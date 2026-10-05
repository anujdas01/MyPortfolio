# 💼 MyPortfolio

A locally hosted web application that tracks your entire financial picture — checking & savings
accounts, brokerage, crypto, 401(k), Roth IRA, real estate, personal property, and liabilities —
behind a single **net worth dashboard** with historical charts, **live market prices**, household
shared logins, and switchable color themes.

## Features

- **Net worth dashboard** — headline totals, change vs. previous snapshot, last 30 days and YoY,
  net-worth-over-time chart (line/area, 3M / 6M / 1Y / YTD / All), allocation donut by category or
  institution, insights & performance (avg monthly, best/worst month, momentum, concentration), key
  ratios (debt ratio, leverage, cash coverage), liabilities breakdown with payoff focus, recently
  updated / top accounts, and a needs-attention list (stale or never-updated accounts). Sections can
  be **rearranged by drag & drop**, hidden, collapsed (Edit layout mode, saved automatically) and
  switched between **comfortable and compact** density.
- **Accounts** — searchable and filterable by category, asset/liability type, and free text; group by
  category, institution, asset/liability, account type, or status with collapsible groups and live
  per-group/net-worth totals. **Bulk-select** accounts to archive/restore or set category/institution
  in one go; toggle visible **columns** (institution, type, category, notes, last updated); record a
  new balance inline with the ⚡ **quick update** without leaving the page; expand any row for its
  history chart/table. Filters sync to the URL; any account can be an asset or a liability; archive
  instead of deleting to keep history.
- **Balance snapshots** — record a value + date + note whenever you want (e.g. monthly statement day).
  All history and charts are derived from snapshots. Market refreshes overwrite *today's* row with
  the live total (even a manual entry); past history is never touched.
- **Holdings & live market data** — track individual positions inside investment accounts: pick the
  exact symbol from a **search picker** covering stocks, ETFs, funds and crypto (it disambiguates
  `BTC-USD` spot Bitcoin from the `BTC` ETF instead of guessing), then enter shares + **average cost**
  — the total cost basis is computed for you. The table shows live prices (full precision, so SHIB at
  $0.00000591 never reads $0.00), market value, gain/loss, and cost weight, grouped into **Stocks &
  ETFs** and **Crypto** sections. Quotes come from Yahoo Finance (no API key) and are **always
  fetched live, never cached**. A dedicated **Crypto** account kind is included.
- **Market-value auto-refresh** — opening the Accounts page reprices every brokerage/retirement
  account from live quotes (toggleable, with a manual **Refresh prices** button and per-account skip
  reasons such as "no holdings to price"). The live total is Σ(shares × price) **plus the cash
  sleeve**, and each account page has an **Update from market value** button applying the same rules.
- **Cash (settlement) sleeve** — record uninvested cash per investment account; it counts toward the
  account value, live totals, and market refreshes. Handy for sweep funds and assets without tickers
  (e.g. stable-value funds).
- **Dividends & interest** — log dividend, interest, and distribution payouts, optionally linked to a
  holding, with trailing-12-month / year-to-date totals and yield. Re-imports never duplicate entries.
- **Benchmark comparison** — each investment account charts its actual growth against a hypothetical
  benchmark (S&P 500 ~10%/yr, balanced 60/40 ~7%/yr, bonds ~4%/yr, inflation ~3%/yr, or custom),
  with outperformance and actual CAGR.
- **Robinhood CSV import** — drop in a Robinhood *Account activity report* CSV: a **preview** shows
  rebuilt positions (average-cost accounting, DRIP detection), dividends/interest to add, fully-sold
  tickers, and anything needing a look (transfers, splits, options, partial history) *before* you
  confirm. Confirming adds new positions, updates existing ones, removes sold-out ones (only when the
  file shows both buys and sells — partial files never delete), and skips already-recorded income, so
  re-importing is safe.
- **Household shared access** — one admin creates additional member logins; everyone sees the same
  combined portfolio. Admins can reset passwords, change roles, and **rename logins**.
- **Editable profile** — click your name in the top-right (or the sidebar footer) to change your
  display name, **login name**, and password. Everyone can edit their own profile without being an
  admin; changing the login name or password asks for the current one and signs you back in
  automatically with a fresh session.
- **Customer demo mode** — a one-click **"Explore the demo"** button on the login page drops visitors
  into an isolated environment seeded with 7 realistic accounts × **8 years** of monthly balances,
  plus sample holdings (VTI/VXUS/BTC-USD, a VTSAX mutual fund, Roth VTI) and cash sleeves. Demo data
  lives in a separate in-memory database, demo tokens cannot touch real accounts (and vice versa),
  and Settings offers "Restore sample data" to reset the showcase at any time.
- **Color themes** — Light, Sepia, Dark, GitHub, Dracula, Catppuccin, Gruvbox, Nord, Solarized,
  Rosé Pine, High Contrast. Persisted per user in both localStorage and the database.
- **Switchable main menu layout** — top bar or left sidebar, chosen from Settings and applied instantly.
- **PDF reports** — pick sections, title, and date range, then **preview the exact PDF inside the page**
  before downloading. Generated entirely client-side; no data leaves your machine.
- **Data ownership** — everything lives in one SQLite file on your PC. The JSON backup includes
  accounts (with cash sleeves), full balance history, **holdings, and income events**, and re-import
  recreates everything with old IDs remapped (income stays linked to its holding). CSV export/import
  covers snapshot rows. A password-guarded reset wipes portfolio data (users are kept).

## Tech Stack

| Layer     | Choice                                        |
|-----------|-----------------------------------------------|
| Frontend  | React 18 + Vite, Tailwind CSS, Recharts       |
| Backend   | Node.js + Express                             |
| Database  | SQLite via Node's built-in `node:sqlite`      |
| Auth      | bcryptjs password hashing + JWT (access token in memory, refresh token in httpOnly cookie) |
| Market data | Yahoo Finance chart + search APIs (no key; server-side, live quotes) |

No native modules are compiled — `node:sqlite` ships with Node 22+, so installation is pure JS.

## Quick Start (Windows)

Requires Node.js 22+ (developed on Node 26).

```powershell
# 1. Install dependencies (three package.json files)
npm install                 # root (concurrently)
npm install --prefix server
npm install --prefix client

# 2a. Development mode (Vite on :5173 proxying API on :3001)
npm run dev

# 2b. Production mode (Express serves the built client on :3001)
npm run build               # builds client/dist
npm start                   # http://127.0.0.1:3001
```

First visit redirects you to **/setup** to create the household admin account.
After that, add accounts from the Accounts page and start saving balances. For investment accounts,
add holdings (or import a Robinhood CSV) to unlock live prices and market-value refresh.

### Optional demo data

```powershell
npm run seed-demo --prefix server        # add --force if accounts already exist
```

Inserts 7 realistic accounts × 8 years of monthly snapshots (plus sample holdings and cash sleeves)
into your real database so the dashboard has something to show. Prefer not to touch your data? Use
the built-in **demo mode** instead (login page → "Explore the demo") — it runs on a separate
in-memory database and never modifies `portfolio.db`.

## Configuration

All optional — see `.env.example`. Copy it to `server/.env` to override:

| Variable       | Default                          | Purpose                              |
|----------------|----------------------------------|--------------------------------------|
| `PORT`         | `3001`                           | API/server port                      |
| `HOST`         | `127.0.0.1`                      | Bind address (keep localhost!)       |
| `JWT_SECRET`   | auto-generated → `data/secret.key` | Token signing secret              |
| `CLIENT_ORIGIN`| `http://localhost:5173`          | Allowed CORS origin for dev mode     |
| `MP_DATA_DIR`  | `<repo>/server/data`             | Where portfolio.db + secret live     |

## Backups

Copy `server/data/portfolio.db` anywhere safe — it's a single file. The Settings page can also
export all data as JSON or CSV, and **import those same formats back**: accounts (with categories and
cash sleeves), balance history, **holdings (with asset types), and income events** are recreated with
old IDs remapped and income re-linked to its holding; invalid rows are skipped and reported. Admins
can additionally **reset the database** from Settings — it requires re-entering the admin password
and restores the default categories while keeping user logins intact.

## Tests

```powershell
npm test    # server API tests (node:test) + client util tests
```

107 server tests cover the whole flow: setup → login → accounts (incl. the cash sleeve) →
snapshots → **holdings (asset types, ticker-change re-derivation, legacy migration)** → **live
market quotes/search/refresh (always-live fetching, sub-cent precision, idempotency, manual-entry
override, per-account skip reasons)** → **Robinhood CSV import (parser, preview, dedupe,
sold-out removal, partial-file guard)** → **users (self-service + admin login-name changes)** →
reports → themes → exports → **JSON/CSV import round-trips (incl. holdings + income)** →
**password-guarded database reset**, **snapshot pagination**, plus the **demo environment**
(one-click login, seeded data incl. holdings, real/demo isolation, sample-data restore) and the
**versioned `/api/v1` surface + OpenAPI/Swagger docs**.
10 client tests cover formatting utilities (incl. sub-cent `marketPrice` and exponent-free
`plainAmount`).

## API Versioning & Docs

All endpoints live under the versioned path **`/api/v1`** (e.g. `POST /api/v1/auth/login`).
The un-versioned `/api/...` paths from earlier releases still work as a backward-compatible alias
during migration; bump the `API_VERSION` constant in `server/src/app.js` when introducing breaking
changes and keep prior versions mounted until clients are updated.

Interactive documentation is served by **Swagger UI**:

| Route | Purpose |
|-------|---------|
| `http://127.0.0.1:3001/api/v1/docs` | Interactive API explorer (try requests, authorize with a JWT) |
| `http://127.0.0.1:3001/api/v1/docs.json` | Raw OpenAPI 3.1 spec (JSON) |

The spec is built automatically from `@openapi` JSDoc annotations living next to each route in
`server/src/routes/*.js` (see `server/src/swagger.js` for the base config), covering the
**Accounts**, **Market** (quotes, search, refresh), **Authentication**, **Users**, **Reports**,
**Settings**, and **Export** tags. For example, run `GET /api/v1/docs.json` to machine-read the
current API, or point a codegen tool (OpenAPI Generator, Postman import, etc.) at it.


## Project Structure

```
MyPortfolio/
├── plan/Plan-MyPortfolio.md   # original build plan
├── client/                    # React SPA (Vite + Tailwind)
│   └── src/{api,components,context,pages,utils}
│       # components/ProfileModal.jsx — self-service profile incl. login name
├── server/
│   ├── src/
│   │   ├── routes/            # auth, users, accounts (+holdings/income/Robinhood import),
│   │   │                      #   market (quotes/search/refresh), reports, settings (+reset), export
│   │   ├── market.js          # Yahoo quote + symbol-search service (live, cached search only)
│   │   ├── robinhood.js       # Robinhood activity-CSV parser + applier
│   │   ├── middleware/        # JWT guard, role guard, error handler
│   │   ├── db/                # schema.sql, connection (+migrations), demo seeder
│   │   └── app.js, index.js
│   ├── data/                  # portfolio.db (gitignored)
│   └── test/                  # api, demo, holdings, market, robinhood, users suites
└── package.json               # dev/start/test orchestration
```

## Security Notes

- Server binds to `127.0.0.1` by default — not reachable from your network unless you change `HOST`
  and open a firewall rule deliberately.
- Passwords are bcrypt-hashed; tokens expire (15 min access / 30-day refresh cookie scoped to
  `/api/auth`); login is rate-limited.
- Changing your own login name or password requires re-entering the current password and re-issues
  the session, so a stolen token cannot lock you out or linger with stale credentials.
- The access token is held **in memory only**, never in `localStorage`, so an XSS payload cannot read
  it out of persistent storage. Each page load re-mints one from the httpOnly refresh cookie via
  `POST /auth/refresh`.
- Cookie-authenticated writes (`/auth/refresh`, `/auth/logout`) require a **double-submit CSRF
  token**: the client echoes the readable `mp_csrf_*` cookie back in the `X-MP-CSRF` header. Requests
  carrying a `Bearer` token are exempt, since those cannot be forged cross-origin.
- Refresh-token revocation is **persisted** to a `revoked_tokens` table, so restarting the server no
  longer resurrects already-logged-out sessions. Rows carry the token's own expiry and are pruned.
- The login rate limiter is **per mount**, and the credential-free demo login has its own, higher
  budget — exploring the demo no longer eats into the household's real login allowance.
- Demo sessions are cryptographically scoped: demo tokens are rejected by the real API, the real API
  rejects demo refresh cookies, and the demo environment's database exists only in memory.
- Live market data is the one exception to "no data leaves your machine": ticker symbols you look up
  or refresh are sent to Yahoo Finance (no account details or personal data). Quotes are fetched live
  on demand and never stored — only the balances and positions you explicitly record end up in your
  database.
- This is a local personal app — don't expose it directly to the internet without putting it behind
  a reverse proxy with TLS first.

## Roadmap ideas

Plaid bank sync · true transaction ledger · allocation targets & drift alerts · multi-currency
display · PWA/mobile install · scheduled PDF snapshots.
See `plan/Plan-MyPortfolio.md` §11.
