// Seeds a database handle with realistic sample data for demos/showcases.
// Used by the CLI (`node src/db/seed-demo.js [--force]`) and by the in-memory
// demo environment mounted at /api/demo (see app.js).
import { openDb, CATEGORY_SEED } from './database.js';

function monthEnd(offset) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - offset);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

export const DEMO_YEARS = 8;
const DEMO_MONTHS = DEMO_YEARS * 12; // 96 monthly snapshots per account

// `start` is the balance DEMO_MONTHS ago and `drift` the average monthly
// change, so each trajectory lands on a realistic current value:
// checking ~$4.8K, savings ~$24K, brokerage ~$52K, 401(k) ~$105K,
// Roth IRA ~$42K, home ~$436K, mortgage paid down to ~$280K.
// Net worth grows from ~$95K to ~$385K over the span.
export const DEMO_ACCOUNTS = [
  { name: 'Everyday Checking', institution: 'US Bank', category: 'Cash', kind: 'checking', isAsset: 1, start: 4200, drift: 6 },
  { name: 'High-Yield Savings', institution: 'Ally Bank', category: 'Cash', kind: 'savings', isAsset: 1, start: 8500, drift: 165 },
  { name: 'Taxable Brokerage', institution: 'Fidelity', category: 'Investment', kind: 'brokerage', isAsset: 1, start: 14500, drift: 395, volatile: true },
  { name: '401(k)', institution: 'Empower', category: 'Retirement', kind: '401k', isAsset: 1, start: 44000, drift: 640, volatile: true },
  { name: 'Roth IRA', institution: 'Vanguard', category: 'Retirement', kind: 'roth_ira', isAsset: 1, start: 17500, drift: 260, volatile: true },
  { name: 'Primary Residence', institution: '', category: 'Real Estate', kind: 'house', isAsset: 1, start: 342000, drift: 980 },
  { name: 'Mortgage', institution: 'Rocket Mortgage', category: 'Liability', kind: 'mortgage', isAsset: 0, start: 362000, drift: -855 },
];

export function seedDemoData(db, { useTransaction = true } = {}) {
  const catId = (name) => db.prepare('SELECT id FROM account_categories WHERE name = ?').get(name).id;

  const insertAccount = db.prepare(
    'INSERT INTO accounts (name, institution, category_id, kind, is_asset) VALUES (?, ?, ?, ?, ?)'
  );
  const insertSnap = db.prepare(
    'INSERT INTO balance_snapshots (account_id, value, as_of_date) VALUES (?, ?, ?)'
  );

  if (!useTransaction) {
    return insertRows();
  }

  db.exec('BEGIN');
  try {
    const n = insertRows();
    db.exec('COMMIT');
    return n;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  function insertRows() {
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647 - 0.5;
    };
    for (const a of DEMO_ACCOUNTS) {
      const info = insertAccount.run(a.name, a.institution || null, catId(a.category), a.kind, a.isAsset);
      // Two gentle market cycles over the span make volatile accounts look organic.
      const approxEnd = Math.abs(a.start + a.drift * (DEMO_MONTHS - 1));
      const amp = a.volatile ? Math.max(500, approxEnd * 0.012) : Math.max(40, approxEnd * 0.002);
      for (let m = DEMO_MONTHS - 1; m >= 0; m--) {
        const age = DEMO_MONTHS - 1 - m; // 0 = oldest … 95 = newest
        const noise = rand() * amp;
        const cycle = a.volatile ? Math.sin((age / DEMO_MONTHS) * Math.PI * 4) * amp * 1.2 : 0;
        const value = Math.max(0, a.start + a.drift * age + cycle + noise);
        insertSnap.run(info.lastInsertRowid, Math.round(value * 100) / 100, monthEnd(m));
      }
    }
    return DEMO_ACCOUNTS.length;
  }
}

// CLI usage: node src/db/seed-demo.js [--force]
const invokedDirectly =
  process.argv[1] && (process.argv[1].endsWith('seed-demo.js') || process.argv[1].endsWith('seed-demo'));

if (invokedDirectly) {
  const force = process.argv.includes('--force');
  const cliDb = openDb();

  const existing = cliDb.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
  if (existing > 0 && !force) {
    console.error(`Database already has ${existing} accounts. Re-run with --force to add demo data anyway.`);
    process.exit(1);
  }

  const created = seedDemoData(cliDb);
  console.log(`Demo data created: ${created} accounts x ${DEMO_MONTHS} monthly snapshots (~${DEMO_YEARS} years).`);
  console.log(`Categories available: ${CATEGORY_SEED.join(', ')}`);
  cliDb.close();
}
