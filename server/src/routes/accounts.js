import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { requireFields, isValidDate, isFiniteNumber, isFutureDate, parsePagination } from '../utils/validate.js';

const ACCOUNT_SELECT = `
  SELECT a.id, a.name, a.institution,
         a.category_id AS categoryId, c.name AS categoryName,
         a.kind, a.is_asset AS isAsset, a.notes, a.archived, a.created_at AS createdAt,
         (SELECT s.value FROM balance_snapshots s WHERE s.account_id = a.id
           ORDER BY s.as_of_date DESC, s.rowid DESC LIMIT 1) AS latestValue,
         (SELECT s.as_of_date FROM balance_snapshots s WHERE s.account_id = a.id
           ORDER BY s.as_of_date DESC, s.rowid DESC LIMIT 1) AS latestDate
  FROM accounts a
  LEFT JOIN account_categories c ON c.id = a.category_id`;

const MAX_IMPORT_CHARS = 10 * 1024 * 1024; // 10 MB of text is plenty for personal data

/**
 * @typedef {Object} Account
 * @property {number} id
 * @property {string} name
 * @property {string|null} institution
 * @property {number|null} categoryId
 * @property {string|null} categoryName
 * @property {string|null} kind
 * @property {boolean} isAsset
 * @property {string|null} notes
 * @property {boolean} archived
 * @property {string} createdAt
 * @property {number|null} latestValue
 * @property {string|null} latestDate
 */

/**
 * @typedef {Object} Category
 * @property {number} id
 * @property {string} name
 */

/**
 * @typedef {Object} Snapshot
 * @property {number} id
 * @property {number} value
 * @property {string} asOfDate
 * @property {string|null} note
 * @property {string} createdAt
 */

/**
 * @typedef {Object} AccountsResponse
 * @property {Account[]} accounts
 */

/**
 * @typedef {Object} CategoriesResponse
 * @property {Category[]} categories
 */

/**
 * @typedef {Object} SnapshotsResponse
 * @property {Snapshot[]} snapshots
 * @property {boolean} hasMore
 * @property {number} limit
 * @property {number} offset
 */

/**
 * @typedef {Object} CreateAccountRequest
 * @property {string} name
 * @property {string} [institution]
 * @property {number} [categoryId]
 * @property {string} [kind]
 * @property {boolean} [isAsset=true]
 * @property {string} [notes]
 */

/**
 * @typedef {Object} UpdateAccountRequest
 * @property {string} [name]
 * @property {string} [institution]
 * @property {number} [categoryId]
 * @property {string} [kind]
 * @property {boolean} [isAsset]
 * @property {string} [notes]
 * @property {boolean} [archived]
 */

/**
 * @typedef {Object} CreateSnapshotRequest
 * @property {number} value
 * @property {string} asOfDate
 * @property {string} [note]
 */

/**
 * @typedef {Object} UpdateSnapshotRequest
 * @property {number} [value]
 * @property {string} [asOfDate]
 * @property {string} [note]
 */

/**
 * @typedef {Object} ImportRequest
 * @property {'json'|'csv'} format
 * @property {string} content
 */

/**
 * @typedef {Object} ImportResult
 * @property {boolean} ok
 * @property {number} accountsCreated
 * @property {number} snapshotsAdded
 * @property {number} snapshotsSkipped
 */

function serializeAccount(row) {
  return { ...row, isAsset: !!row.isAsset, archived: !!row.archived };
}

function getAccount(db, id) {
  const row = db.prepare(`${ACCOUNT_SELECT} WHERE a.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Account not found');
  return serializeAccount(row);
}

function normalizeKind(v) {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed ? trimmed.slice(0, 64) : null;
}

function validateCategory(db, categoryId) {
  if (categoryId === undefined || categoryId === null || categoryId === '') return null;
  const id = Number(categoryId);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid category');
  if (!db.prepare('SELECT id FROM account_categories WHERE id = ?').get(id)) {
    throw new HttpError(400, 'Category does not exist');
  }
  return id;
}

// ---- Import helpers --------------------------------------------------------

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function normalizeBool(v, fallback = true) {
  if (v === true || v === 1) return 1;
  if (v === false || v === 0) return 0;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (['asset', 'true', '1', 'yes', 'y'].includes(t)) return 1;
    if (['liability', 'false', '0', 'no', 'n'].includes(t)) return 0;
  }
  return fallback ? 1 : 0;
}

function cleanText(v, max = 80) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function insertSnapshotStmt(db) {
  return db.prepare(
    'INSERT INTO balance_snapshots (account_id, value, as_of_date, note) VALUES (?, ?, ?, ?)'
  );
}

/**
 * Account & snapshot routes
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
export default function accountRoutes(db) {
  const r = Router();
  r.use(requireAuth);

  /**
   * @openapi
   * /accounts/categories:
   *   get:
   *     tags: [Accounts]
   *     summary: List all account categories
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: List of categories
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/CategoriesResponse'
   *       401:
   *         description: Not authenticated
   */
  r.get('/categories', (_req, res) => {
    const categories = db.prepare('SELECT id, name FROM account_categories ORDER BY id').all();
    res.json({ categories });
  });

  /**
   * @openapi
   * /accounts:
   *   get:
   *     tags: [Accounts]
   *     summary: List all accounts
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: query
   *         name: includeArchived
   *         schema:
   *           type: string
   *           enum: ['0', '1']
   *           default: '0'
   *         description: Set to '1' to include archived accounts
   *     responses:
   *       200:
   *         description: List of accounts with latest values
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AccountsResponse'
   *       401:
   *         description: Not authenticated
   */
  r.get('/', (req, res) => {
    const includeArchived = req.query.includeArchived === '1';
    const rows = db
      .prepare(`${ACCOUNT_SELECT} ${includeArchived ? '' : 'WHERE a.archived = 0'} ORDER BY c.name, a.name`)
      .all()
      .map(serializeAccount);
    res.json({ accounts: rows });
  });

  /**
   * @openapi
   * /accounts/{id}:
   *   get:
   *     tags: [Accounts]
   *     summary: Get a single account by ID
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Account details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 account:
   *                   $ref: '#/components/schemas/Account'
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: Account not found
   */
  r.get('/:id', (req, res) => {
    res.json({ account: getAccount(db, Number(req.params.id)) });
  });

  /**
   * @openapi
   * /accounts:
   *   post:
   *     tags: [Accounts]
   *     summary: Create a new account
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateAccountRequest'
   *     responses:
   *       201:
   *         description: Account created
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 account:
   *                   $ref: '#/components/schemas/Account'
   *       400:
   *         description: Invalid input
   *       401:
   *         description: Not authenticated
   *       409:
   *         description: Duplicate account (same name + institution)
   */
  r.post('/', (req, res) => {
    requireFields(req.body || {}, ['name']);
    const { name, institution, kind, isAsset = true, notes } = req.body;
    const categoryId = validateCategory(db, req.body.categoryId);
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
      throw new HttpError(400, 'Name is required (max 80 characters)');
    }
    // duplicate guard (case-insensitive name+institution)
    const dup = db.prepare(`SELECT id FROM accounts WHERE lower(name)=lower(?) AND lower(coalesce(institution,''))=lower(coalesce(?,''))`).get(name.trim(), institution ? String(institution).trim() : '');
    if (dup) throw new HttpError(409, 'An account with the same name and institution already exists');
    const info = db
      .prepare(
        `INSERT INTO accounts (name, institution, category_id, kind, is_asset, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        name.trim().slice(0,80),
        institution ? String(institution).trim().slice(0,120) || null : null,
        categoryId,
        normalizeKind(kind),
        isAsset ? 1 : 0,
        notes ? String(notes).trim().slice(0,2000) || null : null
      );
    res.status(201).json({ account: getAccount(db, info.lastInsertRowid) });
  });

  /**
   * @openapi
   * /accounts/{id}:
   *   patch:
   *     tags: [Accounts]
   *     summary: Update an existing account
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateAccountRequest'
   *     responses:
   *       200:
   *         description: Account updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 account:
   *                   $ref: '#/components/schemas/Account'
   *       400:
   *         description: Invalid input
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: Account not found
   *       409:
   *         description: Duplicate name+institution
   */
  r.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    const target = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    if (!target) throw new HttpError(404, 'Account not found');
    const b = req.body || {};
    const categoryId =
      b.categoryId !== undefined ? validateCategory(db, b.categoryId) : target.category_id;
    if (b.name !== undefined) {
      if (typeof b.name !== 'string' || !b.name.trim()) throw new HttpError(400, 'Name cannot be empty');
      if (b.name.trim().length > 80) throw new HttpError(400, 'Name is required (max 80 characters)');
    }
    if (b.isAsset !== undefined && typeof b.isAsset !== 'boolean') {
      throw new HttpError(400, 'isAsset must be a boolean');
    }
    if (b.institution !== undefined && b.institution !== null && typeof b.institution !== 'string') {
      throw new HttpError(400, 'Institution must be a string');
    }
    if (b.notes !== undefined && b.notes !== null && typeof b.notes !== 'string') {
      throw new HttpError(400, 'Notes must be a string');
    }
    const cleanInstitution = b.institution !== undefined ? (b.institution ? String(b.institution).trim().slice(0, 120) || null : null) : target.institution;
    const cleanNotes = b.notes !== undefined ? (b.notes ? String(b.notes).trim().slice(0, 2000) || null : null) : target.notes;
    // duplicate guard on PATCH if name/institution changes
    const newName = b.name !== undefined ? b.name.trim() : target.name;
    const newInst = cleanInstitution || '';
    const dup2 = db.prepare(`SELECT id FROM accounts WHERE lower(name)=lower(?) AND lower(coalesce(institution,''))=lower(coalesce(?,'')) AND id<>?`).get(newName, newInst, id);
    if (dup2) throw new HttpError(409, 'Another account with the same name and institution already exists');
    db.prepare(
      `UPDATE accounts SET name=?, institution=?, category_id=?, kind=?, is_asset=?, notes=?, archived=? WHERE id=?`
    ).run(
      b.name !== undefined ? b.name.trim().slice(0, 80) : target.name,
      cleanInstitution,
      categoryId,
      b.kind !== undefined ? normalizeKind(b.kind) : target.kind,
      b.isAsset !== undefined ? (b.isAsset ? 1 : 0) : target.is_asset,
      cleanNotes,
      b.archived !== undefined ? (b.archived ? 1 : 0) : target.archived,
      id
    );
    res.json({ account: getAccount(db, id) });
  });

  /**
   * @openapi
   * /accounts/{id}:
   *   delete:
   *     tags: [Accounts]
   *     summary: Archive or permanently delete an account
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: permanent
   *         schema:
   *           type: string
   *           enum: ['0', '1']
   *           default: '0'
   *         description: Set to '1' to permanently delete (removes snapshots too)
   *     responses:
   *       200:
   *         description: Account archived or deleted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok:
   *                   type: boolean
   *                   example: true
   *                 archived:
   *                   type: boolean
   *                   example: true
   *                 permanent:
   *                   type: boolean
   *                   example: false
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: Account not found
   */
  r.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const target = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    if (!target) throw new HttpError(404, 'Account not found');
    if (req.query.permanent === '1') {
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM balance_snapshots WHERE account_id = ?').run(id);
        db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return res.json({ ok: true, permanent: true });
    }
    db.prepare('UPDATE accounts SET archived = 1 WHERE id = ?').run(id);
    res.json({ ok: true, archived: true });
  });

  /**
   * @openapi
   * /accounts/{id}/snapshots:
   *   get:
   *     tags: [Accounts]
   *     summary: Get balance snapshots for an account
   *     description: >
   *       Paginated, most recent first. Defaults to the 500 most recent rows with
   *       `hasMore` telling you whether older history exists; pass `limit`/`offset`
   *       (max limit 500) to page through the rest.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 500
   *           default: 500
   *         description: Rows per page (max 500)
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           minimum: 0
   *           default: 0
   *         description: Rows to skip
   *     responses:
   *       200:
   *         description: Paginated snapshot list
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SnapshotsResponse'
   *       400:
   *         description: Invalid limit or offset
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: Account not found
   */
  r.get('/:id/snapshots', (req, res) => {
    const id = Number(req.params.id);
    getAccount(db, id);
    const { limit, offset } = parsePagination(req.query);
    // Fetch one extra row to detect whether more history exists without a COUNT(*).
    const rows = db
      .prepare(
        `SELECT id, value, as_of_date AS asOfDate, note, created_at AS createdAt
         FROM balance_snapshots WHERE account_id = ?
         ORDER BY as_of_date DESC, rowid DESC LIMIT ? OFFSET ?`
      )
      .all(id, limit + 1, offset);
    const hasMore = rows.length > limit;
    const snapshots = hasMore ? rows.slice(0, limit) : rows;
    res.json({ snapshots, hasMore, limit, offset });
  });

  /**
   * @openapi
   * /accounts/{id}/snapshots:
   *   post:
   *     tags: [Accounts]
   *     summary: Add a balance snapshot
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateSnapshotRequest'
   *     responses:
   *       201:
   *         description: Snapshot created
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 snapshot:
   *                   $ref: '#/components/schemas/Snapshot'
   *       400:
   *         description: Invalid value or date
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: Account not found
   */
  r.post('/:id/snapshots', (req, res) => {
    const accountId = Number(req.params.id);
    getAccount(db, accountId);
    requireFields(req.body || {}, ['value', 'asOfDate']);
    const { value, asOfDate, note } = req.body;
    if (!isFiniteNumber(value)) throw new HttpError(400, '"value" must be a number');
    if (value < 0) throw new HttpError(400, '"value" must be >= 0');
    if (!isValidDate(asOfDate)) throw new HttpError(400, '"asOfDate" must be YYYY-MM-DD');
    if (isFutureDate(asOfDate)) throw new HttpError(400, '"asOfDate" cannot be in the future');
    const info = db
      .prepare('INSERT INTO balance_snapshots (account_id, value, as_of_date, note) VALUES (?, ?, ?, ?)')
      .run(accountId, value, asOfDate, cleanText(note, 500));
    const snap = db
      .prepare(
        `SELECT id, value, as_of_date AS asOfDate, note, created_at AS createdAt
         FROM balance_snapshots WHERE id = ?`
      )
      .get(info.lastInsertRowid);
    res.status(201).json({ snapshot: snap });
  });

  /**
   * @openapi
   * /accounts/{id}/snapshots/{snapId}:
   *   patch:
   *     tags: [Accounts]
   *     summary: Update a balance snapshot
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: snapId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateSnapshotRequest'
   *     responses:
   *       200:
   *         description: Snapshot updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 snapshot:
   *                   $ref: '#/components/schemas/Snapshot'
   *       400:
   *         description: Invalid value or date
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: Account or snapshot not found
   */
  r.patch('/:id/snapshots/:snapId', (req, res) => {
    const accountId = Number(req.params.id);
    const snapId = Number(req.params.snapId);
    getAccount(db, accountId);
    const existing = db.prepare('SELECT * FROM balance_snapshots WHERE id = ? AND account_id = ?').get(snapId, accountId);
    if (!existing) throw new HttpError(404, 'Snapshot not found');
    const b = req.body || {};
    const value = b.value !== undefined ? b.value : existing.value;
    const asOfDate = b.asOfDate !== undefined ? b.asOfDate : existing.as_of_date;
    const note = b.note !== undefined ? b.note : existing.note;
    if (!isFiniteNumber(value)) throw new HttpError(400, '"value" must be a number');
    if (value < 0) throw new HttpError(400, '"value" must be >= 0');
    if (!isValidDate(asOfDate)) throw new HttpError(400, '"asOfDate" must be YYYY-MM-DD');
    if (isFutureDate(asOfDate)) throw new HttpError(400, '"asOfDate" cannot be in the future');
    db.prepare('UPDATE balance_snapshots SET value = ?, as_of_date = ?, note = ? WHERE id = ?')
      .run(value, asOfDate, cleanText(note, 500), snapId);
    const snap = db.prepare(`SELECT id, value, as_of_date AS asOfDate, note, created_at AS createdAt FROM balance_snapshots WHERE id = ?`).get(snapId);
    res.json({ snapshot: snap });
  });

  /**
   * @openapi
   * /accounts/{id}/snapshots/{snapId}:
   *   delete:
   *     tags: [Accounts]
   *     summary: Delete a balance snapshot
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: snapId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Snapshot deleted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok:
   *                   type: boolean
   *                   example: true
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: Account or snapshot not found
   */
  r.delete('/:id/snapshots/:snapId', (req, res) => {
    const accountId = Number(req.params.id);
    const snapId = Number(req.params.snapId);
    getAccount(db, accountId);
    const existing = db.prepare('SELECT id FROM balance_snapshots WHERE id = ? AND account_id = ?').get(snapId, accountId);
    if (!existing) throw new HttpError(404, 'Snapshot not found');
    db.prepare('DELETE FROM balance_snapshots WHERE id = ?').run(snapId);
    res.json({ ok: true });
  });

  /**
   * @openapi
   * /accounts/import:
   *   post:
   *     tags: [Accounts]
   *     summary: Import accounts and snapshots
   *     description: >
   *       Import previously exported data. Accepts JSON (full backup or accounts-only) or CSV.
   *       Categories are auto-created if they don't exist. Old IDs are remapped.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/ImportRequest'
   *     responses:
   *       200:
   *         description: Import result
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ImportResult'
   *       400:
   *         description: Invalid format or content
   *       401:
   *         description: Not authenticated
   *       413:
   *         description: File too large (>10 MB)
   */
  r.post('/import', (req, res) => {
    const b = req.body || {};
    const format = String(b.format || '').toLowerCase();
    const content = typeof b.content === 'string' ? b.content : '';

    if (!['json', 'csv'].includes(format)) {
      throw new HttpError(400, '"format" must be "json" or "csv"');
    }
    if (!content.trim()) throw new HttpError(400, 'Import content is empty');
    if (content.length > MAX_IMPORT_CHARS) {
      throw new HttpError(413, 'Import file is too large');
    }

    const catByName = new Map(
      db.prepare('SELECT id, name FROM account_categories').all().map((c) => [c.name.toLowerCase(), c.id])
    );
    const catById = new Map(
      db.prepare('SELECT id FROM account_categories').all().map((c) => [c.id, c.id])
    );

    function resolveCategoryId(rawId, rawName) {
      const idNum = Number(rawId);
      if (Number.isInteger(idNum) && catById.has(idNum)) return idNum;
      let name =
        typeof rawName === 'string' && rawName.trim()
          ? rawName.trim()
          : typeof rawId === 'string' && rawId.trim()
            ? rawId.trim()
            : '';
      if (!name) return null;
      const lower = name.toLowerCase();
      if (catByName.has(lower)) return catByName.get(lower);
      const info = db.prepare('INSERT INTO account_categories (name) VALUES (?)').run(name.slice(0, 80));
      const newId = Number(info.lastInsertRowid);
      catByName.set(lower, newId);
      catById.set(newId, newId);
      return newId;
    }

    const stats = { accountsCreated: 0, snapshotsAdded: 0, snapshotsSkipped: 0 };
    const addSnap = insertSnapshotStmt(db);

    db.exec('BEGIN');
    try {
      if (format === 'json') {
        let data;
        try {
          data = JSON.parse(content);
        } catch {
          throw new HttpError(400, 'File is not valid JSON');
        }

        const dumpCategories = new Map();
        if (Array.isArray(data.categories)) {
          for (const c of data.categories) {
            if (c && c.id != null && typeof c.name === 'string') {
              dumpCategories.set(Number(c.id), c.name);
            }
          }
        }

        if (!Array.isArray(data.accounts)) {
          throw new HttpError(400, 'JSON must contain an "accounts" array');
        }

        const idMap = new Map(); // oldId -> newId
        for (const a of data.accounts) {
          if (!a || typeof a !== 'object') {
            continue;
          }
          const name = cleanText(a.name);
          if (!name) {
            continue;
          }
          // Category resolution order: existing local id -> name from dump categories -> create by name
          const localCatName = dumpCategories.get(Number(a.category_id ?? a.categoryId));
          let categoryId = resolveCategoryId(a.category_id ?? a.categoryId, localCatName);
          if (categoryId == null && a.categoryName) {
            categoryId = resolveCategoryId(null, a.categoryName);
          }

          const info = db
            .prepare(
              `INSERT INTO accounts (name, institution, category_id, kind, is_asset, notes, archived)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              name,
              cleanText(a.institution, 120),
              categoryId,
              normalizeKind(a.kind),
              normalizeBool(a.is_asset ?? a.isAsset, true),
              cleanText(a.notes, 2000),
              a.archived === 1 || a.archived === true ? 1 : 0
            );
          const accountId = Number(info.lastInsertRowid);
          if (a.id != null) idMap.set(String(a.id), accountId);
          stats.accountsCreated += 1;

          // Snapshots may live on the account itself or in a flat top-level array.
          const ownSnaps = Array.isArray(a.snapshots) ? a.snapshots : [];
          for (const s of ownSnaps) {
            const value = Number(s?.value);
            const date = s?.as_of_date ?? s?.asOfDate;
            if (!Number.isFinite(value) || !isValidDate(date)) {
              stats.snapshotsSkipped += 1;
              continue;
            }
            addSnap.run(accountId, value, date, cleanText(s?.note, 500));
            stats.snapshotsAdded += 1;
          }
        }

        if (Array.isArray(data.snapshots)) {

          for (const s of data.snapshots) {
            if (!s || typeof s !== 'object') continue;
            const accountId = idMap.get(String(s.account_id ?? s.accountId));
            const value = Number(s.value);
            const date = s.as_of_date ?? s.asOfDate;
            if (!accountId || !Number.isFinite(value) || !isValidDate(date)) {
              stats.snapshotsSkipped += 1;
              continue;
            }
            addSnap.run(accountId, value, date, cleanText(s.note, 500));
            stats.snapshotsAdded += 1;
          }
        }
      } else {
        // CSV import
        const lines = content.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) throw new HttpError(400, 'CSV needs a header row and at least one data row');

        const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
        const col = (name) => headers.indexOf(name);
        const required = ['date', 'account', 'value'];
        for (const c of required) {
          if (col(c) === -1) throw new HttpError(400, `CSV is missing required column "${c}"`);
        }
        const iDate = col('date');
        const iAccount = col('account');
        const iInst = col('institution');
        const iCat = col('category');
        const iKind = col('kind');
        const iType = col('type');
        const iValue = col('value');
        const iNote = col('note');

        // Group rows by account identity so one account gets all its snapshots.
        const groups = new Map();
        for (let i = 1; i < lines.length; i++) {
          const cells = parseCsvLine(lines[i]);
          const name = (cells[iAccount] || '').trim();
          const value = Number(cells[iValue]);
          const date = (cells[iDate] || '').trim();
          if (!name || !Number.isFinite(value) || !isValidDate(date)) {
            stats.snapshotsSkipped += 1;
            continue;
          }
          const inst = (cells[iInst] || '').trim();
          const catName = (cells[iCat] || '').trim();
          const kindNorm = normalizeKind(cells[iKind]);
          const type = (cells[iType] || '').trim().toLowerCase();
          const key = `${name.toLowerCase()}::${inst.toLowerCase()}::${catName.toLowerCase()}::${(kindNorm||'').toLowerCase()}::${type}`;
          if (!groups.has(key)) {
            groups.set(key, {
              name,
              institution: inst || null,
              categoryName: catName || null,
              kind: kindNorm,
              isAsset: type !== 'liability',
              snapshots: [],
            });
          }
          groups.get(key).snapshots.push({ value, date, note: (cells[iNote] || '').trim() });
        }

        for (const g of groups.values()) {
          const info = db
            .prepare(
              `INSERT INTO accounts (name, institution, category_id, kind, is_asset, notes, archived)
               VALUES (?, ?, ?, ?, ?, NULL, 0)`
            )
            .run(g.name, g.institution, resolveCategoryId(null, g.categoryName), g.kind, g.isAsset ? 1 : 0);
          const accountId = Number(info.lastInsertRowid);
          stats.accountsCreated += 1;
          for (const s of g.snapshots) {
            addSnap.run(accountId, s.value, s.date, s.note || null);
            stats.snapshotsAdded += 1;
          }
        }
      }

      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, `Import failed: ${e.message}`);
    }

    res.json({ ok: true, ...stats });
  });

  return r;
}
