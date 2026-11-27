/* tkfunds.mjs — CRYPTO STATEMENTS · tokenised funds' shares outstanding, read from each chain (r363, AP98 phase 2)

   The same method as buidl.mjs, for further funds. Reads the supply of each fund token on each chain whose address
   the issuer itself publishes, once a UTC day, and keeps one row per day per chain (a day held is not overwritten).
   Market context, kept apart from the record. Value is never computed here.

   Addresses, each from the issuer's own page, read in the founder's browser on 27 Nov 2026 and approved by the founder:
     J.P. Morgan Asset Management press releases
       MONY  Ethereum 0x6a7c6aa2b8b8a6A891dE552bDEFFa87c3F53bD46   (15 Dec 2025 release)
       JLTXX Ethereum 0x09864f52B035AE22eE739dFa5c748fA080D07bD8   (13 May 2026 release)
       MONY  Solana   EToDtBM2knZ8N1BHyUq2Riq5ngWTcoD3k6qpsgf7CKYY (22 Oct 2026 release)
       JLTXX Solana   J4cTuCH6frt4AnEmKfMS2k8hsUf7K94PV62sjUJno8Cz (22 Oct 2026 release)
     Franklin Templeton, "Deployed Contracts" (digitalassets.franklintempleton.com/benji/benji-contracts/):
       the "BENJI (<chain>)" Fund Token on Stellar, Polygon, Arbitrum, Avalanche, Aptos, Ethereum, Base and Solana.
       iBENJI, gBENJI, sgBENJI and grBENJI on the same page are other tokens and are not read.
   On-chain checks, 27 Nov 2026: the EVM contracts answer symbol() MONY, JLTXX and BENJI; decimals are read, never assumed.

   Stellar: the asset's balances from Horizon (authorized + authorized_to_maintain_liabilities + unauthorized, plus
   claimable balances, liquidity pools and contracts), as Horizon reports them. Aptos: 0x1::fungible_asset::supply
   over the published metadata object. Solana: getTokenSupply. A chain not read today is logged and left missing.
   No dependencies (Node 20). TKF_NOW: tests only. */
import fs from 'node:fs';
const OUT = 'tkfunds.json', KEEP = 1100, NOW = process.env.TKF_NOW ? Date.parse(process.env.TKF_NOW) : Date.now(), today = new Date(NOW).toISOString().slice(0, 10);
const list = (env, pub) => [...(process.env[env] || '').split(',').map(x => x.trim()).filter(Boolean), ...pub];
const ETH = list('ISSUANCE_RPCS', ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']), SOL = ['https://api.mainnet-beta.solana.com'];
const JPM = 'https://am.jpmorgan.com/us/en/asset-management/institutional/about-us/media/press-releases/';
const FT = 'https://digitalassets.franklintempleton.com/benji/benji-contracts/';
const FUNDS = {
  mony: { name: 'My OnChain Net Yield Fund (MONY)', issuer: 'J.P. Morgan Asset Management', chains: [
    { k: 'ethereum', addr: '0x6a7c6aa2b8b8a6A891dE552bDEFFa87c3F53bD46', kind: 'evm', rpcs: ETH, src: JPM + 'jp-morgan-asset-management-launches-its-first-tokenized-money-market-fund/' },
    { k: 'solana', addr: 'EToDtBM2knZ8N1BHyUq2Riq5ngWTcoD3k6qpsgf7CKYY', kind: 'solana', rpcs: SOL, src: JPM + 'jp-morgan-asset-management-expands-access-to-tokenized-money-market-funds-solana/' }] },
  jltxx: { name: 'JPMorgan OnChain Liquidity-Token Money Market Fund (JLTXX)', issuer: 'J.P. Morgan Asset Management', chains: [
    { k: 'ethereum', addr: '0x09864f52B035AE22eE739dFa5c748fA080D07bD8', kind: 'evm', rpcs: ETH, src: JPM + 'jp-morgan-asset-management-launches-second-tokenized-fund-on-ethereum/' },
    { k: 'solana', addr: 'J4cTuCH6frt4AnEmKfMS2k8hsUf7K94PV62sjUJno8Cz', kind: 'solana', rpcs: SOL, src: JPM + 'jp-morgan-asset-management-expands-access-to-tokenized-money-market-funds-solana/' }] },
  benji: { name: 'Franklin OnChain U.S. Government Money Fund (BENJI)', issuer: 'Franklin Templeton', chains: [
    { k: 'stellar', addr: 'BENJI:GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5', kind: 'stellar', rpcs: ['https://horizon.stellar.org'], src: FT },
    { k: 'polygon', addr: '0x408A634B8a8f0dE729B48574a3a7Ec3fE820B00A', kind: 'evm', rpcs: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'], src: FT },
    { k: 'arbitrum', addr: '0xB9e4765BCE2609bC1949592059B17Ea72fEe6C6A', kind: 'evm', rpcs: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'], src: FT },
    { k: 'avalanche', addr: '0xE08b4c1005603427420e64252a8b120cacE4D122', kind: 'evm', rpcs: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com'], src: FT },
    { k: 'aptos', addr: '0x100589a94461253007bb31ab4511953f37aa8967e2b22077f740e492f3a1900f', kind: 'aptos', rpcs: ['https://fullnode.mainnet.aptoslabs.com/v1'], src: FT },
    { k: 'ethereum', addr: '0x3DDc84940Ab509C11B20B76B466933f40b750dc9', kind: 'evm', rpcs: ETH, src: FT },
    { k: 'base', addr: '0x60CfC2b186a4CF647486e42c42B11cC6D571d1E4', kind: 'evm', rpcs: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'], src: FT },
    { k: 'solana', addr: '5Tu84fKBpe9vfXeotjvfvWdWbAjy3hqsExvuHgFqFxA1', kind: 'solana', rpcs: SOL, src: FT }] } };
const UA = { 'user-agent': 'cryptostatements-issuance (GitHub Actions; daily public-data copy)' };
async function post(url, body) { const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/json', ...UA }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(new URL(url).host + ' HTTP ' + r.status); return r.json(); }
async function get(url) { const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: UA }); if (!r.ok) throw new Error(new URL(url).host + ' HTTP ' + r.status); return r.json(); }
const units = (raw, d) => Number(BigInt(raw)) / 10 ** d;
async function supply(c) {
  for (const rpc of c.rpcs) {
    try {
      if (c.kind === 'evm') { const call = data => post(rpc, { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: c.addr, data }, 'latest'] }).then(j => { if (!j.result || j.result === '0x') throw new Error('no result ' + JSON.stringify(j.error || '')); return j.result; });
        const d = parseInt(await call('0x313ce567'), 16); return [units(await call('0x18160ddd'), d), new URL(rpc).host, d]; }
      if (c.kind === 'aptos') { const v = await post(rpc + '/view', { function: '0x1::fungible_asset::supply', type_arguments: ['0x1::fungible_asset::Metadata'], arguments: [c.addr] });
        const d = await post(rpc + '/view', { function: '0x1::fungible_asset::decimals', type_arguments: ['0x1::fungible_asset::Metadata'], arguments: [c.addr] });
        const s = v && v[0] && v[0].vec && v[0].vec[0]; if (s == null) throw new Error('no supply'); return [units(s, +d[0]), new URL(rpc).host, +d[0]]; }
      if (c.kind === 'solana') { const j = await post(rpc, { jsonrpc: '2.0', id: 1, method: 'getTokenSupply', params: [c.addr] });
        const v = j && j.result && j.result.value; if (!v) throw new Error('no result ' + JSON.stringify(j.error || '')); return [+v.uiAmountString, new URL(rpc).host, v.decimals]; }
      if (c.kind === 'stellar') { const [code, iss] = c.addr.split(':'); const j = await get(rpc + '/assets?asset_code=' + code + '&asset_issuer=' + iss);
        const x = j._embedded && j._embedded.records && j._embedded.records[0]; if (!x) throw new Error('asset not found'); const b = x.balances || {};
        const t = ['authorized', 'authorized_to_maintain_liabilities', 'unauthorized'].reduce((a, k) => a + (+b[k] || 0), 0) + (+x.claimable_balances_amount || 0) + (+x.liquidity_pools_amount || 0) + (+x.contracts_amount || 0);
        return [t, new URL(rpc).host, 7]; }
    } catch (e) { console.error(c.k, rpc.replace(/\/\/([^/]+).*/, '//$1'), e.message); }
  }
  return [null, null, null];
}
async function main() {
  let prev = null; if (fs.existsSync(OUT)) { try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { console.error(OUT + ' does not parse; left untouched.'); return; } }
  const F = (prev && prev.funds) || {}; let ok = 0;
  for (const [id, f] of Object.entries(FUNDS)) {
    const H = (F[id] && F[id].chains) || {};
    for (const c of f.chains) {
      const h = H[c.k] || { rows: [] }; Object.assign(h, { addr: c.addr, src: c.src });
      if (h.rows.some(r => r[0] === today)) { ok++; H[c.k] = h; continue; }
      const [v, host, d] = await supply(c); if (v != null && isFinite(v)) { h.rows.push([today, Math.round(v * 100) / 100, host]); h.rows = h.rows.slice(-KEEP); h.decimals = d; ok++; console.log(id, c.k, v.toLocaleString('en-US'), 'from', host); }
      H[c.k] = h;
    }
    F[id] = { name: f.name, issuer: f.issuer, chains: H };
  }
  if (!ok) { console.error('no chain read; nothing written'); return; }
  fs.writeFileSync(OUT, JSON.stringify({ about: 'Tokenised funds\' shares outstanding by chain, read from each chain once a UTC day (rows: [date, units, node]). Addresses from each issuer\'s own pages (J.P. Morgan Asset Management\'s releases; Franklin Templeton\'s Deployed Contracts page), approved by the founder 27 Nov 2026. Stellar figures are Horizon\'s balances for the asset. Written by tools/tkfunds.mjs.',
    updated: new Date(NOW).toISOString(), funds: F }) + '\n');
  console.log(OUT + ' written');
}
main().catch(e => { console.error(e); process.exitCode = 0; });
