// Punto di ingresso su Vercel: passa tutte le richieste /api al server Express di server/index.js
// e prepara il database alla prima chiamata. Non serve modificarlo: le API si cambiano in server/index.js.

const app = require('../server/index.js');
const db = require('../server/db.js');

// Pre-warm database initialization during serverless cold starts
db.initDb().catch((err) => {
  console.error('[PawLink Serverless] Error during DB warm-up:', err.message);
});

module.exports = (req, res) => {
  return app(req, res);
};
