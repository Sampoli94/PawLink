const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = 'pawlink-secret-key-12345';

// Middlewares
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure Uploads & DB folders exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const DB_FILE = path.join(__dirname, 'database.json');

// Initial Database Structure
const initialDb = {
  users: [],
  reports: [],
  chats: [],
  rewards: [
    { id: 'rew-1', title: 'Sconto 10% cibo cani/gatti', points: 100, partner: 'PetStore Gioia' },
    { id: 'rew-2', title: 'Visita controllo gratuita', points: 300, partner: 'Clinica Vet Croce Azzurra' },
    { id: 'rew-3', title: 'Antiparassitario in omaggio', points: 150, partner: 'Farmacia degli Animali' }
  ],
  vets: [
    { id: 'vet-1', name: 'Dr. Rossi - Clinica Vet Croce Azzurra', lat: 38.4285, lng: 15.9012, address: 'Via Roma 10, Gioia Tauro', phone: '0966 123456', emergency24h: true, verified: true },
    { id: 'vet-2', name: 'Dr.ssa Bianchi - Studio Veterinario', lat: 38.4190, lng: 15.8950, address: 'Via Garibaldi 45, Palmi', phone: '0966 789012', emergency24h: false, verified: true }
  ],
  stores: [
    { id: 'store-1', name: 'PetStore Gioia - Cibo & Accessori', lat: 38.4250, lng: 15.9050, address: 'S.S. 111, Gioia Tauro', phone: '0966 543210' },
    { id: 'store-2', name: 'Supermercato Conad - Reparto Animali', lat: 38.4310, lng: 15.8990, address: 'Via Nazionale, Gioia Tauro', phone: '0966 999888' }
  ]
};

// Database Helpers
function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2));
    return initialDb;
  }
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return initialDb;
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Multer Config for Photo Upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// Authenticate Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Token mancante' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Token non valido' });
    req.user = user;
    next();
  });
}

// --- AUTH APIS ---

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, role, phone, vetDetails, shelterDetails } = req.body;
  if (!email || !password || !name || !role) {
    return res.status(400).json({ message: 'Campi obbligatori mancanti' });
  }

  const db = readDb();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ message: 'Utente già registrato' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: 'usr-' + Date.now(),
      email,
      password: hashedPassword,
      name,
      role, // 'cittadino', 'volontario', 'veterinario', 'rifugio'
      phone: phone || '',
      points: 0,
      verified: role === 'cittadino' || role === 'volontario' ? false : false, // veterinarians and shelters verified manually
      vetDetails: role === 'veterinario' ? vetDetails : null,
      shelterDetails: role === 'rifugio' ? shelterDetails : null,
      createdAt: new Date().toISOString()
    };

    db.users.push(newUser);
    writeDb(db);

    const token = jwt.sign({ id: newUser.id, email: newUser.email, role: newUser.role, name: newUser.name }, JWT_SECRET);
    res.status(201).json({ token, user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, points: newUser.points } });
  } catch (err) {
    res.status(500).json({ message: 'Errore durante la registrazione' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Inserisci email e password' });
  }

  const db = readDb();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(400).json({ message: 'Credenziali non valide' });
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return res.status(400).json({ message: 'Credenziali non valide' });
  }

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, points: user.points } });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const db = readDb();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'Utente non trovato' });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, points: user.points, verified: user.verified, phone: user.phone });
});

// --- REPORTS APIS ---

app.get('/api/reports', (req, res) => {
  const db = readDb();
  res.json(db.reports);
});

// Helper for mock image/content moderation
function analyzeContentForModeration(description) {
  const keywordsGrave = ['sangue', 'ferita', 'investito', 'ferito', 'grave', 'muore', 'violenza', 'maltrattamento', 'maltrattato'];
  const textLower = description.toLowerCase();
  
  // Simulated moderation - if keywords related to injuries are found, mark as sensitive (blur)
  const isSensitive = keywordsGrave.some(k => textLower.includes(k));
  
  // Simulated nudity/obscenity block
  const containsObscene = ['nudo', 'cazzo', 'figa', 'porno'].some(k => textLower.includes(k));
  
  return { isSensitive, containsObscene };
}

app.post('/api/reports', authenticateToken, upload.single('photo'), (req, res) => {
  const { animalType, description, latitude, longitude } = req.body;
  if (!animalType || !description || !latitude || !longitude) {
    return res.status(400).json({ message: 'Dati obbligatori mancanti' });
  }

  const moderation = analyzeContentForModeration(description);
  if (moderation.containsObscene) {
    return res.status(400).json({ message: 'La segnalazione contiene linguaggio inappropriato o immagini non consentite.' });
  }

  const db = readDb();
  const newReport = {
    id: 'rep-' + Date.now(),
    reporterId: req.user.id,
    reporterName: req.user.name,
    animalType, // 'cane', 'gatto', 'altro'
    description,
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    photoUrl: req.file ? `/uploads/${req.file.filename}` : null,
    status: 'segnalato', // 'segnalato', 'in_carico', 'risolto'
    volunteerId: null,
    volunteerName: null,
    sensitive: moderation.isSensitive, // triggers image blur in frontend
    comments: [],
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString()
  };

  db.reports.push(newReport);
  writeDb(db);

  // Simulated notification system trigger
  res.status(201).json(newReport);
});

// Take charge of report
app.patch('/api/reports/:id/take-charge', authenticateToken, (req, res) => {
  const db = readDb();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ message: 'Segnalazione non trovata' });

  if (report.status !== 'segnalato') {
    return res.status(400).json({ message: 'Questa segnalazione è già in gestione o risolta' });
  }

  report.status = 'in_carico';
  report.volunteerId = req.user.id;
  report.volunteerName = req.user.name;
  report.lastUpdatedAt = new Date().toISOString();

  // Create automatic chat for this report
  const newChat = {
    id: 'chat-rep-' + report.id,
    reportId: report.id,
    animalType: report.animalType,
    members: [report.reporterId, req.user.id],
    messages: [
      {
        senderId: 'system',
        senderName: 'Sistema PawLink',
        text: `Il volontario ${req.user.name} ha preso in carico la segnalazione. Usate questa chat per coordinare il soccorso!`,
        timestamp: new Date().toISOString()
      }
    ]
  };
  db.chats.push(newChat);

  writeDb(db);
  res.json({ report, chat: newChat });
});

// Release charge
app.patch('/api/reports/:id/release', authenticateToken, (req, res) => {
  const db = readDb();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ message: 'Segnalazione non trovata' });

  if (report.volunteerId !== req.user.id) {
    return res.status(403).json({ message: 'Non hai in carico questa segnalazione' });
  }

  report.status = 'segnalato';
  report.volunteerId = null;
  report.volunteerName = null;
  report.lastUpdatedAt = new Date().toISOString();

  writeDb(db);
  res.json(report);
});

// Resolve report (awards points)
app.patch('/api/reports/:id/resolve', authenticateToken, (req, res) => {
  const db = readDb();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ message: 'Segnalazione non trovata' });

  if (report.volunteerId !== req.user.id && report.reporterId !== req.user.id) {
    return res.status(403).json({ message: 'Solo il volontario incaricato o il segnalatore possono risolverla' });
  }

  report.status = 'risolto';
  report.lastUpdatedAt = new Date().toISOString();

  // Award points to volunteer (50 points for resolving a report)
  if (report.volunteerId) {
    const volunteer = db.users.find(u => u.id === report.volunteerId);
    if (volunteer) {
      volunteer.points += 50;
    }
  }

  // Also award points to reporter (20 points for making the report)
  const reporter = db.users.find(u => u.id === report.reporterId);
  if (reporter) {
    reporter.points += 20;
  }

  writeDb(db);
  res.json(report);
});

// --- CHAT APIS ---

// Get active chats for user
app.get('/api/chats', authenticateToken, (req, res) => {
  const db = readDb();
  const userChats = db.chats.filter(c => c.members.includes(req.user.id));
  res.json(userChats);
});

// Get chat messages
app.get('/api/chats/:id', authenticateToken, (req, res) => {
  const db = readDb();
  const chat = db.chats.find(c => c.id === req.params.id);
  if (!chat) return res.status(404).json({ message: 'Chat non trovata' });
  if (!chat.members.includes(req.user.id)) return res.status(403).json({ message: 'Non hai accesso a questa chat' });

  res.json(chat);
});

// Send message
app.post('/api/chats/:id/messages', authenticateToken, (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ message: 'Testo vuoto' });

  const db = readDb();
  const chat = db.chats.find(c => c.id === req.params.id);
  if (!chat) return res.status(404).json({ message: 'Chat non trovata' });
  if (!chat.members.includes(req.user.id)) return res.status(403).json({ message: 'Non hai accesso a questa chat' });

  const newMessage = {
    senderId: req.user.id,
    senderName: req.user.name,
    text,
    timestamp: new Date().toISOString()
  };

  chat.messages.push(newMessage);
  writeDb(db);
  res.status(201).json(newMessage);
});

// --- MAP OVERLAYS APIS ---

app.get('/api/map/overlays', (req, res) => {
  const db = readDb();
  
  // Calculate Hotspots based on active reports (within 0.01 coordinate radius)
  const activeReports = db.reports.filter(r => r.status !== 'risolto');
  const hotspots = [];
  
  activeReports.forEach(r => {
    let found = false;
    for (let h of hotspots) {
      const dist = Math.sqrt(Math.pow(h.lat - r.latitude, 2) + Math.pow(h.lng - r.longitude, 2));
      if (dist < 0.015) {
        h.count += 1;
        h.lat = (h.lat * (h.count - 1) + r.latitude) / h.count;
        h.lng = (h.lng * (h.count - 1) + r.longitude) / h.count;
        found = true;
        break;
      }
    }
    if (!found) {
      hotspots.push({ id: 'hs-' + r.id, lat: r.latitude, lng: r.longitude, count: 1 });
    }
  });

  res.json({
    vets: db.vets,
    stores: db.stores,
    hotspots: hotspots.filter(h => h.count >= 2)
  });
});

// --- REWARDS / GAMIFICATION ---

app.get('/api/rewards', (req, res) => {
  const db = readDb();
  res.json(db.rewards);
});

app.post('/api/rewards/:id/redeem', authenticateToken, (req, res) => {
  const db = readDb();
  const user = db.users.find(u => u.id === req.user.id);
  const reward = db.rewards.find(r => r.id === req.params.id);

  if (!user || !reward) return res.status(404).json({ message: 'Utente o premio non trovato' });

  if (user.points < reward.points) {
    return res.status(400).json({ message: 'Punti insufficienti per riscattare questo premio' });
  }

  user.points -= reward.points;
  writeDb(db);

  res.json({
    message: `Premio riscattato con successo! Codice coupon: PWL-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
    userPoints: user.points
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server PawLink avviato su http://localhost:${PORT}`);
});
