/* chain.mjs — CRYPTO STATEMENTS · bitcoin issued, from the chain's own height (r294)

   Market context, kept apart from the record. Run daily by the workflow. Reads the height of the latest
   bitcoin block from two public block explorers (mempool.space first, blockstream.info as the stated
   fallback; both report the chain itself) and computes the bitcoin issued so far exactly from the protocol's
   schedule: 50 BTC a block, halving every 210,000 blocks, in whole satoshis as the protocol rounds. The
   count includes the genesis block's reward, which can never be spent, as every published supply figure does.
   One row per UTC day is appended to chain.json; a day held is not overwritten. Lost coins are not and
   cannot be known, so the figure is bitcoin issued, not bitcoin in circulation. No dependencies (Node 20). */
import fs from 'node:fs';
const OUT = 'chain.json', NOW = process.env.CHAIN_NOW ? Date.parse(process.env.CHAIN_NOW) : Date.now();
const SRC = [['mempool.space', 'https://mempool.space/api/blocks/tip/height'], ['blockstream.info', 'https://blockstream.info/api/blocks/tip/height']];
export function issuedSats(height) { // blocks 0..height inclusive
  let total = 0n, subsidy = 5000000000n, left = BigInt(height) + 1n;
  while (left > 0n && subsidy > 0n) { const n = left < 210000n ? left : 210000n; total += n * subsidy; left -= n; subsidy /= 2n; }
  return total;
}
async function height() {
  for (const [host, url] of SRC) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('HTTP ' + r.status);
      const h = +(await r.text()).trim(); if (!Number.isInteger(h) || h < 900000) throw new Error('implausible height ' + h); return [h, host]; }
    catch (e) { console.error(host, e.message); }
  }
  return [null, null];
}
async function main() {
  let prev = null; if (fs.existsSync(OUT)) { try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { console.error(OUT + ' does not parse; left untouched.'); return; } }
  const rows = (prev && prev.days) || [], day = new Date(NOW).toISOString().slice(0, 10);
  if (rows.some(r => r.date === day)) { console.log('chain.json: ' + day + ' already held'); return; }
  const [h, host] = await height(); if (h == null) { console.error('no height read; nothing written'); return; }
  const sats = issuedSats(h), btc = Number(sats / 100000000n) + Number(sats % 100000000n) / 1e8;
  rows.push({ date: day, read: new Date(NOW).toISOString(), height: h, issued_btc: btc, src: host });
  fs.writeFileSync(OUT, JSON.stringify({ about: 'Bitcoin issued, computed exactly from the latest block height and the protocol schedule (includes the unspendable genesis reward; lost coins cannot be known, so this is issued, not circulating). Height from mempool.space, blockstream.info as fallback. One row per UTC day, never overwritten. Written by tools/chain.mjs.', updated: new Date(NOW).toISOString(), days: rows }) + '\n');
  console.log('chain.json:', day, 'height', h, 'issued', btc, 'BTC from', host);
}
if (process.argv[1] && process.argv[1].endsWith('chain.mjs')) main().catch(e => { console.error(e); process.exitCode = 0; });
