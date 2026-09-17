-- PawLink Database Schema for PostgreSQL (Vercel Postgres / Supabase)

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

-- Initial seed data (inserted only if not already present)
INSERT INTO rewards (id, title, points, partner) VALUES
  ('rew-1', 'Sconto 10% cibo cani/gatti', 100, 'PetStore Convenzionato'),
  ('rew-2', 'Visita controllo gratuita', 300, 'Clinica Vet Croce Azzurra'),
  ('rew-3', 'Antiparassitario in omaggio', 150, 'Farmacia degli Animali')
ON CONFLICT (id) DO NOTHING;

INSERT INTO vets (id, name, lat, lng, address, phone, emergency24h, verified) VALUES
  ('vet-1', 'Dr. Rossi - Clinica Vet Croce Azzurra', 38.4285, 15.9012, 'Via Roma 10', '02 12345678', true, true),
  ('vet-2', 'Dr.ssa Bianchi - Studio Veterinario', 38.4190, 15.8950, 'Via Garibaldi 45', '02 78901234', false, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO stores (id, name, lat, lng, address, phone) VALUES
  ('store-1', 'PetStore - Cibo & Accessori', 38.4250, 15.9050, 'Via Nazionale 12', '02 54321098'),
  ('store-2', 'Supermercato Conad - Reparto Animali', 38.4310, 15.8990, 'Corso Umberto 80', '02 99988877')
ON CONFLICT (id) DO NOTHING;
