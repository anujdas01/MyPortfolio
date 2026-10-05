// Importer for Robinhood "Account activity report" CSV exports.
//
// Expected header (extra columns such as "Account Type" are tolerated):
//   "Activity Date","Process Date","Settle Date","Instrument","Description",
//   "Trans Code","Quantity","Price","Amount"
//
// Notes on the format (verified against Robinhood exports + community parsers):
// - Dates are M/D/YYYY; money looks like $1,234.56 with (parentheses) for
//   cash-out rows; descriptions may span multiple quoted lines.
// - BUY/SELL rows carry stock fills (dividend reinvestments appear as BUY
//   rows whose description mentions "Dividend Reinvestment").
// - CDIV rows are cash dividends, INT rows cash interest.
// - Option rows (STO/BTC/STC/BTO/...) are skipped: holdings track shares only.
// - Anything unrecognized is counted and surfaced as a warning — never
//   silently absorbed — so partial-history or transfer rows stay visible.

import { HttpError } from './utils/httpError.js';
import { isValidDate } from './utils/validate.js';

export const ROBINHOOD_REQUIRED_HEADERS = [
  'Activity Date',
  'Instrument',
  'Description',
  'Trans Code',
  'Quantity',
  'Price',
  'Amount',
];

export const MAX_ROBINHOOD_CHARS = 5 * 1024 * 1024;
const MAX_ROWS = 20000;
const MAX_WARNINGS = 30;

// Trans codes we deliberately skip (counted in the response, not warnings).
const OPTION_CODES = new Set(['STO', 'BTC', 'STC', 'BTO', 'OASGN', 'OEXP', 'OEXER']);

/**
 * Quote-aware CSV split that survives embedded commas, escaped quotes and
 * multi-line quoted fields (Robinhood descriptions span several lines).
 * @returns {string[][]} rows of fields (no header interpretation)
 */
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else if (ch === '\r') {
      // line break handled by \n
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/** "$1,234.56" -> 1234.56, "($43.64)" -> -43.64, "" -> null */
export function parseRobinhoodMoney(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return negative ? -v : v;
}

/** Share/price numbers ($ and commas tolerated). "" -> null */
export function parseRobinhoodNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/[$,\s]/g, '').trim();
  if (!s) return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** "9/18/2023" -> "2023-09-18"; ISO passes through; else null */
export function parseRobinhoodDate(raw) {
  const s = String(raw || '').trim();
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const iso = `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
    return isValidDate(iso) ? iso : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && isValidDate(s)) return s;
  return null;
}

const round2 = (n) => Math.round(n * 100) / 100;
const round6 = (n) => Math.round(n * 1e6) / 1e6;
// Per-share averages need full precision: sub-cent crypto prices (e.g.
// SHIB at $0.00000591) round to $0 at cents. Totals stay at cents.
const round10 = (n) => Math.round(n * 1e10) / 1e10;

function firstLine(desc) {
  const line = String(desc || '').split('\n')[0].trim();
  if (!line || /^cash div/i.test(line)) return null;
  return line.slice(0, 120);
}

/**
 * Parse a Robinhood activity CSV into positions + income.
 * @returns {{positions, income, closedPositions, ignored, warnings, stats}}
 * @throws {HttpError} 400 on wrong file, 413 on oversized file
 */
export function parseRobinhoodCsv(content) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new HttpError(400, 'CSV content is empty');
  }
  if (content.length > MAX_ROBINHOOD_CHARS) {
    throw new HttpError(413, 'CSV is too large (max 5 MB)');
  }

  const rows = parseCsvRows(content);
  if (rows.length < 2) {
    throw new HttpError(400, 'CSV has no data rows — is this a Robinhood activity report?');
  }
  const headers = rows[0].map((h) => h.trim());
  const idx = {};
  headers.forEach((h, i) => {
    if (idx[h] === undefined) idx[h] = i;
  });
  const missing = ROBINHOOD_REQUIRED_HEADERS.filter((h) => idx[h] === undefined);
  if (missing.length) {
    throw new HttpError(
      400,
      `Not a Robinhood activity CSV — missing columns: ${missing.join(', ')}. ` +
        'Export it via Robinhood → Account → Reports and statements → Account activity report → Download CSV.'
    );
  }
  if (rows.length - 1 > MAX_ROWS) {
    throw new HttpError(413, `CSV has too many rows (max ${MAX_ROWS})`);
  }

  // ticker -> { ticker, name, shares, cost, buys, sells, dripBuys, firstSeen }
  const lots = new Map();
  const income = [];
  const ignored = new Map(); // transCode -> count
  const tickerFlags = new Map(); // ticker -> Set(transCode) of ignored rows
  let optionsSkipped = 0;
  const warnings = [];
  const warn = (msg) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(msg);
  };

  const getLot = (ticker) => {
    let lot = lots.get(ticker);
    if (!lot) {
      lot = { ticker, name: null, shares: 0, cost: 0, buys: 0, sells: 0, dripBuys: 0 };
      lots.set(ticker, lot);
    }
    return lot;
  };

  let dataRows = 0;
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (h) => (cells[idx[h]] ?? '').trim();
    const code = get('Trans Code').toUpperCase();
    if (!code) continue; // blank filler row
    dataRows++;

    const date = parseRobinhoodDate(get('Activity Date'));
    const instrument = get('Instrument').toUpperCase();
    const desc = get('Description');
    const qty = parseRobinhoodNumber(get('Quantity'));
    const price = parseRobinhoodNumber(get('Price'));
    const amount = parseRobinhoodMoney(get('Amount'));

    const flag = (t, c) => {
      if (!t) return;
      if (!tickerFlags.has(t)) tickerFlags.set(t, new Set());
      tickerFlags.get(t).add(c);
    };

    if (code === 'BUY' || code === 'SELL') {
      if (!instrument || !/^[A-Z0-9.\-]{1,16}$/.test(instrument)) {
        warn(`Row ${r + 1}: ${code} with missing ticker — skipped.`);
        continue;
      }
      if (!(qty > 0) || !(price >= 0)) {
        warn(`Row ${r + 1}: ${code} ${instrument} has no usable quantity/price — skipped.`);
        continue;
      }
      const lot = getLot(instrument);
      if (!lot.name) lot.name = firstLine(desc);
      if (code === 'BUY') {
        lot.shares += qty;
        lot.cost += qty * price;
        lot.buys++;
        if (/dividend reinvest/i.test(desc)) lot.dripBuys++;
      } else {
        lot.sells++;
        if (qty >= lot.shares) {
          if (lot.buys === 0) {
            warn(
              `${instrument}: sold ${qty} with no recorded buys — ` +
                'the file may not cover your full history; no position created.'
            );
          } else if (lot.shares > 0) {
            warn(
              `${instrument}: sold ${qty} but only ${round6(lot.shares)} recorded as bought — ` +
                'the file may not cover your full history; cost basis reset to $0 for the remainder.'
            );
          }
          lot.shares = 0;
          lot.cost = 0;
        } else {
          lot.cost = (lot.cost * (lot.shares - qty)) / lot.shares;
          lot.shares -= qty;
        }
      }
    } else if (code === 'CDIV' || code === 'INT') {
      const type = code === 'CDIV' ? 'dividend' : 'interest';
      if (!(amount > 0)) {
        warn(`Row ${r + 1}: ${type} of ${get('Amount') || '$0'} — skipped (only cash payouts import).`);
        continue;
      }
      if (!date) {
        warn(`Row ${r + 1}: ${type} has an unreadable date — skipped.`);
        continue;
      }
      const today = new Date().toISOString().slice(0, 10);
      if (date > today) {
        warn(`Row ${r + 1}: ${type} dated ${date} is in the future — skipped.`);
        continue;
      }
      income.push({
        type,
        amount: round2(amount),
        asOfDate: date,
        ticker: instrument || null,
        note: `Robinhood ${code}${instrument ? ` · ${instrument}` : ''}`,
      });
    } else if (code === 'SPLIT') {
      if (!instrument || !(qty !== null && qty !== 0)) {
        warn(`Row ${r + 1}: stock split without usable details — check ${instrument || 'the position'} manually.`);
        continue;
      }
      const lot = getLot(instrument);
      lot.shares += qty; // forward splits arrive as additional shares at zero cost
      warn(
        `${instrument}: stock split (${qty > 0 ? '+' : ''}${qty} shares) — applied at zero cost, ` +
          'please verify the share count.'
      );
    } else if (OPTION_CODES.has(code)) {
      optionsSkipped++;
    } else {
      ignored.set(code, (ignored.get(code) || 0) + 1);
      flag(instrument, code);
    }
  }

  if (!dataRows) {
    throw new HttpError(400, 'CSV has no data rows — is this a Robinhood activity report?');
  }

  const positions = [];
  const closedPositions = [];
  for (const lot of lots.values()) {
    const shares = round6(lot.shares);
    const cost = round2(Math.max(0, lot.cost));
    const entry = {
      ticker: lot.ticker,
      name: lot.name,
      shares,
      costBasis: cost,
      avgCost: shares > 0 ? round10(cost / shares) : 0,
      buys: lot.buys,
      sells: lot.sells,
      dripBuys: lot.dripBuys,
    };
    if (shares > 0) positions.push(entry);
    else closedPositions.push(entry);
  }
  positions.sort((a, b) => b.costBasis - a.costBasis);

  // Tickers that still hold shares but also had unrecognized rows (transfers,
  // corporate actions, ...) need a human eye on the share count.
  for (const [ticker, codes] of tickerFlags) {
    if (lots.has(ticker) && round6(lots.get(ticker).shares) > 0) {
      warn(
        `${ticker}: also has ${[...codes].map((c) => `${c} ×${ignored.get(c)}`).join(', ')} ` +
          'rows that were not counted — verify the share count.'
      );
    }
  }

  const ignoredList = [...ignored.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  const dividends = income.filter((e) => e.type === 'dividend').length;
  const interest = income.filter((e) => e.type === 'interest').length;

  return {
    positions,
    income,
    closedPositions,
    ignored: ignoredList,
    optionsSkipped,
    warnings,
    stats: {
      rows: dataRows,
      tickers: lots.size,
      buys: [...lots.values()].reduce((s, l) => s + l.buys, 0),
      sells: [...lots.values()].reduce((s, l) => s + l.sells, 0),
      dividends,
      interest,
    },
  };
}

/**
 * Which closed positions are safe to remove on import: only tickers the file
 * shows being both bought AND fully sold. A sell with no recorded buy means
 * partial history, so that holding must be left alone.
 */
export function deletableClosedPositions(parsed) {
  return (parsed.closedPositions || []).filter((c) => c.buys > 0);
}

/**
 * Apply a parsed import to an account with replace semantics: holdings are
 * upserted by ticker, fully-sold positions (with buy history in the file)
 * are removed, then income events are added (deduped on
 * date+type+amount+holding so re-imports are safe).
 * Must run validation (account exists) before calling.
 * @returns {{holdingsCreated, holdingsUpdated, holdingsRemoved, incomeAdded, incomeSkipped}}
 */
export function applyRobinhoodImport(db, accountId, parsed) {
  let holdingsCreated = 0;
  let holdingsUpdated = 0;
  let incomeAdded = 0;
  let incomeSkipped = 0;

  db.exec('BEGIN');
  try {
    const findHolding = db.prepare('SELECT * FROM holdings WHERE account_id = ? AND ticker = ?');
    const insertHolding = db.prepare(
      'INSERT INTO holdings (account_id, ticker, name, shares, cost_basis, currency) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const updateHolding = db.prepare(
      'UPDATE holdings SET shares = ?, cost_basis = ?, name = COALESCE(?, name), updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    );

    for (const p of parsed.positions) {
      const existing = findHolding.get(accountId, p.ticker);
      if (existing) {
        updateHolding.run(p.shares, p.costBasis, p.name, existing.id);
        holdingsUpdated++;
      } else {
        insertHolding.run(accountId, p.ticker, p.name, p.shares, p.costBasis, 'USD');
        holdingsCreated++;
      }
    }

    // Remove sold-out positions first, so income links resolve against the
    // final holdings (FK nulls out links for removed rows).
    const deleteHolding = db.prepare('DELETE FROM holdings WHERE account_id = ? AND ticker = ?');
    const holdingsRemoved = [];
    for (const c of deletableClosedPositions(parsed)) {
      const existing = findHolding.get(accountId, c.ticker);
      if (existing) {
        deleteHolding.run(accountId, c.ticker);
        holdingsRemoved.push({ id: existing.id, ticker: existing.ticker, shares: existing.shares });
      }
    }

    // Resolve holding links (fresh map, so newly created rows link up too).
    const holdingIds = new Map(
      db
        .prepare('SELECT id, ticker FROM holdings WHERE account_id = ?')
        .all(accountId)
        .map((h) => [h.ticker, h.id])
    );
    const seen = new Set(
      db
        .prepare('SELECT as_of_date AS d, type AS t, amount AS a, holding_id AS h FROM income_events WHERE account_id = ?')
        .all(accountId)
        .map((e) => `${e.d}||${e.t}||${Number(e.a).toFixed(2)}||${e.h ?? ''}`)
    );
    const insertIncome = db.prepare(
      'INSERT INTO income_events (account_id, holding_id, type, amount, currency, as_of_date, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const ev of parsed.income) {
      const holdingId = (ev.ticker && holdingIds.get(ev.ticker)) || null;
      const key = `${ev.asOfDate}||${ev.type}||${Number(ev.amount).toFixed(2)}||${holdingId ?? ''}`;
      if (seen.has(key)) {
        incomeSkipped++;
        continue;
      }
      insertIncome.run(accountId, holdingId, ev.type, ev.amount, 'USD', ev.asOfDate, ev.note);
      seen.add(key);
      incomeAdded++;
    }

    db.exec('COMMIT');
    return { holdingsCreated, holdingsUpdated, holdingsRemoved, incomeAdded, incomeSkipped };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
