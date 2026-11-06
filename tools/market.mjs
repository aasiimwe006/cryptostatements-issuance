/* market.mjs — CRYPTO STATEMENTS · market history and the daily snapshot (r276, Phase 3 of AP75)

   Market context for the figure cards on cryptostatements.ai, kept apart from the record. Run daily
   by the workflow. Writes market.json, which GitHub Pages serves to the site:
     1. stablecoins: circulating supply across all chains, one point per UTC day, for the total
        stablecoin market and for USDT, USDC, USDS, DAI, USDe, USD1, RLUSD, PYUSD, FDUSD and EURC,
        from DefiLlama's public stablecoins API. The last 1,100 days are kept and refreshed each run,
        because DefiLlama revises recent days. An aggregator's count, labelled as such on the site:
        the issuer's own attested figure stays on its own card.
     2. snapshots: one row per completed UTC day, appended and never altered: the daily close of BTC,
        ETH, SOL, XRP, BNB and PAXG against USDT on Binance Spot (data-api.binance.vision first, then
        api.binance.com), the crowd Fear & Greed value for that day (alternative.me), and the
        stablecoin totals above. It is the platform's own dated copy of the market figures it shows.
        The record's derived scores are not snapshotted here: they are rebuilt from the record, whose
        every entry is fingerprinted, so they can be recomputed for any day.
   A source that fails leaves its field out for that day; nothing is estimated. A failure here does
   not fail the workflow's other steps. No dependencies (Node 20). MARKET_NOW: tests only.          */
import fs from 'node:fs';
const OUT = 'market.json', KEEP = 1100;
const NOW = process.env.MARKET_NOW ? Date.parse(process.env.MARKET_NOW) : Date.now();
const DAY = 864e5, iso = t => new Date(t).toISOString().slice(0, 10);
const STABLES = [['total', null, 'All stablecoins'], ['USDT', 1, 'Tether USDT'], ['USDC', 2, 'USD Coin'], ['USDS', 209, 'Sky Dollar USDS'],
  ['DAI', 5, 'Dai'], ['USDe', 146, 'Ethena USDe'], ['USD1', 262, 'World Liberty Financial USD1'], ['RLUSD', 250, 'Ripple USD'],
  ['PYUSD', 120, 'PayPal USD'], ['FDUSD', 119, 'First Digital USD'], ['EURC', 50, 'EURC (euro)']];
const PAIRS = { btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT', xrp: 'XRPUSDT', bnb: 'BNBUSDT', paxg: 'PAXGUSDT' };
const BIN = ['https://data-api.binance.vision', 'https://api.binance.com'];
async function get(url) { const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'accept': 'application/json' } });
  if (!r.ok) throw new Error(new URL(url).host + ' HTTP ' + r.status); return r.json(); }
function sumPegged(o) { return o ? Object.values(o).reduce((s, v) => s + (+v || 0), 0) : null; }
async function stables(prev) {
  const out = {};
  for (const [k, id, label] of STABLES) {
    try {
      const j = await get('https://stablecoins.llama.fi/stablecoincharts/all' + (id ? '?stablecoin=' + id : ''));
      const today = iso(NOW);
      const s = (j || []).map(x => [iso(+x.date * 1000), id ? sumPegged(x.totalCirculating) : sumPegged(x.totalCirculatingUSD)])
        .filter(([d, v]) => d < today && v != null && isFinite(v) && v > 0).slice(-KEEP).map(([d, v]) => [d, Math.round(v)]);
      if (!s.length) throw new Error('empty');
      out[k] = { label, id, unit: k === 'EURC' ? 'EUR' : 'USD', basis: id ? 'circulating, all chains' : 'circulating USD value, all stablecoins', series: s };
      console.log('stablecoin', k, s.length, 'days, last', s[s.length - 1].join(' '));
    } catch (e) { console.error('stablecoin', k, e.message); if (prev && prev[k]) out[k] = prev[k]; }
  }
  return out;
}
async function close(sym, day) {
  const start = Date.parse(day + 'T00:00:00Z');
  for (const h of BIN) { try { const k = await get(h + '/api/v3/klines?symbol=' + sym + '&interval=1d&startTime=' + start + '&limit=1');
      if (Array.isArray(k) && k[0] && +k[0][0] === start) return +k[0][4]; } catch (e) { console.error('  ', sym, e.message); } }
  return null;
}
async function fngFor(days) { try { const j = await get('https://api.alternative.me/fng/?limit=40&format=json'); const M = {};
    (j.data || []).forEach(x => { M[iso(+x.timestamp * 1000)] = +x.value; }); return days.map(d => M[d] ?? null); } catch (e) { console.error('fng', e.message); return days.map(() => null); } }
async function main() {
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const doc = { about: 'Market context for CRYPTO STATEMENTS figure cards, kept apart from the record. Stablecoin supply from DefiLlama (an aggregator, labelled as such on the site); daily snapshots of the market figures the site shows, appended and never altered. Written by tools/market.mjs.',
    updated: new Date(NOW).toISOString(), stablecoins: {}, snapshots: (prev && prev.snapshots) || [] };
  doc.stablecoins = await stables(prev && prev.stablecoins);
  /* snapshot the completed UTC days not yet held, at most the last 7 (a missed run is caught up) */
  const held = new Set(doc.snapshots.map(s => s.date)), days = [];
  for (let i = 7; i >= 1; i--) { const d = iso(NOW - i * DAY); if (!held.has(d)) days.push(d); }
  const fng = await fngFor(days);
  for (let i = 0; i < days.length; i++) {
    const d = days[i], row = { date: d };
    for (const [k, sym] of Object.entries(PAIRS)) { const v = await close(sym, d); if (v != null) row[k] = v; }
    if (fng[i] != null) row.fng = fng[i];
    for (const k of ['total', 'USDT', 'USDC']) { const S = doc.stablecoins[k]; const p = S && S.series.find(x => x[0] === d); if (p) row['stable_' + k] = p[1]; }
    if (Object.keys(row).length > 1) { doc.snapshots.push(row); console.log('snapshot', JSON.stringify(row)); }
  }
  doc.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(OUT, JSON.stringify(doc) + '\n');
  console.log('market.json written:', Object.keys(doc.stablecoins).length, 'stablecoin series,', doc.snapshots.length, 'snapshots');
}
main().catch(e => { console.error(e); process.exitCode = 0; });
