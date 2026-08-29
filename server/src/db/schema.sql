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

CREATE INDEX IF NOT EXISTS idx_snapshots_account ON balance_snapshots(account_id, as_of_date);
CREATE INDEX IF NOT EXISTS idx_accounts_category ON accounts(category_id);
