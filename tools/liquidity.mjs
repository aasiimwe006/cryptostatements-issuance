/* liquidity.mjs — CRYPTO STATEMENTS · dollar liquidity, the dollar and policy rates (r294)

   Market context for the Market Structure panel, kept apart from the record. Run daily by the workflow.
   Federal Reserve series are the Fed's own releases as republished, unchanged, by FRED (Federal Reserve
   Bank of St. Louis), a part of the Federal Reserve System; each series keeps its FRED code so a reader can
   check it. The ECB deposit facility rate comes from the ECB Data Portal. Public-institution data only: no
   licensed index (the ICE US Dollar Index is not used; the Fed's broad dollar index stands in its place).

     WALCL      Fed total assets, millions of dollars, weekly (Wednesday), H.4.1
     WRESBAL    reserve balances with Federal Reserve Banks, billions, weekly, H.4.1
     RRPONTSYD  overnight reverse repurchase agreements, billions, daily
     WTREGEN    Treasury General Account at the Fed, millions, weekly (Wednesday), H.4.1
     DTWEXBGS   nominal broad US dollar index, daily, H.10
     DFEDTARU   federal funds target range, upper limit, percent, daily
     DFEDTARL   federal funds target range, lower limit, percent, daily
     ECB DFR    ECB deposit facility rate, percent, from the ECB Data Portal (FM.D.U2.EUR.4F.KR.DFR.LEV)
     M2SL       US M2 money stock, billions, monthly, seasonally adjusted, H.6 (r300)
     BOJ_CALL   uncollateralized overnight call rate, daily average, percent: the rate the Bank of Japan's
                policy guides (BoJ Time-Series Data Search API, FM01/STRDCLUCON) (r300)
     BOJ_BLR    the Bank of Japan's basic loan rate, monthly, percent (IR01/MADR1M), which moves with each
                policy-rate decision (r300)

   Net liquidity, computed here for each Wednesday on which all three are published: total assets minus
   overnight reverse repo (that Wednesday) minus the Treasury General Account, in billions. A series that
   cannot be read keeps the rows already held; nothing is estimated. Rows held are not overwritten (the Fed
   revises rarely; a revision is not copied over a stored day). No dependencies (Node 20). LIQ_NOW: tests. */
import fs from 'node:fs';
const OUT = 'liquidity.json', FROM = '2023-01-01';
const NOW = process.env.LIQ_NOW ? Date.parse(process.env.LIQ_NOW) : Date.now();
const FRED = ['WALCL', 'WRESBAL', 'RRPONTSYD', 'WTREGEN', 'DTWEXBGS', 'DFEDTARU', 'DFEDTARL', 'M2SL'];
async function text(url) { const r = await fetch(url, { signal: AbortSignal.timeout(40000), headers: { 'user-agent': 'cryptostatements-issuance (GitHub Actions; daily public-data copy)' } }); if (!r.ok) throw new Error(new URL(url).host + ' HTTP ' + r.status); return r.text(); }
function csv(t) { return t.trim().split(/\r?\n/).map(l => l.split(',').map(x => x.replace(/^"|"$/g, '').trim())); }
async function fred(id) {
  const R = csv(await text(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${FROM}`));
  return R.slice(1).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && r[1] !== '.' && r[1] !== '' && isFinite(+r[1])).map(r => [r[0], +r[1]]);
}
async function ecbDfr() {
  const R = csv(await text('https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV?format=csvdata&startPeriod=' + FROM));
  const H = R[0], di = H.indexOf('TIME_PERIOD'), vi = H.indexOf('OBS_VALUE'); if (di < 0 || vi < 0) throw new Error('ECB: unexpected columns');
  return R.slice(1).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r[di]) && isFinite(+r[vi]) && r[vi] !== '').map(r => [r[di], +r[vi]]);
}
/* r300 · Bank of Japan Time-Series Data Search API (JSON). Dates come as YYYYMMDD (daily) or YYYYMM (monthly,
   stored as the first of the month); empty values are skipped; NEXTPOSITION pages through long series. */
async function boj(db, code) {
  const out = []; let pos = '';
  for (let i = 0; i < 20; i++) {
    const j = JSON.parse(await text(`https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=json&lang=en&db=${db}&code=${code}&startDate=${FROM.slice(0, 4)}01${pos ? '&startPosition=' + pos : ''}`));
    if (j.STATUS !== 200) throw new Error('BoJ ' + code + ': ' + (j.MESSAGE || j.STATUS));
    const R = j.RESULTSET && j.RESULTSET[0]; if (!R) throw new Error('BoJ ' + code + ': no result');
    const D = R.VALUES.SURVEY_DATES, V = R.VALUES.VALUES;
    D.forEach((d, k) => { const t = String(d), v = V[k]; if (v == null || !isFinite(+v)) return; const iso = t.length === 8 ? t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6) : t.slice(0, 4) + '-' + t.slice(4, 6) + '-01'; out.push([iso, +v]); });
    if (!j.NEXTPOSITION) break; pos = j.NEXTPOSITION;
  }
  return out.filter(r => r[0] >= FROM);
}
function merge(held, got) { const have = new Set((held || []).map(r => r[0])); const out = (held || []).slice(); let n = 0;
  for (const r of got) if (!have.has(r[0])) { out.push(r); have.add(r[0]); n++; } out.sort((a, b) => a[0].localeCompare(b[0])); return [out, n]; }
async function main() {
  let prev = null; if (fs.existsSync(OUT)) { try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { console.error(OUT + ' does not parse; left untouched.'); return; } }
  const S = (prev && prev.series) || {}; let ok = 0;
  for (const id of FRED) { try { const [m, n] = merge(S[id], await fred(id)); S[id] = m; ok++; console.log(id, m.length, 'rows,', n, 'new'); } catch (e) { console.error(id, e.message); } }
  try { const [m, n] = merge(S.ECB_DFR, await ecbDfr()); S.ECB_DFR = m; ok++; console.log('ECB_DFR', m.length, 'rows,', n, 'new'); } catch (e) { console.error('ECB_DFR', e.message); }
  for (const [k, db, code] of [['BOJ_CALL', 'FM01', 'STRDCLUCON'], ['BOJ_BLR', 'IR01', 'MADR1M']]) {
    try { const [m, n] = merge(S[k], await boj(db, code)); S[k] = m; ok++; console.log(k, m.length, 'rows,', n, 'new'); } catch (e) { console.error(k, e.message); } }
  if (!ok) { console.error('no series read; nothing written'); return; }
  const by = id => new Map((S[id] || []).map(r => [r[0], r[1]]));
  const A = by('WALCL'), R = by('RRPONTSYD'), T = by('WTREGEN'), net = [];
  for (const [d, a] of A) if (R.has(d) && T.has(d)) net.push([d, Math.round((a / 1000 - R.get(d) - T.get(d) / 1000) * 10) / 10]);
  net.sort((x, y) => x[0].localeCompare(y[0]));
  fs.writeFileSync(OUT, JSON.stringify({
    about: 'Dollar liquidity, the dollar and policy rates for the CRYPTO STATEMENTS Market Structure panel, kept apart from the record. Federal Reserve series as published by the Fed and republished unchanged by FRED (codes kept); ECB deposit facility rate from the ECB Data Portal; Bank of Japan call rate and basic loan rate from the BoJ Time-Series Data Search API; US M2 (H.6) via FRED. Net liquidity = Fed total assets - overnight reverse repo - Treasury General Account, billions, on Wednesdays where all three exist. Written by tools/liquidity.mjs.',
    units: { WALCL: 'USD millions', WRESBAL: 'USD billions', RRPONTSYD: 'USD billions', WTREGEN: 'USD millions', DTWEXBGS: 'index, Jan 2006 = 100', DFEDTARU: 'percent', DFEDTARL: 'percent', ECB_DFR: 'percent', M2SL: 'USD billions', BOJ_CALL: 'percent', BOJ_BLR: 'percent', net: 'USD billions' },
    updated: new Date(NOW).toISOString(), series: S, net }) + '\n');
  console.log('liquidity.json written:', net.length, 'net-liquidity Wednesdays');
}
main().catch(e => { console.error(e); process.exitCode = 0; });
