require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const connectionString =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

const isPg = Boolean(connectionString);

const pgClientConfig = isPg
  ? {
      connectionString,
      ssl:
        connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
          ? false
          : { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    }
  : null;

// In ambiente serverless (Vercel) un Pool "pg-pool" tradizionale vive tra
// un'invocazione e l'altra della stessa funzione: quando Vercel "congela"
// l'istanza e poi la ripristina, lo stato interno del pool (client in coda,
// socket ormai morti) puo' restare inconsistente. Il sintomo osservato in
// produzione era che OGNI pool.query() falliva con "Connection terminated
// due to connection timeout" — non perche' il database fosse irraggiungibile
// (un endpoint diagnostico con una connessione "usa e getta" si connetteva
// sempre in pochi millisecondi), ma perche' pg-pool restava bloccato ad
// aspettare un client dal pool che non si liberava mai.
// Soluzione: eliminare del tutto il pool persistente. Ogni query apre una
// connessione dedicata e la chiude subito dopo. E' leggermente piu' lento
// (un handshake TCP/TLS in piu' per richiesta) ma molto piu' affidabile in
// un contesto "una funzione per richiesta" come questo, e coerente con come
// PgBouncer (la pooler di Supabase su porta 6543) gestisce comunque le
// connessioni a monte.
async function runWithFreshClient(fn) {
  const client = new Client(pgClientConfig);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    client.end().catch(() => {});
  }
}

let pool = null;
if (isPg) {
  pool = {
    query: async (text, params) => {
      try {
        return await runWithFreshClient((client) => client.query(text, params));
      } catch (err) {
        const msg = (err && err.message) || '';
        const isTransient =
          msg.includes('Connection terminated') ||
          msg.includes('timeout') ||
          msg.includes('ECONNRESET') ||
          err?.code === 'ECONNRESET' ||
          err?.code === '57P01';
        if (!isTransient) throw err;
        console.warn('[PawLink DB] Connessione al database fallita, ritento una volta con una nuova connessione...');
        return await runWithFreshClient((client) => client.query(text, params));
      }
    },
    connect: async () => {
      const client = new Client(pgClientConfig);
      await client.connect();
      client.release = () => client.end().catch(() => {});
      return client;
    },
    on: () => {},
    end: async () => {},
  };
}

// Fallback JSON DB configuration
const DB_FILE = process.env.VERCEL
  ? path.join('/tmp', 'database.json')
  : path.join(__dirname, 'database.json');

const initialDb = {
  users: [],
  reports: [],
  chats: [],
  rewards: [
    { id: 'rew-1', title: 'Sconto 10% cibo cani/gatti', points: 100, partner: 'PetStore Convenzionato' },
    { id: 'rew-2', title: 'Visita controllo gratuita', points: 300, partner: 'Clinica Vet Croce Azzurra' },
    { id: 'rew-3', title: 'Antiparassitario in omaggio', points: 150, partner: 'Farmacia degli Animali' }
  ],
  vets: [
    { id: 'vet-1', name: 'Dr. Rossi - Clinica Vet Croce Azzurra', lat: 38.4285, lng: 15.9012, address: 'Via Roma 10', phone: '02 12345678', emergency24h: true, verified: true },
    { id: 'vet-2', name: 'Dr.ssa Bianchi - Studio Veterinario', lat: 38.4190, lng: 15.8950, address: 'Via Garibaldi 45', phone: '02 78901234', emergency24h: false, verified: true }
  ],
  stores: [
    { id: 'store-1', name: 'PetStore - Cibo & Accessori', lat: 38.4250, lng: 15.9050, address: 'Via Nazionale 12', phone: '02 54321098' },
    { id: 'store-2', name: 'Supermercato Conad - Reparto Animali', lat: 38.4310, lng: 15.8990, address: 'Corso Umberto 80', phone: '02 99988877' }
  ]
};

function readJsonDb() {
  if (!fs.existsSync(DB_FILE)) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2));
    } catch (e) {
      // Ignored if read-only filesystem
    }
    return initialDb;
  }
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return initialDb;
  }
}

function writeJsonDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[PawLink DB] Error writing to fallback JSON file:', err.message);
  }
}

// Data Mappers (Postgres snake_case -> Frontend camelCase)
function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    password: row.password,
    name: row.name,
    role: row.role,
    phone: row.phone || '',
    points: parseInt(row.points, 10) || 0,
    verified: Boolean(row.verified),
    vetDetails: row.vet_details || null,
    shelterDetails: row.shelter_details || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
  };
}

function mapReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    reporterId: row.reporter_id,
    reporterName: row.reporter_name,
    animalType: row.animal_type,
    description: row.description,
    latitude: parseFloat(row.latitude),
    longitude: parseFloat(row.longitude),
    photoUrl: row.photo_url || null,
    status: row.status,
    volunteerId: row.volunteer_id || null,
    volunteerName: row.volunteer_name || null,
    sensitive: Boolean(row.sensitive),
    comments: row.comments || [],
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    lastUpdatedAt: row.last_updated_at ? new Date(row.last_updated_at).toISOString() : new Date().toISOString()
  };
}

function mapChat(row) {
  if (!row) return null;
  return {
    id: row.id,
    reportId: row.report_id,
    animalType: row.animal_type || null,
    members: row.members || [],
    messages: row.messages || [],
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
  };
}

function mapReward(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    points: parseInt(row.points, 10),
    partner: row.partner
  };
}

function mapVet(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    lat: parseFloat(row.lat),
    lng: parseFloat(row.lng),
    address: row.address || '',
    phone: row.phone || '',
    emergency24h: Boolean(row.emergency24h),
    verified: Boolean(row.verified)
  };
}

function mapStore(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    lat: parseFloat(row.lat),
    lng: parseFloat(row.lng),
    address: row.address || '',
    phone: row.phone || ''
  };
}

// Database Initialization & Migration
let isInitialized = false;
let initPromise = null;

async function initDb() {
  if (isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!isPg) {
      console.log('[PawLink DB] Using file-based JSON storage. To connect persistent PostgreSQL (Supabase / Vercel Postgres), set POSTGRES_URL or DATABASE_URL in environment.');
      isInitialized = true;
      return;
    }

    try {
      console.log('[PawLink DB] Initializing PostgreSQL database tables...');
      const client = await pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(100) PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL,
            phone VARCHAR(100) DEFAULT '',
            points INTEGER DEFAULT 0,
            verified BOOLEAN DEFAULT FALSE,
            vet_details JSONB DEFAULT NULL,
            shelter_details JSONB DEFAULT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS reports (
            id VARCHAR(100) PRIMARY KEY,
            reporter_id VARCHAR(100) NOT NULL,
            reporter_name VARCHAR(255) NOT NULL,
            animal_type VARCHAR(50) NOT NULL,
            description TEXT NOT NULL,
            latitude DOUBLE PRECISION NOT NULL,
            longitude DOUBLE PRECISION NOT NULL,
            photo_url TEXT DEFAULT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'segnalato',
            volunteer_id VARCHAR(100) DEFAULT NULL,
            volunteer_name VARCHAR(255) DEFAULT NULL,
            sensitive BOOLEAN DEFAULT FALSE,
            comments JSONB DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            last_updated_at TIMESTAMPTZ DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS chats (
            id VARCHAR(100) PRIMARY KEY,
            report_id VARCHAR(100) NOT NULL,
            animal_type VARCHAR(50) DEFAULT NULL,
            members JSONB NOT NULL DEFAULT '[]'::jsonb,
            messages JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS rewards (
            id VARCHAR(100) PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            points INTEGER NOT NULL,
            partner VARCHAR(255) NOT NULL
          );

          CREATE TABLE IF NOT EXISTS vets (
            id VARCHAR(100) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            lat DOUBLE PRECISION NOT NULL,
            lng DOUBLE PRECISION NOT NULL,
            address VARCHAR(255) DEFAULT '',
            phone VARCHAR(100) DEFAULT '',
            emergency24h BOOLEAN DEFAULT FALSE,
            verified BOOLEAN DEFAULT TRUE
          );

          CREATE TABLE IF NOT EXISTS stores (
            id VARCHAR(100) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            lat DOUBLE PRECISION NOT NULL,
            lng DOUBLE PRECISION NOT NULL,
            address VARCHAR(255) DEFAULT '',
            phone VARCHAR(100) DEFAULT ''
          );
        `);

        // Seed rewards if empty
        const rewCount = await client.query('SELECT COUNT(*) FROM rewards');
        if (parseInt(rewCount.rows[0].count, 10) === 0) {
          for (const rew of initialDb.rewards) {
            await client.query(
              'INSERT INTO rewards (id, title, points, partner) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
              [rew.id, rew.title, rew.points, rew.partner]
            );
          }
        }

        // Seed vets if empty
        const vetCount = await client.query('SELECT COUNT(*) FROM vets');
        if (parseInt(vetCount.rows[0].count, 10) === 0) {
          for (const vet of initialDb.vets) {
            await client.query(
              'INSERT INTO vets (id, name, lat, lng, address, phone, emergency24h, verified) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING',
              [vet.id, vet.name, vet.lat, vet.lng, vet.address, vet.phone, vet.emergency24h, vet.verified]
            );
          }
        }

        // Seed stores if empty
        const storeCount = await client.query('SELECT COUNT(*) FROM stores');
        if (parseInt(storeCount.rows[0].count, 10) === 0) {
          for (const store of initialDb.stores) {
            await client.query(
              'INSERT INTO stores (id, name, lat, lng, address, phone) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
              [store.id, store.name, store.lat, store.lng, store.address, store.phone]
            );
          }
        }

        // If Postgres users/reports tables are empty and a local database.json has existing records, migrate them!
        const userCount = await client.query('SELECT COUNT(*) FROM users');
        if (parseInt(userCount.rows[0].count, 10) === 0) {
          const jsonDb = readJsonDb();
          if (jsonDb.users && jsonDb.users.length > 0) {
            console.log(`[PawLink DB] Migrating ${jsonDb.users.length} existing users from JSON to PostgreSQL...`);
            for (const u of jsonDb.users) {
              await client.query(
                `INSERT INTO users (id, email, password, name, role, phone, points, verified, vet_details, shelter_details, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 ON CONFLICT (id) DO NOTHING`,
                [
                  u.id,
                  u.email,
                  u.password,
                  u.name,
                  u.role,
                  u.phone || '',
                  u.points || 0,
                  Boolean(u.verified),
                  u.vetDetails ? JSON.stringify(u.vetDetails) : null,
                  u.shelterDetails ? JSON.stringify(u.shelterDetails) : null,
                  u.createdAt || new Date().toISOString()
                ]
              );
            }
          }

          if (jsonDb.reports && jsonDb.reports.length > 0) {
            console.log(`[PawLink DB] Migrating ${jsonDb.reports.length} existing reports from JSON to PostgreSQL...`);
            for (const r of jsonDb.reports) {
              await client.query(
                `INSERT INTO reports (id, reporter_id, reporter_name, animal_type, description, latitude, longitude, photo_url, status, volunteer_id, volunteer_name, sensitive, comments, created_at, last_updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                 ON CONFLICT (id) DO NOTHING`,
                [
                  r.id,
                  r.reporterId,
                  r.reporterName,
                  r.animalType,
                  r.description,
                  r.latitude,
                  r.longitude,
                  r.photoUrl,
                  r.status,
                  r.volunteerId,
                  r.volunteerName,
                  Boolean(r.sensitive),
                  JSON.stringify(r.comments || []),
                  r.createdAt || new Date().toISOString(),
                  r.lastUpdatedAt || new Date().toISOString()
                ]
              );
            }
          }

          if (jsonDb.chats && jsonDb.chats.length > 0) {
            console.log(`[PawLink DB] Migrating ${jsonDb.chats.length} existing chats from JSON to PostgreSQL...`);
            for (const c of jsonDb.chats) {
              await client.query(
                `INSERT INTO chats (id, report_id, animal_type, members, messages, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (id) DO NOTHING`,
                [
                  c.id,
                  c.reportId,
                  c.animalType || null,
                  JSON.stringify(c.members || []),
                  JSON.stringify(c.messages || []),
                  c.createdAt || new Date().toISOString()
                ]
              );
            }
          }
        }

        console.log('[PawLink DB] PostgreSQL database successfully initialized and ready.');
        isInitialized = true;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[PawLink DB] Failed to initialize PostgreSQL tables:', err);
      throw err;
    }
  })();

  return initPromise;
}

// Unified Database API Methods
const db = {
  isPostgres: () => isPg,
  initDb,

  // --- USERS ---
  async findUserByEmail(email) {
    await initDb();
    if (!email) return null;
    if (isPg) {
      const res = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
      return mapUser(res.rows[0]);
    } else {
      const db = readJsonDb();
      const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
      return user || null;
    }
  },

  async findUserById(id) {
    await initDb();
    if (!id) return null;
    if (isPg) {
      const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      return mapUser(res.rows[0]);
    } else {
      const db = readJsonDb();
      const user = db.users.find(u => u.id === id);
      return user || null;
    }
  },

  async createUser(user) {
    await initDb();
    if (isPg) {
      const res = await pool.query(
        `INSERT INTO users (id, email, password, name, role, phone, points, verified, vet_details, shelter_details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          user.id,
          user.email,
          user.password,
          user.name,
          user.role,
          user.phone || '',
          user.points || 0,
          Boolean(user.verified),
          user.vetDetails ? JSON.stringify(user.vetDetails) : null,
          user.shelterDetails ? JSON.stringify(user.shelterDetails) : null,
          user.createdAt || new Date().toISOString()
        ]
      );
      return mapUser(res.rows[0]);
    } else {
      const db = readJsonDb();
      db.users.push(user);
      writeJsonDb(db);
      return user;
    }
  },

  async updateUserPoints(id, delta) {
    await initDb();
    if (isPg) {
      const res = await pool.query(
        'UPDATE users SET points = points + $1 WHERE id = $2 RETURNING *',
        [delta, id]
      );
      return mapUser(res.rows[0]);
    } else {
      const db = readJsonDb();
      const user = db.users.find(u => u.id === id);
      if (user) {
        user.points = (user.points || 0) + delta;
        writeJsonDb(db);
      }
      return user || null;
    }
  },

  // --- REPORTS ---
  async getReports() {
    await initDb();
    if (isPg) {
      const res = await pool.query('SELECT * FROM reports ORDER BY created_at DESC');
      return res.rows.map(mapReport);
    } else {
      const db = readJsonDb();
      return db.reports || [];
    }
  },

  async findReportById(id) {
    await initDb();
    if (isPg) {
      const res = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);
      return mapReport(res.rows[0]);
    } else {
      const db = readJsonDb();
      return db.reports.find(r => r.id === id) || null;
    }
  },

  async createReport(report) {
    await initDb();
    if (isPg) {
      const res = await pool.query(
        `INSERT INTO reports (id, reporter_id, reporter_name, animal_type, description, latitude, longitude, photo_url, status, volunteer_id, volunteer_name, sensitive, comments, created_at, last_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING *`,
        [
          report.id,
          report.reporterId,
          report.reporterName,
          report.animalType,
          report.description,
          report.latitude,
          report.longitude,
          report.photoUrl || null,
          report.status || 'segnalato',
          report.volunteerId || null,
          report.volunteerName || null,
          Boolean(report.sensitive),
          JSON.stringify(report.comments || []),
          report.createdAt || new Date().toISOString(),
          report.lastUpdatedAt || new Date().toISOString()
        ]
      );
      return mapReport(res.rows[0]);
    } else {
      const db = readJsonDb();
      db.reports.push(report);
      writeJsonDb(db);
      return report;
    }
  },

  async updateReport(id, updates) {
    await initDb();
    if (isPg) {
      const fields = [];
      const values = [];
      let idx = 1;

      if (updates.status !== undefined) {
        fields.push(`status = $${idx++}`);
        values.push(updates.status);
      }
      if (updates.volunteerId !== undefined) {
        fields.push(`volunteer_id = $${idx++}`);
        values.push(updates.volunteerId);
      }
      if (updates.volunteerName !== undefined) {
        fields.push(`volunteer_name = $${idx++}`);
        values.push(updates.volunteerName);
      }
      if (updates.lastUpdatedAt !== undefined) {
        fields.push(`last_updated_at = $${idx++}`);
        values.push(updates.lastUpdatedAt);
      }

      values.push(id);
      const sql = `UPDATE reports SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
      const res = await pool.query(sql, values);
      return mapReport(res.rows[0]);
    } else {
      const db = readJsonDb();
      const report = db.reports.find(r => r.id === id);
      if (report) {
        Object.assign(report, updates);
        writeJsonDb(db);
      }
      return report || null;
    }
  },

  // --- CHATS ---
  async getUserChats(userId) {
    await initDb();
    if (isPg) {
      const res = await pool.query(
        'SELECT * FROM chats WHERE members @> $1::jsonb ORDER BY created_at DESC',
        [JSON.stringify([userId])]
      );
      return res.rows.map(mapChat);
    } else {
      const db = readJsonDb();
      return (db.chats || []).filter(c => c.members && c.members.includes(userId));
    }
  },

  async findChatById(id) {
    await initDb();
    if (isPg) {
      const res = await pool.query('SELECT * FROM chats WHERE id = $1', [id]);
      return mapChat(res.rows[0]);
    } else {
      const db = readJsonDb();
      return (db.chats || []).find(c => c.id === id) || null;
    }
  },

  async createChat(chat) {
    await initDb();
    if (isPg) {
      const res = await pool.query(
        `INSERT INTO chats (id, report_id, animal_type, members, messages, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          chat.id,
          chat.reportId,
          chat.animalType || null,
          JSON.stringify(chat.members || []),
          JSON.stringify(chat.messages || []),
          chat.createdAt || new Date().toISOString()
        ]
      );
      return mapChat(res.rows[0]);
    } else {
      const db = readJsonDb();
      db.chats.push(chat);
      writeJsonDb(db);
      return chat;
    }
  },

  async addChatMessage(chatId, message) {
    await initDb();
    if (isPg) {
      const res = await pool.query(
        `UPDATE chats
         SET messages = messages || $1::jsonb
         WHERE id = $2
         RETURNING *`,
        [JSON.stringify([message]), chatId]
      );
      return mapChat(res.rows[0]);
    } else {
      const db = readJsonDb();
      const chat = (db.chats || []).find(c => c.id === chatId);
      if (chat) {
        chat.messages = chat.messages || [];
        chat.messages.push(message);
        writeJsonDb(db);
      }
      return chat || null;
    }
  },

  // --- REWARDS ---
  async getRewards() {
    await initDb();
    if (isPg) {
      const res = await pool.query('SELECT * FROM rewards ORDER BY points ASC');
      return res.rows.map(mapReward);
    } else {
      const db = readJsonDb();
      return db.rewards || [];
    }
  },

  async findRewardById(id) {
    await initDb();
    if (isPg) {
      const res = await pool.query('SELECT * FROM rewards WHERE id = $1', [id]);
      return mapReward(res.rows[0]);
    } else {
      const db = readJsonDb();
      return (db.rewards || []).find(r => r.id === id) || null;
    }
  },

  // --- VETS & STORES ---
  async getVets() {
    await initDb();
    if (isPg) {
      const res = await pool.query('SELECT * FROM vets ORDER BY name ASC');
      return res.rows.map(mapVet);
    } else {
      const db = readJsonDb();
      return db.vets || [];
    }
  },

  async getStores() {
    await initDb();
    if (isPg) {
      const res = await pool.query('SELECT * FROM stores ORDER BY name ASC');
      return res.rows.map(mapStore);
    } else {
      const db = readJsonDb();
      return db.stores || [];
    }
  }
};

module.exports = db;
