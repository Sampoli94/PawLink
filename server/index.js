require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'pawlink-secret-key-12345';

// Middlewares
app.use(cors());
app.use(express.json());

// Ensure Uploads folder exists (using writeable /tmp folder when deployed on Vercel)
const uploadsDir = process.env.VERCEL
  ? path.join('/tmp', 'uploads')
  : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
  } catch (e) {
    // Ignored in restricted environments
  }
}

app.use('/uploads', express.static(uploadsDir));

// Multer Config for Photo Upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'));
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

// Helper for mock image/content moderation
function analyzeContentForModeration(description) {
  const keywordsGrave = ['sangue', 'ferita', 'investito', 'ferito', 'grave', 'muore', 'violenza', 'maltrattamento', 'maltrattato'];
  const textLower = (description || '').toLowerCase();

  // Simulated moderation - if keywords related to injuries are found, mark as sensitive (blur)
  const isSensitive = keywordsGrave.some(k => textLower.includes(k));

  // Simulated nudity/obscenity block
  const containsObscene = ['nudo', 'cazzo', 'figa', 'porno'].some(k => textLower.includes(k));

  return { isSensitive, containsObscene };
}

// --- AUTH APIS ---

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, role, phone, vetDetails, shelterDetails } = req.body;
  if (!email || !password || !name || !role) {
    return res.status(400).json({ message: 'Campi obbligatori mancanti' });
  }

  try {
    const existing = await db.findUserByEmail(email);
    if (existing) {
      return res.status(400).json({ message: 'Utente già registrato' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: 'usr-' + Date.now(),
      email,
      password: hashedPassword,
      name,
      role, // 'cittadino', 'volontario', 'veterinario', 'rifugio'
      phone: phone || '',
      points: 0,
      verified: false,
      vetDetails: role === 'veterinario' ? vetDetails : null,
      shelterDetails: role === 'rifugio' ? shelterDetails : null,
      createdAt: new Date().toISOString()
    };

    const created = await db.createUser(newUser);
    const token = jwt.sign(
      { id: created.id, email: created.email, role: created.role, name: created.name },
      JWT_SECRET
    );

    res.status(201).json({
      token,
      user: {
        id: created.id,
        name: created.name,
        email: created.email,
        role: created.role,
        points: created.points
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Errore durante la registrazione' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Inserisci email e password' });
  }

  try {
    const user = await db.findUserByEmail(email);
    if (!user) {
      return res.status(400).json({ message: 'Credenziali non valide' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ message: 'Credenziali non valide' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        points: user.points
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Errore durante il login' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await db.findUserById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Utente non trovato' });
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      points: user.points,
      verified: user.verified,
      phone: user.phone
    });
  } catch (err) {
    console.error('Auth me error:', err);
    res.status(500).json({ message: 'Errore caricamento dati utente' });
  }
});

// --- REPORTS APIS ---

app.get('/api/reports', async (req, res) => {
  try {
    const reports = await db.getReports();
    res.json(reports);
  } catch (err) {
    console.error('Get reports error:', err);
    res.status(500).json({ message: 'Errore nel recupero delle segnalazioni' });
  }
});

app.post('/api/reports', authenticateToken, upload.single('photo'), async (req, res) => {
  const { animalType, description, latitude, longitude } = req.body;
  if (!animalType || !description || !latitude || !longitude) {
    return res.status(400).json({ message: 'Dati obbligatori mancanti' });
  }

  const moderation = analyzeContentForModeration(description);
  if (moderation.containsObscene) {
    return res.status(400).json({ message: 'La segnalazione contiene linguaggio inappropriato o immagini non consentite.' });
  }

  try {
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

    const created = await db.createReport(newReport);
    res.status(201).json(created);
  } catch (err) {
    console.error('Create report error:', err);
    res.status(500).json({ message: 'Errore nel salvataggio della segnalazione' });
  }
});

// Take charge of report
app.patch('/api/reports/:id/take-charge', authenticateToken, async (req, res) => {
  try {
    const report = await db.findReportById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Segnalazione non trovata' });

    if (report.status !== 'segnalato') {
      return res.status(400).json({ message: 'Questa segnalazione è già in gestione o risolta' });
    }

    const updated = await db.updateReport(report.id, {
      status: 'in_carico',
      volunteerId: req.user.id,
      volunteerName: req.user.name,
      lastUpdatedAt: new Date().toISOString()
    });

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
      ],
      createdAt: new Date().toISOString()
    };
    await db.createChat(newChat);

    res.json({ report: updated, chat: newChat });
  } catch (err) {
    console.error('Take charge error:', err);
    res.status(500).json({ message: 'Errore nella presa in carico' });
  }
});

// Release charge
app.patch('/api/reports/:id/release', authenticateToken, async (req, res) => {
  try {
    const report = await db.findReportById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Segnalazione non trovata' });

    if (report.volunteerId !== req.user.id) {
      return res.status(403).json({ message: 'Non hai in carico questa segnalazione' });
    }

    const updated = await db.updateReport(report.id, {
      status: 'segnalato',
      volunteerId: null,
      volunteerName: null,
      lastUpdatedAt: new Date().toISOString()
    });

    res.json(updated);
  } catch (err) {
    console.error('Release report error:', err);
    res.status(500).json({ message: 'Errore nel rilascio della segnalazione' });
  }
});

// Resolve report (awards points)
app.patch('/api/reports/:id/resolve', authenticateToken, async (req, res) => {
  try {
    const report = await db.findReportById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Segnalazione non trovata' });

    if (report.volunteerId !== req.user.id && report.reporterId !== req.user.id) {
      return res.status(403).json({ message: 'Solo il volontario incaricato o il segnalatore possono risolverla' });
    }

    const updated = await db.updateReport(report.id, {
      status: 'risolto',
      lastUpdatedAt: new Date().toISOString()
    });

    // Award points to volunteer (50 points for resolving a report)
    if (report.volunteerId) {
      await db.updateUserPoints(report.volunteerId, 50);
    }

    // Also award points to reporter (20 points for making the report)
    if (report.reporterId) {
      await db.updateUserPoints(report.reporterId, 20);
    }

    res.json(updated);
  } catch (err) {
    console.error('Resolve report error:', err);
    res.status(500).json({ message: 'Errore nella risoluzione della segnalazione' });
  }
});

// --- CHAT APIS ---

// Get active chats for user
app.get('/api/chats', authenticateToken, async (req, res) => {
  try {
    const userChats = await db.getUserChats(req.user.id);
    res.json(userChats);
  } catch (err) {
    console.error('Get chats error:', err);
    res.status(500).json({ message: 'Errore nel recupero delle chat' });
  }
});

// Get chat messages
app.get('/api/chats/:id', authenticateToken, async (req, res) => {
  try {
    const chat = await db.findChatById(req.params.id);
    if (!chat) return res.status(404).json({ message: 'Chat non trovata' });
    if (!chat.members.includes(req.user.id)) {
      return res.status(403).json({ message: 'Non hai accesso a questa chat' });
    }

    res.json(chat);
  } catch (err) {
    console.error('Get chat error:', err);
    res.status(500).json({ message: 'Errore nel recupero della chat' });
  }
});

// Send message
app.post('/api/chats/:id/messages', authenticateToken, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ message: 'Testo vuoto' });

  try {
    const chat = await db.findChatById(req.params.id);
    if (!chat) return res.status(404).json({ message: 'Chat non trovata' });
    if (!chat.members.includes(req.user.id)) {
      return res.status(403).json({ message: 'Non hai accesso a questa chat' });
    }

    const newMessage = {
      senderId: req.user.id,
      senderName: req.user.name,
      text,
      timestamp: new Date().toISOString()
    };

    await db.addChatMessage(chat.id, newMessage);
    res.status(201).json(newMessage);
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ message: 'Errore nell\'invio del messaggio' });
  }
});

// --- MAP OVERLAYS APIS ---

app.get('/api/map/overlays', async (req, res) => {
  try {
    const [allReports, vets, stores] = await Promise.all([
      db.getReports(),
      db.getVets(),
      db.getStores()
    ]);

    // Calculate Hotspots based on active reports (within 0.015 coordinate radius)
    const activeReports = allReports.filter(r => r.status !== 'risolto');
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
      vets,
      stores,
      hotspots: hotspots.filter(h => h.count >= 2)
    });
  } catch (err) {
    console.error('Map overlays error:', err);
    res.status(500).json({ message: 'Errore nel recupero degli overlay mappa' });
  }
});

// --- REWARDS / GAMIFICATION ---

app.get('/api/rewards', async (req, res) => {
  try {
    const rewards = await db.getRewards();
    res.json(rewards);
  } catch (err) {
    console.error('Get rewards error:', err);
    res.status(500).json({ message: 'Errore nel recupero dei premi' });
  }
});

app.post('/api/rewards/:id/redeem', authenticateToken, async (req, res) => {
  try {
    const [user, reward] = await Promise.all([
      db.findUserById(req.user.id),
      db.findRewardById(req.params.id)
    ]);

    if (!user || !reward) return res.status(404).json({ message: 'Utente o premio non trovato' });

    if (user.points < reward.points) {
      return res.status(400).json({ message: 'Punti insufficienti per riscattare questo premio' });
    }

    const updatedUser = await db.updateUserPoints(user.id, -reward.points);

    res.json({
      message: `Premio riscattato con successo! Codice coupon: PWL-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
      userPoints: updatedUser ? updatedUser.points : user.points - reward.points
    });
  } catch (err) {
    console.error('Redeem reward error:', err);
    res.status(500).json({ message: 'Errore nel riscatto del premio' });
  }
});

// Temporary diagnostic endpoint (no secrets exposed) - to be removed after debugging
app.get('/api/debug/db-diag', async (req, res) => {
  const dns = require('dns').promises;
  const { URL } = require('url');
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL_NON_POOLING || '';
  if (!raw) return res.json({ configured: false });
  let host = null, port = null, pathname = null;
  try {
    const u = new URL(raw);
    host = u.hostname;
    port = u.port;
    pathname = u.pathname;
  } catch (e) {
    return res.json({ configured: true, parseError: e.message });
  }
  let dnsResult = null, dnsError = null;
  try {
    dnsResult = await dns.lookup(host, { all: true, verbatim: true });
  } catch (e) {
    dnsError = e.message;
  }
  let connectOk = false, connectError = null;
  try {
    const { Client } = require('pg');
    const testClient = new Client({
      connectionString: raw,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    await testClient.connect();
    await testClient.query('SELECT 1');
    await testClient.end();
    connectOk = true;
  } catch (e) {
    connectError = e.message + (e.cause ? ' | cause: ' + e.cause.message : '');
  }
  res.json({
    configured: true,
    host,
    port,
    pathname,
    dns: dnsResult,
    dnsError,
    connectOk,
    connectError,
    nodeVersion: process.version,
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[PawLink Server Error]', err);
  res.status(500).json({ message: 'Errore interno del server', error: err.message });
});

// Export app for serverless / testing
module.exports = app;

// Start Server locally if run directly
if (require.main === module) {
  db.initDb().then(() => {
    app.listen(PORT, () => {
      console.log(`Server PawLink avviato su http://localhost:${PORT}`);
    });
  }).catch((err) => {
    console.error('Failed to start server:', err);
  });
}
