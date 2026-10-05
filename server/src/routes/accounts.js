import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { requireFields, isValidDate, isFiniteNumber, isFutureDate, parsePagination } from '../utils/validate.js';
import { getQuotes } from '../market.js';
import { parseRobinhoodCsv, applyRobinhoodImport, deletableClosedPositions, MAX_ROBINHOOD_CHARS } from '../robinhood.js';

// Express 4 does not catch rejected promises from async handlers, so wrap
// them and forward failures to the error middleware instead of hanging.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Accounts eligible for market-value auto refresh (no explicit selection).
const REFRESH_KINDS = new Set(['brokerage', 'crypto', '401k', 'roth_ira', 'traditional_ira', 'hsa', '529', 'pension']);

// Yahoo quote types a holding can carry (drives the stocks/crypto split).
const ASSET_TYPES = new Set(['EQUITY', 'ETF', 'CRYPTOCURRENCY', 'MUTUALFUND']);

// Fallback classification for rows without a stored type: Yahoo crypto pairs
// look like BASE-QUOTE (BTC-USD, ETH-EUR). Plain stock tickers with a dash
// (BRK-B) never end in a quote currency, so this is safe.
const CRYPTO_SUFFIX_RE = /-(USD|USDT|EUR|GBP|BTC|ETH)$/i;
function deriveAssetType(ticker) {
  return CRYPTO_SUFFIX_RE.test(String(ticker || '')) ? 'CRYPTOCURRENCY' : null;
}
const REFRESH_CATEGORIES = new Set(['Investment', 'Retirement']);
// Tags refreshed snapshots. The live total always wins: today's row is
// overwritten whether it was entered manually or automatically.
const AUTO_REFRESH_NOTE = 'auto: market refresh';

const ACCOUNT_SELECT = `
  SELECT a.id, a.name, a.institution,
         a.category_id AS categoryId, c.name AS categoryName,
         a.kind, a.is_asset AS isAsset, a.notes, a.archived, a.created_at AS createdAt,
         a.cash_balance AS cashBalance, a.cash_updated_at AS cashUpdatedAt,
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
 * @property {number} cashBalance
 * @property {string|null} cashUpdatedAt
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
 * @typedef {Object} Holding
 * @property {number} id
 * @property {number} accountId
 * @property {string} ticker
 * @property {string|null} name
 * @property {number} shares
 * @property {number} costBasis
 * @property {string} currency
 * @property {string|null} assetType
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} IncomeEvent
 * @property {number} id
 * @property {number} accountId
 * @property {number|null} holdingId
 * @property {string} type
 * @property {number} amount
 * @property {string} currency
 * @property {string} asOfDate
 * @property {string|null} note
 * @property {string} createdAt
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
 * @property {number} holdingsCreated
 * @property {number} incomeAdded
 * @property {number} incomeSkipped
 */

function serializeAccount(row) {
  return {
    ...row,
    isAsset: !!row.isAsset,
    archived: !!row.archived,
    cashBalance: Number(row.cashBalance) || 0,
  };
}

// Shared cash-sleeve validation for create/update/import.
// `existing` is the raw DB row (snake_case) for PATCH so an omitted side is
// preserved; pass null for create/import. Returns null when neither side was
// sent, else { cashBalance, cashUpdatedAt } — throws HttpError(400) on bad input.
function normalizeCash(input = {}, existing = null) {
  const rawBalance = input.cashBalance ?? input.cash_balance;
  const rawDate = input.cashUpdatedAt ?? input.cash_updated_at;
  const hasBalance = rawBalance !== undefined;
  const hasDate = rawDate !== undefined && rawDate !== null && String(rawDate).trim() !== '';
  if (!hasBalance && !hasDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  let cashBalance = existing ? Number(existing.cash_balance) || 0 : 0;
  if (hasBalance) {
    cashBalance = rawBalance === null || rawBalance === '' ? 0 : Number(rawBalance);
    if (!Number.isFinite(cashBalance) || cashBalance < 0) {
      throw new HttpError(400, '"cashBalance" must be a non-negative number');
    }
    cashBalance = Math.round(cashBalance * 100) / 100;
  }
  let cashUpdatedAt = existing?.cash_updated_at ?? null;
  if (hasDate) {
    if (!isValidDate(rawDate)) throw new HttpError(400, '"cashUpdatedAt" must be YYYY-MM-DD');
    if (isFutureDate(rawDate)) throw new HttpError(400, '"cashUpdatedAt" cannot be in the future');
    cashUpdatedAt = rawDate;
  } else if (hasBalance) {
    cashUpdatedAt = today;
  }
  return { cashBalance, cashUpdatedAt };
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
    const cash = normalizeCash(req.body || {}, null);
    const info = db
      .prepare(
        `INSERT INTO accounts (name, institution, category_id, kind, is_asset, notes, cash_balance, cash_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        name.trim().slice(0,80),
        institution ? String(institution).trim().slice(0,120) || null : null,
        categoryId,
        normalizeKind(kind),
        isAsset ? 1 : 0,
        notes ? String(notes).trim().slice(0,2000) || null : null,
        cash?.cashBalance ?? 0,
        cash?.cashUpdatedAt ?? null
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
    const cash = normalizeCash(b, target);
    // duplicate guard on PATCH if name/institution changes
    const newName = b.name !== undefined ? b.name.trim() : target.name;
    const newInst = cleanInstitution || '';
    const dup2 = db.prepare(`SELECT id FROM accounts WHERE lower(name)=lower(?) AND lower(coalesce(institution,''))=lower(coalesce(?,'')) AND id<>?`).get(newName, newInst, id);
    if (dup2) throw new HttpError(409, 'Another account with the same name and institution already exists');
    db.prepare(
      `UPDATE accounts SET name=?, institution=?, category_id=?, kind=?, is_asset=?, notes=?, archived=?, cash_balance=?, cash_updated_at=? WHERE id=?`
    ).run(
      b.name !== undefined ? b.name.trim().slice(0, 80) : target.name,
      cleanInstitution,
      categoryId,
      b.kind !== undefined ? normalizeKind(b.kind) : target.kind,
      b.isAsset !== undefined ? (b.isAsset ? 1 : 0) : target.is_asset,
      cleanNotes,
      b.archived !== undefined ? (b.archived ? 1 : 0) : target.archived,
      cash ? cash.cashBalance : (Number(target.cash_balance) || 0),
      cash ? cash.cashUpdatedAt : (target.cash_updated_at ?? null),
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

    const stats = { accountsCreated: 0, snapshotsAdded: 0, snapshotsSkipped: 0, holdingsCreated: 0, incomeAdded: 0, incomeSkipped: 0 };
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

          let importCash = null;
          try {
            importCash = normalizeCash(a, null);
          } catch {
            importCash = null; // invalid cash in a backup never blocks the restore
          }
          const info = db
            .prepare(
              `INSERT INTO accounts (name, institution, category_id, kind, is_asset, notes, archived, cash_balance, cash_updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              name,
              cleanText(a.institution, 120),
              categoryId,
              normalizeKind(a.kind),
              normalizeBool(a.is_asset ?? a.isAsset, true),
              cleanText(a.notes, 2000),
              a.archived === 1 || a.archived === true ? 1 : 0,
              importCash?.cashBalance ?? 0,
              importCash?.cashUpdatedAt ?? null
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

        // Holdings restore (old account/holding ids remapped through idMap).
        const holdingIdMap = new Map(); // oldHoldingId -> newHoldingId
        if (Array.isArray(data.holdings)) {
          const addHolding = db.prepare(
            `INSERT INTO holdings (account_id, ticker, name, shares, cost_basis, currency, asset_type)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          );
          for (const h of data.holdings) {
            if (!h || typeof h !== 'object') continue;
            const accountId = idMap.get(String(h.account_id ?? h.accountId));
            const ticker = typeof h.ticker === 'string' ? h.ticker.trim().toUpperCase().slice(0, 16) : '';
            const shares = Number(h.shares);
            const costBasis = Number(h.cost_basis ?? h.costBasis);
            if (!accountId || !ticker || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(costBasis) || costBasis < 0) {
              continue;
            }
            const assetType = ASSET_TYPES.has(h.asset_type ?? h.assetType) ? (h.asset_type ?? h.assetType) : null;
            const info = addHolding.run(
              accountId,
              ticker,
              cleanText(h.name, 120),
              shares,
              costBasis,
              (typeof h.currency === 'string' && h.currency.trim() ? h.currency.trim().toUpperCase().slice(0, 8) : 'USD'),
              assetType
            );
            if (h.id != null) holdingIdMap.set(String(h.id), Number(info.lastInsertRowid));
            stats.holdingsCreated += 1;
          }
        }

        // Income restore (links resolve through the remapped holding ids).
        if (Array.isArray(data.incomeEvents)) {
          const addIncome = db.prepare(
            `INSERT INTO income_events (account_id, holding_id, type, amount, currency, as_of_date, note)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          );
          for (const ev of data.incomeEvents) {
            if (!ev || typeof ev !== 'object') continue;
            const accountId = idMap.get(String(ev.account_id ?? ev.accountId));
            const type = ev.type;
            const amount = Number(ev.amount);
            const date = ev.as_of_date ?? ev.asOfDate;
            if (!accountId || !['dividend', 'interest', 'distribution', 'other'].includes(type) || !Number.isFinite(amount) || amount <= 0 || !isValidDate(date)) {
              stats.incomeSkipped += 1;
              continue;
            }
            const holdingId = ev.holding_id != null || ev.holdingId != null
              ? (holdingIdMap.get(String(ev.holding_id ?? ev.holdingId)) ?? null)
              : null;
            addIncome.run(
              accountId,
              holdingId,
              type,
              amount,
              (typeof ev.currency === 'string' && ev.currency.trim() ? ev.currency.trim().toUpperCase().slice(0, 8) : 'USD'),
              date,
              cleanText(ev.note, 500)
            );
            stats.incomeAdded += 1;
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

  // ---- Holdings routes ------------------------------------------------------

  /**
   * @openapi
   * /accounts/{id}/holdings:
   *   get:
   *     tags: [Accounts]
   *     summary: List holdings for an investment account
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
   *         description: List of holdings
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 holdings:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Holding'
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: Account not found
   */
  r.get('/:id/holdings', (req, res) => {
    const accountId = Number(req.params.id);
    getAccount(db, accountId);
    const rows = db
      .prepare(
        `SELECT id, account_id AS accountId, ticker, name, shares, cost_basis AS costBasis, currency, asset_type AS assetType, created_at AS createdAt, updated_at AS updatedAt
         FROM holdings WHERE account_id = ? ORDER BY ticker`
      )
      .all(accountId);
    res.json({ holdings: rows });
  });

  /**
   * @openapi
   * /accounts/{id}/holdings:
   *   post:
   *     tags: [Accounts]
   *     summary: Create a new holding
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
   *             type: object
   *             required: [ticker, shares, costBasis]
   *             properties:
   *               ticker:
   *                 type: string
   *               name:
   *                 type: string
   *               shares:
   *                 type: number
   *               costBasis:
   *                 type: number
   *               currency:
   *                 type: string
   *                 default: USD
   *               assetType:
   *                 type: string
   *                 enum: [EQUITY, ETF, CRYPTOCURRENCY, MUTUALFUND]
   *                 description: Optional; auto-detected from the ticker (e.g. BTC-USD) when omitted
   *     responses:
   *       201:
   *         description: Holding created
   *       400:
   *         description: Invalid input
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: Account not found
   */
  r.post('/:id/holdings', (req, res) => {
    const accountId = Number(req.params.id);
    getAccount(db, accountId);
    requireFields(req.body || {}, ['ticker', 'shares', 'costBasis']);
    const { ticker, name, shares, costBasis, currency = 'USD', assetType } = req.body;
    if (!isFiniteNumber(shares) || shares <= 0) throw new HttpError(400, '"shares" must be a positive number');
    if (!isFiniteNumber(costBasis) || costBasis < 0) throw new HttpError(400, '"costBasis" must be a non-negative number');
    if (typeof ticker !== 'string' || !ticker.trim()) throw new HttpError(400, '"ticker" is required');
    const cleanTicker = ticker.trim().toUpperCase().slice(0, 16);
    let finalAssetType = deriveAssetType(cleanTicker);
    if (assetType !== undefined && assetType !== null && assetType !== '') {
      if (!ASSET_TYPES.has(assetType)) throw new HttpError(400, '"assetType" must be one of EQUITY, ETF, CRYPTOCURRENCY, MUTUALFUND');
      finalAssetType = assetType;
    }
    const info = db
      .prepare(
        `INSERT INTO holdings (account_id, ticker, name, shares, cost_basis, currency, asset_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(accountId, cleanTicker, name ? name.trim().slice(0, 120) : null, shares, costBasis, currency.trim().toUpperCase().slice(0, 8), finalAssetType);
    const holding = db.prepare(`SELECT id, account_id AS accountId, ticker, name, shares, cost_basis AS costBasis, currency, asset_type AS assetType, created_at AS createdAt, updated_at AS updatedAt FROM holdings WHERE id = ?`).get(info.lastInsertRowid);
    res.status(201).json({ holding });
  });

  /**
   * @openapi
   * /accounts/{id}/holdings/{holdingId}:
   *   patch:
   *     tags: [Accounts]
   *     summary: Update a holding
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
   *         name: holdingId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               ticker:
   *                 type: string
   *               name:
   *                 type: string
   *               shares:
   *                 type: number
   *               costBasis:
   *                 type: number
   *               currency:
   *                 type: string
   *               assetType:
   *                 type: string
   *                 enum: [EQUITY, ETF, CRYPTOCURRENCY, MUTUALFUND]
   *                 description: Set explicitly, or null/empty to re-detect from the ticker
   *     responses:
   *       200:
   *         description: Holding updated
   *       400:
   *         description: Invalid input
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: Holding not found
   */
  r.patch('/:id/holdings/:holdingId', (req, res) => {
    const accountId = Number(req.params.id);
    const holdingId = Number(req.params.holdingId);
    getAccount(db, accountId);
    const existing = db.prepare('SELECT * FROM holdings WHERE id = ? AND account_id = ?').get(holdingId, accountId);
    if (!existing) throw new HttpError(404, 'Holding not found');
    const b = req.body || {};
    const ticker = b.ticker !== undefined ? b.ticker.trim().toUpperCase().slice(0, 16) : existing.ticker;
    const name = b.name !== undefined ? (b.name ? b.name.trim().slice(0, 120) : null) : existing.name;
    const shares = b.shares !== undefined ? b.shares : existing.shares;
    const costBasis = b.costBasis !== undefined ? b.costBasis : existing.cost_basis;
    const currency = b.currency !== undefined ? b.currency.trim().toUpperCase().slice(0, 8) : existing.currency;
    if (!isFiniteNumber(shares) || shares <= 0) throw new HttpError(400, '"shares" must be a positive number');
    if (!isFiniteNumber(costBasis) || costBasis < 0) throw new HttpError(400, '"costBasis" must be a non-negative number');
    if (!ticker) throw new HttpError(400, '"ticker" is required');
    // Explicit type wins; "auto" (null/'') re-derives; a changed ticker
    // without an explicit type re-derives too, otherwise the stored type stays.
    let finalAssetType = existing.asset_type;
    if (b.assetType !== undefined) {
      if (b.assetType === null || b.assetType === '') {
        finalAssetType = deriveAssetType(ticker);
      } else {
        if (!ASSET_TYPES.has(b.assetType)) throw new HttpError(400, '"assetType" must be one of EQUITY, ETF, CRYPTOCURRENCY, MUTUALFUND');
        finalAssetType = b.assetType;
      }
    } else if (b.ticker !== undefined && ticker !== existing.ticker) {
      finalAssetType = deriveAssetType(ticker);
    }
    db.prepare(
      `UPDATE holdings SET ticker=?, name=?, shares=?, cost_basis=?, currency=?, asset_type=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).run(ticker, name, shares, costBasis, currency, finalAssetType, holdingId);
    const holding = db.prepare(`SELECT id, account_id AS accountId, ticker, name, shares, cost_basis AS costBasis, currency, asset_type AS assetType, created_at AS createdAt, updated_at AS updatedAt FROM holdings WHERE id = ?`).get(holdingId);
    res.json({ holding });
  });

  /**
   * @openapi
   * /accounts/{id}/holdings/{holdingId}:
   *   delete:
   *     tags: [Accounts]
   *     summary: Delete a holding
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
   *         name: holdingId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Holding deleted
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: Holding not found
   */
  r.delete('/:id/holdings/:holdingId', (req, res) => {
    const accountId = Number(req.params.id);
    const holdingId = Number(req.params.holdingId);
    getAccount(db, accountId);
    const existing = db.prepare('SELECT id FROM holdings WHERE id = ? AND account_id = ?').get(holdingId, accountId);
    if (!existing) throw new HttpError(404, 'Holding not found');
    db.prepare('DELETE FROM holdings WHERE id = ?').run(holdingId);
    res.json({ ok: true });
  });

  // ---- Robinhood CSV import --------------------------------------------------

  /**
   * @openapi
   * /accounts/{id}/import/robinhood:
   *   post:
   *     tags: [Accounts]
   *     summary: Import a Robinhood activity CSV into an account
   *     description: >
   *       Parses a Robinhood "Account activity report" CSV (Activity Date,
   *       Instrument, Description, Trans Code, Quantity, Price, Amount).
   *       BUY/SELL rows rebuild positions with average-cost accounting,
   *       CDIV/INT rows become dividend/interest income. With `dryRun: true`
   *       nothing is saved and the parsed result is returned for preview
   *       (including `pendingRemovals`: sold-out positions that would be
   *       deleted). Otherwise each import replaces holdings by ticker —
   *       new positions are added, existing ones updated, and fully-sold
   *       positions removed — while income is added with duplicate
   *       protection, so re-importing the same file is safe.
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
   *             type: object
   *             required: [content]
   *             properties:
   *               content:
   *                 type: string
   *                 description: Raw CSV file text (max 5 MB)
   *               dryRun:
   *                 type: boolean
   *                 default: false
   *                 description: Preview only — do not save anything
   *     responses:
   *       200:
   *         description: Import preview or result
   *       400:
   *         description: Empty content or not a Robinhood CSV
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: Account not found
   *       413:
   *         description: File too large
   */
  r.post('/:id/import/robinhood', ah(async (req, res) => {
    const accountId = Number(req.params.id);
    getAccount(db, accountId);
    const { content, dryRun } = req.body || {};
    if (typeof content !== 'string' || !content.trim()) {
      throw new HttpError(400, 'CSV content is empty');
    }
    if (content.length > MAX_ROBINHOOD_CHARS) {
      throw new HttpError(413, 'CSV is too large (max 5 MB)');
    }
    const parsed = parseRobinhoodCsv(content);
    if (dryRun) {
      // Show exactly which sold-out rows would disappear on confirm.
      const removable = deletableClosedPositions(parsed).map((c) => c.ticker);
      const pendingRemovals =
        removable.length === 0
          ? []
          : db
              .prepare(
                `SELECT ticker FROM holdings WHERE account_id = ? AND ticker IN (${removable.map(() => '?').join(',')})`
              )
              .all(accountId, ...removable)
              .map((h) => h.ticker);
      return res.json({ ok: true, dryRun: true, ...parsed, pendingRemovals });
    }
    const result = applyRobinhoodImport(db, accountId, parsed);
    res.json({ ok: true, dryRun: false, ...parsed, ...result });
  }));

  // ---- Income events routes -------------------------------------------------

  /**
   * @openapi
   * /accounts/{id}/income:
   *   get:
   *     tags: [Accounts]
   *     summary: List income events for an account
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
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           minimum: 0
   *           default: 0
   *     responses:
   *       200:
   *         description: Paginated income events
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 income:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/IncomeEvent'
   *                 hasMore:
   *                   type: boolean
   *                 limit:
   *                   type: integer
   *                 offset:
   *                   type: integer
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: Account not found
   */
  r.get('/:id/income', (req, res) => {
    const accountId = Number(req.params.id);
    getAccount(db, accountId);
    const { limit, offset } = parsePagination(req.query);
    const rows = db
      .prepare(
        `SELECT id, account_id AS accountId, holding_id AS holdingId, type, amount, currency, as_of_date AS asOfDate, note, created_at AS createdAt
         FROM income_events WHERE account_id = ?
         ORDER BY as_of_date DESC, rowid DESC LIMIT ? OFFSET ?`
      )
      .all(accountId, limit + 1, offset);
    const hasMore = rows.length > limit;
    const income = hasMore ? rows.slice(0, limit) : rows;
    res.json({ income, hasMore, limit, offset });
  });

  /**
   * @openapi
   * /accounts/{id}/income:
   *   post:
   *     tags: [Accounts]
   *     summary: Create an income event
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
   *             type: object
   *             required: [type, amount, asOfDate]
   *             properties:
   *               type:
   *                 type: string
   *                 enum: [dividend, interest, distribution, other]
   *               amount:
   *                 type: number
   *               currency:
   *                 type: string
   *                 default: USD
   *               asOfDate:
   *                 type: string
   *               holdingId:
   *                 type: integer
   *               note:
   *                 type: string
   *     responses:
   *       201:
   *         description: Income event created
   *       400:
   *         description: Invalid input
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: Account not found
   */
  r.post('/:id/income', (req, res) => {
    const accountId = Number(req.params.id);
    getAccount(db, accountId);
    requireFields(req.body || {}, ['type', 'amount', 'asOfDate']);
    const { type, amount, currency = 'USD', asOfDate, holdingId, note } = req.body;
    if (!['dividend', 'interest', 'distribution', 'other'].includes(type)) throw new HttpError(400, '"type" must be dividend, interest, distribution, or other');
    if (!isFiniteNumber(amount) || amount <= 0) throw new HttpError(400, '"amount" must be a positive number');
    if (!isValidDate(asOfDate)) throw new HttpError(400, '"asOfDate" must be YYYY-MM-DD');
    if (isFutureDate(asOfDate)) throw new HttpError(400, '"asOfDate" cannot be in the future');
    if (holdingId !== undefined && holdingId !== null) {
      const h = db.prepare('SELECT id FROM holdings WHERE id = ? AND account_id = ?').get(holdingId, accountId);
      if (!h) throw new HttpError(400, 'Holding not found');
    }
    const info = db
      .prepare(
        `INSERT INTO income_events (account_id, holding_id, type, amount, currency, as_of_date, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(accountId, holdingId || null, type, amount, currency.trim().toUpperCase().slice(0, 8), asOfDate, note ? note.trim().slice(0, 500) : null);
    const event = db.prepare(`SELECT id, account_id AS accountId, holding_id AS holdingId, type, amount, currency, as_of_date AS asOfDate, note, created_at AS createdAt FROM income_events WHERE id = ?`).get(info.lastInsertRowid);
    res.status(201).json({ income: event });
  });

  /**
   * @openapi
   * /accounts/{id}/income/{incomeId}:
   *   delete:
   *     tags: [Accounts]
   *     summary: Delete an income event
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
   *         name: incomeId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Income event deleted
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: Income event not found
   */
  r.delete('/:id/income/:incomeId', (req, res) => {
    const accountId = Number(req.params.id);
    const incomeId = Number(req.params.incomeId);
    getAccount(db, accountId);
    const existing = db.prepare('SELECT id FROM income_events WHERE id = ? AND account_id = ?').get(incomeId, accountId);
    if (!existing) throw new HttpError(404, 'Income event not found');
    db.prepare('DELETE FROM income_events WHERE id = ?').run(incomeId);
    res.json({ ok: true });
  });

  // ---- Market-value auto refresh --------------------------------------------

  /**
   * @openapi
   * /accounts/refresh-market-values:
   *   post:
   *     tags: [Accounts]
   *     summary: Reprice investment accounts from live quotes
   *     description: >
   *       For each active asset account holding securities, computes
   *       Σ(shares × latest price) plus the account's cash sleeve and records
   *       it as today's balance. The live total always wins: today's balance
   *       is overwritten whether it was entered manually or automatically
   *       (at most one snapshot row per account per day), and an unchanged
   *       value writes nothing. Refreshed rows are tagged with the note
   *       "auto: market refresh".
   *       Accounts that cannot be priced (no holdings, missing quotes, manual
   *       entry today) are reported in `skipped` with a reason per account.
   *       Without a body, all brokerage/retirement accounts are refreshed;
   *       pass `accountIds` to restrict the run (e.g. from an account page).
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               accountIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *                 example: [3]
   *     responses:
   *       200:
   *         description: Refresh summary
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok:
   *                   type: boolean
   *                   example: true
   *                 asOfDate:
   *                   type: string
   *                   format: date
   *                 created:
   *                   type: array
   *                   items:
   *                     type: object
   *                 updated:
   *                   type: array
   *                   items:
   *                     type: object
   *                 unchanged:
   *                   type: array
   *                   items:
   *                     type: object
   *                 skipped:
   *                   type: array
   *                   items:
   *                     type: object
   *       400:
   *         description: Invalid accountIds
   *       401:
   *         description: Not authenticated
   *       502:
   *         description: Quote provider unreachable
   */
  r.post('/refresh-market-values', ah(async (req, res) => {
    const rawIds = req.body?.accountIds;
    let onlyIds = null;
    if (rawIds !== undefined) {
      if (!Array.isArray(rawIds) || !rawIds.length) {
        throw new HttpError(400, '"accountIds" must be a non-empty array of account ids');
      }
      onlyIds = [...new Set(rawIds.map(Number).filter((n) => Number.isInteger(n)))];
      if (!onlyIds.length) throw new HttpError(400, '"accountIds" must be a non-empty array of account ids');
    }

    const asOfDate = new Date().toISOString().slice(0, 10);
    const created = [];
    const updated = [];
    const unchanged = [];
    const skipped = [];
    const NO_HOLDINGS_REASON =
      'no holdings to price — add positions, import a Robinhood CSV, or record a balance manually';

    // Candidates carry their holding count so "nothing to price" is reported
    // instead of silently dropped (the classic "why didn't my brokerage
    // update?" case). Auto mode stays quiet for non-investment accounts;
    // explicitly requested accounts are always accounted for.
    let candidates;
    if (onlyIds) {
      const placeholders = onlyIds.map(() => '?').join(',');
      candidates = db
        .prepare(
          `SELECT a.id, a.name, a.kind, COALESCE(c.name, '') AS categoryName,
                  COALESCE(a.cash_balance, 0) AS cashBalance,
                  a.archived AS archived, a.is_asset AS isAsset,
                  (SELECT COUNT(*) FROM holdings h WHERE h.account_id = a.id) AS holdingCount
           FROM accounts a
           LEFT JOIN account_categories c ON c.id = a.category_id
           WHERE a.id IN (${placeholders})`
        )
        .all(...onlyIds);
    } else {
      candidates = db
        .prepare(
          `SELECT a.id, a.name, a.kind, COALESCE(c.name, '') AS categoryName,
                  COALESCE(a.cash_balance, 0) AS cashBalance, 0 AS archived, 1 AS isAsset,
                  (SELECT COUNT(*) FROM holdings h WHERE h.account_id = a.id) AS holdingCount
           FROM accounts a
           LEFT JOIN account_categories c ON c.id = a.category_id
           WHERE a.archived = 0 AND a.is_asset = 1`
        )
        .all();
    }

    const targets = [];
    if (onlyIds) {
      const byId = new Map(candidates.map((a) => [a.id, a]));
      for (const id of onlyIds) {
        const a = byId.get(id);
        if (!a) skipped.push({ accountId: id, name: `#${id}`, reason: 'account not found' });
        else if (a.archived) skipped.push({ accountId: id, name: a.name, reason: 'account is archived' });
        else if (!a.isAsset) skipped.push({ accountId: id, name: a.name, reason: 'liabilities are not repriced' });
        else targets.push(a);
      }
    } else {
      for (const a of candidates) {
        if (REFRESH_KINDS.has(a.kind) || REFRESH_CATEGORIES.has(a.categoryName)) targets.push(a);
      }
    }

    if (!targets.length) {
      return res.json({ ok: true, asOfDate, created, updated, unchanged, skipped });
    }

    const placeholders = targets.map(() => '?').join(',');
    const allHoldings = db
      .prepare(
        `SELECT account_id AS accountId, ticker, shares, COALESCE(currency, 'USD') AS currency
         FROM holdings WHERE account_id IN (${placeholders})`
      )
      .all(...targets.map((a) => a.id));

    const byAccount = new Map(targets.map((a) => [a.id, []]));
    for (const h of allHoldings) byAccount.get(h.accountId)?.push(h);

    const tickers = [...new Set(allHoldings.map((h) => h.ticker))];
    let quotes;
    try {
      quotes = await getQuotes(tickers);
    } catch (e) {
      throw new HttpError(502, e.message || 'Quote provider unavailable');
    }

    const todayStmt = db.prepare(
      `SELECT id, value, note FROM balance_snapshots
       WHERE account_id = ? AND as_of_date = ?
       ORDER BY rowid DESC LIMIT 1`
    );
    const insertStmt = db.prepare(
      'INSERT INTO balance_snapshots (account_id, value, as_of_date, note) VALUES (?, ?, ?, ?)'
    );

    db.exec('BEGIN');
    try {
      for (const a of targets) {
        if (!a.holdingCount) {
          skipped.push({ accountId: a.id, name: a.name, reason: NO_HOLDINGS_REASON });
          continue;
        }
        let total = 0;
        let problem = null;
        for (const h of byAccount.get(a.id) || []) {
          const q = quotes[h.ticker];
          if (!q?.ok || !Number.isFinite(q.price) || q.price <= 0) {
            problem = `no live quote for ${h.ticker}`;
            break;
          }
          if ((q.currency || 'USD').toUpperCase() !== String(h.currency).toUpperCase()) {
            problem = `currency mismatch for ${h.ticker} (${q.currency} vs ${h.currency})`;
            break;
          }
          total += (Number(h.shares) || 0) * q.price;
        }
        if (problem) {
          skipped.push({ accountId: a.id, name: a.name, reason: problem });
          continue;
        }
        const cash = Math.round((Number(a.cashBalance) || 0) * 100) / 100;
        total = Math.round((total + cash) * 100) / 100;

        const today = todayStmt.get(a.id, asOfDate);
        if (today) {
          if (Math.abs(today.value - total) < 0.005) {
            unchanged.push({ accountId: a.id, name: a.name, value: total, cash });
            continue;
          }
          // Market wins: today's balance (manual or auto) is overwritten
          // with the live portfolio total and tagged as auto-refreshed.
          const overrodeManual = today.note !== AUTO_REFRESH_NOTE;
          db.prepare('UPDATE balance_snapshots SET value = ?, note = ? WHERE id = ?').run(
            total,
            AUTO_REFRESH_NOTE,
            today.id
          );
          updated.push({ accountId: a.id, name: a.name, oldValue: today.value, newValue: total, cash, overrodeManual });
        } else {
          insertStmt.run(a.id, total, asOfDate, AUTO_REFRESH_NOTE);
          const latest = db
            .prepare(
              `SELECT value FROM balance_snapshots WHERE account_id = ? AND as_of_date < ?
               ORDER BY as_of_date DESC, rowid DESC LIMIT 1`
            )
            .get(a.id, asOfDate);
          created.push({
            accountId: a.id,
            name: a.name,
            oldValue: latest ? latest.value : null,
            newValue: total,
            cash,
          });
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    res.json({ ok: true, asOfDate, created, updated, unchanged, skipped });
  }));

  return r;
}
