import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { requireFields } from '../utils/validate.js';
import { sanitizeUser } from './auth.js';

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

function countAdmins(db) {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
}

export default function userRoutes(db) {
  const r = Router();
  r.use(requireAuth, requireAdmin);

  r.get('/', (_req, res) => {
    const users = db.prepare('SELECT * FROM users ORDER BY id').all().map(sanitizeUser);
    res.json({ users });
  });

  r.post('/', (req, res) => {
    requireFields(req.body || {}, ['username', 'password']);
    const { username, password, displayName, role } = req.body;
    if (!USERNAME_RE.test(String(username))) {
      throw new HttpError(400, 'Username must be 3-32 characters (letters, numbers, _ . -)');
    }
    if (typeof password !== 'string' || password.length < 8) {
      throw new HttpError(400, 'Password must be at least 8 characters');
    }
    if (role && !['admin', 'member'].includes(role)) throw new HttpError(400, 'Invalid role');
    const uname = String(username).toLowerCase();
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(uname)) {
      throw new HttpError(409, 'Username already taken');
    }
    const info = db
      .prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)')
      .run(uname, bcrypt.hashSync(password, 10), displayName || username, role || 'member');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ user: sanitizeUser(user) });
  });

  r.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) throw new HttpError(404, 'User not found');

    const { displayName, role, password } = req.body || {};
    if (role && !['admin', 'member'].includes(role)) throw new HttpError(400, 'Invalid role');
    if (target.role === 'admin' && role === 'member' && countAdmins(db) <= 1) {
      throw new HttpError(400, 'Cannot demote the last admin');
    }
    if (password !== undefined && (typeof password !== 'string' || password.length < 8)) {
      throw new HttpError(400, 'Password must be at least 8 characters');
    }

    db.prepare('UPDATE users SET display_name = ?, role = ?, password_hash = ? WHERE id = ?').run(
      displayName ?? target.display_name,
      role ?? target.role,
      password !== undefined ? bcrypt.hashSync(password, 10) : target.password_hash,
      id
    );
    res.json({ user: sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  });

  r.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.sub) throw new HttpError(400, 'You cannot delete your own account');
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) throw new HttpError(404, 'User not found');
    if (target.role === 'admin' && countAdmins(db) <= 1) {
      throw new HttpError(400, 'Cannot delete the last admin');
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  return r;
}
