import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { requireFields } from '../utils/validate.js';
import { ALLOWED_THEMES } from '../config.js';
import { CATEGORY_SEED } from '../db/database.js';
import { seedDemoData } from '../db/seed-demo.js';

/**
 * @typedef {Object} ThemesResponse
 * @property {string[]} themes
 */

/**
 * @typedef {Object} SetThemeRequest
 * @property {string} theme
 */

/**
 * @typedef {Object} ResetResult
 * @property {boolean} ok
 * @property {number} deletedAccounts
 * @property {number} deletedSnapshots
 * @property {boolean} [reseeded]
 */

// opts.demo: when true (isolated demo environment), reset-data skips the
// password check and restores the sample showcase data instead.
export default function settingRoutes(db, opts = {}) {
  const { demo = false } = opts;
  const r = Router();
  r.use(requireAuth);

  /**
   * @openapi
   * /settings/themes:
   *   get:
   *     tags: [Settings]
   *     summary: List available color themes
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: List of theme identifiers
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ThemesResponse'
   *       401:
   *         description: Not authenticated
   */
  r.get('/themes', (_req, res) => {
    res.json({ themes: ALLOWED_THEMES });
  });

  /**
   * @openapi
   * /settings/theme:
   *   put:
   *     tags: [Settings]
   *     summary: Set the current user's color theme
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/SetThemeRequest'
   *     responses:
   *       200:
   *         description: Theme updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok:
   *                   type: boolean
   *                   example: true
   *                 theme:
   *                   type: string
   *                   example: 'dark'
   *       400:
   *         description: Invalid theme
   *       401:
   *         description: Not authenticated
   */
  r.put('/theme', (req, res) => {
    requireFields(req.body || {}, ['theme']);
    const { theme } = req.body;
    if (!ALLOWED_THEMES.includes(theme)) {
      throw new HttpError(400, `Theme must be one of: ${ALLOWED_THEMES.join(', ')}`);
    }
    db.prepare('UPDATE users SET theme_pref = ? WHERE id = ?').run(theme, req.user.sub);
    res.json({ ok: true, theme });
  });

  /**
   * @openapi
   * /settings/reset-data:
   *   post:
   *     tags: [Settings]
   *     summary: Wipe all portfolio data
   *     description: >
   *       Requires an admin session and the admin's password. Deletes all accounts,
   *       snapshots, and non-default categories. Users are kept. In demo mode skips
   *       password check and reseeds sample data.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [password]
   *             properties:
   *               password:
   *                 type: string
   *                 format: password
   *                 description: Admin password (not required in demo mode)
   *     responses:
   *       200:
   *         description: Data reset
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ResetResult'
   *       400:
   *         description: Missing password
   *       401:
   *         description: Invalid admin password or not an admin
   */
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
