/* signals.mjs — CRYPTO STATEMENTS · market-linked signals (r281)

   Market context for the alert ledger, kept apart from the record. Run daily by the workflow after
   issuance.mjs and market.mjs. Re-examines the last 7 completed UTC days and appends any signal not
   yet held to signals.json, which GitHub Pages serves to the site. A signal, once written, is never
   altered or removed; the ledger on the site copies it at the next build.

   Four rules, thresholds fixed here before any signal was seen (6 Nov 2026):
     peg       a USD stablecoin's daily close against USD on Kraken (USDT, USDC, PYUSD, RLUSD) at least
               0.5% away from 1.00. Kraken is a regulated USD venue; the pair is the token against
               dollars, not against another stablecoin.
     issuance  a token's net issuance on its Ethereum contract for one day (issued minus redeemed, from
               index.json) larger, either way, than every one of its previous 30 days AND at least
               100 million (USD tokens), 50 million (EURC) or 5,000 ounces (PAXG). What the contract
               recorded, never why.
     wipe      the contract recorded a wipe (balance destroyed by the issuer) that day. Freezes are too
               frequent on USDT and USDC to be a signal on their own; they stay on the cards.
     funding   a Binance USD-M perpetual funding settlement (BTCUSDT, ETHUSDT) outside the 2.5th to
               97.5th percentile of the previous 90 days AND at least 0.03% per 8 hours either way.
               Binance first, OKX's matching swap as the stated fallback when Binance refuses the runner.
   A source that fails writes nothing for that rule; nothing is estimated. A failure here does not fail
   the workflow's other steps. No dependencies (Node 20). SIGNALS_NOW: tests only.                    */
import fs from 'node:fs';
const OUT = 'signals.json', IDX = 'index.json';
const NOW = process.env.SIGNALS_NOW ? Date.parse(process.env.SIGNALS_NOW) : Date.now();
const DAY = 864e5, iso = t => new Date(t).toISOString().slice(0, 10);
const RULES = {
  peg: { venue: 'Kraken', pairs: { USDT: 'USDTUSD', USDC: 'USDCUSD', PYUSD: 'PYUSDUSD', RLUSD: 'RLUSDUSD' }, band: 0.005 },
  issuance: { lookback: 30, floor: { USDC: 1e8, USDT: 1e8, PYUSD: 1e8, RLUSD: 1e8, EURC: 5e7, PAXG: 5000 }, unit: { EURC: 'EUR', PAXG: 'oz' } },
  wipe: {},
  funding: { symbols: ['BTCUSDT', 'ETHUSDT'], okx: { BTCUSDT: 'BTC-USDT-SWAP', ETHUSDT: 'ETH-USDT-SWAP' }, days: 90, q: [0.025, 0.975], floor: 0.0003 }
};
async function get(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(new URL(url).host + ' HTTP ' + r.status); return r.json();
}
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b), k = (s.length - 1) * q, f = Math.floor(k), c = Math.ceil(k);
  return f === c ? s[f] : s[f] + (s[c] - s[f]) * (k - f); };
const fmtN = (v, u) => (u === 'oz' ? Math.round(v).toLocaleString('en-US') + ' oz' : (u === 'EUR' ? '€' : '$') + (Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : (v / 1e6).toFixed(1) + 'M'));
const pctS = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(3) + '%';

const days7 = () => { const d = []; for (let i = 7; i >= 1; i--) d.push(iso(NOW - i * DAY)); return d; };

async function peg() {
  const out = [], want = new Set(days7());
  for (const [tok, pair] of Object.entries(RULES.peg.pairs)) {
    try {
      const j = await get('https://api.kraken.com/0/public/OHLC?pair=' + pair + '&interval=1440&since=' + Math.floor((NOW - 10 * DAY) / 1000));
      if (j.error && j.error.length) throw new Error(j.error.join(' '));
      const key = Object.keys(j.result || {}).find(k => k !== 'last'); const rows = key ? j.result[key] : [];
      for (const r of rows) {
        const d = iso(+r[0] * 1000); if (!want.has(d)) continue;          // completed days only; today's candle is never in want
        const close = +r[4], lo = +r[3], hi = +r[2], dev = close - 1;
        if (Math.abs(dev) >= RULES.peg.band)
          out.push({ id: 'peg:' + tok + ':' + d, date: d, rule: 'peg', sev: Math.abs(dev) >= 0.01 ? 1 : 2,
            title: tok + ' closed ' + (dev < 0 ? 'below' : 'above') + ' its dollar peg',
            why: 'Kraken ' + pair + ' daily close ' + close.toFixed(4) + ' (' + pctS(dev) + '), low ' + lo.toFixed(4) + ', high ' + hi.toFixed(4) + ' · ' + d,
            src: 'Kraken public OHLC, ' + pair, value: close });
      }
      console.log('peg', tok, rows.length, 'candles');
    } catch (e) { console.error('peg', tok, e.message); }
  }
  return out;
}

function issuance() {
  const out = []; if (!fs.existsSync(IDX)) { console.error('issuance: no index.json'); return out; }
  const I = JSON.parse(fs.readFileSync(IDX, 'utf8')), D = (I.days || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const want = new Set(days7());
  D.forEach((day, i) => {
    if (!want.has(day.date)) return;
    for (const [tok, t] of Object.entries(day.totals || {})) {
      if (t.wipe > 0) out.push({ id: 'wipe:' + tok + ':' + day.date, date: day.date, rule: 'wipe', sev: 2,
        title: tok + ' issuer wiped frozen balances', why: t.wipe + ' wipe event' + (t.wipe === 1 ? '' : 's') + ' on the Ethereum contract · ' + day.date + ' · what the contract recorded, never why',
        src: 'index.json (issuance archive, Ethereum)', value: t.wipe });
      const floor = RULES.issuance.floor[tok]; if (floor == null) continue;
      const net = (t.issue?.sum || 0) - (t.redeem?.sum || 0);
      const prev = D.slice(Math.max(0, i - RULES.issuance.lookback), i).map(x => { const p = (x.totals || {})[tok]; return p ? Math.abs((p.issue?.sum || 0) - (p.redeem?.sum || 0)) : null; }).filter(v => v != null);
      if (prev.length < RULES.issuance.lookback) continue;                 // a full 30-day history or no signal
      if (Math.abs(net) > Math.max(...prev) && Math.abs(net) >= floor) {
        const u = RULES.issuance.unit[tok];
        out.push({ id: 'issuance:' + tok + ':' + day.date, date: day.date, rule: 'issuance', sev: 2,
          title: tok + ' net ' + (net > 0 ? 'issuance' : 'redemption') + ' largest in 30 days',
          why: 'Net ' + (net > 0 ? '+' : '−') + fmtN(Math.abs(net), u) + ' on the Ethereum contract (issued ' + fmtN(t.issue?.sum || 0, u) + ', redeemed ' + fmtN(t.redeem?.sum || 0, u) + ') · ' + day.date + ' · what the contract recorded, never why',
          src: 'index.json (issuance archive, Ethereum)', value: Math.round(net) });
      }
    }
  });
  return out;
}

async function fundingSeries(sym) {
  const start = NOW - (RULES.funding.days + 8) * DAY;
  try {
    const j = await get('https://fapi.binance.com/fapi/v1/fundingRate?symbol=' + sym + '&startTime=' + start + '&limit=1000');
    if (Array.isArray(j) && j.length) return { venue: 'Binance', rows: j.map(r => [+r.fundingTime, +r.fundingRate]) };
  } catch (e) { console.error('funding', sym, 'Binance', e.message); }
  try {
    const inst = RULES.funding.okx[sym]; let after = '', rows = [];
    for (let p = 0; p < 4; p++) {
      const j = await get('https://www.okx.com/api/v5/public/funding-rate-history?instId=' + inst + '&limit=100' + (after ? '&after=' + after : ''));
      const d = j.data || []; if (!d.length) break;
      rows = rows.concat(d.map(r => [+r.fundingTime, +r.realizedRate || +r.fundingRate])); after = d[d.length - 1].fundingTime;
      if (+after < start) break;
    }
    if (rows.length) return { venue: 'OKX ' + inst, rows: rows.filter(r => r[0] >= start).sort((a, b) => a[0] - b[0]) };
  } catch (e) { console.error('funding', sym, 'OKX', e.message); }
  return null;
}
async function funding() {
  const out = [], from = Date.parse(days7()[0] + 'T00:00:00Z'), to = Date.parse(iso(NOW) + 'T00:00:00Z');
  for (const sym of RULES.funding.symbols) {
    const S = await fundingSeries(sym); if (!S) continue;
    console.log('funding', sym, S.venue, S.rows.length, 'settlements');
    S.rows.forEach(([t, r], i) => {
      if (t < from || t >= to) return;
      const prev = S.rows.filter(([u]) => u < t && u >= t - RULES.funding.days * DAY).map(x => x[1]);
      if (prev.length < 200) return;                                         // about 67 days at three settlements a day
      const lo = quantile(prev, RULES.funding.q[0]), hi = quantile(prev, RULES.funding.q[1]);
      if ((r < lo || r > hi) && Math.abs(r) >= RULES.funding.floor) {
        const at = new Date(t).toISOString().slice(0, 16) + 'Z';
        out.push({ id: 'funding:' + sym + ':' + at, date: at.slice(0, 10), rule: 'funding', sev: 2,
          title: sym.replace('USDT', '') + ' perpetual funding ' + (r > 0 ? 'unusually high' : 'unusually negative'),
          why: S.venue + ' settlement ' + at.replace('T', ' ').replace('Z', ' UTC') + ': ' + pctS(r) + ' per 8h, outside the 90-day range ' + pctS(lo) + ' to ' + pctS(hi) + (r > 0 ? ' · longs paying shorts' : ' · shorts paying longs'),
          src: S.venue + ' funding history', value: r });
      }
    });
  }
  return out;
}

async function main() {
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const doc = { about: 'Market-linked signals for the CRYPTO STATEMENTS alert ledger, kept apart from the record: stablecoin peg, net issuance and wipes on Ethereum contracts, and perpetual funding extremes. Context, never a measured reaction to a statement. Appended, never altered. Written by tools/signals.mjs.',
    method: 'sig-v1', rules: RULES, updated: new Date(NOW).toISOString(), signals: (prev && prev.signals) || [] };
  const held = new Set(doc.signals.map(s => s.id)), found = [...await peg(), ...issuance(), ...await funding()];
  let n = 0; for (const s of found) if (!held.has(s.id)) { s.found = doc.updated; doc.signals.push(s); held.add(s.id); n++; console.log('signal', s.id, '·', s.why); }
  doc.signals.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 0) + '\n');
  console.log('signals.json written:', n, 'new,', doc.signals.length, 'held');
}
main().catch(e => { console.error(e); process.exitCode = 0; });
