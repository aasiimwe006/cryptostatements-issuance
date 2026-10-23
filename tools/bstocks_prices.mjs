/* bstocks_prices.mjs — CRYPTO STATEMENTS · bStocks daily closes from Binance Spot (r196, AP40)

   Market context for the Reserve Monitor, kept apart from the record (bstocks.json). Run daily by the
   workflow after bstocks.mjs. For every ticker the issuer discloses or has published an address for:
     1. checks whether a Binance Spot pair against USDT exists (one request for the whole list);
     2. for each pair, appends the exchange's own daily candles for every completed UTC day not yet
        held: open, high, low, close, quote volume (USDT) and trade count. On a pair's first day in the
        file this backfills its whole history (up to 1,000 days), so the file starts complete;
     3. records which disclosed tickers have no Spot pair, and the day a new pair is first seen.
   It never writes today's unfinished candle, never alters a stored day, and never touches bstocks.json.
   A failure here does not fail the workflow's other steps.
   Hosts: data-api.binance.vision (Binance's public market-data mirror), then api.binance.com.
   No dependencies (Node 20). BSTOCKS_NOW: tests only.                                             */
import fs from 'node:fs';
const SRC = 'bstocks.json', OUT = 'bstocks_prices.json';
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let HOST = null;
async function get(path) {
  let last = null;
  for (const h of (HOST ? [HOST] : HOSTS)) {
    try {
      const r = await fetch(h + path, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(new URL(h).host + ' HTTP ' + r.status);
      HOST = h; return await r.json();
    } catch (e) { last = e; console.error('  ', e.message); }
  }
  throw last;
}
async function main() {
  const doc = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const dis = (doc.disclosures || []).slice().sort((a, b) => String(b.asOf).localeCompare(String(a.asOf)))[0];
  const tick = [...new Set(Object.keys(doc.tokens || {}).concat(Object.keys(dis ? dis.rows : {})))].sort();
  const now = process.env.BSTOCKS_NOW ? new Date(process.env.BSTOCKS_NOW) : new Date(), today = now.toISOString().slice(0, 10);
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()), yEnd = dayStart - 1;
  const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  out.about = 'Daily candles of each bStock on Binance Spot against USDT, as the exchange records them (UTC days). series[ticker] = [date, open, high, low, close, quote volume in USDT, trades]. Market context only: not part of the record, not a valuation, not compared with the US share price.';
  out.source = 'Binance Spot public market data, /api/v3/klines, interval 1d';
  out.series = out.series || {}; out.listing = out.listing || {};
  const firstRun = !Object.keys(out.listing).length;
  const S = new Set((await get('/api/v3/ticker/price')).map(x => x.symbol));
  const listed = tick.filter(k => S.has(k + 'USDT'));
  for (const k of listed) {
    const s = out.series[k] || [], lastDate = s.length ? s[s.length - 1][0] : null;
    if (!out.listing[k]) out.listing[k] = firstRun ? {} : { detected: today };
    const start = lastDate ? Date.parse(lastDate + 'T00:00:00Z') + 864e5 : 0;
    if (start > yEnd) continue;
    const kl = await get(`/api/v3/klines?symbol=${k}USDT&interval=1d&startTime=${start}&endTime=${yEnd}&limit=1000`);
    for (const b of kl) {
      if (+b[6] > yEnd) continue;                                    /* only completed UTC days */
      const d = new Date(+b[0]).toISOString().slice(0, 10);
      if (s.length && s[s.length - 1][0] >= d) continue;
      s.push([d, +b[1], +b[2], +b[3], +b[4], Math.round(+b[7] * 100) / 100, +b[8]]);
    }
    out.series[k] = s;
    if (s.length && !out.listing[k].first_candle) out.listing[k].first_candle = s[0][0];
    await sleep(120);
  }
  out.not_listed = { checked: today, tickers: tick.filter(k => !listed.includes(k)) };
  out.updated = now.toISOString(); out.host = HOST ? new URL(HOST).host : null;
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(`bstocks prices: ${listed.length} of ${tick.length} tickers on Binance Spot via ${out.host}; ${out.not_listed.tickers.length} with no pair`);
}
main().catch(e => { console.error('bstocks prices failed:', e.message); process.exit(1); });
