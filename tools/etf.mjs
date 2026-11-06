/* etf.mjs — CRYPTO STATEMENTS · spot crypto ETF holdings from the issuers' own files (r282)

   Market context for the figure cards, kept apart from the record. Run daily by the workflow. For each
   fund in FUNDS, reads the issuer's own published holdings file and appends one row per as-of date not
   yet held: the as-of date the issuer prints, shares outstanding, the crypto quantity held and its
   market value. A day's flow is the change in the quantity held from the previous row, so it is what
   the issuer's own files show, not an aggregator's estimate. The issuers publish only the latest file,
   so the history starts on the first run and grows a business day at a time; a stored row is never
   altered. A fund whose file cannot be read or parsed is skipped for the day and says so in the log;
   nothing is estimated. A failure here does not fail the workflow's other steps.
   Starts with BlackRock's iShares Bitcoin Trust (IBIT), by the founder's decision of 6 Nov 2026; other
   issuers are added one at a time, each with its own parser, once its file has been checked by hand.
   No dependencies (Node 20).                                                                          */
import fs from 'node:fs';
const OUT = 'etf.json';
const num = s => +String(s || '').replace(/[",\s]/g, '');
const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
function csvLine(l) { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(x => x.trim()); }
/* iShares product CSV: a header block ("Fund Holdings as of", "Shares Outstanding"), then a holdings table. */
function ishares(text, asset) {
  const L = text.split(/\r?\n/), get = k => { const l = L.find(x => x.startsWith(k)); return l ? csvLine(l)[1] : null; };
  const m = (get('Fund Holdings as of') || '').match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/); if (!m) throw new Error('no as-of date');
  const date = `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2, '0')}`, shares = num(get('Shares Outstanding'));
  const hi = L.findIndex(x => x.startsWith('Ticker,')); if (hi < 0) throw new Error('no holdings table');
  const H = csvLine(L[hi]), iq = H.indexOf('Quantity'), iv = H.indexOf('Market Value'), it = H.indexOf('Ticker');
  const row = L.slice(hi + 1).map(csvLine).find(r => r[it] === asset); if (!row) throw new Error('no ' + asset + ' line');
  const qty = num(row[iq]), mv = num(row[iv]); if (!(qty > 0) || !(shares > 0)) throw new Error('unreadable figures');
  return { date, shares, qty, mv };
}
const FUNDS = [
  { id: 'IBIT', name: 'iShares Bitcoin Trust ETF', issuer: 'BlackRock (iShares)', asset: 'BTC',
    url: 'https://www.ishares.com/us/products/333011/ishares-bitcoin-trust-etf/latest-holdings.csv', parse: t => ishares(t, 'BTC') }
];
async function main() {
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const doc = { about: 'Spot crypto ETF holdings as each issuer publishes them in its own holdings file: as-of date, shares outstanding, quantity held and market value, one row per as-of date, appended and never altered. A flow is the change in quantity between rows. Context for CRYPTO STATEMENTS figure cards, kept apart from the record. Written by tools/etf.mjs.',
    updated: new Date().toISOString(), funds: (prev && prev.funds) || {} };
  for (const F of FUNDS) {
    const held = (doc.funds[F.id] && doc.funds[F.id].rows) || [];
    try {
      const r = await fetch(F.url, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'cryptostatements-issuance (GitHub Actions)', accept: 'text/csv,text/plain,*/*' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const x = F.parse(await r.text());
      if (!held.some(h => h.date === x.date)) { held.push(x); console.log(F.id, x.date, x.qty, F.asset, 'held,', x.shares, 'shares'); } else console.log(F.id, x.date, 'already held');
      held.sort((a, b) => a.date.localeCompare(b.date));
    } catch (e) { console.error(F.id, e.message); }
    doc.funds[F.id] = { name: F.name, issuer: F.issuer, asset: F.asset, src: F.url, rows: held };
  }
  fs.writeFileSync(OUT, JSON.stringify(doc) + '\n');
  console.log('etf.json written:', Object.entries(doc.funds).map(([k, v]) => k + ' ' + v.rows.length).join(', '));
}
main().catch(e => { console.error(e); process.exitCode = 0; });
