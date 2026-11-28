/* pulse.mjs — CRYPTO STATEMENTS · the Data Wire's pulse (r384, AP104 stage 1; plan approved by the founder 28 Nov 2026)

   Every 30 minutes (GitHub Actions, .github/workflows/pulse.yml) it re-reads the fast, cheap sources and writes one line
   per change to wire.json, which GitHub Pages serves to the Data Wire page. It reads:
     1. Tokens created and destroyed on each EVM chain read for USDC, PYUSD and RLUSD, from the issuer contract's
        Transfer events from and to the zero address, over the blocks since the previous pulse (tools/stables.mjs readers).
     2. Supply on the other chains read (USD₮ on every chain, and USDC/PYUSD/RLUSD off the EVM chains), against the
        previous pulse.
     3. Tether's own per-chain file: a new update time.
     4. SEC EDGAR filing lists for the followed filers: a new filing of a followed form.
   A line is written only when the change is at least FLOW_MIN tokens (flows and supply) or is a new file or filing.
   The first run sets the starting point and writes no lines. The file is written only when there is something new, so
   a quiet half-hour leaves no commit; the next run then covers the longer window. Market context, never filed as a
   record or a disclosure: anything filed still goes through the founder's approval. Keys only from the environment
   (ISSUANCE_RPCS). Node 20, no dependencies. PULSE_NOW: tests only. */
import fs from 'node:fs';
process.env.STB_IMPORT = '1';
const S = await import('./stables.mjs');
const OUT = 'wire.json', KEEP_DAYS = 30, KEEP_MAX = 3000, FLOW_MIN = 1_000_000, NOW = process.env.PULSE_NOW ? Date.parse(process.env.PULSE_NOW) : Date.now();
const iso = t => new Date(t).toISOString().replace(/\.\d+Z$/, 'Z');
/* SEC asks automated readers to name a contact e-mail in the User-Agent; without one EDGAR refuses the request (r386). */
const SEC_UA = { 'user-agent': 'CRYPTO STATEMENTS aasiimwe@hotmail.com', accept: 'application/json' };
/* followed filers: the forms whose arrival is a line on the Wire */
const SEC = [
  { cik: 1050446, name: 'Strategy', forms: ['8-K', '10-Q', '10-K'] },
  { cik: 1704268, name: 'Mubadala Investment Co PJSC', forms: ['13F-HR', '13F-HR/A'] },
  { cik: 1814011, name: 'Abu Dhabi Investment Council Co P.J.S.C', forms: ['13F-HR', '13F-HR/A'] },
  { cik: 1786958, name: 'Franklin Templeton Trust (FOBXX)', forms: ['N-MFP3'] }];
const NAMES = { usdc: 'USDC', usdt: 'USDT', pyusd: 'PYUSD', rlusd: 'RLUSD' };
const FLOW_COINS = ['usdc', 'pyusd', 'rlusd'];

async function flows(c, from, st) {           // created/destroyed on one EVM chain since block `from`
  for (const rpc of c.rpcs || []) {
    let head = null;
    try { head = parseInt(await S.rpcCall(rpc, 'eth_blockNumber', []), 16); const a = from == null ? head : from + 1;
      if (a > head) return { head, m: 0n, b: 0n, nm: 0, nb: 0, a, z: head, host: new URL(rpc).host };
      const s0 = { calls: 0 }, m = await S.sumLogs(rpc, c.addr, [S.TRANSFER, S.ZERO32], a, head, s0), b = await S.sumLogs(rpc, c.addr, [S.TRANSFER, null, S.ZERO32], a, head, s0);
      return { head, m: m.v, b: b.v, nm: m.n, nb: b.n, a, z: head, host: new URL(rpc).host };
    } catch (e) { console.error(c.k, 'pulse flows', rpc.replace(/\/\/([^/]+).*/, '//$1'), e.message);
      /* a window too long to read within the call budget (after missed runs) is skipped, said in the log, and the next
         pulse starts from the head, so a chain never stays stuck on one old block */
      if (/call budget/.test(e.message) && head != null) return { head, skip: true, z: head }; }
  }
  return null;
}
async function main() {
  let prev = null; if (fs.existsSync(OUT)) { try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { console.error(OUT + ' does not parse; left untouched.'); return; } }
  const first = !prev, state = (prev && prev.state) || { blk: {}, sup: {}, tether: null, sec: {} }, events = (prev && prev.events) || [], add = [];
  const decOf = {}; try { const sj = JSON.parse(fs.readFileSync('stables.json', 'utf8')); for (const [id, o] of Object.entries(sj.coins || {})) for (const [k, h] of Object.entries(o.chains || {})) decOf[id + ':' + k] = h.decimals; } catch (e) {}
  for (const [id, f] of Object.entries(S.COINS)) for (const c of f.chains) {
    const key = id + ':' + c.k;
    if (c.kind === 'evm' && FLOW_COINS.includes(id)) {
      const dec = decOf[key]; if (dec == null) continue;
      const r = await flows(c, state.blk[key] ?? null, state); if (!r) continue;
      const fresh = state.blk[key] == null; state.blk[key] = r.z;
      if (fresh || first || r.skip) continue;
      const m = S.units(r.m, dec), b = S.units(r.b, dec);
      if (m >= FLOW_MIN || b >= FLOW_MIN) add.push({ t: iso(NOW), kind: 'flow', coin: NAMES[id], chain: c.k, created: Math.round(m * 100) / 100, destroyed: Math.round(b * 100) / 100, events: [r.nm, r.nb], blocks: [r.a, r.z], src: r.host, by: 'pulse', what: NAMES[id] + ' on ' + c.k + ': created and destroyed by the issuer contract since the previous pulse' });
      continue; }
    let v = null, host = null; try { [v, host] = await S.supply(c); } catch (e) {} if (v == null || !isFinite(v)) continue;
    const was = state.sup[key]; state.sup[key] = Math.round(v * 100) / 100;
    if (first || was == null) continue;
    const d = v - was; if (Math.abs(d) >= FLOW_MIN) add.push({ t: iso(NOW), kind: 'supply', coin: NAMES[id], chain: c.k, from: was, to: Math.round(v * 100) / 100, change: Math.round(d * 100) / 100, src: host, by: 'pulse', what: NAMES[id] + ' on ' + c.k + ': contract total against the previous pulse' });
  }
  try { const j = await S.get(S.TETHER_FILE), u = j && j.data && j.data.usdt; if (u && u.id) { const at = iso(+u.id * 1000);
      if (state.tether && state.tether !== at && !first) add.push({ t: iso(NOW), kind: 'issuer-file', coin: 'USDT', what: 'Tether updated its per-chain figures', from: state.tether, to: at, src: new URL(S.TETHER_FILE).host, link: 'https://tether.to/en/transparency/?tab=usdt', by: 'pulse' });
      state.tether = at; } } catch (e) { console.error('pulse tether', e.message); }
  for (const f of SEC) {
    try { const r = await fetch('https://data.sec.gov/submissions/CIK' + String(f.cik).padStart(10, '0') + '.json', { headers: SEC_UA, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json(), R = j.filings && j.filings.recent; if (!R) continue;
      const seen = new Set(state.sec[f.cik] || []), hits = [];
      for (let i = 0; i < R.accessionNumber.length && i < 40; i++) if (f.forms.includes(R.form[i]) && !seen.has(R.accessionNumber[i])) hits.push(i);
      if (state.sec[f.cik] && !first) for (const i of hits) { const acc = R.accessionNumber[i];
        add.push({ t: iso(NOW), kind: 'filing', who: f.name, form: R.form[i], filed: R.filingDate[i], accepted: R.acceptanceDateTime ? R.acceptanceDateTime[i] : null, period: R.reportDate[i] || null, accession: acc, src: 'data.sec.gov', link: 'https://www.sec.gov/Archives/edgar/data/' + f.cik + '/' + acc.replace(/-/g, '') + '/', by: 'pulse', what: f.name + ' filed ' + R.form[i] + ' on EDGAR' }); }
      state.sec[f.cik] = R.accessionNumber.slice(0, 40).filter((a, i) => f.forms.includes(R.form[i]));
    } catch (e) { console.error('pulse sec', f.cik, e.message); }
    await new Promise(r => setTimeout(r, 300));
  }
  if (!first && !add.length) { console.log('pulse: nothing new; ' + OUT + ' left as it is'); return; }
  const cut = NOW - KEEP_DAYS * 86400000, all = add.concat(events).filter(e => Date.parse(e.t) >= cut).slice(0, KEEP_MAX);
  fs.writeFileSync(OUT, JSON.stringify({ about: 'The Data Wire: one line per change, newest first, written every 30 minutes by tools/pulse.mjs from the issuers\' own contracts and files and from SEC EDGAR\'s filing lists. flow: tokens created and destroyed by the issuer contract since the previous pulse (at least ' + FLOW_MIN.toLocaleString('en-US') + ' tokens either way); supply: a contract total that moved by at least that much; issuer-file: a new update time on an issuer\'s own file; filing: a new filing of a followed form. Market context, never filed: figures filed on the platform go through the founder\'s approval. state holds the starting points of the next pulse.', updated: iso(NOW), state, events: all }) + '\n');
  console.log('pulse: ' + add.length + ' new line(s)' + (first ? ' (first run: starting point set)' : ''));
}
main().catch(e => { console.error(e); process.exitCode = 0; });
