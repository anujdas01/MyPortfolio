import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb, openDemoDb } from './db/database.js';
import { seedDemoData } from './db/seed-demo.js';
import { CLIENT_ORIGINS } from './config.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import accountRoutes from './routes/accounts.js';
import reportRoutes from './routes/reports.js';
import settingRoutes from './routes/settings.js';
import exportRoutes from './routes/export.js';
import { notFound, errorHandler } from './middleware/error.js';
import { HttpError } from './utils/httpError.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Builds the full versioned API (auth/users/accounts/reports/settings/export)
// against a single database handle so the same surface can be mounted twice.
function buildApiRouter(db, opts = {}) {
  const router = express.Router();
  router.use('/auth', authRoutes(db, opts));
  router.use('/users', userRoutes(db));
  router.use('/accounts', accountRoutes(db));
  router.use('/reports', reportRoutes(db));
  router.use('/settings', settingRoutes(db, opts));
  router.use('/export', exportRoutes(db));
  return router;
}

export function createApp() {
  const db = openDb();
  const app = express();
  app.disable('x-powered-by');
  // Security headers (helmet-lite without extra dependency)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  });

  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || CLIENT_ORIGINS.includes(origin)),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '25mb' }));
  // Handle malformed JSON
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    return next(err);
  });
  app.use(cookieParser());

  app.get('/api/health', (_req, res) =>
    res.json({
      ok: true,
      name: 'MyPortfolio API',
      demo: true,
      time: new Date().toISOString(),
    })
  );

  // Real data lives here. Demo-scoped sessions are refused outright so a
  // visitor clicking around the showcase can never touch real accounts.
  // The scope claim is read unverified here purely for routing; the request
  // is still fully verified by requireAuth inside each router.
  const blockDemoTokens = (req, _res, next) => {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      const payload = jwt.decode(header.slice(7));
      if (payload?.scope === 'demo') {
        return next(new HttpError(401, 'This session only has access to the demo environment'));
      }
    }
    next();
  };
  app.use(
    ['/api/auth', '/api/users', '/api/accounts', '/api/reports', '/api/settings', '/api/export'],
    blockDemoTokens
  );

  app.use('/api', buildApiRouter(db));

  // Isolated customer demo at /api/demo — its own in-memory SQLite database
  // seeded with sample data. Nothing here ever touches the real database,
  // and it evaporates when the server restarts.
  const demoDb = openDemoDb();
  seedDemoData(demoDb);
  app.use('/api/demo', buildApiRouter(demoDb, { basePath: '/api/demo', demo: true }));

  app.use('/api', notFound);

  const dist = path.resolve(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return { app, db };
}
