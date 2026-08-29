# 💼 MyPortfolio

A locally hosted web application that tracks your entire financial picture — checking & savings
accounts, brokerage, 401(k), Roth IRA, real estate, personal property, and liabilities — behind a
single **net worth dashboard** with historical charts, household shared logins, and switchable
color themes.

## Features

- **Net worth dashboard** — headline totals, change vs. previous snapshot & last 30 days,
  net-worth-over-time line chart (6M / 1Y / YTD / All), asset-allocation donut, recent updates.
  Sections can be **rearranged by drag & drop** (Edit layout mode, saved automatically) and switched
  between **comfortable and compact** density.
- **Accounts** — searchable and filterable by category, asset/liability type, and free text; group by
  category, institution, asset/liability, account type, or status with collapsible groups and live
  per-group/net-worth totals. Any account can be an asset or a liability; archive instead of deleting
  to keep history.
- **Balance snapshots** — record a value + date + note whenever you want (e.g. monthly statement day).
  All history and charts are derived from snapshots, so nothing is ever overwritten.
- **Household shared access** — one admin creates additional member logins; everyone sees the same
  combined portfolio.
- **Customer demo mode** — a one-click **"Explore the demo"** button on the login page drops visitors
  into an isolated environment seeded with 7 realistic accounts × **8 years** of monthly balances.
  Demo data lives in a separate in-memory database, demo tokens cannot touch real accounts (and vice
  versa), and Settings offers "Restore sample data" to reset the showcase at any time.
- **Color themes** — Light, Sepia, Dark, GitHub, Dracula, Catppuccin, Gruvbox, Nord, Solarized,
  Rosé Pine, High Contrast. Persisted per user in both localStorage and the database.
- **Switchable main menu layout** — top bar or left sidebar, chosen from Settings and applied instantly.
- **PDF reports** — pick sections, title, and date range, then **preview the exact PDF inside the page**
  before downloading. Generated entirely client-side; no data leaves your machine.
- **Data ownership** — everything lives in one SQLite file on your PC. JSON/CSV export **and re-import**
  built in, plus a password-guarded reset that wipes portfolio data (users are kept).

## Tech Stack

| Layer     | Choice                                        |
|-----------|-----------------------------------------------|
| Frontend  | React 18 + Vite, Tailwind CSS, Recharts       |
| Backend   | Node.js + Express                             |
| Database  | SQLite via Node's built-in `node:sqlite`      |
| Auth      | bcryptjs password hashing + JWT (access token in memory, refresh token in httpOnly cookie) |

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

# 2b. Production mode (Express serves the built client on :3000... actually :3001)
npm run build               # builds client/dist
npm start                   # http://127.0.0.1:3001
```

First visit redirects you to **/setup** to create the household admin account.
After that, add accounts from the Accounts page and start saving balances.

### Optional demo data

```powershell
npm run seed-demo --prefix server        # add --force if accounts already exist
```

Inserts 7 realistic accounts × 8 years of monthly snapshots into your real database so the dashboard
has something to show. Prefer not to touch your data? Use the built-in **demo mode** instead (login
page → "Explore the demo") — it runs on a separate in-memory database and never modifies
`portfolio.db`.

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
export all data as JSON or CSV, and **import those same formats back** (accounts, balance history,
and categories are recreated; old IDs are remapped). Admins can additionally **reset the database**
from Settings — it requires re-entering the admin password and restores the default categories while
keeping user logins intact.

## Tests

```powershell
npm test    # server API tests (node:test) + client util tests
```

31 server tests cover the whole flow: setup → login → accounts → snapshots → reports → users →
themes → exports → **JSON/CSV import round-trips** → **password-guarded database reset**, plus the
**demo environment** (one-click login, seeded data, real/demo isolation, sample-data restore).
8 client tests cover formatting utilities.

## Project Structure

```
MyPortfolio/
├── plan/Plan-MyPortfolio.md   # original build plan
├── client/                    # React SPA (Vite + Tailwind)
│   └── src/{api,components,context,pages,utils}
├── server/
│   ├── src/
│   │   ├── routes/            # auth, users, accounts (+import), reports, settings (+reset), export
│   │   ├── middleware/        # JWT guard, role guard, error handler
│   │   ├── db/                # schema.sql, connection, demo seeder
│   │   └── app.js, index.js
│   ├── data/                  # portfolio.db (gitignored)
│   └── test/api.test.mjs
└── package.json               # dev/start/test orchestration
```

## Security Notes

- Server binds to `127.0.0.1` by default — not reachable from your network unless you change `HOST`
  and open a firewall rule deliberately.
- Passwords are bcrypt-hashed; tokens expire (15 min access / 30-day refresh cookie scoped to
  `/api/auth`); login is rate-limited.
- Demo sessions are cryptographically scoped: demo tokens are rejected by the real API, the real API
  rejects demo refresh cookies, and the demo environment's database exists only in memory.
- This is a local personal app — don't expose it directly to the internet without putting it behind
  a reverse proxy with TLS first.

## Roadmap ideas

Plaid bank sync · transaction-level tracking · allocation targets & drift alerts · multi-currency.
See `plan/Plan-MyPortfolio.md` §11.
