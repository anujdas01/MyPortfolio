import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { requireFields } from '../utils/validate.js';
import { ALLOWED_THEMES } from '../config.js';
import { CATEGORY_SEED } from '../db/database.js';
import { seedDemoData } from '../db/seed-demo.js';

// opts.demo: when true (isolated demo environment), reset-data skips the
// password check and restores the sample showcase data instead.
export default function settingRoutes(db, opts = {}) {
  const { demo = false } = opts;
  const r = Router();
  r.use(requireAuth);

  r.get('/themes', (_req, res) => {
    res.json({ themes: ALLOWED_THEMES });
  });

  r.put('/theme', (req, res) => {
    requireFields(req.body || {}, ['theme']);
    const { theme } = req.body;
    if (!ALLOWED_THEMES.includes(theme)) {
      throw new HttpError(400, `Theme must be one of: ${ALLOWED_THEMES.join(', ')}`);
    }
    db.prepare('UPDATE users SET theme_pref = ? WHERE id = ?').run(theme, req.user.sub);
    res.json({ ok: true, theme });
  });

  // Wipe all portfolio data (accounts, balance history, custom categories).
  // Requires an admin session AND re-entry of that admin's password.
  // Users are never touched so nobody gets locked out.
  r.post('/reset-data', requireAdmin, (req, res) => {
    const { password } = req.body || {};
    if (!demo) {
      requireFields(req.body || {}, ['password']);
      if (typeof password !== 'string' || !password) {
        throw new HttpError(400, 'Admin password is required');
      }
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        throw new HttpError(401, 'Invalid admin password');
      }
    }

    const countSnapshots = db.prepare('SELECT COUNT(*) AS n FROM balance_snapshots').get().n;
    const countAccounts = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;

    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM balance_snapshots').run();
      db.prepare('DELETE FROM accounts').run();
      // Restore categories to the seeded defaults (removes any imported/custom ones).
      db.prepare(
        `DELETE FROM account_categories WHERE name NOT IN (${CATEGORY_SEED.map(() => '?').join(', ')})`
      ).run(...CATEGORY_SEED);
      const seedStmt = db.prepare('INSERT OR IGNORE INTO account_categories (name) VALUES (?)');
      for (const name of CATEGORY_SEED) seedStmt.run(name);
      if (demo) seedDemoData(db, { useTransaction: false });
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    res.json({
      ok: true,
      deletedAccounts: countAccounts,
      deletedSnapshots: countSnapshots,
      ...(demo ? { reseeded: true } : {}),
    });
  });

  return r;
}
