/* leverage.mjs — CRYPTO STATEMENTS · perpetual-futures open interest by venue (r301, lev-v1)

   Market context for the Market Structure leverage pillar, kept apart from the record. Run daily by the
   workflow. Reads each venue's own public market-data API, one instrument at a time, and stores open interest
   in coins (and in US dollars where the venue gives it), one row per UTC day, keyed by venue and instrument:

     OKX      BTC-USDT-SWAP, BTC-USD-SWAP, ETH-USDT-SWAP, ETH-USD-SWAP
              /api/v5/rubik/stat/contracts/open-interest-history (period 1D, up to 100 days), falling back to
              /api/v5/public/open-interest for today's reading if the history call fails
     Binance  BTCUSDT, ETHUSDT (USD-M perpetuals)
              /futures/data/openInterestHist (period 1d, 30 days)

   OKX's daily bars open at 16:00 UTC (00:00 Hong Kong); each is stored under the UTC date of its own timestamp,
   as the venue gives it. Binance's daily points are stored the same way.
   A venue's figures cover that venue only, and each is named on the site. A venue that refuses the runner
   (Binance has answered GitHub's runners with HTTP 451) is logged as not read: no other route is tried, no
   proxy, no disguise. Rows already held are kept and not overwritten; a day missing stays missing. No
   dependencies (Node 20). LEV_NOW: tests only. */
import fs from 'node:fs';
const OUT = 'leverage.json', KEEP = 1100, NOW = process.env.LEV_NOW ? Date.parse(process.env.LEV_NOW) : Date.now();
const iso = t => new Date(t).toISOString().slice(0, 10), today = iso(NOW);
const OKX = [['BTC', 'BTC-USDT-SWAP'], ['BTC', 'BTC-USD-SWAP'], ['ETH', 'ETH-USDT-SWAP'], ['ETH', 'ETH-USD-SWAP']];
const BIN = [['BTC', 'BTCUSDT'], ['ETH', 'ETHUSDT']];
async function get(url) { const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { accept: 'application/json', 'user-agent': 'cryptostatements-issuance (GitHub Actions; daily public-data copy)' } });
  if (!r.ok) throw new Error(new URL(url).host + ' HTTP ' + r.status); return r.json(); }
async function okx(inst) {
  try { const j = await get('https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=' + inst + '&period=1D&limit=100');
    if (j.code !== '0' || !Array.isArray(j.data) || !j.data.length) throw new Error('code ' + j.code + ' ' + (j.msg || 'no data'));
    return j.data.map(r => [iso(+r[0]), +r[2], r[3] != null ? Math.round(+r[3]) : null]).filter(r => r[0] < today && isFinite(r[1])); }
  catch (e) { console.error('OKX history', inst, e.message, '— reading today\'s figure instead');
    const j = await get('https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=' + inst);
    const d = j && j.data && j.data[0]; if (!d) throw new Error('OKX ' + inst + ': no data');
    return [[today, +d.oiCcy, d.oiUsd != null ? Math.round(+d.oiUsd) : null]]; }
}
async function binance(sym) {
  const j = await get('https://fapi.binance.com/futures/data/openInterestHist?symbol=' + sym + '&period=1d&limit=30');
  if (!Array.isArray(j)) throw new Error('Binance ' + sym + ': unexpected reply');
  return j.map(r => [iso(+r.timestamp), +r.sumOpenInterest, Math.round(+r.sumOpenInterestValue)]).filter(r => r[0] < today && isFinite(r[1]));
}
function merge(held, got) { const have = new Set((held || []).map(r => r[0])), out = (held || []).slice(); let n = 0;
  for (const r of got) if (!have.has(r[0])) { out.push(r); have.add(r[0]); n++; } out.sort((a, b) => a[0].localeCompare(b[0])); return [out.slice(-KEEP), n]; }
async function main() {
  let prev = null; if (fs.existsSync(OUT)) { try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { console.error(OUT + ' does not parse; left untouched.'); return; } }
  const V = (prev && prev.venues) || {}, notRead = []; let ok = 0;
  const run = async (venue, asset, inst, fn) => { const key = venue + ':' + inst; try { const [m, n] = merge(V[key] && V[key].rows, await fn(inst));
      V[key] = { venue, asset, inst, unit: asset, rows: m }; ok++; console.log(key, m.length, 'rows,', n, 'new'); }
    catch (e) { console.error(key, 'not read:', e.message); notRead.push({ venue, inst, why: e.message }); } };
  for (const [a, i] of OKX) await run('OKX', a, i, okx);
  for (const [a, i] of BIN) await run('Binance', a, i, binance);
  if (!ok) { console.error('no venue read; nothing written'); return; }
  fs.writeFileSync(OUT, JSON.stringify({ about: 'Perpetual-futures open interest by venue and instrument, in coins (and US dollars where the venue gives it), one row per UTC day from each venue\'s own public API. Each venue covers itself only. A venue that refuses the runner is listed under notRead; no other route is tried. Written by tools/leverage.mjs.',
    method: 'lev-v1', updated: new Date(NOW).toISOString(), venues: V, notRead }) + '\n');
  console.log('leverage.json written:', Object.keys(V).length, 'instruments;', notRead.length, 'not read');
}
main().catch(e => { console.error(e); process.exitCode = 0; });
