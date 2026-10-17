/* issuance.mjs — CRYPTO STATEMENTS · daily on-chain issuance archive (repository cryptostatements-issuance, r140)
   Reads one UTC day of mint, burn, freeze, wipe and pause events from the USDC, USDT and
   PAXG contracts on Ethereum and writes work/<date>.json (uploaded by the workflow to that
   month's release, issuance-YYYY-MM) and index.json (daily totals, served by GitHub Pages).
   Primary on-chain facts only: what each contract recorded, with block, time and
   transaction; never why. The decode table is the same as the platform page's.
     node tools/issuance.mjs                  yesterday (UTC)
     node tools/issuance.mjs 2026-10-15       one day
     node tools/issuance.mjs 2026-09-17 30    thirty days from 17 Sep
   A day already in index.json is never re-read unless ISSUANCE_FORCE=1. No dependencies (Node 20). */
import fs from 'node:fs'; import path from 'node:path';
/* Public nodes, tried in order. Some refuse cloud addresses such as GitHub's runners
   (eth.llamarpc.com answers 403). A node of your own (an Alchemy or Infura URL with its key)
   can be put first through the repository variable ISSUANCE_RPCS, comma-separated. */
const RPCS=((process.env.ISSUANCE_RPCS||'').trim()?process.env.ISSUANCE_RPCS:'https://ethereum-rpc.publicnode.com,https://eth.drpc.org,https://1rpc.io/eth,https://eth.llamarpc.com').split(',').map(x=>x.trim()).filter(Boolean);
const PACE=Number(process.env.ISSUANCE_PACE_MS||600), bad=new Map(), noLogs=new Set();   /* noLogs: nodes whose log-range limit is too small to use */
const OUT='work', REPO=process.env.GITHUB_REPOSITORY||'aasiimwe006/cryptostatements-issuance';
const assetUrl=(date,file)=>`https://github.com/${REPO}/releases/download/issuance-${date.slice(0,7)}/${file}`;
/* Event signatures, checked against the contracts' own source: USDC, circlefin/stablecoin-evm
   (FiatTokenV1, Blacklistable, Pausable); PAXG, paxosglobal/paxos-token-contracts (V2,
   TokenAdminEvents) plus the V1 freeze events from paxos-gold-contract; USDT, TetherToken as
   verified on Etherscan. Topic = keccak-256 of the signature. who: indexed address topic;
   whoData / amt: 32-byte word in the data. */
const ISS_EVENTS={
  '0xab8530f87dc9b59234c4623bf917212bb2536d647574c8e7e5da92c2ede0c9f8':{n:'Mint',k:'issue',who:2,amt:0},
  '0xcc16f5dbb4873280815c1ee09dbd06736cffcc184412cf7a71a0fdb75d397ca5':{n:'Burn',k:'redeem',who:1,amt:0},
  '0xffa4e6181777692565cf28528fc88fd1516ea86b56da075235fa575af6a4b855':{n:'Blacklisted',k:'freeze',who:1},
  '0x117e3210bb9aa7d9baff172026820255c6f6c30ba8999d1c2fd88e2848137c4e':{n:'UnBlacklisted',k:'unfreeze',who:1},
  '0x6985a02210a168e66602d3235cb6db0e70f92b3ba4d376a33c0f3d9434bff625':{n:'Pause',k:'pause'},
  '0x7805862f689e2f13df9f062ff482ad3ad112aca9e0847911ed832e158c525b33':{n:'Unpause',k:'unpause'},
  '0xcb8241adb0c3fdb35b70c24ce35c5eb0c17af7431c99f827d44a445ca624176a':{n:'Issue',k:'issue',amt:0},
  '0x702d5967f45f6513a38ffc42d6ba9bf230bd40e8f53b16363c7eb4fd2deb9a44':{n:'Redeem',k:'redeem',amt:0},
  '0x42e160154868087d6bfdc0ca23d96a1c1cfa32f1b72ba9ba27b69b98a0d819dc':{n:'AddedBlackList',k:'freeze',whoData:0},
  '0xd7e9ec6e6ecd65492dce6bf513cd6867560d49544421d0783ddf06e76c24470c':{n:'RemovedBlackList',k:'unfreeze',whoData:0},
  '0x61e6e66b0d6339b2980aecc6ccc0039736791f0ccde9ed512e789a7fbdd698c6':{n:'DestroyedBlackFunds',k:'wipe',whoData:0,amt:1},
  '0xf5c174d57843e57fea3c649fdde37f015ef08750759cbee88060390566a98797':{n:'SupplyIncreased',k:'issue',who:1,amt:0},
  '0x1b7e18241beced0d7f41fbab1ea8ed468732edbcb74ec4420151654ca71c8a63':{n:'SupplyDecreased',k:'redeem',who:1,amt:0},
  '0x1aa660498c83ea285bc55e4cfc00afcaa7120798db87b74f3c0d7c6e001bc392':{n:'FreezeAddress',k:'freeze',who:1},
  '0x150465b020dfc06a59269da94ed66db9b65a516cf4fdd5f583b0f12752339bbe':{n:'UnfreezeAddress',k:'unfreeze',who:1},
  '0x90811a8edd3b3c17eeaefffc17f639cc69145d41a359c9843994dc2538203690':{n:'AddressFrozen',k:'freeze',who:1},
  '0xc3776b472ebf54114339eec9e4dc924e7ce307a97f5c1ee72b6d474e6e5e8b7c':{n:'AddressUnfrozen',k:'unfreeze',who:1},
  '0xfc5960f1c5a5d2b60f031bf534af053b1bf7d9881989afaeb8b1d164db23aede':{n:'FrozenAddressWiped',k:'wipe',who:1}
};
const ISS_TOKENS=[
  {sym:'USDC',contract:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',decimals:6},
  {sym:'USDT',contract:'0xdac17f958d2ee523a2206206994597c13d831ec7',decimals:6},
  {sym:'PAXG',contract:'0x45804880de22913dafe09f4980848ece6ecbaf78',decimals:18}
];
function issDecode(l){
  if(!l||l.removed) return null;
  const E=ISS_EVENTS[(l.topics[0]||'').toLowerCase()], T=ISS_TOKENS.find(t=>t.contract===String(l.address).toLowerCase());
  if(!E||!T) return null;
  const w=i=>{const h=l.data.slice(2+64*i,2+64*(i+1));return h.length===64?h:null;}, addr=h=>h?'0x'+h.slice(-40):null;
  const who=E.who!=null?addr(l.topics[E.who]):E.whoData!=null?addr(w(E.whoData)):null;
  let amt=null; if(E.amt!=null&&w(E.amt)){ const v=BigInt('0x'+w(E.amt)), d=10n**BigInt(T.decimals); amt=Number(v/d)+Number(v%d)/Number(d); }
  return {sym:T.sym,ev:E.n,k:E.k,who,amt,block:parseInt(l.blockNumber,16),li:parseInt(l.logIndex,16),tx:l.transactionHash};
}
function issTotals(rows){
  const o={}; for(const t of ISS_TOKENS) o[t.sym]={issue:{n:0,sum:0},redeem:{n:0,sum:0},freeze:0,unfreeze:0,wipe:0,pause:0,unpause:0};
  for(const r of rows){ const x=o[r.sym]; if(r.k==='issue'||r.k==='redeem'){x[r.k].n++;x[r.k].sum+=r.amt||0;} else x[r.k]++; }
  return o;
}
const hex=n=>'0x'+n.toString(16), sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function rpc(body){ const errs=[];
  for(let attempt=0;attempt<6;attempt++){
    const isLogs=!Array.isArray(body)&&body.method==='eth_getLogs'; let rangeErr=null, tried=0;
    for(const url of RPCS){ if((bad.get(url)||0)>=3||(isLogs&&noLogs.has(url))) continue; tried++;
      try{ await sleep(PACE);
        const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
        if(r.status===429){ const ra=Number(r.headers.get('retry-after'))||0, wait=Math.min(60000,Math.max(ra*1000,3000*Math.pow(2,attempt)));
          errs.push(new URL(url).host+' HTTP 429'); console.log('  rate limited by',new URL(url).host+', waiting',Math.round(wait/1000),'s'); await sleep(wait); continue; }   /* a rate limit is a pause, not a refusal */
        if(!r.ok){ if(r.status===403||r.status===401||(r.status>=300&&r.status<400)) bad.set(url,9); throw new Error(new URL(url).host+' HTTP '+r.status); }
        const j=await r.json();
        if(!Array.isArray(j)&&j.error) throw Object.assign(new Error(new URL(url).host+' '+j.error.message),{rpcError:j.error});
        if(Array.isArray(j)&&j.every(x=>x&&x.error)) throw new Error(new URL(url).host+' batch refused: '+(j[0].error.message||''));
        return {j,url}; }
      catch(e){ errs.push(e.message);
        if(e.rpcError&&isLogs&&/range|limit|too many|exceed|block|results/i.test(e.rpcError.message)){
          const m=String(e.rpcError.message).match(/(\d+)\s*-\s*(\d+)\s*blocks?|(\d{1,6})\s*blocks?/i), cap=m?Number(m[2]||m[3]):null;
          if(cap!=null&&cap<100) noLogs.add(url);          /* e.g. 1rpc.io: 50 blocks; skip it for logs, try the next node */
          rangeErr=rangeErr||e; continue; }
        bad.set(url,(bad.get(url)||0)+(e.rpcError?0:1)); } }
    if(rangeErr) throw rangeErr;                            /* every usable node wants a smaller range: the caller halves it */
    if(!tried) break;
    await sleep(2000*(attempt+1)); }
  throw new Error('every node refused: '+[...new Set(errs)].slice(-6).join(' | ')); }
const tsCache={};
async function blockTs(n){ if(tsCache[n]) return tsCache[n]; const {j}=await rpc({jsonrpc:'2.0',id:1,method:'eth_getBlockByNumber',params:[hex(n),false]}); return tsCache[n]=parseInt(j.result.timestamp,16); }
async function blocksTs(nums){ const need=[...new Set(nums)].filter(n=>!tsCache[n]);
  for(let i=0;i<need.length;i+=5){ const part=need.slice(i,i+5);   /* small batches: a batch of 50 spends a second's allowance at once */
    try{ const {j}=await rpc(part.map((n,k)=>({jsonrpc:'2.0',id:k+1,method:'eth_getBlockByNumber',params:[hex(n),false]})));
      if(Array.isArray(j)) for(const x of j) if(x&&x.result) tsCache[parseInt(x.result.number,16)]=parseInt(x.result.timestamp,16); }catch(e){}
    for(const n of part) if(!tsCache[n]) await blockTs(n); } }
async function firstBlockAtOrAfter(t,lo,hi){ while(lo<hi){ const mid=Math.floor((lo+hi)/2); if(await blockTs(mid)>=t) hi=mid; else lo=mid+1; } return lo; }
async function readDay(date,head){
  const t0=Date.parse(date+'T00:00:00Z')/1000, t1=t0+86400;
  if(t1>Date.now()/1000) throw new Error(date+' has not ended yet (UTC)');
  const guess=head-Math.ceil((Date.now()/1000-t0)/12);
  const from=await firstBlockAtOrAfter(t0,Math.max(1,guess-1500),Math.min(head,guess+1500)), to=(await firstBlockAtOrAfter(t1,from,Math.min(head,from+7500)))-1;
  const addrs=ISS_TOKENS.map(t=>t.contract), topics=Object.keys(ISS_EVENTS); let rows=[], step=2000, url=null;
  for(let a=from;a<=to;){ const b=Math.min(to,a+step-1);
    try{ const r=await rpc({jsonrpc:'2.0',id:2,method:'eth_getLogs',params:[{fromBlock:hex(a),toBlock:hex(b),address:addrs,topics:[topics]}]}); url=r.url;
      rows=rows.concat(r.j.result.map(l=>{const d=issDecode(l); if(d&&l.blockTimestamp) d.bts=parseInt(l.blockTimestamp,16); return d;}).filter(Boolean)); a=b+1; }
    catch(e){ if(e.rpcError&&step>10){ step=Math.max(10,Math.floor(step/2)); console.log('  smaller log range:',step,'blocks'); continue; } throw e; } }
  rows.sort((x,y)=>x.block-y.block||x.li-y.li);
  for(const r of rows) if(r.bts&&!tsCache[r.block]) tsCache[r.block]=r.bts;   /* newer nodes put the block time on each log */
  await blocksTs(rows.map(r=>r.block));
  /* rows-v1 (r139): one array per event, columns named once in cols, one event per line */
  const COLS=['t','sym','ev','k','who','amt','block','li','tx'];
  const events=rows.map(r=>[new Date(tsCache[r.block]*1000).toISOString().replace('.000Z','Z'),r.sym,r.ev,r.k,r.who,r.amt,r.block,r.li,r.tx]);
  return {date,chain:'ethereum',from,to,fromTime:new Date(tsCache[from]*1000).toISOString(),toTime:new Date(tsCache[to]*1000).toISOString(),
    generated:new Date().toISOString(),rpc:url?new URL(url).host:null,method:'iss-v1',format:'rows-v1',contracts:ISS_TOKENS,totals:issTotals(rows),cols:COLS,events};
}
async function main(){
  const [startArg,nArg]=process.argv.slice(2), force=process.env.ISSUANCE_FORCE==='1';
  const y=new Date(Date.now()-86400000).toISOString().slice(0,10), n=Math.max(1,Math.min(31,parseInt(nArg||'1',10)));
  let start=(startArg||'').trim()||y;
  const dmy=start.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})$/); if(dmy) start=`${dmy[3]}-${dmy[2]}-${dmy[1]}`;   /* 16-09-2026 is read as 16 Sep 2026 */
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||isNaN(Date.parse(start+'T00:00:00Z'))) throw new Error('date must be YYYY-MM-DD (or DD-MM-YYYY), got '+startArg);
  console.log('archiving',n,'day(s) from',start);
  fs.mkdirSync(OUT,{recursive:true});
  const idxPath='index.json'; const idx=fs.existsSync(idxPath)?JSON.parse(fs.readFileSync(idxPath,'utf8')):{chain:'ethereum',method:'iss-v1',days:[]};
  const {j}=await rpc({jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]}); const head=parseInt(j.result,16);
  let wrote=0, failed=0;
  console.log('nodes:',RPCS.map(u=>new URL(u).host).join(', '));
  for(let i=0;i<n;i++){ const date=new Date(Date.parse(start+'T00:00:00Z')+i*86400000).toISOString().slice(0,10), file=date+'.json', fp=path.join(OUT,file);
    if(idx.days.some(d=>d.date===date)&&!force){ console.log(date,'already archived; skipped'); continue; }
    let day; try{ day=await readDay(date,head); }
    catch(e){ console.error(date,'not archived:',e.message); failed++; if(failed>=2) break; continue; }
    const {events,...hdr}=day;   /* compact: the header readable, then one event per line */
    fs.writeFileSync(fp,JSON.stringify(hdr,null,1).replace(/\n}$/,',\n "events":[\n'+events.map(e=>JSON.stringify(e)).join(',\n')+'\n]\n}')+'\n');
    idx.days=idx.days.filter(d=>d.date!==date).concat([{date,file,url:assetUrl(date,file),from:day.from,to:day.to,events:day.events.length,totals:day.totals}]).sort((a,b)=>a.date.localeCompare(b.date));
    idx.updated=new Date().toISOString(); fs.writeFileSync(idxPath,JSON.stringify(idx,null,1)+'\n');   /* written after every day, so a later failure keeps the days already read */
    wrote++; console.log(date,'blocks',day.from,'to',day.to,'·',day.events.length,'events via',day.rpc); }
  console.log(wrote,'day(s) written',failed?'· '+failed+' failed':'');
  if(failed&&!wrote) process.exit(1);
}
main().catch(e=>{ console.error('issuance archive failed:',e.message); process.exit(1); });
