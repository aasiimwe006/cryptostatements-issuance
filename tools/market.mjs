/* market.mjs — CRYPTO STATEMENTS · market history and the daily snapshot (r276, Phase 3 of AP75)

   Market context for the figure cards on cryptostatements.ai, kept apart from the record. Run daily
   by the workflow. Writes market.json, which GitHub Pages serves to the site:
     1. stablecoins: circulating supply across all chains, one point per UTC day, for the total
        stablecoin market and for the thirty largest coins (list below, about 98% of the total in Nov 2026),
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
/* r296: thirty coins, the largest by DefiLlama's own circulating count on 8 Nov 2026 (about 98% of the total);
   the rest stays in the total. [key, DefiLlama id, label, peg]. A coin pegged to another currency also keeps
   its USD value per day (usd), so shares of the dollar total add up. */
const STABLES = [['total', null, 'All stablecoins'], ['USDT', 1, 'Tether USDT'], ['USDC', 2, 'USD Coin'], ['USDS', 209, 'Sky Dollar USDS'],
  ['DAI', 5, 'Dai'], ['USDe', 146, 'Ethena USDe'], ['USD1', 262, 'World Liberty Financial USD1'], ['RLUSD', 250, 'Ripple USD'],
  ['PYUSD', 120, 'PayPal USD'], ['FDUSD', 119, 'First Digital USD'], ['EURC', 50, 'EURC (euro)', 'EUR'],
  ['USDG', 286, 'Global Dollar USDG (Paxos)'], ['BUIDL', 173, 'BlackRock USD Institutional Digital Liquidity Fund (a tokenised fund DefiLlama counts)'],
  ['USDf', 246, 'Falcon USD'], ['U', 336, 'United Stables U'], ['USDD', 14, 'USDD'], ['USDGO', 347, 'USDGO'], ['OUSD', 443, 'Open USD'],
  ['GHO', 118, 'Aave GHO'], ['USDX', 214, 'USDX Money USDX'], ['A7A5', 258, 'A7A5 (Russian rouble)', 'RUB'], ['USD0', 195, 'Usual USD0'],
  ['pUSD', 406, 'Polymarket USD'], ['TUSD', 7, 'TrueUSD'], ['YLDS', 272, 'Figure YLDS'], ['USDtb', 221, 'Ethena USDtb'],
  ['USDN', 12, 'Neutrino USD'], ['GateUSD', 306, 'Gate USD (GUSD)'], ['SoFiUSD', 430, 'SoFiUSD'], ['apxUSD', 354, 'apxUSD'], ['M', 213, 'M by M0']];
const PAIRS = { btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT', xrp: 'XRPUSDT', bnb: 'BNBUSDT', paxg: 'PAXGUSDT' };
const BIN = ['https://data-api.binance.vision', 'https://api.binance.com'];
async function get(url) { const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'accept': 'application/json' } });
  if (!r.ok) throw new Error(new URL(url).host + ' HTTP ' + r.status); return r.json(); }
function sumPegged(o) { return o ? Object.values(o).reduce((s, v) => s + (+v || 0), 0) : null; }
async function stables(prev) {
  const out = {};
  for (const [k, id, label, peg] of STABLES) {
    try {
      const j = await get('https://stablecoins.llama.fi/stablecoincharts/all' + (id ? '?stablecoin=' + id : ''));
      const today = iso(NOW);
      const s = (j || []).map(x => [iso(+x.date * 1000), id ? sumPegged(x.totalCirculating) : sumPegged(x.totalCirculatingUSD)])
        .filter(([d, v]) => d < today && v != null && isFinite(v) && v > 0).slice(-KEEP).map(([d, v]) => [d, Math.round(v)]);
      if (!s.length) throw new Error('empty');
      out[k] = { label, id, unit: peg || 'USD', basis: id ? 'circulating, all chains' : 'circulating USD value, all stablecoins', series: s };
      if (id && peg) out[k].usd = (j || []).map(x => [iso(+x.date * 1000), sumPegged(x.totalCirculatingUSD)])
        .filter(([d, v]) => d < today && v != null && isFinite(v) && v > 0).slice(-KEEP).map(([d, v]) => [d, Math.round(v)]);
      console.log('stablecoin', k, s.length, 'days, last', s[s.length - 1].join(' '));
    } catch (e) { console.error('stablecoin', k, e.message); if (prev && prev[k]) out[k] = prev[k]; }
  }
  return out;
}
/* r300 · the dollar value of all stablecoins by peg currency (USD, EUR, the rest), daily, from the same DefiLlama
   total; and a daily copy of supply by chain (DefiLlama publishes only the current split, so each run appends
   that day's row; a day held is not overwritten). */
async function pegs(prev) {
  try { const j = await get('https://stablecoins.llama.fi/stablecoincharts/all'), today = iso(NOW), o = { USD: [], EUR: [], other: [] };
    for (const x of j || []) { const d = iso(+x.date * 1000); if (d >= today) continue; const u = x.totalCirculatingUSD || {}; let oth = 0;
      for (const [k, v] of Object.entries(u)) if (k !== 'peggedUSD' && k !== 'peggedEUR') oth += +v || 0;
      if (u.peggedUSD != null) o.USD.push([d, Math.round(+u.peggedUSD)]); if (u.peggedEUR != null) o.EUR.push([d, Math.round(+u.peggedEUR)]); o.other.push([d, Math.round(oth)]); }
    for (const k in o) o[k] = o[k].slice(-KEEP); console.log('pegs', o.EUR.length, 'days, euro last', (o.EUR[o.EUR.length - 1] || []).join(' ')); return o;
  } catch (e) { console.error('pegs', e.message); return prev || null; }
}
async function chains(prev) {
  const held = (prev && prev.days) || [], day = iso(NOW);
  if (held.some(r => r.date === day)) return prev;
  try { const j = await get('https://stablecoins.llama.fi/stablecoinchains');
    const R = (j || []).map(c => [c.name, Math.round(Object.values(c.totalCirculatingUSD || {}).reduce((a, b) => a + (+b || 0), 0))]).filter(r => r[1] > 0).sort((a, b) => b[1] - a[1]);
    const top = R.slice(0, 12), rest = R.slice(12).reduce((a, r) => a + r[1], 0);
    held.push({ date: day, read: new Date(NOW).toISOString(), rows: top, other: rest, chains: R.length });
    console.log('chains', day, top.slice(0, 3).map(r => r.join(' ')).join(', ')); return { about: 'Stablecoin supply by chain, USD value, DefiLlama /stablecoinchains, one row per UTC day as read (the twelve largest chains and the rest summed).', days: held.slice(-KEEP) };
  } catch (e) { console.error('chains', e.message); return prev || null; }
}
/* r329 · the whole crypto market: total market capitalisation, 24-hour volume and the bitcoin and ether shares, one row
   per UTC day as read (no free source publishes the history, so the history starts with the first run and grows;
   a day held is not overwritten). CoinGecko's public /global first, then CoinPaprika's /global, then Coinlore's.
   An aggregator's estimate across thousands of coins, labelled as such on the site and never filed as a record. */
async function global(prev) {
  const held = (prev && prev.days) || [], day = iso(NOW);
  if (held.some(r => r.date === day)) return prev;
  const tries = [
    ['CoinGecko', 'https://api.coingecko.com/api/v3/global', j => { const d = j && j.data; return d && { mcap: d.total_market_cap && d.total_market_cap.usd, vol: d.total_volume && d.total_volume.usd, btc: d.market_cap_percentage && d.market_cap_percentage.btc, eth: d.market_cap_percentage && d.market_cap_percentage.eth, coins: d.active_cryptocurrencies }; }],
    ['CoinPaprika', 'https://api.coinpaprika.com/v1/global', d => d && { mcap: d.market_cap_usd, vol: d.volume_24h_usd, btc: d.bitcoin_dominance_percentage, eth: null, coins: d.cryptocurrencies_number }],
    ['Coinlore', 'https://api.coinlore.net/api/global/', j => { const d = Array.isArray(j) ? j[0] : j; return d && { mcap: +d.total_mcap, vol: +d.total_volume, btc: +d.btc_d, eth: +d.eth_d, coins: d.coins_count }; }]];
  for (const [src, url, f] of tries) {
    try { const r = f(await get(url)); if (!r || !(+r.mcap > 0)) throw new Error('no market cap');
      const row = { date: day, read: new Date(NOW).toISOString(), src, mcap: Math.round(+r.mcap) };
      if (+r.vol > 0) row.vol = Math.round(+r.vol); if (+r.btc > 0) row.btc = +(+r.btc).toFixed(3); if (+r.eth > 0) row.eth = +(+r.eth).toFixed(3); if (+r.coins > 0) row.coins = +r.coins;
      held.push(row); console.log('global', JSON.stringify(row));
      return { about: 'The whole crypto market as an aggregator estimates it: total market capitalisation and 24-hour volume in US dollars, and the bitcoin and ether shares of the total, in percent. One row per UTC day as read; src names the aggregator. History starts with the first run.', days: held };
    } catch (e) { console.error('global', src, e.message); }
  }
  return prev || null;
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
  doc.stablePegs = await pegs(prev && prev.stablePegs);
  doc.stableChains = await chains(prev && prev.stableChains);
  doc.global = await global(prev && prev.global);
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
