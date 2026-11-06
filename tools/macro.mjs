/* macro.mjs — CRYPTO STATEMENTS · US Treasury yields for macro records (r281)

   Market context for the figure cards, kept apart from the record. Run daily by the workflow. Reads the
   US Treasury's own Daily Treasury Par Yield Curve Rates (home.treasury.gov, CSV, one file per year)
   and keeps the 3-month, 2-year and 10-year constant-maturity par yields, one row per business day,
   since January 2023. If the Treasury refuses the runner, the Federal Reserve's H.15 series as
   republished by FRED (DGS3MO, DGS2, DGS10) is the stated fallback, and each row says which source it
   came from. Rows already held are kept as they are; the Treasury revises rarely, and a revision is not
   copied over a stored day. A failure here leaves the file as it was and does not fail the workflow.
   No dependencies (Node 20). MACRO_NOW: tests only.                                               */
import fs from 'node:fs';
const OUT = 'macro.json', FROM_YEAR = 2023;
const NOW = process.env.MACRO_NOW ? Date.parse(process.env.MACRO_NOW) : Date.now();
const COLS = { y3m: '3 Mo', y2: '2 Yr', y10: '10 Yr' }, FRED = { y3m: 'DGS3MO', y2: 'DGS2', y10: 'DGS10' };
async function text(url) { const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(new URL(url).host + ' HTTP ' + r.status); return r.text(); }
function csvRows(t) { return t.trim().split(/\r?\n/).map(l => l.split(',').map(x => x.replace(/^"|"$/g, '').trim())); }
async function treasury(year) {
  const t = await text(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`);
  const R = csvRows(t), H = R[0], di = H.indexOf('Date'); if (di < 0) throw new Error('no Date column');
  const ix = Object.fromEntries(Object.entries(COLS).map(([k, c]) => [k, H.indexOf(c)]));
  if (ix.y10 < 0) throw new Error('no 10 Yr column');
  return R.slice(1).map(r => { const m = (r[di] || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (!m) return null;
    const row = { date: `${m[3]}-${m[1]}-${m[2]}`, src: 'treasury' }; for (const [k, i] of Object.entries(ix)) if (i >= 0 && r[i] !== '' && isFinite(+r[i])) row[k] = +r[i];
    return row.y10 != null ? row : null; }).filter(Boolean);
}
async function fred() {
  const M = {};
  for (const [k, id] of Object.entries(FRED)) {
    const R = csvRows(await text(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${FROM_YEAR}-01-01`));
    for (const r of R.slice(1)) { if (!/^\d{4}-\d{2}-\d{2}$/.test(r[0]) || r[1] === '.' || r[1] === '' || !isFinite(+r[1])) continue; (M[r[0]] = M[r[0]] || { date: r[0], src: 'fred-h15' })[k] = +r[1]; }
  }
  return Object.values(M).filter(r => r.y10 != null);
}
async function main() {
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const held = (prev && prev.yields) || [], have = new Set(held.map(r => r.date));
  let got = [], ok = false;
  const y1 = new Date(NOW).getUTCFullYear(), years = [];
  for (let y = held.length ? y1 - 1 : FROM_YEAR; y <= y1; y++) years.push(y);
  try { for (const y of years) { const r = await treasury(y); got = got.concat(r); console.log('treasury', y, r.length, 'days'); } ok = true; }
  catch (e) { console.error('treasury', e.message); }
  if (!ok) { try { got = await fred(); console.log('fred fallback', got.length, 'days'); ok = true; } catch (e) { console.error('fred', e.message); } }
  if (!ok) return;
  let n = 0; for (const r of got) if (!have.has(r.date) && r.date >= FROM_YEAR + '-01-01') { held.push(r); have.add(r.date); n++; }
  held.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(OUT, JSON.stringify({ about: 'US Treasury par yields (3-month, 2-year, 10-year), percent, one row per business day, from the Treasury’s Daily Treasury Par Yield Curve Rates; rows marked fred-h15 came from the Federal Reserve H.15 via FRED when the Treasury could not be read. Context for CRYPTO STATEMENTS figure cards on macro records, kept apart from the record. Written by tools/macro.mjs.',
    updated: new Date(NOW).toISOString(), yields: held }) + '\n');
  console.log('macro.json written:', n, 'new,', held.length, 'held');
}
main().catch(e => { console.error(e); process.exitCode = 0; });
