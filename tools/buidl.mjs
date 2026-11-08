/* buidl.mjs — CRYPTO STATEMENTS · BlackRock BUIDL shares outstanding, read from each chain (r305, AP78)

   Market context for the tokenised-funds pillar, kept apart from the record. Run daily by the workflow.
   Reads the total supply of the BUIDL token on each chain whose address the issuer side has published,
   once a UTC day, and keeps one row per day per chain (a day held is not overwritten).

   Addresses: Securitize's own press releases (read in the founder's browser, 9 Nov 2026), except BNB Chain:
     Ethereum, Arbitrum, Avalanche, Optimism, Polygon, Aptos   securitize.io, 13 Nov 2024 release
     Solana                                                   securitize.io, 25 Mar 2025 release
     BNB Chain   0x2d5b…f84f: supplied by the founder; Securitize's 14 Nov 2025 release announces the BNB Chain
                 share class without an address. Confirmed on chain 9 Nov 2026: name "BlackRock USD Institutional
                 Digital Liquidity Fund", symbol BUIDL, 6 decimals, and the same owner() as all six EVM contracts
                 Securitize published (0xe01605f6…b09e). Its basis is stated wherever it is shown.
   Not read: BUIDL-I and any chain without a published address. Value is shares x $1, the stable value per
   token the fund "seeks to offer" (Securitize, 21 Mar 2024), applied on the site, not here.

   Nodes: Ethereum from the ISSUANCE_RPCS variable or public nodes, BNB Chain from the BSC_RPCS secret or public
   nodes, the others from each network's public endpoint; Aptos through its view function; Solana getTokenSupply.
   A chain not read today is logged and left missing. No dependencies (Node 20). BUIDL_NOW: tests only. */
import fs from 'node:fs';
const OUT = 'buidl.json', KEEP = 1100, NOW = process.env.BUIDL_NOW ? Date.parse(process.env.BUIDL_NOW) : Date.now(), today = new Date(NOW).toISOString().slice(0, 10);
const list = (env, pub) => [...(process.env[env] || '').split(',').map(x => x.trim()).filter(Boolean), ...pub];
const SRC24 = 'https://securitize.io/learn/press/blackRock-launches-new-buidl-share-classes-across-multiple-blockchains';
const SRC25 = 'https://securitize.io/learn/press/blackRock-and-securitize-debut-new-buidl-share-class-on-solana-network';
const CHAINS = [
  { k: 'ethereum', addr: '0x7712c34205737192402172409a8F7ccef8aA2AEc', kind: 'evm', rpcs: list('ISSUANCE_RPCS', ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']), basis: 'securitize', src: SRC24 },
  { k: 'arbitrum', addr: '0xA6525Ae43eDCd03dC08E775774dCAbd3bb925872', kind: 'evm', rpcs: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'], basis: 'securitize', src: SRC24 },
  { k: 'avalanche', addr: '0x53FC82f14F009009b440a706e31c9021E1196A2F', kind: 'evm', rpcs: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com'], basis: 'securitize', src: SRC24 },
  { k: 'optimism', addr: '0xa1CDAb15bBA75a80dF4089CaFbA013e376957cF5', kind: 'evm', rpcs: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'], basis: 'securitize', src: SRC24 },
  { k: 'polygon', addr: '0x2893Ef551B6dD69F661Ac00F11D93E5Dc5Dc0e99', kind: 'evm', rpcs: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'], basis: 'securitize', src: SRC24 },
  { k: 'bnb', addr: '0x2d5bdc96d9c8aabbdb38c9a27398513e7e5ef84f', kind: 'evm', rpcs: list('BSC_RPCS', ['https://bsc-dataseed.bnbchain.org', 'https://bsc-rpc.publicnode.com']), basis: 'owner-match', src: 'https://securitize.io/learn/press/BlackRock-BUIDL-Tokenized-by-Securitize-Now-Accepted-on-Binance-and-Launches-on-BNB-Chain' },
  { k: 'aptos', addr: '0x4de5876d8a8e2be7af6af9f3ca94d9e4fafb24b5f4a5848078d8eb08f08e808a', kind: 'aptos', rpcs: ['https://fullnode.mainnet.aptoslabs.com/v1'], basis: 'securitize', src: SRC24 },
  { k: 'solana', addr: 'GyWgeqpy5GueU2YbkE8xqUeVEokCMMCEeUrfbtMw6phr', kind: 'solana', rpcs: ['https://api.mainnet-beta.solana.com'], basis: 'securitize', src: SRC25 }];
async function post(url, body) { const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/json', 'user-agent': 'cryptostatements-issuance (GitHub Actions; daily public-data copy)' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(new URL(url).host + ' HTTP ' + r.status); return r.json(); }
async function supply(c) {
  for (const rpc of c.rpcs) {
    try {
      if (c.kind === 'evm') { const j = await post(rpc, { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: c.addr, data: '0x18160ddd' }, 'latest'] });
        if (!j.result || j.result === '0x') throw new Error('no result ' + JSON.stringify(j.error || '')); return [Number(BigInt(j.result)) / 1e6, new URL(rpc).host]; }
      if (c.kind === 'aptos') { const md = await post(rpc + '/view', { function: c.addr + '::ds_token::metadata', type_arguments: [], arguments: [] });
        const s = await post(rpc + '/view', { function: '0x1::fungible_asset::supply', type_arguments: ['0x1::fungible_asset::Metadata'], arguments: [md[0].inner] });
        const v = s && s[0] && s[0].vec && s[0].vec[0]; if (v == null) throw new Error('no supply'); return [Number(BigInt(v)) / 1e6, new URL(rpc).host]; }
      if (c.kind === 'solana') { const j = await post(rpc, { jsonrpc: '2.0', id: 1, method: 'getTokenSupply', params: [c.addr] });
        const v = j && j.result && j.result.value; if (!v) throw new Error('no result ' + JSON.stringify(j.error || '')); return [+v.uiAmountString, new URL(rpc).host]; }
    } catch (e) { console.error(c.k, rpc.replace(/\/\/([^/]+).*/, '//$1'), e.message); }
  }
  return [null, null];
}
async function main() {
  let prev = null; if (fs.existsSync(OUT)) { try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { console.error(OUT + ' does not parse; left untouched.'); return; } }
  const H = (prev && prev.chains) || {}; let ok = 0;
  for (const c of CHAINS) {
    const h = H[c.k] || { addr: c.addr, basis: c.basis, src: c.src, rows: [] }; Object.assign(h, { addr: c.addr, basis: c.basis, src: c.src });
    if (h.rows.some(r => r[0] === today)) { ok++; H[c.k] = h; continue; }
    const [v, host] = await supply(c); if (v != null && isFinite(v)) { h.rows.push([today, Math.round(v * 100) / 100, host]); h.rows = h.rows.slice(-KEEP); ok++; console.log(c.k, v.toLocaleString('en-US'), 'BUIDL from', host); }
    H[c.k] = h;
  }
  if (!ok) { console.error('no chain read; nothing written'); return; }
  fs.writeFileSync(OUT, JSON.stringify({ about: 'BlackRock BUIDL shares outstanding by chain, read from each chain once a UTC day (rows: [date, shares, node]). Addresses from Securitize\'s own releases (basis "securitize"); BNB Chain supplied by the founder and confirmed on chain by its owner() matching the six Securitize-published EVM contracts (basis "owner-match"). BUIDL-I and chains without a published address are not read. Written by tools/buidl.mjs.',
    updated: new Date(NOW).toISOString(), chains: H }) + '\n');
  console.log('buidl.json written');
}
main().catch(e => { console.error(e); process.exitCode = 0; });
