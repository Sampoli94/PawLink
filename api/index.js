const app = require('../server/index.js');
const db = require('../server/db.js');

// Pre-warm database initialization during serverless cold starts
db.initDb().catch((err) => {
  console.error('[PawLink Serverless] Error during DB warm-up:', err.message);
});

module.exports = (req, res) => {
  return app(req, res);
};
