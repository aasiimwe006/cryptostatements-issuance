/* bundle.mjs — CRYPTO STATEMENTS · monthly bundle of the issuance archive (r140)
   Reads the day files of one month from work/ (downloaded from the month's release by the
   workflow), checks each against index.json, and writes work/issuance-YYYY-MM.json.gz: every
   day of the month in one compressed file, days in order, each exactly as filed. Records the
   bundle in index.json under months. No dependencies (Node 20).
     node tools/bundle.mjs 2026-09    one month (default: the previous UTC month) */
import fs from 'node:fs'; import zlib from 'node:zlib';
const REPO=process.env.GITHUB_REPOSITORY||'aasiimwe006/cryptostatements-issuance';
const prev=(()=>{ const d=new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()-1); return d.toISOString().slice(0,7); })();
const M=(process.argv[2]||'').trim()||prev;
if(!/^\d{4}-\d{2}$/.test(M)) { console.error('month must be YYYY-MM, got',M); process.exit(1); }
const idx=JSON.parse(fs.readFileSync('index.json','utf8'));
const listed=idx.days.filter(d=>d.date.startsWith(M)).sort((a,b)=>a.date.localeCompare(b.date));
if(!listed.length){ console.error('no archived day in',M); process.exit(1); }
const days=[], missing=[];
for(const d of listed){ const fp='work/'+d.file; if(!fs.existsSync(fp)){ missing.push(d.date); continue; }
  const day=JSON.parse(fs.readFileSync(fp,'utf8'));
  if(day.events.length!==d.events) { console.error(d.date,'has',day.events.length,'events but the index says',d.events); process.exit(1); }
  days.push(day); }
if(missing.length){ console.error('day files missing from the release:',missing.join(', ')); process.exit(1); }
const first=new Date(M+'-01T00:00:00Z'), last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
const complete=listed.length===last;
const bundle={month:M,chain:'ethereum',method:'iss-v1',format:'month-v1',generated:new Date().toISOString(),complete,days};
const file=`issuance-${M}.json.gz`, gz=zlib.gzipSync(JSON.stringify(bundle),{level:9});
fs.writeFileSync('work/'+file,gz);
idx.months=(idx.months||[]).filter(m=>m.month!==M).concat([{month:M,file,url:`https://github.com/${REPO}/releases/download/issuance-${M}/${file}`,
  days:listed.length,complete,events:listed.reduce((s,d)=>s+d.events,0),bytes:gz.length}]).sort((a,b)=>a.month.localeCompare(b.month));
idx.updated=new Date().toISOString(); fs.writeFileSync('index.json',JSON.stringify(idx,null,1)+'\n');
console.log(M,'·',listed.length,'of',last,'days ·',(gz.length/1e6).toFixed(1),'MB compressed ·',complete?'complete':'partial month');
