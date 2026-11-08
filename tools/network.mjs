/* network.mjs — CRYPTO STATEMENTS · the bitcoin network itself (r302, net-v1)

   Market context for the Market Structure panel, kept apart from the record. Run daily by the workflow.
   Reads mempool.space's public API, which reads the bitcoin chain:

     difficulty   each retarget (height, time, difficulty, adjustment): a protocol fact, set by the chain
     hash rate    mempool.space's daily average, which it computes from difficulty and block times: an
                  estimate by construction (no one can observe hash rate directly), labelled as such
     fees         fees paid in the last 144 blocks (about a day) and their share of miner revenue, read once a
                  day from /api/v1/mining/reward-stats/144 (the chain's own sums); and the average fees per
                  block by UTC day from /api/v1/mining/blocks/fees/3m

   Rows held are kept and not overwritten; a day not read stays missing. Ether staked is not read: the public
   explorer API that gave it now requires a key, and the beacon chain's own API has no keyless total. No
   dependencies (Node 20). NET_NOW: tests only. */
import fs from 'node:fs';
const OUT = 'network.json', KEEP = 1100, NOW = process.env.NET_NOW ? Date.parse(process.env.NET_NOW) : Date.now();
const iso = t => new Date(t).toISOString().slice(0, 10), today = iso(NOW), API = 'https://mempool.space/api/v1/mining/';
async function get(path) { const r = await fetch(API + path, { signal: AbortSignal.timeout(30000), headers: { accept: 'application/json', 'user-agent': 'cryptostatements-issuance (GitHub Actions; daily public-data copy)' } });
  if (!r.ok) throw new Error('mempool.space ' + path + ' HTTP ' + r.status); return r.json(); }
function merge(held, got, key = r => r[0]) { const have = new Set((held || []).map(key)), out = (held || []).slice(); let n = 0;
  for (const r of got) if (!have.has(key(r))) { out.push(r); have.add(key(r)); n++; } out.sort((a, b) => String(key(a)).localeCompare(String(key(b)))); return [out.slice(-KEEP), n]; }
async function main() {
  let prev = null; if (fs.existsSync(OUT)) { try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { console.error(OUT + ' does not parse; left untouched.'); return; } }
  const D = Object.assign({ hashrate: [], difficulty: [], feesPerBlock: [], fees144: [] }, prev || {}); let ok = 0;
  try { const j = await get(D.hashrate.length ? 'hashrate/3m' : 'hashrate/3y');
    const [h, n1] = merge(D.hashrate, (j.hashrates || []).map(x => [iso(x.timestamp * 1000), Math.round(x.avgHashrate / 1e15) / 1e3]).filter(r => r[0] < today)); D.hashrate = h; // EH/s
    const [d, n2] = merge(D.difficulty, (j.difficulty || []).map(x => [x.height, iso(x.time * 1000), x.difficulty, Math.round((x.adjustment - 1) * 10000) / 100]), r => String(r[0]).padStart(8, '0')); D.difficulty = d;
    ok++; console.log('hash rate', h.length, 'days,', n1, 'new; difficulty', d.length, 'retargets,', n2, 'new'); } catch (e) { console.error('hash rate / difficulty', e.message); }
  try { const j = await get(D.feesPerBlock.length ? 'blocks/fees/3m' : 'blocks/fees/1y'), by = {};
    for (const x of j || []) { const d = iso(x.timestamp * 1000); if (d >= today) continue; (by[d] = by[d] || []).push(x.avgFees); }
    const [f, n] = merge(D.feesPerBlock, Object.entries(by).map(([d, v]) => [d, Math.round(v.reduce((a, b) => a + b, 0) / v.length)])); D.feesPerBlock = f; // sats per block
    ok++; console.log('fees per block', f.length, 'days,', n, 'new'); } catch (e) { console.error('fees per block', e.message); }
  if (!D.fees144.some(r => r.date === today)) {
    try { const j = await get('reward-stats/144'), fee = +j.totalFee, rew = +j.totalReward;
      D.fees144.push({ date: today, read: new Date(NOW).toISOString(), startBlock: j.startBlock, endBlock: j.endBlock, fees_btc: fee / 1e8, reward_btc: rew / 1e8, fee_share_pct: rew ? Math.round(10000 * fee / rew) / 100 : null, tx: +j.totalTx });
      D.fees144 = D.fees144.slice(-KEEP); ok++; console.log('fees, last 144 blocks', fee / 1e8, 'BTC'); } catch (e) { console.error('reward stats', e.message); }
  }
  if (!ok) { console.error('nothing read; nothing written'); return; }
  D.about = 'The bitcoin network, from mempool.space (which reads the chain). difficulty: [height, date, difficulty, adjustment %], a protocol fact. hashrate: [date, EH/s], mempool.space\'s daily average computed from difficulty and block times, an estimate by construction. feesPerBlock: [date, average sats per block]. fees144: one reading a day of fees in the last 144 blocks and their share of miner revenue. Ether staked is not read (no keyless chain source). Written by tools/network.mjs.';
  D.method = 'net-v1'; D.updated = new Date(NOW).toISOString();
  fs.writeFileSync(OUT, JSON.stringify(D) + '\n'); console.log('network.json written');
}
main().catch(e => { console.error(e); process.exitCode = 0; });
