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
  {sym:'RLUSD',issuer:'Ripple',  contract:'0x8292bb45bf1ee4d140127049757c2e0ff06317ed', source:'https://docs.ripple.com/products/stablecoin/overview/token-addresses'}
];
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
      doc.tokens=TOKENS.map(t=>({...t,decimals:decimals[t.sym]}));
      doc.readings.push({date,block:parseInt(bn,16),time:new Date(parseInt(blk.timestamp,16)*1000).toISOString().replace('.000Z','Z'),rpc:new URL(url).host,values});
      doc.readings.sort((a,b)=>a.date.localeCompare(b.date)); doc.updated=new Date().toISOString();
      fs.writeFileSync(P,JSON.stringify(doc,null,1)+'\n');
      console.log(date,'block',parseInt(bn,16),'via',new URL(url).host,JSON.stringify(values)); return;
    }catch(e){ last=e; console.error('  ',e.message); } }
  throw last||new Error('no node');
}
main().catch(e=>{ console.error('supply reading failed:',e.message); process.exit(1); });
