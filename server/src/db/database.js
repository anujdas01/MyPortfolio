import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CATEGORY_SEED = [
  'Cash',
  'Investment',
  'Retirement',
  'Real Estate',
  'Personal Property',
  'Liability',
];

export function resolveDataDir() {
  if (process.env.MP_DATA_DIR) return path.resolve(process.env.MP_DATA_DIR);
  return path.resolve(__dirname, '..', '..', 'data');
}

export function ensureJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const dir = resolveDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'secret.key');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  }
  process.env.JWT_SECRET = fs.readFileSync(file, 'utf8').trim();
  return process.env.JWT_SECRET;
}

export function openDb() {
  ensureJwtSecret();
  const dir = resolveDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'portfolio.db'));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  migrate(db);

  const seedStmt = db.prepare('INSERT OR IGNORE INTO account_categories (name) VALUES (?)');
  for (const name of CATEGORY_SEED) seedStmt.run(name);

  return db;
}

// Isolated in-memory database powering the customer demo environment.
// Lives only for the lifetime of the process — real data is never touched.
export function openDemoDb() {
  ensureJwtSecret();
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  migrate(db);

  const seedStmt = db.prepare('INSERT OR IGNORE INTO account_categories (name) VALUES (?)');
  for (const name of CATEGORY_SEED) seedStmt.run(name);

  return db;
}

// Adds the brokerage cash-sleeve columns to pre-existing databases.
// Exported for unit tests (runs against throwaway handles there).
export function ensureCashColumns(db) {
  const names = new Set(db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name));
  if (!names.has('cash_balance')) {
    db.exec('ALTER TABLE accounts ADD COLUMN cash_balance REAL NOT NULL DEFAULT 0');
  }
  if (!names.has('cash_updated_at')) {
    db.exec('ALTER TABLE accounts ADD COLUMN cash_updated_at TEXT');
  }
}

// Adds the holdings asset-type column (stocks vs crypto grouping) to
// pre-existing databases. Exported for unit tests.
export function ensureHoldingsAssetType(db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'holdings'").get();
  if (!table) return;
  const names = new Set(db.prepare('PRAGMA table_info(holdings)').all().map((c) => c.name));
  if (!names.has('asset_type')) {
    db.exec('ALTER TABLE holdings ADD COLUMN asset_type TEXT');
  }
}

// v0.2: accounts.kind became nullable (was NOT NULL DEFAULT 'other').
// SQLite cannot drop a NOT NULL constraint in place, so rebuild the table if needed.
function migrate(db) {
  ensureCashColumns(db);
  ensureHoldingsAssetType(db);
  const cols = db.prepare("PRAGMA table_info(accounts)").all();
  const kindCol = cols.find((c) => c.name === 'kind');
  if (!kindCol || !kindCol.notnull) return;

  console.log('Migrating accounts.kind to nullable...');
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE accounts_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT NOT NULL,
          institution TEXT,
          category_id INTEGER REFERENCES account_categories(id),
          kind        TEXT,
          is_asset    INTEGER NOT NULL DEFAULT 1 CHECK (is_asset IN (0,1)),
          notes       TEXT,
          archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
          cash_balance   REAL NOT NULL DEFAULT 0,
          cash_updated_at TEXT,
          created_at  TEXT DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO accounts_new (id, name, institution, category_id, kind, is_asset, notes, archived, cash_balance, cash_updated_at, created_at)
        SELECT id, name, institution, category_id, kind, is_asset, notes, archived, cash_balance, cash_updated_at, created_at FROM accounts;
      DROP TABLE accounts;
      ALTER TABLE accounts_new RENAME TO accounts;
    `);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_accounts_category ON accounts(category_id);' +
    'CREATE INDEX IF NOT EXISTS idx_snapshots_account ON balance_snapshots(account_id, as_of_date);' +
    'CREATE INDEX IF NOT EXISTS idx_snapshots_date ON balance_snapshots(as_of_date);'
  );
}
