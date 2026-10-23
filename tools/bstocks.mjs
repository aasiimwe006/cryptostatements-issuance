/* bstocks.mjs — CRYPTO STATEMENTS · bStocks: certificates disclosed vs tokens on chain (r185, AP39)

   bStocks are certificates issued by BTech Holdings Ltd (ADGM), recorded on BNB Chain, each giving a
   1:1 entitlement to a US share held by the custodian (Alpaca Securities LLC) in the issuer's
   segregated account. Every week BTech Services files the number of certificates outstanding per
   ticker on ADGM's public-disclosure page, as of Friday 23:59:59 UTC.

   This script, run daily by the workflow:
     1. reads totalSupply() on BNB Chain for every token whose address the issuer group has published
        (bstocks.json → tokens; an address is used only with its source announcement);
     2. on the run after each Friday, works out the supply AT Friday 23:59:59 UTC exactly: it finds the
        last block at or before that second and subtracts the mints and burns (Transfer events from or
        to the zero address) made since, so no archive node is needed;
     3. compares that snapshot with the disclosure for the same as-of time, when the disclosure has been
        added to bstocks.json, ticker by ticker.
   What it checks: the issuer's two numbers against each other (certificates disclosed vs tokens on
   chain). What it cannot check: the shares at the custodian. No periodic independent attestation of
   the custodied shares is published; the output says so.
   No dependencies (Node 20). Nodes: secret BSC_RPCS first, then public BNB Chain nodes.          */
import fs from 'node:fs';
const P = 'bstocks.json';
const NODES = ((process.env.BSC_RPCS || '').trim() ? process.env.BSC_RPCS : 'https://bsc-rpc.publicnode.com,https://bsc-dataseed.bnbchain.org,https://bsc-dataseed1.defibit.io').split(',').map(x => x.trim()).filter(Boolean);
const ZERO = '0x' + '0'.repeat(64), TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(new URL(url).host + ' HTTP ' + r.status);
  const j = await r.json(); if (j.error) throw new Error(new URL(url).host + ' ' + j.error.message); return j.result;
}
const scale = (raw, dec) => { const v = BigInt(raw), d = 10n ** BigInt(dec); return Number(v / d) + Number(v % d) / Number(d); };
const hex = n => '0x' + n.toString(16);
async function blockTime(url, n) { const b = await call(url, 'eth_getBlockByNumber', [hex(n), false]); return parseInt(b.timestamp, 16); }
/* the last block whose timestamp is at or before t (seconds) */
async function blockAtOrBefore(url, t, latest) {
  let hi = latest, lo = Math.max(0, latest - 400000);
  while (await blockTime(url, lo) > t) { hi = lo; lo = Math.max(0, lo - 400000); if (lo === 0) break; }
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (await blockTime(url, mid) <= t) lo = mid; else hi = mid; }
  return lo;
}
/* net mint (mints minus burns), in raw units, in blocks (from, to] */
async function netMint(url, contract, from, to) {
  let net = 0n;
  for (let a = from + 1; a <= to; a += 2000) {
    const b = Math.min(to, a + 1999);
    for (const topics of [[TRANSFER, ZERO], [TRANSFER, null, ZERO]]) {
      const logs = await call(url, 'eth_getLogs', [{ address: contract, fromBlock: hex(a), toBlock: hex(b), topics }]);
      for (const l of logs) { const v = BigInt(l.data); net += topics[1] === ZERO ? v : -v; }
      await sleep(150);
    }
  }
  return net;
}
function lastFriday(now) { /* the most recent Friday 23:59:59 UTC strictly before now */
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
  while (d.getUTCDay() !== 5 || d >= now) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}
async function main() {
  const doc = JSON.parse(fs.readFileSync(P, 'utf8'));
  const toks = Object.entries(doc.tokens).filter(([, t]) => t.contract);
  const now = process.env.BSTOCKS_NOW ? new Date(process.env.BSTOCKS_NOW) : new Date(), date = now.toISOString().slice(0, 10);   /* BSTOCKS_NOW: tests only */
  doc.readings = doc.readings || []; doc.snapshots = doc.snapshots || []; doc.reconciliations = doc.reconciliations || [];
  let last = null;
  for (const url of NODES) {
    try {
      const latest = parseInt(await call(url, 'eth_blockNumber', []), 16), lt = await blockTime(url, latest);
      const raw = {}, values = {};
      for (const [k, t] of toks) {
        if (t.decimals == null) t.decimals = Number(BigInt(await call(url, 'eth_call', [{ to: t.contract, data: '0x313ce567' }, hex(latest)])));
        raw[k] = BigInt(await call(url, 'eth_call', [{ to: t.contract, data: '0x18160ddd' }, hex(latest)]));
        values[k] = scale(raw[k], t.decimals); await sleep(150);
      }
      if (!doc.readings.some(r => r.date === date)) doc.readings.push({ date, block: latest, time: new Date(lt * 1000).toISOString().replace('.000Z', 'Z'), node: new URL(url).host, values });
      /* the Friday snapshot, if not yet taken and still recent enough to rebuild from logs (3 days) */
      const fri = lastFriday(now), asOf = fri.toISOString().replace('.000Z', 'Z');
      if (!doc.snapshots.some(s => s.asOf === asOf) && now - fri < 3 * 864e5) {
        const b = await blockAtOrBefore(url, Math.floor(fri / 1000), latest), sv = {};
        for (const [k, t] of toks) sv[k] = scale(raw[k] - await netMint(url, t.contract, b, latest), t.decimals);
        doc.snapshots.push({ asOf, block: b, method: 'supply at the latest block minus mints plus burns since the as-of block', node: new URL(url).host, values: sv });
        console.log('snapshot', asOf, 'block', b);
      }
      break;
    } catch (e) { last = e; console.error('  ', e.message); }
  }
  if (last && !doc.readings.some(r => r.date === date)) throw last;
  /* reconcile every disclosure that has a snapshot at the same second and no reconciliation yet */
  for (const d of doc.disclosures) {
    const s = doc.snapshots.find(x => x.asOf === d.asOf);
    if (!s || doc.reconciliations.some(r => r.asOf === d.asOf)) continue;
    const rows = {};
    for (const k of Object.keys(s.values)) { const dis = d.rows[k] ? d.rows[k].outstanding : null; rows[k] = { disclosed: dis, onchain: s.values[k], difference: dis == null ? null : Number((s.values[k] - dis).toFixed(8)) }; }
    doc.reconciliations.push({ asOf: d.asOf, block: s.block, disclosure: d.src, rows, note: 'Certificates disclosed by the issuer vs tokens on BNB Chain at the same second. The shares held at the custodian are not checked: no periodic independent attestation of them is published.' });
    console.log('reconciled', d.asOf);
  }
  doc.updated = now.toISOString();
  fs.writeFileSync(P, JSON.stringify(doc, null, 1) + '\n');
}
main().catch(e => { console.error('bstocks failed:', e.message); process.exit(1); });
