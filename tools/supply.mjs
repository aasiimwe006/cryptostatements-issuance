/* supply.mjs — CRYPTO STATEMENTS · daily supply reading (repository cryptostatements-issuance, r147, AP11)
   Reads each token's totalSupply() on Ethereum at the latest block when the daily workflow runs
   (just after midnight UTC) and appends one reading per UTC day to supply.json, served by GitHub
   Pages to the Reserve Monitor. The reading carries its block number and block time: it is the
   supply at that block, not at midnight exactly. Primary on-chain facts only, at addresses each
   issuer publishes; not the issue across chains, not a market value, not a reserve check.
     node tools/supply.mjs        one reading for today (UTC); a day already read is kept
   No dependencies (Node 20). Same node list as issuance.mjs (secret ISSUANCE_RPCS first). */
import fs from 'node:fs';
const RPCS=((process.env.ISSUANCE_RPCS||'').trim()?process.env.ISSUANCE_RPCS:'https://ethereum-rpc.publicnode.com,https://eth.drpc.org,https://1rpc.io/eth').split(',').map(x=>x.trim()).filter(Boolean);
const TOKENS=[
  {sym:'USDC', issuer:'Circle',  contract:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', source:'https://developers.circle.com/stablecoins/usdc-contract-addresses'},
  {sym:'USDT', issuer:'Tether',  contract:'0xdac17f958d2ee523a2206206994597c13d831ec7', source:'https://tether.to/en/supported-protocols'},
  {sym:'PAXG', issuer:'Paxos',   contract:'0x45804880de22913dafe09f4980848ece6ecbaf78', source:'https://github.com/paxosglobal/paxos-gold-contract'},
  {sym:'EURC', issuer:'Circle',  contract:'0x1abaea1f7c830bd89acc67ec4af516284b1bc33c', source:'https://developers.circle.com/stablecoins/eurc-contract-addresses'},
  {sym:'PYUSD',issuer:'Paxos (for PayPal)', contract:'0x6c3ea9036406852006290770bedfcaba0e23a0e8', source:'https://docs.paxos.com/stablecoin/pyusd/pyusd-faq'},
  {sym:'XAUT', issuer:'Tether (Tether Gold, XAU\u20ae)', contract:'0x68749665ff8d2d112fa859aa293f07a622782f38', source:'https://tether.to/en/supported-protocols/'},
  {sym:'BUIDL:0x7712', issuer:'BlackRock (BUIDL, first of two listed addresses)', contract:'0x7712c34205737192402172409a8f7ccef8aa2aec', source:'https://www.blackrock.com/corporate/compliance/scams-and-fraud/blackrock-token-addresses'},
  {sym:'BUIDL:0x6a9d', issuer:'BlackRock (BUIDL, second of two listed addresses)', contract:'0x6a9da2d710bb9b700acde7cb81f10f1ff8c89041', source:'https://www.blackrock.com/corporate/compliance/scams-and-fraud/blackrock-token-addresses'},
  {sym:'RLUSD',issuer:'Ripple',  contract:'0x8292bb45bf1ee4d140127049757c2e0ff06317ed', source:'https://docs.ripple.com/products/stablecoin/overview/token-addresses'}
];
/* r152: RLUSD on the XRP Ledger. The issuer account is the one Ripple publishes (docs.ripple.com,
   token addresses); gateway_balances returns the issuer's obligations, i.e. the RLUSD it has issued
   and others hold, at a validated ledger. Public XRPL nodes, tried in order. */
const XRPL={sym:'RLUSD:XRPL',issuer:'Ripple (RLUSD on the XRP Ledger)',account:'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',currency:'524C555344000000000000000000000000000000',source:'https://docs.ripple.com/products/stablecoin/overview/token-addresses'};
const XRPL_NODES=((process.env.XRPL_RPCS||'').trim()?process.env.XRPL_RPCS:'https://xrplcluster.com,https://s1.ripple.com:51234,https://s2.ripple.com:51234').split(',').map(x=>x.trim()).filter(Boolean);
async function readXrpl(){ let last=null;
  for(const url of XRPL_NODES){ try{
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'gateway_balances',params:[{account:XRPL.account,ledger_index:'validated',strict:true}]}),signal:AbortSignal.timeout(20000)});
      if(!r.ok) throw new Error(new URL(url).host+' HTTP '+r.status); const j=await r.json(), R=j.result||{};
      if(R.status!=='success') throw new Error(new URL(url).host+' '+(R.error||'no result'));
      const ob=R.obligations||{}, v=ob[XRPL.currency]!=null?ob[XRPL.currency]:ob.RLUSD; if(v==null) throw new Error('no RLUSD obligation in the reply');
      return {value:Number(v),ledger:R.ledger_index,node:new URL(url).host}; }
    catch(e){ last=e; console.error('  XRPL',e.message); } }
  throw last||new Error('no XRPL node'); }
/* r153: per-chain readings on other EVM chains, at addresses the issuer publishes for that chain.
   Each token on each chain is its own figure; the platform never adds chains together. */
const OTHER_EVM=[
  {chain:'bsc',label:'BNB Smart Chain',nodes:((process.env.BSC_RPCS||'').trim()?process.env.BSC_RPCS:'https://bsc-rpc.publicnode.com,https://bsc-dataseed.bnbchain.org,https://bsc-dataseed1.defibit.io').split(',').map(x=>x.trim()).filter(Boolean),
   tokens:[{sym:'XAUT:BSC',issuer:'Tether (Tether Gold, XAU\u20ae, on BNB Smart Chain)',contract:'0x21caef8a43163eea865baee23b9c2e327696a3bf',source:'https://tether.to/en/supported-protocols/'}]}
];
async function readOtherEvm(C){ let last=null;
  for(const url of C.nodes){ try{
      const bn=await call(url,'eth_blockNumber',[]), blk=await call(url,'eth_getBlockByNumber',[bn,false]), values={}, decimals={};
      for(const t of C.tokens){ await sleep(300);
        const dec=Number(BigInt(await call(url,'eth_call',[{to:t.contract,data:'0x313ce567'},bn])));
        values[t.sym]=scale(await call(url,'eth_call',[{to:t.contract,data:'0x18160ddd'},bn]),dec); decimals[t.sym]=dec; }
      return {values,decimals,block:parseInt(bn,16),time:new Date(parseInt(blk.timestamp,16)*1000).toISOString().replace('.000Z','Z'),node:new URL(url).host}; }
    catch(e){ last=e; console.error('  '+C.label,e.message); } }
  throw last||new Error('no '+C.label+' node'); }
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(url,method,params){ const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(20000)});
  if(!r.ok) throw new Error(new URL(url).host+' HTTP '+r.status); const j=await r.json(); if(j.error) throw new Error(new URL(url).host+' '+j.error.message); return j.result; }
const scale=(raw,dec)=>{ const v=BigInt(raw), d=10n**BigInt(dec); return Number(v/d)+Number(v%d)/Number(d); };
async function main(){
  const P='supply.json', date=new Date().toISOString().slice(0,10);
  const doc=fs.existsSync(P)?JSON.parse(fs.readFileSync(P,'utf8')):{chain:'ethereum',method:'sup-v1',note:'totalSupply() of each contract on Ethereum at the stated block, one reading per UTC day, taken by the daily workflow just after midnight UTC. Addresses as published by each issuer (see tokens). Not the issue across chains, not a market value, not a reserve check.',tokens:[],readings:[]};
  if(doc.readings.some(r=>r.date===date)){ console.log(date,'already read; kept'); return; }
  let last=null;
  for(const url of RPCS){ try{
      const bn=await call(url,'eth_blockNumber',[]), blk=await call(url,'eth_getBlockByNumber',[bn,false]);
      const values={}, decimals={};
      for(const t of TOKENS){ await sleep(400);
        const dec=Number(BigInt(await call(url,'eth_call',[{to:t.contract,data:'0x313ce567'},bn])));
        const ts=await call(url,'eth_call',[{to:t.contract,data:'0x18160ddd'},bn]);
        values[t.sym]=scale(ts,dec); decimals[t.sym]=dec; }
      doc.tokens=TOKENS.map(t=>({...t,decimals:decimals[t.sym]})).concat([{sym:XRPL.sym,issuer:XRPL.issuer,account:XRPL.account,currency:XRPL.currency,source:XRPL.source,chain:'xrpl'}]);
      const reading={date,block:parseInt(bn,16),time:new Date(parseInt(blk.timestamp,16)*1000).toISOString().replace('.000Z','Z'),rpc:new URL(url).host,values};
      for(const C of OTHER_EVM){ try{ const o=await readOtherEvm(C); Object.assign(values,o.values); reading[C.chain]={block:o.block,time:o.time,node:o.node};
          doc.tokens=doc.tokens.concat(C.tokens.map(t=>({...t,chain:C.chain,decimals:o.decimals[t.sym]}))); }
        catch(e){ reading[C.chain]={error:String(e.message||e)}; } }   /* another chain failing never stops the Ethereum reading */
      try{ const x=await readXrpl(); values[XRPL.sym]=x.value; reading.xrpl={ledger:x.ledger,node:x.node}; }catch(e){ reading.xrpl={error:String(e.message||e)}; }   /* a failed XRPL read never stops the Ethereum reading */
      doc.readings.push(reading);
      doc.readings.sort((a,b)=>a.date.localeCompare(b.date)); doc.updated=new Date().toISOString();
      fs.writeFileSync(P,JSON.stringify(doc,null,1)+'\n');
      console.log(date,'block',parseInt(bn,16),'via',new URL(url).host,JSON.stringify(values)); return;
    }catch(e){ last=e; console.error('  ',e.message); } }
  throw last||new Error('no node');
}
main().catch(e=>{ console.error('supply reading failed:',e.message); process.exit(1); });
