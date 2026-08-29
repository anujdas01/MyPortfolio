import pdfMakeRaw from 'pdfmake/build/pdfmake';
import { getVfs } from './pdfVfsShim.js';

pdfMakeRaw.vfs = getVfs();
export const pdfMake = pdfMakeRaw;

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const SOFT = '#f4f6f8';
const POS = '#059669';
const NEG = '#dc2626';

function safeAccent(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return '#2563eb';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum > 0.88) return '#1d4ed8';
  if (lum < 0.22) return '#2563eb';
  return `#${m[1]}`;
}

export async function captureChartSvg(container, scale = 2) {
  if (!container) return null;
  const svg = container.querySelector('svg');
  if (!svg) return null;
  const rect = container.getBoundingClientRect();
  const w = Math.max(Math.round(rect.width) || 0, 100);
  const h = Math.max(Math.round(rect.height) || 0, 80);
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  // Inline computed styles for better fidelity (Recharts uses CSS vars)
  try {
    const computed = getComputedStyle(svg);
    if (computed.fontFamily) clone.style.fontFamily = computed.fontFamily;
  } catch {}
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('chart image load timeout')), 4000);
      img.onload = () => { clearTimeout(timer); resolve(); };
      img.onerror = (e) => { clearTimeout(timer); reject(e); };
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const fmt = (n) => (Math.abs(n) >= 10000 ? usd0.format(n) : usd2.format(n));

function prettyDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function th(text, opts = {}) {
  return { text, bold: true, color: '#ffffff', fillColor: opts.accent, fontSize: 9, margin: [4, 5, 4, 5], alignment: opts.align || 'left' };
}

function td(text, opts = {}) {
  return {
    text,
    fontSize: 9,
    color: opts.color || INK,
    bold: !!opts.bold,
    alignment: opts.align || 'left',
    fillColor: opts.fill,
    margin: [4, 4, 4, 4],
  };
}

function dataTable(header, rows, widths, accent) {
  return {
    table: {
      widths,
      body: [
        header.map((h) => th(h.t, { ...h, align: h.align, accent })),
        ...rows,
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => LINE,
      vLineColor: () => LINE,
      paddingLeft: () => 4,
      paddingRight: () => 4,
    },
    margin: [0, 4, 0, 8],
  };
}

function sectionHeading(text, accent) {
  return {
    columns: [
      { canvas: [{ type: 'rect', x: 0, y: 2, w: 3, h: 14, color: accent }] },
      { text: text.toUpperCase(), fontSize: 12, bold: true, color: INK, margin: [6, 2, 0, 0] },
    ],
    margin: [0, 14, 0, 6],
  };
}

export function buildReportDoc({ options, report, allocation, accounts, trendPng, allocPng, accentHex }) {
  const accent = safeAccent(accentHex);
  const { current, changes, series } = report;
  const content = [];

  if (options.cover) {
    content.push(
      { canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 150, color: accent }] },
      {
        text: 'MyPortfolio',
        color: '#ffffff',
        bold: true,
        fontSize: 22,
        absolutePosition: { x: 50, y: 45 },
      },
      {
        text: options.title || 'Net Worth Report',
        color: '#ffffff',
        fontSize: 13,
        absolutePosition: { x: 50, y: 82 },
      },
      { text: '', margin: [0, 120, 0, 30] },
      {
        text: 'CURRENT NET WORTH',
        fontSize: 10,
        color: MUTED,
        characterSpacing: 2,
        margin: [0, 0, 0, 6],
      },
      {
        text: fmt(current.netWorth),
        fontSize: 40,
        bold: true,
        color: current.netWorth >= 0 ? POS : NEG,
        margin: [0, 0, 0, 18],
      },
      {
        table: {
          widths: ['auto', '*'],
          body: [
            [td('Generated', { color: MUTED }), td(new Date().toLocaleString('en-US'), {})],
            [td('Balances as of', { color: MUTED }), td(prettyDate(current.asOf), {})],
            [td('Period covered', { color: MUTED }), td(options.rangeLabel, {})],
          ],
        },
        layout: 'noBorders',
      },
      {
        text: 'This report was generated locally from your MyPortfolio database. Figures reflect the most recent balance snapshot recorded for each account.',
        fontSize: 8.5,
        color: MUTED,
        italics: true,
        margin: [0, 60, 0, 0],
      },
      { text: '', pageBreak: 'after' }
    );
  }

  if (options.summary) {
    const prev = changes.sincePrevSnapshot;
    const m30 = changes.last30Days;
    const ratio = current.assets > 0 ? current.liabilities / current.assets : null;
    const lev = current.netWorth > 0 && current.liabilities > 0 ? current.liabilities / current.netWorth : null;
    content.push(
      sectionHeading('Executive summary', accent),
      dataTable(
        [{ t: 'Metric' }, { t: 'Value', align: 'right' }, { t: 'Detail' }],
        [
          [td('Net worth', { bold: true }), td(fmt(current.netWorth), { align: 'right', bold: true, color: current.netWorth >= 0 ? POS : NEG }), td(`As of ${prettyDate(current.asOf)}`)],
          [td('Total assets'), td(fmt(current.assets), { align: 'right', color: POS }), td(`${(allocation.assets || []).length} categories held`)],
          [td('Total liabilities'), td(fmt(current.liabilities), { align: 'right', color: NEG }), td(current.liabilities > 0 ? `${(allocation.liabilities || []).length} liability account(s)` : 'Debt free')],
          [td('Change vs previous entry', { color: MUTED }), td(prev ? `${fmt(prev.delta)} (${prev.pct ?? '—'}%)` : '—', { align: 'right', color: prev ? (prev.delta >= 0 ? POS : NEG) : MUTED }), td(prev ? `since ${prettyDate(prev.since)}` : 'No prior data')],
          [td('Last 30 days', { color: MUTED }), td(m30 ? `${fmt(m30.delta)} (${m30.pct ?? '—'}%)` : '—', { align: 'right', color: m30 ? (m30.delta >= 0 ? POS : NEG) : MUTED }), td(m30 ? `since ${prettyDate(m30.since)}` : 'No prior data')],
          [td('Cash buffer', { color: MUTED }), td(fmt(options.cashBuffer), { align: 'right' }), td('Balance across Cash-category accounts')],
          [td('Debt ratio', { color: MUTED }), td(ratio === null ? '—' : `${(ratio * 100).toFixed(1)}%`, { align: 'right', color: ratio !== null && ratio > 0.5 ? NEG : INK }), td('Liabilities ÷ assets')],
          [td('Leverage', { color: MUTED }), td(lev === null ? '—' : `${lev.toFixed(2)}x`, { align: 'right' }), td('Liabilities ÷ net worth')],
        ],
        ['35%', '20%', '45%'],
        accent
      )
    );
  }

  if (options.trend) {
    content.push(sectionHeading(`Net worth trend — ${options.rangeLabel}`, accent));
    if (trendPng) {
      content.push({ image: trendPng, width: 500, margin: [0, 0, 0, 2] });
      const first = series[0];
      const last = series[series.length - 1];
      if (first && last && first.date !== last.date) {
        const delta = last.netWorth - first.netWorth;
        content.push({
          text: `${series.length} data points · ${prettyDate(first.date)} to ${prettyDate(last.date)} · change ${delta >= 0 ? '+' : ''}${fmt(delta)}`,
          fontSize: 8.5,
          color: MUTED,
          margin: [0, 2, 0, 0],
        });
      }
    } else {
      content.push({ text: 'Not enough history to plot a trend yet.', italics: true, color: MUTED, fontSize: 9 });
    }
  }

  if (options.allocation) {
    content.push(sectionHeading('Asset allocation', accent));
    if (allocPng) content.push({ image: allocPng, width: 330, alignment: 'center', margin: [0, 0, 0, 6] });
    const total = current.assets || 0;
    const rows = (allocation.assets || []).map((r) => [
      td(r.name),
      td(fmt(r.total), { align: 'right' }),
      td(total ? `${((r.total / total) * 100).toFixed(1)}%` : '—', { align: 'right', color: MUTED }),
    ]);
    if (rows.length) {
      content.push(dataTable([{ t: 'Category' }, { t: 'Value', align: 'right' }, { t: 'Share', align: 'right' }], rows, ['50%', '28%', '22%'], accent));
    }
    const liabRows = (allocation.liabilities || []).map((r) => [
      td(r.name),
      td(fmt(r.total), { align: 'right', color: NEG }),
      td(current.liabilities ? `${((r.total / current.liabilities) * 100).toFixed(1)}%` : '—', { align: 'right', color: MUTED }),
    ]);
    if (liabRows.length) {
      content.push({ text: 'Liability mix', fontSize: 9.5, bold: true, margin: [0, 4, 0, 3] });
      content.push(dataTable([{ t: 'Category' }, { t: 'Outstanding', align: 'right' }, { t: 'Share', align: 'right' }], liabRows, ['50%', '28%', '22%'], accent));
    }
  }

  if (options.accounts) {
    content.push(sectionHeading('Account statements', accent));
    const order = ['Cash', 'Investment', 'Retirement', 'Real Estate', 'Personal Property', 'Liability'];
    const groups = new Map();
    for (const a of accounts.filter((x) => !x.archived)) {
      const key = a.categoryName || 'Uncategorized';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    }
    const sortedGroups = [...groups.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    for (const [cat, list] of sortedGroups) {
      const subtotal = list.reduce((s, a) => s + (a.latestValue || 0), 0);
      content.push({ text: cat, fontSize: 10, bold: true, color: accent, margin: [0, 6, 0, 2] });
      content.push(
        dataTable(
          [{ t: 'Account' }, { t: 'Institution / Type' }, { t: 'Updated', align: 'right' }, { t: 'Value', align: 'right' }],
          [
            ...list.map((a) => [
              td(a.name),
              td([a.institution, kindLabelOf(a.kind)].filter(Boolean).join(' · ') || '—'),
              td(prettyDate(a.latestDate), { align: 'right', color: MUTED }),
              td(fmt(a.latestValue || 0), { align: 'right', color: a.isAsset ? POS : NEG }),
            ]),
            [
              td('', { fill: SOFT }),
              td('Subtotal', { bold: true, fill: SOFT }),
              td('', { fill: SOFT }),
              td(fmt(subtotal), { align: 'right', bold: true, fill: SOFT }),
            ],
          ],
          ['32%', '34%', '16%', '18%'],
          accent
        )
      );
    }

    content.push({
      table: {
        widths: ['*', 'auto'],
        body: [
          [td('TOTAL ASSETS', { bold: true }), td(fmt(current.assets), { align: 'right', bold: true, color: POS })],
          [td('TOTAL LIABILITIES', { bold: true }), td(fmt(current.liabilities), { align: 'right', bold: true, color: NEG })],
          [
            td('NET WORTH', { bold: true, color: accent }),
            td(fmt(current.netWorth), { align: 'right', bold: true, fontSize: 11, color: current.netWorth >= 0 ? POS : NEG }),
          ],
        ],
      },
      layout: {
        hLineWidth: (i) => i === 0 || i === 3 ? 0.5 : 0,
        vLineWidth: () => 0,
        hLineColor: () => LINE,
        paddingLeft: () => 4,
        paddingRight: () => 4,
        paddingTop: () => 4,
        paddingBottom: () => 4,
      },
      margin: [0, 6, 0, 0],
    });
  }

  if (options.topHoldings) {
    const topAssets = [...accounts]
      .filter((a) => a.isAsset && !a.archived && a.latestValue)
      .sort((a, b) => b.latestValue - a.latestValue)
      .slice(0, 5);
    const topLiabs = [...accounts]
      .filter((a) => !a.isAsset && !a.archived && a.latestValue)
      .sort((a, b) => b.latestValue - a.latestValue)
      .slice(0, 5);
    content.push(sectionHeading('Top holdings', accent));
    content.push({
      columns: [
        {
          width: '*',
          stack: [
            { text: 'Largest assets', fontSize: 9.5, bold: true, margin: [0, 0, 0, 3] },
            ...(topAssets.length
              ? topAssets.map((a) => ({
                  columns: [
                    { text: a.name, fontSize: 9, width: '*' },
                    { text: fmt(a.latestValue), fontSize: 9, bold: true, color: POS, alignment: 'right', width: 'auto' },
                  ],
                  margin: [0, 1.5, 0, 1.5],
                }))
              : [{ text: 'None recorded.', fontSize: 9, italics: true, color: MUTED }]),
          ],
        },
        { width: 16, text: '' },
        {
          width: '*',
          stack: [
            { text: 'Largest liabilities', fontSize: 9.5, bold: true, margin: [0, 0, 0, 3] },
            ...(topLiabs.length
              ? topLiabs.map((a) => ({
                  columns: [
                    { text: a.name, fontSize: 9, width: '*' },
                    { text: fmt(a.latestValue), fontSize: 9, bold: true, color: NEG, alignment: 'right', width: 'auto' },
                  ],
                  margin: [0, 1.5, 0, 1.5],
                }))
              : [{ text: 'None recorded.', fontSize: 9, italics: true, color: MUTED }]),
          ],
        },
      ],
    });
  }

  if (options.alerts) {
    const stale = [...accounts]
      .filter((a) => {
        if (a.archived) return false;
        if (!a.latestDate) return true;
        return Math.floor((Date.now() - new Date(`${a.latestDate}T00:00:00`).getTime()) / 86400000) >= 45;
      })
      .slice(0, 10);
    content.push(sectionHeading('Maintenance alerts', accent));
    if (!stale.length) {
      content.push({ text: 'All active accounts have been updated within the last 45 days.', fontSize: 9, color: POS });
    } else {
      content.push(
        ...stale.map((a) => {
          const days = a.latestDate
            ? Math.floor((Date.now() - new Date(`${a.latestDate}T00:00:00`).getTime()) / 86400000)
            : null;
          return {
            columns: [
              { text: `•  ${a.name}`, fontSize: 9, width: '*' },
              {
                text: days === null ? 'No balance history yet' : `${days} days since last update`,
                fontSize: 9,
                color: MUTED,
                alignment: 'right',
                width: 'auto',
              },
            ],
            margin: [0, 1.5, 0, 1.5],
          };
        })
      );
    }
  }

  return {
    pageSize: 'A4',
    pageMargins: [42, 46, 42, 44],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: INK, lineHeight: 1.35 },
    info: {
      title: `MyPortfolio — ${options.title || 'Net Worth Report'}`,
      author: 'MyPortfolio',
      subject: 'Personal finance report',
    },
    header: (page) =>
      page > 1
        ? {
            columns: [
              { text: 'MyPortfolio', fontSize: 8, bold: true, color: accent, margin: [42, 16, 0, 0] },
              { text: options.title || 'Net Worth Report', fontSize: 8, color: MUTED, alignment: 'right', margin: [0, 16, 42, 0] },
            ],
          }
        : null,
    footer: (page, pageCount) => ({
      columns: [
        { text: `Generated ${new Date().toLocaleDateString('en-US')}`, fontSize: 7.5, color: MUTED, margin: [42, 8, 0, 0] },
        { text: `Page ${page} of ${pageCount}`, fontSize: 7.5, color: MUTED, alignment: 'right', margin: [0, 8, 42, 0] },
      ],
    }),
    content,
  };
}

function kindLabelOf(kind) {
  const map = {
    checking: 'Checking',
    savings: 'Savings',
    money_market: 'Money Market',
    cd: 'Certificate of Deposit (CD)',
    cash: 'Cash',
    brokerage: 'Brokerage',
    '529': '529 Plan',
    '401k': '401(k)',
    roth_ira: 'Roth IRA',
    traditional_ira: 'Traditional IRA',
    hsa: 'HSA',
    pension: 'Pension',
    house: 'House / Home',
    land: 'Land',
    vehicle: 'Vehicle',
    jewelry: 'Jewelry',
    collectible: 'Collectible',
    receivable: 'Money owed to me',
    mortgage: 'Mortgage',
    car_loan: 'Car Loan',
    student_loan: 'Student Loan',
    credit_card: 'Credit Card',
    personal_loan: 'Personal Loan',
    other: 'Other',
  };
  return map[kind] || '';
}
