/* stables.mjs — CRYPTO STATEMENTS · stablecoin supply by chain, read from the issuers' own contracts (r368, AP101 step 2)

   Reads the supply of USDC, USDT, PYUSD and RLUSD on each chain the issuer itself lists, once a UTC day, and keeps one
   row per day per chain (a day held is not overwritten). Market context, kept apart from the record: the site sets the
   on-chain total beside the issuer's own filed circulation and beside DefiLlama's chain figure, and shows any
   difference without explaining it. Value is never computed here; supply is a count of tokens.

   Addresses, each from the issuer's own page, read on 28 Nov 2026 and approved by the founder 28 Nov 2026:
     USDC  Circle, "USDC contract addresses"  https://developers.circle.com/stablecoins/usdc-contract-addresses
     USDT  Tether, "Supported Protocols and Integration Guidelines"  https://tether.to/en/supported-protocols/
     PYUSD Paxos, PYUSD mainnet  https://docs.paxos.com/stablecoin/pyusd/mainnet
     RLUSD Ripple, token addresses  https://docs.ripple.com/products/stablecoin/overview/token-addresses
   Rule (founder, 28 Nov 2026): a chain counts only if the issuer lists it. Tether lists no USD₮ on BNB Smart Chain,
   Arbitrum, Polygon or Base, so tokens called USDT there are not read. Chains the issuer lists but this job does not
   read yet are named in NOT_READ and shown on the site as not read.

   r370 · added (tested in a browser 28 Nov 2026, each answering): USDC on Arc (Circle's endpoint, chain 5042, per
   docs.arc.io), Sui (GraphQL coinMetadata.supply; Sui's JSON-RPC is deprecated), NEAR (ft_total_supply) and Noble
   (bank supply of uusdc); USDT on TON (toncenter jetton master) and NEAR. TON and NEAR USD₮ equal Tether's own
   total authorised on those chains.

   Readers: EVM eth_call totalSupply() and decimals(); Solana getTokenSupply; Aptos 0x1::fungible_asset::supply over
   the published metadata object; Stellar Horizon /assets (balances, claimable balances, pools, contracts); Tron
   TronGrid triggerconstantcontract totalSupply() and decimals(); XRPL gateway_balances on the issuer (obligations
   for the currency). Public endpoints only; an endpoint that refuses is logged and the next one is tried; a chain
   not read today is left missing for that day. Tested in a browser on 28 Nov 2026: every chain answered except
   Solana (which refuses browsers; tkfunds.mjs reads it daily from GitHub's runner) and Arc (no public endpoint
   confirmed, so listed as not read).

   r369 · Tether's own per-chain figures, once a UTC day: https://app.tether.to/transparency.json (the file behind
   https://tether.to/en/transparency/?tab=usdt). For each chain Tether names: total authorised, authorised but not
   issued, quarantined, as Tether states them, with Tether's own update time (the file's id, in Unix seconds). The site
   uses them to reconcile the contract reads with Tether's net circulation line by line. Copied, never computed
   beyond the subtraction Tether's page itself shows. No dependencies (Node 20). STB_NOW: tests only. */
import fs from 'node:fs';
const OUT = 'stables.json', KEEP = 1100, NOW = process.env.STB_NOW ? Date.parse(process.env.STB_NOW) : Date.now(), today = new Date(NOW).toISOString().slice(0, 10);
const list = (env, pub) => [...(process.env[env] || '').split(',').map(x => x.trim()).filter(Boolean), ...pub];
const UA = { 'user-agent': 'cryptostatements-issuance (GitHub Actions; daily public-data copy)' };
async function post(url, body) { const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/json', ...UA }, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(new URL(url).host + ' HTTP ' + r.status + ' ' + t.slice(0, 160)); } return r.json(); }
async function get(url) { const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: UA }); if (!r.ok) throw new Error(new URL(url).host + ' HTTP ' + r.status); return r.json(); }
const units = (raw, d) => Number(BigInt(raw)) / 10 ** d;

/* endpoints: each chain's own public endpoint first where it publishes one, publicnode second */
const R = {
  ethereum: list('ISSUANCE_RPCS', ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']),
  base: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
  arbitrum: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
  polygon: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'],
  avalanche: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com'],
  optimism: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'],
  hyperevm: ['https://rpc.hyperliquid.xyz/evm'],
  plasma: ['https://rpc.plasma.to'],
  xlayer: ['https://rpc.xlayer.tech', 'https://xlayerrpc.okx.com'],
  linea: ['https://rpc.linea.build', 'https://linea-rpc.publicnode.com'],
  unichain: ['https://mainnet.unichain.org', 'https://unichain-rpc.publicnode.com'],
  worldchain: ['https://worldchain-mainnet.g.alchemy.com/public'],
  celo: ['https://forno.celo.org', 'https://celo-rpc.publicnode.com'],
  kaia: ['https://public-en.node.kaia.io'],
  kava: ['https://evm.kava.io', 'https://kava-evm-rpc.publicnode.com'],
  solana: ['https://api.mainnet-beta.solana.com'],
  aptos: ['https://fullnode.mainnet.aptoslabs.com/v1'],
  stellar: ['https://horizon.stellar.org'],
  tron: ['https://api.trongrid.io'],
  xrpl: ['https://xrplcluster.com', 'https://s1.ripple.com:51234'],
  arc: ['https://rpc.mainnet.arc.io', 'https://arc.drpc.org'],
  sui: ['https://graphql.mainnet.sui.io/graphql'],
  near: ['https://rpc.mainnet.near.org', 'https://free.rpc.fastnear.com'],
  noble: ['https://rest.cosmos.directory/noble', 'https://noble-api.polkachu.com'],
  ton: ['https://toncenter.com/api/v3']
};
const CIRCLE = 'https://developers.circle.com/stablecoins/usdc-contract-addresses', TETHER = 'https://tether.to/en/supported-protocols/',
  PAXOS = 'https://docs.paxos.com/stablecoin/pyusd/mainnet', RIPPLE = 'https://docs.ripple.com/products/stablecoin/overview/token-addresses';
const ev = (k, addr, src) => ({ k, addr, kind: 'evm', rpcs: R[k], src });
const COINS = {
  usdc: { name: 'USDC', issuer: 'Circle', src: CIRCLE, chains: [
    ev('ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', CIRCLE),
    { k: 'solana', addr: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', kind: 'solana', rpcs: R.solana, src: CIRCLE },
    ev('base', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', CIRCLE),
    ev('arbitrum', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', CIRCLE),
    ev('polygon', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', CIRCLE),
    ev('avalanche', '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', CIRCLE),
    ev('optimism', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', CIRCLE),
    ev('hyperevm', '0xb88339CB7199b77E23DB6E890353E22632Ba630f', CIRCLE),
    ev('plasma', '0x2d661C89D812261039AF9764eceaAee884f5F67F', CIRCLE),
    ev('xlayer', '0xB6CEceAB302E2E4948951eE7843FC24E92933061', CIRCLE),
    ev('linea', '0x176211869cA2b568f2A7D4EE941E073a821EE1ff', CIRCLE),
    ev('unichain', '0x078D782b760474a361dDA0AF3839290b0EF57AD6', CIRCLE),
    ev('worldchain', '0x79A02482A880bCe3F13E09da970dC34dB4cD24D1', CIRCLE),
    ev('arc', '0x3600000000000000000000000000000000000000', CIRCLE),
    { k: 'sui', addr: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC', kind: 'sui', rpcs: R.sui, src: CIRCLE },
    { k: 'near', addr: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', kind: 'near', rpcs: R.near, src: CIRCLE },
    { k: 'noble', addr: 'uusdc', kind: 'cosmosbank', dec: 6, rpcs: R.noble, src: CIRCLE },
    { k: 'aptos', addr: '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b', kind: 'aptos', rpcs: R.aptos, src: CIRCLE },
    { k: 'stellar', addr: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', kind: 'stellar', rpcs: R.stellar, src: CIRCLE }] },
  usdt: { name: 'USDT', issuer: 'Tether', src: TETHER, chains: [
    ev('ethereum', '0xdac17f958d2ee523a2206206994597c13d831ec7', TETHER),
    { k: 'tron', addr: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', kind: 'tron', rpcs: R.tron, src: TETHER },
    { k: 'solana', addr: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', kind: 'solana', rpcs: R.solana, src: TETHER },
    ev('avalanche', '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7', TETHER),
    ev('celo', '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', TETHER),
    ev('kaia', '0xd077a400968890eacc75cdc901f0356c943e4fdb', TETHER),
    ev('kava', '0x919C1c267BC06a7039e03fcc2eF738525769109c', TETHER),
    { k: 'aptos', addr: '0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b', kind: 'aptos', rpcs: R.aptos, src: TETHER },
    { k: 'ton', addr: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', kind: 'ton', dec: 6, rpcs: R.ton, src: TETHER },
    { k: 'near', addr: 'usdt.tether-token.near', kind: 'near', rpcs: R.near, src: TETHER }] },
  pyusd: { name: 'PYUSD', issuer: 'Paxos (for PayPal)', src: PAXOS, chains: [
    ev('ethereum', '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8', PAXOS),
    { k: 'solana', addr: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', kind: 'solana', rpcs: R.solana, src: PAXOS },
    ev('arbitrum', '0x46850aD61C2B7d64d08c9C754F45254596696984', PAXOS)] },
  rlusd: { name: 'RLUSD', issuer: 'Ripple', src: RIPPLE, chains: [
    { k: 'xrpl', addr: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De', cur: 'RLUSD', kind: 'xrpl', rpcs: R.xrpl, src: RIPPLE },
    ev('ethereum', '0x8292bb45bf1ee4d140127049757c2e0ff06317ed', RIPPLE),
    ev('base', '0x8d58c0c60b8d6b88fa98b291a646db34d0f98258', RIPPLE),
    ev('optimism', '0x8d58c0c60b8d6b88fa98b291a646db34d0f98258', RIPPLE)] } };
/* listed by the issuer, not read by this job yet (shown on the site as "not read") */
const NOT_READ = {
  usdc: ['Algorand', 'Celo', 'Codex', 'Cronos', 'EDGE', 'Hedera', 'Injective', 'Ink', 'Monad', 'Morph', 'Pharos', 'Plume', 'Polkadot Asset Hub', 'Sei', 'Sonic', 'Starknet', 'XDC', 'XRPL', 'ZKsync Era'],
  usdt: ['Tezos', 'Liquid', 'Polkadot AssetHub'],
  pyusd: [],
  rlusd: ['Ink', 'Robinhood Chain', 'Unichain', 'XRPL EVM Sidechain'] };
/* the XRPL names a currency longer than three letters by its 40-hex code */
const xrplCode = c => c.length === 3 ? c : Buffer.from(c, 'ascii').toString('hex').toUpperCase().padEnd(40, '0');

async function supply(c) {
  for (const rpc of c.rpcs || []) {
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
      if (c.kind === 'tron') { const call = sel => post(rpc + '/wallet/triggerconstantcontract', { owner_address: c.addr, contract_address: c.addr, function_selector: sel, parameter: '', visible: true })
          .then(j => { const r = j && j.constant_result && j.constant_result[0]; if (!r) throw new Error('no result ' + JSON.stringify(j && j.result || '')); return '0x' + r; });
        const d = parseInt(await call('decimals()'), 16); return [units(await call('totalSupply()'), d), new URL(rpc).host, d]; }
      if (c.kind === 'xrpl') { const j = await post(rpc, { method: 'gateway_balances', params: [{ account: c.addr, ledger_index: 'validated', strict: true }] });
        const o = j && j.result && j.result.obligations; if (!o) throw new Error('no obligations ' + JSON.stringify(j && j.result && j.result.error || ''));
        const v = o[xrplCode(c.cur)] != null ? o[xrplCode(c.cur)] : o[c.cur]; if (v == null) throw new Error('currency not in obligations'); return [+v, new URL(rpc).host, 15]; }
      if (c.kind === 'sui') { const j = await post(rpc, { query: '{ coinMetadata(coinType:"' + c.addr + '") { decimals supply } }' });
        const m = j && j.data && j.data.coinMetadata; if (!m || m.supply == null) throw new Error('no supply ' + JSON.stringify(j && j.errors || '').slice(0, 120)); return [units(m.supply, +m.decimals), new URL(rpc).host, +m.decimals]; }
      if (c.kind === 'near') { const call = async meth => { const j = await post(rpc, { jsonrpc: '2.0', id: '1', method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: c.addr, method_name: meth, args_base64: 'e30=' } });
          if (!j.result || !j.result.result) throw new Error('no result ' + JSON.stringify(j.error || '').slice(0, 120)); return JSON.parse(Buffer.from(j.result.result).toString('utf8')); };
        const d = +(await call('ft_metadata')).decimals; return [units(await call('ft_total_supply'), d), new URL(rpc).host, d]; }
      if (c.kind === 'cosmosbank') { const j = await get(rpc + '/cosmos/bank/v1beta1/supply/by_denom?denom=' + encodeURIComponent(c.addr));
        const a = j && j.amount && j.amount.amount; if (a == null) throw new Error('no amount'); return [units(a, c.dec), new URL(rpc).host, c.dec]; }
      if (c.kind === 'ton') { const j = await get(rpc + '/jetton/masters?address=' + encodeURIComponent(c.addr) + '&limit=1');
        const m = j && j.jetton_masters && j.jetton_masters[0]; if (!m) throw new Error('jetton not found'); const d = +((m.jetton_content && m.jetton_content.decimals) || c.dec || 9); return [units(m.total_supply, d), new URL(rpc).host, d]; }
    } catch (e) { console.error(c.k, rpc.replace(/\/\/([^/]+).*/, '//$1'), e.message); }
  }
  return [null, null, null];
}
const TETHER_FILE = 'https://app.tether.to/transparency.json';
const TETHER_KEYS = { eth: 'ethereum', tron: 'tron', sol: 'solana', ava: 'avalanche', celo: 'celo', kaia: 'kaia', cosmos: 'kava', aptos: 'aptos', ton: 'ton', near: 'near', tezos: 'tezos', liq: 'liquid', statemint: 'polkadot', bnb: 'bsc', algo: 'algorand', eos: 'eos', omni: 'omni', slp: 'slp', statemine: 'kusama' };
const TETHER_DEPRECATED = ['algorand', 'eos', 'omni', 'slp', 'kusama'];
async function tetherNow(prev) {
  const held = (prev && prev.days) || [];
  try { const j = await get(TETHER_FILE), u = j && j.data && j.data.usdt; if (!u || !u.id) throw new Error('no usdt block');
    const asOf = new Date(+u.id * 1000).toISOString(), chains = {};
    for (const [k, name] of Object.entries(TETHER_KEYS)) { if (u['totaltokens_' + k] == null) continue;
      chains[name] = [+u['totaltokens_' + k] || 0, +u['reserve_balance_' + k] || 0, +u['quarantined_' + k] || 0]; }
    for (const k of Object.keys(u)) { const m = k.match(/^totaltokens_(.+)$/); if (m && !TETHER_KEYS[m[1]]) chains[m[1]] = [+u[k] || 0, +u['reserve_balance_' + m[1]] || 0, +u['quarantined_' + m[1]] || 0]; }
    if (!held.some(d => d.asOf === asOf)) held.push({ date: today, asOf, read: new Date(NOW).toISOString(), chains });
    console.log('tether file', asOf, Object.keys(chains).length, 'chains');
    return { about: 'Tether\'s own per-chain figures for USD₮ from ' + TETHER_FILE + ': [total authorised, authorised but not issued, quarantined], with Tether\'s update time (asOf). Net circulation = total - not issued - quarantined, over the chains Tether has not deprecated (' + TETHER_DEPRECATED.join(', ') + ' are deprecated on Tether\'s page).', src: TETHER_FILE, page: 'https://tether.to/en/transparency/?tab=usdt', deprecated: TETHER_DEPRECATED, days: held.slice(-KEEP) };
  } catch (e) { console.error('tether file', e.message); return prev || null; }
}
/* r376 · AP103 step A2 (plan approved by the founder 28 Nov 2026): mints and burns by chain, per complete UTC day.
   For each EVM chain read for USDC, PYUSD and RLUSD, the job sums the ERC-20 Transfer events from the zero address
   (tokens created) and to the zero address (tokens destroyed) on the issuer's own contract, over the blocks of one
   UTC day. The day's blocks are found by their own timestamps. Check: the contract's totalSupply at the day's last
   block less the total at the block before the day's first, which must equal created less destroyed; when the
   endpoint does not serve old state the row says "unchecked", never assumed. USD₮ is not read this way: Tether's
   Ethereum contract issues without Transfer events, and Tether moves issued tokens from its own treasury; its net
   per-chain file (above) stays the USD₮ figure. Rows: [date, created, destroyed, events created, events destroyed,
   first block, last block, check, endpoint]. The newest complete day is read, and up to FLOW_CATCHUP earlier days a
   missed run left empty.
   Tested in a browser 28 Nov 2026 for 27 Nov: USDC on Ethereum created 603,398,217.42 and destroyed 749,929,016.90
   (matches supply), Base, Optimism and Avalanche (match supply), Arbitrum and Polygon (read; the endpoints do not serve
   old state, so unchecked); PYUSD and RLUSD on Ethereum (match supply). HyperEVM answered but rate-limited its log
   queries from the test browser; a day it refuses is left missing. */
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', ZERO32 = '0x' + '0'.repeat(64);
const FLOW_COINS = ['usdc', 'pyusd', 'rlusd'], FLOW_CATCHUP = 3, FLOW_BUDGET = 1500;
const hex = n => '0x' + n.toString(16);
/* a rate limit is waited out (2, 4 and 8 seconds) before the endpoint is given up */
async function rpcCall(rpc, method, params) {
  for (let i = 0; ; i++) {
    try { const j = await post(rpc, { jsonrpc: '2.0', id: 1, method, params }); if (j.error || j.result === undefined) throw new Error(method + ' ' + JSON.stringify(j.error || 'no result').slice(0, 140)); return j.result; }
    catch (e) { if (i >= 3 || !/HTTP 429|rate limit|limit reached/i.test(e.message)) throw e; await new Promise(r => setTimeout(r, 2000 * 2 ** i)); } } }
/* the first block whose timestamp is at or after t (seconds): interpolation inside a bracket, bisection as fallback */
async function blockAtOrAfter(rpc, t, cache) {
  const ts = async n => { if (cache.has(n)) return cache.get(n); const b = await rpcCall(rpc, 'eth_getBlockByNumber', [hex(n), false]); const v = parseInt(b.timestamp, 16); cache.set(n, v); return v; };
  let hi = parseInt(await rpcCall(rpc, 'eth_blockNumber', []), 16), thi = await ts(hi); if (thi < t) return null;
  let lo = Math.max(0, hi - 50000), tlo = await ts(lo); for (let w = hi - lo; tlo >= t && lo > 0; w *= 4) { hi = lo; thi = tlo; lo = Math.max(0, lo - 4 * w); tlo = await ts(lo); }
  for (let i = 0; hi - lo > 1 && i < 60; i++) {
    let m = lo + Math.round((t - tlo) / Math.max(1, thi - tlo) * (hi - lo)); if (i % 2 || m <= lo || m >= hi) m = Math.floor((lo + hi) / 2);
    const tm = await ts(m); if (tm >= t) { hi = m; thi = tm; } else { lo = m; tlo = tm; } }
  return hi;
}
/* summed Transfer amounts for one topic filter over [a, b], walked forward in chunks. An endpoint that refuses a range
   as too wide (drpc's free plan takes 100 blocks, HyperEVM 1,000) halves the chunk and carries on; any other refusal
   (a rate limit, an outage) ends this endpoint's attempt so the next endpoint is tried. */
const RANGE_ERR = /HTTP 400|HTTP 413|range|too many|exceed|more than|10000 results|response size/i;
async function sumLogs(rpc, addr, topics, a, b, st) {
  let x = a, v = 0n, n = 0, span = st.span || (b - a + 1);
  while (x <= b) { const y = Math.min(b, x + span - 1);
    if (++st.calls > FLOW_BUDGET) throw new Error('call budget reached');
    try { const L = await rpcCall(rpc, 'eth_getLogs', [{ address: addr, topics, fromBlock: hex(x), toBlock: hex(y) }]);
      for (const l of L) { v += BigInt(l.data === '0x' ? 0 : l.data); n++; } x = y + 1; }
    catch (e) { if (!RANGE_ERR.test(e.message) || /limit reached|rate/i.test(e.message) || span === 1) throw e; const cap = e.message.match(/(?:over|range|maximum|up to|limited to)[^\d]{0,20}(\d[\d,]*)/i), c = cap ? +cap[1].replace(/,/g, '') : 0; span = c > 0 && c < span ? c : Math.max(1, Math.floor(span / 2)); st.span = span; } }
  return { v, n };
}
async function supplyAt(rpc, addr, n) { try { return BigInt(await rpcCall(rpc, 'eth_call', [{ to: addr, data: '0x18160ddd' }, hex(n)])); } catch (e) { return null; } }
async function flowDay(c, dec, day, bcache) {
  const t0 = Date.parse(day + 'T00:00:00Z') / 1000, t1 = t0 + 86400;
  for (const rpc of c.rpcs || []) {
    try { const cache = bcache[rpc] || (bcache[rpc] = new Map()), st = { calls: 0 };
      const a = await blockAtOrAfter(rpc, t0, cache), next = await blockAtOrAfter(rpc, t1, cache); if (a == null || next == null) throw new Error('day not complete on this endpoint');
      const b = next - 1, mint = await sumLogs(rpc, c.addr, [TRANSFER, ZERO32], a, b, st), burn = await sumLogs(rpc, c.addr, [TRANSFER, null, ZERO32], a, b, st);
      const s0 = await supplyAt(rpc, c.addr, a - 1), s1 = await supplyAt(rpc, c.addr, b);
      const check = s0 == null || s1 == null ? 'unchecked' : (s1 - s0 === mint.v - burn.v ? 'matches supply' : 'differs from supply by ' + units((s1 - s0) - (mint.v - burn.v), dec));
      const r2 = v => Math.round(units(v, dec) * 100) / 100;
      return [day, r2(mint.v), r2(burn.v), mint.n, burn.n, a, b, check, new URL(rpc).host];
    } catch (e) { console.error(c.k, 'flows', day, rpc.replace(/\/\/([^/]+).*/, '//$1'), e.message); }
  }
  return null;
}
async function flowsAll(C) {
  const bcache = {}, newest = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  for (const id of FLOW_COINS) { const f = COINS[id]; for (const c of f.chains) { if (c.kind !== 'evm') continue;
    const h = C[id] && C[id].chains && C[id].chains[c.k]; if (!h || !h.decimals) continue; h.flows = h.flows || [];
    for (let k = FLOW_CATCHUP; k >= 0; k--) { const day = new Date(Date.parse(newest) - k * 86400000).toISOString().slice(0, 10);
      if (h.flows.some(r => r[0] === day)) continue; if (k > 0 && (!h.flows.length || day < h.flows[0][0])) continue;   // catch-up only for days after the first row
      const r = await flowDay(c, h.decimals, day, bcache); if (r) { h.flows.push(r); console.log(id, c.k, 'flows', day, 'created', r[1].toLocaleString('en-US'), 'destroyed', r[2].toLocaleString('en-US'), r[7]); } }
    h.flows.sort((x, y) => x[0].localeCompare(y[0])); h.flows = h.flows.slice(-KEEP); } }
}
async function main() {
  let prev = null; if (fs.existsSync(OUT)) { try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { console.error(OUT + ' does not parse; left untouched.'); return; } }
  const C = (prev && prev.coins) || {}; let ok = 0;
  for (const [id, f] of Object.entries(COINS)) {
    const H = (C[id] && C[id].chains) || {};
    for (const c of f.chains) {
      const h = H[c.k] || { rows: [] }; Object.assign(h, { addr: c.addr, src: c.src });
      if (h.rows.some(r => r[0] === today)) { ok++; H[c.k] = h; continue; }
      const [v, host, d] = await supply(c); if (v != null && isFinite(v)) { h.rows.push([today, Math.round(v * 100) / 100, host]); h.rows = h.rows.slice(-KEEP); h.decimals = d; ok++; console.log(id, c.k, v.toLocaleString('en-US'), 'from', host); }
      else console.error(id, c.k, 'not read today');
      H[c.k] = h;
    }
    C[id] = { name: f.name, issuer: f.issuer, src: f.src, chains: H, notRead: NOT_READ[id] || [] };
  }
  try { await flowsAll(C); } catch (e) { console.error('flows', e.message); }
  const tether = await tetherNow(prev && prev.tether);
  if (!ok && !tether) { console.error('no chain read; nothing written'); return; }
  fs.writeFileSync(OUT, JSON.stringify({ about: 'Stablecoin supply by chain, read from the contracts each issuer lists, once a UTC day (rows: [date, tokens, endpoint]). Addresses from the issuers\' own pages (Circle, Tether, Paxos, Ripple), approved by the founder 28 Nov 2026; a chain counts only if the issuer lists it. notRead names chains the issuer lists that this job does not read yet. flows (EVM chains, USDC, PYUSD and RLUSD): one row per complete UTC day, [date, tokens created, tokens destroyed, events created, events destroyed, first block, last block, check against totalSupply, endpoint], from Transfer events from and to the zero address on the issuer\'s contract. Written by tools/stables.mjs.',
    updated: new Date(NOW).toISOString(), coins: C, tether }) + '\n');
  console.log(OUT + ' written');
}
/* r384 · the pulse job (tools/pulse.mjs, AP104) imports the readers below; set STB_IMPORT to load them without running. */
export { COINS, R, supply, post, get, units, rpcCall, blockAtOrAfter, sumLogs, TRANSFER, ZERO32, TETHER_FILE, TETHER_KEYS, TETHER_DEPRECATED };
if (!process.env.STB_IMPORT) main().catch(e => { console.error(e); process.exitCode = 0; });
