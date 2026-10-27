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
const PUBLIC = ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed1.defibit.io'];
/* AP44 (r211): the keyed node from the BSC_RPCS secret first, then the public nodes, so a keyed-node
   outage falls back instead of failing. The key sits in the address path; only host names are logged
   or stored. */
/* r231: the secret may hold the full endpoint (https://bsc-mainnet.nodereal.io/v1/<key>) or the NodeReal API key
   alone; a bare key is turned into the NodeReal BSC mainnet endpoint. */
const KEYED = (process.env.BSC_RPCS || '').split(',').map(x => x.trim()).filter(Boolean)
  .map(x => /^https?:\/\//i.test(x) ? x : (/^[A-Za-z0-9_-]{16,}$/.test(x) ? 'https://bsc-mainnet.nodereal.io/v1/' + x : x));
const safe = m => KEYED.reduce((t, k) => t.split(k).join((() => { try { return new URL(k).host; } catch (e) { return '[keyed node]'; } })()), String(m));
const NODES = [...new Set(KEYED.concat(PUBLIC))];
const isPublic = url => PUBLIC.includes(url);
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
/* AP44 (r211): one UTC day of mints and burns for every published token, with an exact check.
   Blocks: the first after 00:00:00 and the last at or before 23:59:59. Logs in groups of 10 addresses
   (some nodes refuse more) and windows that halve on refusal. Check: totalSupply at the day's last block
   minus totalSupply just before its first block must equal minted minus burned, token by token; it needs
   a node that answers for past blocks, and says so when none does. */
async function dayFlows(url, toks, dayStart, latest) {
  const b0 = (await blockAtOrBefore(url, dayStart - 1, latest)) + 1, b1 = await blockAtOrBefore(url, dayStart + 86399, latest);
  const addr = toks.map(([, t]) => t.contract.toLowerCase()), acc = {};
  toks.forEach(([k]) => { acc[k] = { minted: 0n, burned: 0n, mints: 0, burns: 0 }; });
  const groups = []; for (let i = 0; i < addr.length; i += 10) groups.push(addr.slice(i, i + 10));
  let a = b0, step = 5000;
  while (a <= b1) {
    const b = Math.min(b1, a + step - 1);
    try {
      const got = [];
      for (const g of groups) for (const topics of [[TRANSFER, ZERO], [TRANSFER, null, ZERO]]) {
        const logs = await call(url, 'eth_getLogs', [{ address: g, fromBlock: hex(a), toBlock: hex(b), topics }]);
        for (const l of logs) got.push([l, topics[1] === ZERO]);
        await sleep(120);
      }
      for (const [l, mint] of got) { const i = addr.indexOf(String(l.address).toLowerCase()); if (i < 0) continue; const x = acc[toks[i][0]], v = BigInt(l.data);
        if (mint) { x.minted += v; x.mints++; } else { x.burned += v; x.burns++; } }
      a = b + 1;
    } catch (e) { if (step > 500) { step = Math.max(500, Math.floor(step / 2)); continue; } throw e; }
  }
  const rows = {}, check = { method: 'totalSupply at the last block minus totalSupply before the first block, against minted minus burned', matched: 0, of: 0, diffs: {} };
  let checkable = true;
  for (const [k, t] of toks) {
    const x = acc[k], net = x.minted - x.burned;
    if (x.mints || x.burns) rows[k] = { minted: scale(x.minted, t.decimals), burned: scale(x.burned, t.decimals), mints: x.mints, burns: x.burns, net: scale(net < 0n ? -net : net, t.decimals) * (net < 0n ? -1 : 1) };
    if (!checkable) continue;
    try {
      const s1 = BigInt(await call(url, 'eth_call', [{ to: t.contract, data: '0x18160ddd' }, hex(b1)]));
      const s0 = BigInt(await call(url, 'eth_call', [{ to: t.contract, data: '0x18160ddd' }, hex(b0 - 1)]));
      check.of++; if (s1 - s0 === net) check.matched++; else check.diffs[k] = scale(((s1 - s0) - net) < 0n ? -((s1 - s0) - net) : (s1 - s0) - net, t.decimals);
      await sleep(80);
    } catch (e) { checkable = false; check.note = 'not checked: the node did not answer for past blocks (' + e.message.slice(0, 80) + ')'; }
  }
  return { date: new Date(dayStart * 1000).toISOString().slice(0, 10), fromBlock: b0, toBlock: b1, node: new URL(url).host, tokens: toks.length, rows, check };
}
/* AP44 (r211): the same supply read from a public node at the same block, so no figure rests on one provider. */
async function crossCheck(toks, block, raw, primary) {
  for (const url of PUBLIC) { if (url === primary) continue;
    try { let matched = 0; const diffs = {};
      for (const [k, t] of toks) { const v = BigInt(await call(url, 'eth_call', [{ to: t.contract, data: '0x18160ddd' }, hex(block)])); if (v === raw[k]) matched++; else diffs[k] = scale(v > raw[k] ? v - raw[k] : raw[k] - v, t.decimals); await sleep(80); }
      return { node: new URL(url).host, block, matched, of: toks.length, diffs };
    } catch (e) { /* try the next public node */ }
  }
  return { block, note: 'no public node answered for this block' };
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
      if (!doc.readings.some(r => r.date === date)) {
        const rd = { date, block: latest, time: new Date(lt * 1000).toISOString().replace('.000Z', 'Z'), node: new URL(url).host, values };
        if (!isPublic(url)) { try { rd.crosscheck = await crossCheck(toks, latest, raw, url); } catch (e) { rd.crosscheck = { note: 'cross-check failed' }; } }
        doc.readings.push(rd);
      }
      /* AP44 (r211): full-day flows for the previous UTC day, and up to 7 days back on the first run or 3 after a gap */
      doc.flows = doc.flows || [];
      const today0 = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
      const back = doc.flows.length ? 3 : 7;
      for (let d = back; d >= 1; d--) {
        const ds = today0 - d * 86400, dd = new Date(ds * 1000).toISOString().slice(0, 10);
        if (doc.flows.some(f => f.date === dd)) continue;
        try { const f = await dayFlows(url, toks, ds, latest); doc.flows.push(f); console.log('flows', dd, Object.keys(f.rows).length, 'tickers active', 'check', f.check.matched + '/' + f.check.of, f.check.note || ''); }
        catch (e) { console.error('   flows', dd, 'not read:', safe(e.message)); if (isPublic(url)) break; }
      }
      doc.flows.sort((x, y) => x.date.localeCompare(y.date));
      /* the Friday snapshot, if not yet taken and still recent enough to rebuild from logs (3 days) */
      const fri = lastFriday(now), asOf = fri.toISOString().replace('.000Z', 'Z');
      if (!doc.snapshots.some(s => s.asOf === asOf) && now - fri < 3 * 864e5) {
        const b = await blockAtOrBefore(url, Math.floor(fri / 1000), latest), sv = {};
        for (const [k, t] of toks) sv[k] = scale(raw[k] - await netMint(url, t.contract, b, latest), t.decimals);
        doc.snapshots.push({ asOf, block: b, method: 'supply at the latest block minus mints plus burns since the as-of block', node: new URL(url).host, values: sv });
        console.log('snapshot', asOf, 'block', b);
      }
      break;
    } catch (e) { last = e; console.error('  ', isPublic(url) ? '' : 'keyed node ' + (()=>{ try { return new URL(url).host; } catch (x) { return '(address not valid)'; } })() + ' failed:', safe(e.message)); }
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
console.log('nodes:', NODES.map(u => { try { return new URL(u).host; } catch (e) { return '(address not valid)'; } }).join(', '));
main().catch(e => { console.error('bstocks failed:', safe(e.message)); process.exit(1); });
