import 'dotenv/config';
import { createApp } from './app.js';
import { PORT, HOST } from './config.js';

const { app, db } = createApp();

const server = app.listen(PORT, HOST, () => {
  console.log(`MyPortfolio server listening on http://${HOST}:${PORT}`);
});

function shutdown() {
  console.log('\nShutting down...');
  server.close(() => {
    try {
      db.close();
    } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
