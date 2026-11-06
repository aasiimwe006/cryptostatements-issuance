/* cot.mjs — CRYPTO STATEMENTS · CFTC Commitments of Traders for CME bitcoin and ether futures (r281)

   Market context for the figure cards, kept apart from the record. Run daily by the workflow; the CFTC
   publishes once a week (Friday, for positions as of the Tuesday before), so most runs change nothing.
   Source: the CFTC's own Public Reporting Environment, Traders in Financial Futures, futures only
   (dataset gpe5-46if). Contracts: BITCOIN - CHICAGO MERCANTILE EXCHANGE (code 133741, 5 BTC each) and
   ETHER CASH SETTLED - CHICAGO MERCANTILE EXCHANGE (code 146021, 50 ETH each). The micro contracts are
   separate markets with different traders and are not added in.
   For each weekly report: open interest; long and short positions of asset managers, leveraged funds,
   dealers and other reportables; non-reportable positions; trader counts. Stored as reported, in
   contracts. Every week since January 2023 is kept; a stored week is never altered.
   A failure here leaves the file as it was and does not fail the workflow's other steps.
   No dependencies (Node 20). COT_NOW: tests only.                                                  */
import fs from 'node:fs';
const OUT = 'cot.json', SINCE = '2023-01-01';
const NOW = process.env.COT_NOW ? Date.parse(process.env.COT_NOW) : Date.now();
const MARKETS = { btc: { code: '133741', label: 'CME Bitcoin futures', mult: 5, unit: 'BTC' }, eth: { code: '146021', label: 'CME Ether futures', mult: 50, unit: 'ETH' } };
const FIELDS = { oi: 'open_interest_all', am_l: 'asset_mgr_positions_long', am_s: 'asset_mgr_positions_short', lev_l: 'lev_money_positions_long',
  lev_s: 'lev_money_positions_short', dl_l: 'dealer_positions_long_all', dl_s: 'dealer_positions_short_all', oth_l: 'other_rept_positions_long',
  oth_s: 'other_rept_positions_short', nr_l: 'nonrept_positions_long_all', nr_s: 'nonrept_positions_short_all', traders: 'traders_tot_all' };
async function get(url) { const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(new URL(url).host + ' HTTP ' + r.status); return r.json(); }
async function main() {
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const doc = { about: 'CFTC Commitments of Traders, Traders in Financial Futures (futures only), for CME bitcoin and ether futures, as the CFTC reports them, in contracts. Positions are as of each report date (a Tuesday) and published the Friday after. Context for CRYPTO STATEMENTS figure cards, kept apart from the record. Written by tools/cot.mjs.',
    source: 'https://publicreporting.cftc.gov/resource/gpe5-46if', updated: new Date(NOW).toISOString(), markets: {} };
  for (const [k, m] of Object.entries(MARKETS)) {
    const held = (prev && prev.markets && prev.markets[k] && prev.markets[k].weeks) || [];
    const have = new Set(held.map(w => w.date));
    try {
      const q = new URLSearchParams({ '$where': `cftc_contract_market_code='${m.code}' AND report_date_as_yyyy_mm_dd >= '${SINCE}'`, '$order': 'report_date_as_yyyy_mm_dd ASC', '$limit': '1000' });
      const rows = await get(doc.source + '.json?' + q.toString());
      let n = 0;
      for (const r of rows) {
        const date = String(r.report_date_as_yyyy_mm_dd || '').slice(0, 10); if (!date || have.has(date)) continue;
        const w = { date }; for (const [f, src] of Object.entries(FIELDS)) if (r[src] != null && r[src] !== '') w[f] = +r[src];
        if (w.oi == null) continue; held.push(w); have.add(date); n++;
      }
      held.sort((a, b) => a.date.localeCompare(b.date));
      console.log('cot', k, rows.length, 'rows read,', n, 'new, last', held.length ? held[held.length - 1].date : '-');
    } catch (e) { console.error('cot', k, e.message); }
    doc.markets[k] = { label: m.label, code: m.code, contract: m.mult + ' ' + m.unit, mult: m.mult, unit: m.unit, weeks: held };
  }
  if (!Object.values(doc.markets).some(x => x.weeks.length)) { console.error('cot: nothing to write'); return; }
  fs.writeFileSync(OUT, JSON.stringify(doc) + '\n');
  console.log('cot.json written');
}
main().catch(e => { console.error(e); process.exitCode = 0; });
