CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  TEXT,
    role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
    theme_pref    TEXT DEFAULT 'light',
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS account_categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    institution TEXT,
    category_id INTEGER REFERENCES account_categories(id),
    kind        TEXT,
    is_asset    INTEGER NOT NULL DEFAULT 1 CHECK (is_asset IN (0,1)),
    notes       TEXT,
    archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
    -- Uninvested cash sleeve (settlement / sweep fund) for brokerage-style
    -- accounts. Counted by the market-value auto refresh alongside holdings.
    cash_balance   REAL NOT NULL DEFAULT 0,
    cash_updated_at TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS balance_snapshots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    value      REAL NOT NULL,
    as_of_date TEXT NOT NULL CHECK (as_of_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    note       TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti        TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_snapshots_account ON balance_snapshots(account_id, as_of_date);
-- Lets the net-worth series walk snapshots already in date order rather than
-- sorting the whole table through a temp B-tree on every dashboard load.
CREATE INDEX IF NOT EXISTS idx_snapshots_date ON balance_snapshots(as_of_date);
CREATE INDEX IF NOT EXISTS idx_accounts_category ON accounts(category_id);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);

-- Holdings for investment accounts (brokerage, 401k, IRA, etc.)
CREATE TABLE IF NOT EXISTS holdings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    ticker      TEXT NOT NULL,
    name        TEXT,
    shares      REAL NOT NULL,
    cost_basis  REAL NOT NULL,
    currency    TEXT NOT NULL DEFAULT 'USD',
    -- Yahoo quote type (EQUITY | ETF | CRYPTOCURRENCY | MUTUALFUND), used to
    -- group stocks vs crypto. NULL = unknown, falls back to ticker suffix.
    asset_type  TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id);

-- Income events (dividends, interest, distributions)
CREATE TABLE IF NOT EXISTS income_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    holding_id  INTEGER REFERENCES holdings(id) ON DELETE SET NULL,
    type        TEXT NOT NULL CHECK (type IN ('dividend','interest','distribution','other')),
    amount      REAL NOT NULL,
    currency    TEXT NOT NULL DEFAULT 'USD',
    as_of_date  TEXT NOT NULL CHECK (as_of_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    note        TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_income_account ON income_events(account_id, as_of_date);
CREATE INDEX IF NOT EXISTS idx_income_holding ON income_events(holding_id);
