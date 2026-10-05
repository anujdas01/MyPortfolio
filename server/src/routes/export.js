import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Export routes
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
export default function exportRoutes(db) {
  const r = Router();
  r.use(requireAuth);

  /**
   * @openapi
   * /export:
   *   get:
   *     tags: [Export]
   *     summary: Export all data as JSON or CSV
   *     description: >
   *       Downloads a full backup of all data. JSON includes complete history with
   *       per-account grouping and metadata. CSV provides one row per snapshot with
   *       full context. Compatible with the /accounts/import endpoint.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: query
   *         name: format
   *         schema:
   *           type: string
   *           enum: [json, csv]
   *           default: json
   *         description: Export format
   *     responses:
   *       200:
   *         description: Exported file
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               description: JSON backup structure (accounts, snapshots, categories, users)
   *           text/csv:
   *             schema:
   *               type: string
   *               description: CSV rows with header date,account,institution,category,kind,type,value,note
   *       401:
   *         description: Not authenticated
   */
  r.get('/', (req, res) => {
    const format = (req.query.format || 'json').toLowerCase();
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      // Historic amounts export — one row per balance_snapshots entry with full context.
      // Extra columns (snapshotId, createdAt, accountId, archived) are appended for
      // full historic fidelity; import ignores unknown columns so this stays backward-compatible.
      const rows = db
        .prepare(
          `SELECT s.as_of_date AS date, a.name AS account,
                  COALESCE(a.institution, '') AS institution,
                  COALESCE(c.name, '') AS category,
                  a.kind,
                  CASE WHEN a.is_asset = 1 THEN 'asset' ELSE 'liability' END AS type,
                  s.value, COALESCE(s.note, '') AS note,
                  s.id AS snapshotId, s.created_at AS createdAt,
                  a.id AS accountId, a.archived AS archived
           FROM balance_snapshots s
           JOIN accounts a ON a.id = s.account_id
           LEFT JOIN account_categories c ON c.id = a.category_id
           ORDER BY s.as_of_date ASC, a.name ASC, s.id ASC`
        )
        .all();
      const header = 'date,account,institution,category,kind,type,value,note,snapshotId,createdAt,accountId,archived';
      const body = rows.map((r2) => [r2.date, r2.account, r2.institution, r2.category, r2.kind, r2.type, r2.value, r2.note, r2.snapshotId, r2.createdAt, r2.accountId, r2.archived].map(csvEscape).join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="myportfolio-export-${stamp}.csv"`);
      return res.send(`${header}\n${body}\n`);
    }

    // JSON export — now explicitly historic-aware
    const categories = db.prepare('SELECT * FROM account_categories ORDER BY id').all();
    const accounts = db.prepare('SELECT * FROM accounts ORDER BY id').all();
    const snapshots = db.prepare('SELECT * FROM balance_snapshots ORDER BY as_of_date, id').all();
    const holdings = db.prepare('SELECT * FROM holdings ORDER BY account_id, id').all();
    const incomeEvents = db.prepare('SELECT * FROM income_events ORDER BY as_of_date, id').all();
    const users = db.prepare('SELECT id, username, display_name, role, theme_pref, created_at FROM users').all();

    // Build per-account historic grouping for ergonomic restores and human inspection
    const snapsByAccount = new Map();
    for (const s of snapshots) {
      if (!snapsByAccount.has(s.account_id)) snapsByAccount.set(s.account_id, []);
      snapsByAccount.get(s.account_id).push(s);
    }
    const accountsWithHistory = accounts.map((a) => ({
      ...a,
      snapshots: (snapsByAccount.get(a.id) || []).map((s) => ({
        id: s.id,
        value: s.value,
        asOfDate: s.as_of_date,
        as_of_date: s.as_of_date,
        note: s.note,
        createdAt: s.created_at,
        created_at: s.created_at,
      })),
    }));
    const perAccount = accounts.map((a) => {
      const list = snapsByAccount.get(a.id) || [];
      return {
        accountId: a.id,
        name: a.name,
        institution: a.institution,
        categoryId: a.category_id,
        kind: a.kind,
        isAsset: !!a.is_asset,
        archived: !!a.archived,
        snapshotsCount: list.length,
        firstDate: list[0]?.as_of_date ?? null,
        lastDate: list[list.length - 1]?.as_of_date ?? null,
        snapshots: list.map((s) => ({ value: s.value, asOfDate: s.as_of_date, note: s.note, createdAt: s.created_at })),
      };
    });
    const dates = snapshots.map((s) => s.as_of_date).sort();
    const dump = {
      exportedAt: new Date().toISOString(),
      version: '2.1',
      summary: {
        totalAccounts: accounts.length,
        totalSnapshots: snapshots.length,
        totalHoldings: holdings.length,
        totalIncomeEvents: incomeEvents.length,
        archivedAccounts: accounts.filter((a) => a.archived).length,
        dateRange: snapshots.length ? { from: dates[0], to: dates[dates.length - 1] } : { from: null, to: null },
        historyIncluded: true,
      },
      history: {
        totalSnapshots: snapshots.length,
        perAccount,
      },
      users,
      categories,
      accounts,
      accountsWithHistory,
      snapshots,
      holdings,
      incomeEvents,
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="myportfolio-export-${stamp}.json"`);
    res.json(dump);
  });

  return r;
}
