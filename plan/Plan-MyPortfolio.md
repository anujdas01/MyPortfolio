# MyPortfolio — Comprehensive Build Plan

A locally hosted web application for tracking your complete financial picture — checking/savings accounts, brokerage, 401k, Roth IRA, real estate, and more — with a unified **net worth dashboard**, historical trends, charts, household shared login, and switchable color themes.

---

## 1. Overview

| Attribute | Decision |
|---|---|
| Application name | **MyPortfolio** |
| Hosting | Local Windows PC (localhost by default; LAN access optional) |
| Stack | React (Vite) + Node.js/Express + SQLite |
| Data entry | Manual balance snapshots |
| Access model | Household shared — multiple users see one combined portfolio |
| Key features | Net worth summary, history & charts, customizable dashboard layout, filterable accounts, PDF reports with in-page preview, JSON/CSV export & import, color theme switcher, top/left menu layouts |

---

## 2. Architecture

```
┌─────────────────────┐        REST (JSON)         ┌──────────────────────┐
│  React SPA (Vite)   │ ◄────────────────────────► │  Express API Server  │
│  Tailwind + Themes  │      JWT-protected         │  node:sqlite         │
│  Recharts charts    │                            │  data/portfolio.db   │
│  pdfmake reports    │                            └──────────────────────┘
└─────────────────────┘
```

**Monorepo layout:**

```
D:\VSCodeWorkspace\MyPortfolio\
├── plan\Plan-MyPortfolio.md
├── client\                  # React + Vite frontend
│   └── src\
│       ├── components\      # Layout (top bar / left sidebar), ThemeSwitcher, Cards, Charts, Modal, Spinner
│       ├── pages\           # Login, Setup, Dashboard, Accounts, AccountDetail, Reports, Settings
│       ├── context\         # AuthContext, ThemeContext, NavContext (menu position)
│       ├── utils\           # format helpers, reportPdf.js (pdfmake doc builder + chart capture)
│       └── api\             # Axios instance w/ token interceptor
├── server\                  # Express backend
│   ├── src\
│   │   ├── routes\          # auth, users, accounts (+import), snapshots, reports, settings (+reset), export
│   │   ├── middleware\      # JWT auth guard, admin role guard, error handler, rate-limit
│   │   ├── db\              # connection, schema.sql, seed, migrations
│   │   └── index.js
│   └── data\portfolio.db    # single-file SQLite DB (easy backup)
└── package.json             # root scripts (dev/prod/test via concurrently)
```

**Key libraries**

| Layer | Choice |
|---|---|
| Frontend build | Vite + React 18 |
| Styling | Tailwind CSS driven by CSS custom properties |
| Charts | Recharts |
| PDF reports | pdfmake (client-side; charts rasterized from SVG to PNG) |
| HTTP client | Axios (interceptor attaches JWT) |
| Routing | React Router v6+ |
| Backend | Node.js + Express |
| Database | SQLite via Node's built-in `node:sqlite` (zero native deps) |
| Auth | bcryptjs + jsonwebtoken |

---

## 3. Database Schema (SQLite)

```sql
CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  TEXT,
    role          TEXT NOT NULL DEFAULT 'member',   -- 'admin' | 'member'
    theme_pref    TEXT DEFAULT 'light',
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE account_categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);
-- Seeded: Cash, Investment, Retirement, Real Estate, Personal Property, Liability

CREATE TABLE accounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    institution   TEXT,
    category_id   INTEGER REFERENCES account_categories(id),
    kind          TEXT,              -- nullable since v0.2 migration; checking | savings |
                                     -- brokerage | 401k | roth_ira | house | vehicle | ...
    is_asset      INTEGER NOT NULL DEFAULT 1,        -- 0 = liability
    notes         TEXT,
    archived      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE balance_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id   INTEGER NOT NULL REFERENCES accounts(id),
    value        REAL NOT NULL,
    as_of_date   DATE NOT NULL,
    note         TEXT,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);
-- One row per update; powers all history/charts.
```

**Net worth** = Σ(latest snapshot ≤ date for each `is_asset = 1` account) − Σ(latest snapshot for liabilities).

---

## 4. Backend API (Express)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/setup` | POST | First-run creation of the household admin |
| `/api/auth/login` | POST | Authenticate → JWT access token (+ refresh cookie) |
| `/api/auth/refresh` | POST | Rotate access token |
| `/api/auth/logout` | POST | Clear refresh cookie |
| `/api/users` | GET / POST / PATCH / DELETE | Manage household users (admin only) |
| `/api/accounts` | CRUD | List/create/update/archive accounts (+ permanent delete) |
| `/api/accounts/categories` | GET | Category list for forms/filters |
| `/api/accounts/import` | POST | Import previously exported JSON/CSV (`{ format, content }`) |
| `/api/accounts/:id/snapshots` | GET / POST | Balance history + add new balance entry |
| `/api/reports/net-worth` | GET | Current totals + time series (`?range=6m\|1y\|ytd\|all`) |
| `/api/reports/allocation` | GET | Breakdown by category/kind |
| `/api/settings/theme` | PUT | Persist theme preference per user |
| `/api/settings/reset-data` | POST | Wipe portfolio data; requires admin session + admin password re-entry |
| `/api/export` | GET | JSON/CSV backup of all data |

---

## 5. Authentication

- **bcryptjs** password hashing; JWT (15 min) + httpOnly refresh cookie (30 days).
- First run shows setup wizard → create admin user.
- Admin invites additional household members (role: `member`); everyone shares one portfolio dataset.
- All `/api/*` routes except auth guarded by middleware; rate-limit login attempts.

---

## 6. Frontend Pages

1. **Login / First-run Setup**
2. **Dashboard**
   - Net worth headline card + change since last month/year
   - Net worth line chart over time (Recharts)
   - Allocation donut chart by category
   - Account list with latest values
   - **Layout customization**: drag & drop section reordering with per-section handles and ↑/↓
     buttons, persisted to localStorage; compact/comfortable density toggle
3. **Accounts** — searchable + filterable (category, asset/liability, free text); group by category,
   institution, asset/liability, account type, or status; collapsible groups with counts and net
   totals; add, edit, archive
4. **Account Detail** — snapshot history table + sparkline, quick "update value" form
5. **Reports** — pick title, trend period (incl. custom dates), and sections; **in-page PDF preview**
   of the exact document before download; presets for common report types
6. **Settings** — manage users, theme gallery, main menu position (top bar / left sidebar), data
   export (JSON/CSV), import of the same formats, password-guarded database reset

---

## 7. Theme System

- CSS custom properties per `[data-theme="…"]`:
  - `--color-bg`, `--color-surface`, `--color-text`, `--color-primary`, `--color-accent`, `--color-positive`, `--color-negative`, etc.
- Built-in themes: **Light, Sepia, Dark, GitHub, Dracula, Catppuccin, Gruvbox, Nord, Solarized,
  Rosé Pine, High Contrast**; ThemeSwitcher dropdown in the menu (top bar or sidebar).
- Choice persisted via `localStorage` + synced to `users.theme_pref`.
- Respects `prefers-color-scheme` on first visit.

---

## 8. Implementation Milestones

1. ✅ **M1 – Skeleton**: monorepo init, Vite client + Express server, SQLite schema/migrations, health check endpoint.
2. ✅ **M2 – Auth**: setup wizard, login page, JWT middleware, user management UI.
3. ✅ **M3 – Core data**: accounts CRUD + balance snapshots, dashboard summary endpoints.
4. ✅ **M4 – UI**: layout/navbar, dashboard cards + Recharts charts, accounts pages.
5. ✅ **M5 – Themes**: CSS-variable engine, switcher, persistence.
6. ✅ **M6 – Polish**: export/backup, error handling, seed script with sample data, README.

### Shipped after v1 (v1.1)

- Accounts page: search, multi-mode grouping (category / institution / asset-liability / kind /
  status / none), filters, collapsible groups, filter-aware totals.
- Dashboard: drag-and-drop section reordering (persisted), expand/collapse groups, compact view.
- Settings: JSON/CSV import (round-trips the export formats; old IDs remapped), password-guarded
  database reset, main menu position toggle (top bar / left sidebar).
- Reports: in-page PDF preview of the exact document before download (pdfmake blob → embedded viewer).

---

## 9. Security & Ops (Windows)

- Bind server to `127.0.0.1` by default; LAN access opt-in via config + Windows Firewall rule.
- `data/portfolio.db` is single-file → trivially backed up; optional nightly copy script.
- **Dev**: `npm run dev` at root → concurrently runs client (Vite :5173) + server (:3001).
- **Prod option**: build client → Express serves static `dist/` on port 3000; optional Task Scheduler auto-start at login.

---

## 10. Testing

- **Server**: `node:test` API suite (22 tests) against an in-memory temp DB — covers setup → login →
  accounts → snapshots → reports → users → themes → exports → JSON/CSV import round-trips →
  password-guarded reset, including auth guards and validation errors.
- **Client**: `node --test` (8 tests) for formatting utilities.

---

## 11. Future Enhancements (Out of Scope for v1)

- Bank sync via Plaid (design keeps accounts/snapshots sync-friendly)
- Transaction-level tracking and holdings detail per brokerage
- Goals & target-allocation drift tracking
- Multi-currency support
- Document attachments (statements, deeds)
