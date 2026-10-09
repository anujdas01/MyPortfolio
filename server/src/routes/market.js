import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { getQuote, getQuotes, getIntradayChart, normalizeTicker, searchSymbols, normalizeSearchQuery } from '../market.js';

const MAX_BATCH = 25;

// Express 4 does not catch rejected promises from async handlers, so wrap
// them and forward failures to the error middleware instead of hanging.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Public market-data routes (quotes carry no personal data, but the router
 * still sits behind auth so demo sessions stay scoped to their own mount).
 */
export default function marketRoutes() {
  const r = Router();
  r.use(requireAuth);

  /**
   * @openapi
   * /market/search:
   *   get:
   *     tags: [Market]
   *     summary: Search for matching ticker symbols
   *     description: >
   *       Free-text symbol search across stocks, ETFs, mutual funds and
   *       crypto (e.g. "BTC" finds both BTC-USD spot Bitcoin and the BTC
   *       ETF). Powers the holding-form picker so ambiguous symbols are
   *       chosen explicitly instead of guessed. Results are cached
   *       server-side for one hour.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: query
   *         name: q
   *         required: true
   *         schema:
   *           type: string
   *           example: BTC
   *         description: Search text (ticker or company name)
   *     responses:
   *       200:
   *         description: Matching symbols
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 query:
   *                   type: string
   *                   example: BTC
   *                 cached:
   *                   type: boolean
   *                   example: false
   *                 results:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/SearchResult'
   *       400:
   *         description: Missing or invalid search text
   *       401:
   *         description: Not authenticated
   *       502:
   *         description: Search provider unreachable
   */
  r.get('/search', ah(async (req, res) => {
    const q = req.query.q;
    if (!q) throw new HttpError(400, '"q" query parameter is required');
    if (!normalizeSearchQuery(q)) {
      throw new HttpError(400, 'Search text must be 1-32 characters (letters, numbers, spaces, . -)');
    }
    try {
      res.json(await searchSymbols(q));
    } catch (e) {
      throw new HttpError(502, e.message || 'Search provider unavailable');
    }
  }));

  /**
   * @openapi
   * /market/quote:
   *   get:
   *     tags: [Market]
   *     summary: Look up the latest quote for a ticker
   *     description: >
   *       Returns the company/security name and most recent market price for
   *       an exact symbol (stocks, ETFs and crypto pairs such as BTC-USD).
   *       Use /market/search first when the symbol is ambiguous. Prices are
   *       always fetched live — never cached — at full provider precision.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: query
   *         name: ticker
   *         required: true
   *         schema:
   *           type: string
   *           example: VTI
   *         description: Ticker symbol (e.g. VTI, AAPL, MSFT)
   *     responses:
   *       200:
   *         description: Latest quote
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Quote'
   *       400:
   *         description: Missing or invalid ticker
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: No market data for this ticker
   *       502:
   *         description: Quote provider unreachable
   */
  r.get('/quote', ah(async (req, res) => {
    const raw = req.query.ticker;
    if (!raw) throw new HttpError(400, '"ticker" query parameter is required');
    if (!normalizeTicker(raw)) {
      throw new HttpError(400, 'Invalid ticker (letters, numbers, . - = ^, max 16 chars)');
    }
    try {
      res.set('Cache-Control', 'no-store').json(await getQuote(raw));
    } catch (e) {
      if (e.code === 'NOT_FOUND') throw new HttpError(404, e.message);
      throw new HttpError(502, e.message || 'Quote provider unavailable');
    }
  }));

  /**
   * @openapi
   * /market/quotes:
   *   get:
   *     tags: [Market]
   *     summary: Look up quotes for several tickers at once
   *     description: >
   *       Batch version of /market/quote for refreshing a holdings table.
   *       Never fails wholesale — each ticker resolves to a quote or an error.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: query
   *         name: tickers
   *         required: true
   *         schema:
   *           type: string
   *           example: VTI,AAPL
   *         description: Comma-separated tickers (max 25)
   *     responses:
   *       200:
   *         description: Map of ticker to quote-or-error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 quotes:
   *                   type: object
   *                   additionalProperties:
   *                     oneOf:
   *                       - $ref: '#/components/schemas/Quote'
   *                       - $ref: '#/components/schemas/QuoteError'
   *       400:
   *         description: Missing or invalid tickers
   *       401:
   *         description: Not authenticated
   */
  r.get('/quotes', ah(async (req, res) => {
    const list = [
      ...new Set(
        String(req.query.tickers || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    ].slice(0, MAX_BATCH);
    if (!list.length) {
      throw new HttpError(400, '"tickers" query parameter is required (comma-separated, max 25)');
    }
    const bad = list.find((t) => !normalizeTicker(t));
    if (bad) throw new HttpError(400, `Invalid ticker: "${bad}"`);
    res.set('Cache-Control', 'no-store').json({ quotes: await getQuotes(list) });
  }));

  /**
   * @openapi
   * /market/chart:
   *   get:
   *     tags: [Market]
   *     summary: Today's intraday price series for a ticker
   *     description: >
   *       Returns 5-minute bars for the current trading day plus the prior
   *       close, so the client can draw a small "today" sparkline (used by
   *       the holdings hover popup). Prices are always fetched live — never
   *       cached. Illiquid gaps (null closes) are dropped.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: query
   *         name: ticker
   *         required: true
   *         schema:
   *           type: string
   *           example: AAPL
   *         description: Ticker symbol (e.g. AAPL, BTC-USD)
   *     responses:
   *       200:
   *         description: Intraday series
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/IntradayChart'
   *       400:
   *         description: Missing or invalid ticker
   *       401:
   *         description: Not authenticated
   *       404:
   *         description: No market data for this ticker
   *       502:
   *         description: Chart provider unreachable
   */
  r.get('/chart', ah(async (req, res) => {
    const raw = req.query.ticker;
    if (!raw) throw new HttpError(400, '"ticker" query parameter is required');
    if (!normalizeTicker(raw)) {
      throw new HttpError(400, 'Invalid ticker (letters, numbers, . - = ^, max 16 chars)');
    }
    try {
      res.set('Cache-Control', 'no-store').json(await getIntradayChart(raw));
    } catch (e) {
      if (e.code === 'NOT_FOUND') throw new HttpError(404, e.message);
      throw new HttpError(502, e.message || 'Chart provider unavailable');
    }
  }));

  return r;
}
