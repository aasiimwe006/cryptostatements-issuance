/* structure.mjs — CRYPTO STATEMENTS · daily log of the Market Structure labels, struct-v2 (r294; struct-v1 r289)

   Runs last in the daily workflow, after market.mjs, signals.mjs, cot.mjs, macro.mjs and etf.mjs have written
   their files. Applies the same fixed rules as the Market Structure panel on the platform's Market Context page
   to the files the job has just written, and appends ONE row per UTC day to structure.json: each pillar's label,
   direction and the figures behind it, with each figure's own as-of date. A day already logged is never altered
   (a second run on the same day changes nothing). When a pillar's label differs from the previous logged day's,
   a change entry is appended (rule "structure"), which the platform's alert ledger records like any other
   market alert. The labels describe what each figure did over its window; they are not combined into a
   verdict and are not a forecast, a score or a signal. A pillar whose file cannot be read is logged as null.
   struct-v2 (8 Nov 2026) adds three money pillars from liquidity.json (dollar liquidity, the dollar, policy rates);
   r300 adds stablecoin concentration and money supply (US M2) and shows the Bank of Japan beside the Fed and the ECB.
   The pillars computed from the record itself (policy climate, rules in the pipeline, regulated stablecoins) and
   institutional ownership (which needs the platform's disclosures) are computed on the page and not logged here.
   No dependencies (Node 20). STRUCT_NOW: tests only.                                                        */
import fs from 'node:fs';
const OUT = 'structure.json', DAY = 864e5;
const NOW = process.env.STRUCT_NOW ? Date.parse(process.env.STRUCT_NOW) : Date.now();
const today = new Date(NOW).toISOString().slice(0, 10);
const RULES = {
  'Dollar liquidity': 'Net liquidity (Fed total assets - overnight reverse repo - Treasury General Account, Fed H.4.1 via FRED), each Wednesday: change over four weeks. Expanding at +1.0% or more, contracting at -1.0% or less, otherwise flat.',
  Dollar: "The Fed's nominal broad US dollar index (H.10 via FRED): change over 21 business days. Strengthening at +1.5% or more, weakening at -1.5% or less, otherwise steady.",
  'Policy rates': "The Fed's target range upper limit against 90 days earlier: cutting, raising or on hold. The ECB deposit rate and the Bank of Japan's basic loan rate are shown beside it, each against 90 days earlier; they do not set the label.",
  'Money supply': 'US M2 (Fed H.6 via FRED, monthly, seasonally adjusted): change over the latest three months. Expanding at +0.5% or more, contracting at -0.5% or less, otherwise flat.',
  Liquidity: 'Total stablecoin supply across all chains (DefiLlama, market.json): change over 30 days. Contracting at -1.0% or less, expanding at +1.0% or more, otherwise flat.',
  'Stablecoin concentration': 'USDT and USDC together as a share of all stablecoin supply (DefiLlama, market.json) against 90 days earlier: concentrating at +1.0 point or more, dispersing at -1.0 point or less, otherwise steady.',
  Leverage: 'CME bitcoin futures open interest (CFTC Commitments of Traders, Tuesday positions): change over the last four reports. Falling at -10% or less, rising at +10% or more, otherwise steady.',
  Positioning: "Asset managers' net position in CME bitcoin futures against four reports earlier; a change smaller than 2% of open interest is unchanged.",
  Funding: 'Perpetual funding on BTCUSDT and ETHUSDT (sig-v1 alert rule). Extreme if the rule fired in the 7 days before signals.json was written, otherwise inside its band.',
  'ETF holdings': 'Spot bitcoin ETFs summed only on dates every fund in the sum has published (no fund carried forward; a fund with no file for more than 5 days left out; ARK placed at the close its file reflects). Net change over the last five complete changes: inflow if positive, outflow if negative; no label before two complete dates.',
  Rates: "US Treasury 10-year par yield (the Treasury's daily curve): change over the last 21 business days. Easing at -15 bp or less, tightening at +15 bp or more, otherwise steady.",
  Sentiment: 'alternative.me Fear & Greed (market.json snapshots), its own bands: under 25 extreme fear, under 45 fear, 45-55 neutral, up to 75 greed, above 75 extreme greed.'
};
const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.error(f, 'not read:', e.message); return null; } };
const pct = (a, b) => b ? 100 * (a / b - 1) : null, r1 = x => x == null ? null : Math.round(x * 10) / 10;

function liquidity(M) {
  const z = M && M.stablecoins && M.stablecoins.total && M.stablecoins.total.series; if (!z || z.length <= 31) return null;
  const L = z[z.length - 1], m = z[z.length - 31], w = z[z.length - 8], c30 = pct(L[1], m[1]);
  return { label: c30 <= -1 ? 'Contracting' : c30 >= 1 ? 'Expanding' : 'Flat', dir: c30 <= -1 ? -1 : c30 >= 1 ? 1 : 0, asof: L[0],
    figs: { supply: Math.round(L[1]), chg30pct: r1(c30), chg30: Math.round(L[1] - m[1]), chg7pct: r1(pct(L[1], w[1])) } };
}
function leverage(C) {
  const B = C && C.markets && C.markets.btc; if (!B || !B.weeks || B.weeks.length <= 4) return null;
  const W = B.weeks, L = W[W.length - 1], P = W[W.length - 2], Q = W[W.length - 5], c4 = pct(L.oi, Q.oi);
  return { label: c4 <= -10 ? 'Falling' : c4 >= 10 ? 'Rising' : 'Steady', dir: c4 <= -10 ? -1 : c4 >= 10 ? 1 : 0, asof: L.date,
    figs: { oi_contracts: L.oi, oi_btc: L.oi * B.mult, chg4pct: r1(c4), chg1pct: r1(pct(L.oi, P.oi)) } };
}
function positioning(C) {
  const B = C && C.markets && C.markets.btc; if (!B || !B.weeks || B.weeks.length <= 4) return null;
  const W = B.weeks, L = W[W.length - 1], Q = W[W.length - 5], am = L.am_l - L.am_s, amq = Q.am_l - Q.am_s, dd = am - amq, tol = 0.02 * L.oi;
  const label = (Math.sign(am) !== Math.sign(amq) && am && amq) ? 'Asset managers flipped to net ' + (am > 0 ? 'long' : 'short')
    : Math.abs(dd) < tol ? 'Asset managers unchanged' : 'Asset managers ' + (am >= 0 ? (dd > 0 ? 'more long' : 'less long') : (dd < 0 ? 'more short' : 'less short'));
  return { label, dir: Math.abs(dd) < tol ? 0 : dd > 0 ? 1 : -1, asof: L.date,
    figs: { am_net_btc: am * B.mult, am_net_4w_btc: amq * B.mult, lev_net_btc: (L.lev_l - L.lev_s) * B.mult, lev_net_4w_btc: (Q.lev_l - Q.lev_s) * B.mult } };
}
function funding(S) {
  if (!S || !Array.isArray(S.signals)) return null; const up = Date.parse(S.updated) || NOW;
  const F = S.signals.filter(x => x.rule === 'funding' && Date.parse(x.date) >= up - 7 * DAY && Date.parse(x.date) < up).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { label: F.length ? 'Extreme' : 'Inside its band', dir: F.length ? (/high|positive|above/i.test(F[0].title) ? 1 : -1) : 0, asof: new Date(up).toISOString().slice(0, 10),
    figs: { fired: F.slice(0, 3).map(x => ({ date: x.date, title: x.title })) } };
}
/* The same summing rules as the page's etfGroup (r288). */
const LAG = { ARKB: 1 }, STALE = 5;
const prevWeekday = d => { let t = Date.parse(d); do { t -= DAY; } while ([0, 6].includes(new Date(t).getUTCDay())); return new Date(t).toISOString().slice(0, 10); };
function etfGroup(E, asset) {
  const ent = Object.entries((E && E.funds) || {}).filter(([k, v]) => v.asset === asset && !v.hand);
  const all = ent.map(([k, v]) => [k, (v.rows || []).filter(r => r.qty > 0).map(r => LAG[k] ? Object.assign({}, r, { date: prevWeekday(r.date) }) : r)]).filter(([k, Q]) => Q.length && !Q[Q.length - 1].hand);
  if (!all.length) return { rows: [], funds: 0 };
  const newest = all.map(([k, Q]) => Q[Q.length - 1].date).sort().pop();
  const Fd = all.filter(([k, Q]) => (Date.parse(newest) - Date.parse(Q[Q.length - 1].date)) / DAY <= STALE);
  const start = Fd.map(([k, Q]) => Q[0].date).sort().pop(), own = Fd.map(([k, Q]) => new Map(Q.map(r => [r.date, r.qty])));
  const dates = [...new Set(Fd.flatMap(([k, Q]) => Q.map(r => r.date)))].filter(d => d >= start).sort();
  return { rows: dates.filter(d => own.every(m => m.has(d))).map(d => ({ date: d, qty: own.reduce((x, m) => x + m.get(d), 0) })), funds: Fd.length };
}
function etf(E) {
  if (!E || !E.funds) return null; const G = etfGroup(E, 'BTC'), R = G.rows;
  if (!R.length) return { label: 'Awaiting a second complete date', dir: null, asof: null, figs: { funds: G.funds } };
  const L = R[R.length - 1], F = R.slice(1).map((r, i) => r.qty - R[i].qty).slice(-5);
  if (!F.length) return { label: 'Awaiting a second complete date', dir: null, asof: L.date, figs: { held_btc: L.qty, funds: G.funds } };
  const net = F.reduce((x, v) => x + v, 0), from = R[Math.max(0, R.length - 1 - F.length)].date;
  return { label: net > 0 ? 'Bitcoin inflow' : net < 0 ? 'Bitcoin outflow' : 'Bitcoin unchanged', dir: net > 0 ? 1 : net < 0 ? -1 : 0, asof: L.date,
    figs: { held_btc: L.qty, net_btc: net, changes: F.length, from, funds: G.funds } };
}
function rates(Mc) {
  const Y = Mc && Mc.yields; if (!Y || Y.length <= 21) return null;
  const L = Y[Y.length - 1], P = Y[Y.length - 22], d = Math.round((L.y10 - P.y10) * 100);
  return { label: d <= -15 ? 'Easing' : d >= 15 ? 'Tightening' : 'Steady', dir: d <= -15 ? -1 : d >= 15 ? 1 : 0, asof: L.date,
    figs: { y10: L.y10, y2: L.y2 ?? null, chg21_bp: d, curve_bp: L.y2 != null ? Math.round((L.y10 - L.y2) * 100) : null } };
}
function sentiment(M) {
  const Sn = ((M && M.snapshots) || []).filter(x => x.fng != null); if (!Sn.length) return null;
  const L = Sn[Sn.length - 1], P = Sn.find(x => x.date === new Date(Date.parse(L.date) - 7 * DAY).toISOString().slice(0, 10)), v = +L.fng;
  return { label: v < 25 ? 'Extreme fear' : v < 45 ? 'Fear' : v <= 55 ? 'Neutral' : v <= 75 ? 'Greed' : 'Extreme greed', dir: P ? (v > P.fng ? 1 : v < P.fng ? -1 : 0) : null, asof: L.date,
    figs: { fng: v, fng_7d: P ? +P.fng : null } };
}
const pc = (a, b) => b ? 100 * (a / b - 1) : null;
function dollarLiq(Lq) { const N = Lq && Lq.net; if (!N || N.length <= 4) return null; const L = N[N.length - 1], P = N[N.length - 5], c = pc(L[1], P[1]);
  return { label: c >= 1 ? 'Expanding' : c <= -1 ? 'Contracting' : 'Flat', dir: c >= 1 ? 1 : c <= -1 ? -1 : 0, asof: L[0], figs: { net_bn: L[1], chg4w_pct: r1(c) } }; }
function dollar(Lq) { const D = Lq && Lq.series && Lq.series.DTWEXBGS; if (!D || D.length <= 21) return null; const L = D[D.length - 1], P = D[D.length - 22], c = pc(L[1], P[1]);
  return { label: c >= 1.5 ? 'Strengthening' : c <= -1.5 ? 'Weakening' : 'Steady', dir: c >= 1.5 ? 1 : c <= -1.5 ? -1 : 0, asof: L[0], figs: { index: L[1], chg21_pct: r1(c) } }; }
function policy(Lq) { const U = Lq && Lq.series && Lq.series.DFEDTARU; if (!U || !U.length) return null; const L = U[U.length - 1], P = U.filter(r => Date.parse(r[0]) <= Date.parse(L[0]) - 90 * DAY).pop() || U[0], d = Math.round((L[1] - P[1]) * 100);
  return { label: 'Fed ' + (d < 0 ? 'cutting' : d > 0 ? 'raising' : 'on hold'), dir: d > 0 ? 1 : d < 0 ? -1 : 0, asof: L[0], figs: { upper: L[1], chg90_bp: d } }; }
function concentration(M) { const St = M && M.stablecoins, T = St && St.total && St.total.series, U = St && St.USDT && St.USDT.series, C = St && St.USDC && St.USDC.series;
  if (!T || !U || !C || T.length <= 91) return null; const at = (z, d) => { const r = z.filter(x => x[0] <= d).pop(); return r ? r[1] : null; }, L = T[T.length - 1][0], P = T[T.length - 91][0];
  const sh = d => { const t = at(T, d), u = at(U, d), c = at(C, d); return t && u != null && c != null ? 100 * (u + c) / t : null; }, a = sh(L), b = sh(P); if (a == null || b == null) return null; const d = a - b;
  return { label: d >= 1 ? 'Concentrating' : d <= -1 ? 'Dispersing' : 'Steady', dir: d >= 1 ? 1 : d <= -1 ? -1 : 0, asof: L, figs: { usdt_usdc_pct: r1(a), chg90_pts: r1(d) } }; }
function m2(Lq) { const S = Lq && Lq.series && Lq.series.M2SL; if (!S || S.length <= 3) return null; const L = S[S.length - 1], P = S[S.length - 4], c = pc(L[1], P[1]);
  return { label: c >= 0.5 ? 'Expanding' : c <= -0.5 ? 'Contracting' : 'Flat', dir: c >= 0.5 ? 1 : c <= -0.5 ? -1 : 0, asof: L[0], figs: { m2_bn: L[1], chg3m_pct: r1(c) } }; }
function main() {
  const prev = fs.existsSync(OUT) ? read(OUT) : null;
  if (fs.existsSync(OUT) && !prev) { console.error(OUT + ' does not parse; left untouched, nothing written today.'); return; }
  const doc = prev || { days: [], changes: [] };
  if (doc.days.some(d => d.date === today)) { console.log('structure.json: ' + today + ' already logged; unchanged'); return; }
  const M = read('market.json'), C = read('cot.json'), Mc = read('macro.json'), S = read('signals.json'), E = read('etf.json'), Lq = fs.existsSync('liquidity.json') ? read('liquidity.json') : null;
  const rows = { 'Dollar liquidity': dollarLiq(Lq), Dollar: dollar(Lq), 'Policy rates': policy(Lq), 'Money supply': m2(Lq), Liquidity: liquidity(M), 'Stablecoin concentration': concentration(M), Leverage: leverage(C), Positioning: positioning(C), Funding: funding(S), 'ETF holdings': etf(E), Rates: rates(Mc), Sentiment: sentiment(M) };
  const last = doc.days[doc.days.length - 1];
  if (last) for (const [k, r] of Object.entries(rows)) {
    const p = last.rows && last.rows[k];
    if (!r || !p || !r.label || !p.label || r.label === p.label) continue;
    doc.changes.push({ id: 'structure:' + k + ':' + today, date: today, rule: 'structure', sev: 2, pillar: k, from: p.label, to: r.label,
      title: 'Market structure · ' + k + ': ' + p.label + ' → ' + r.label,
      why: 'struct-v1, figures as of ' + (r.asof || 'n/a') + ' (previous label as of ' + (p.asof || 'n/a') + ', logged ' + last.date + ') · ' + RULES[k] + ' · a description of what the figure did, not a forecast',
      src: 'structure.json' });
    console.log('label change:', k, p.label, '->', r.label);
  }
  doc.days.push({ date: today, read: new Date(NOW).toISOString(), rows });
  Object.assign(doc, { about: 'Daily log of the CRYPTO STATEMENTS Market Structure labels (struct-v1): one row per UTC day, each pillar\'s label, direction and figures with their own as-of dates, computed from the files the daily job writes. Appended, never altered. A label change is also a market alert. Context beside the record, never a forecast or a signal. Written by tools/structure.mjs.',
    method: 'struct-v2', rules: RULES, updated: new Date(NOW).toISOString() });
  fs.writeFileSync(OUT, JSON.stringify(doc) + '\n');
  console.log('structure.json: ' + today + ' logged · ' + Object.entries(rows).map(([k, r]) => k + ' ' + (r ? r.label : 'not read')).join(' · ') + ' · ' + doc.days.length + ' days, ' + doc.changes.length + ' changes');
}
try { main(); } catch (e) { console.error(e); process.exitCode = 0; }
