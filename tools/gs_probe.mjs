/* gs_probe.mjs — CRYPTO STATEMENTS · one-off test of Grayscale's published spreadsheets (r285)

   Grayscale's fund pages refuse the daily job (HTTP 429), but each page links a "product performance"
   spreadsheet stored on Amazon S3, outside the site's bot protection. This test fetches each linked file
   once and prints what it holds, so we can see whether it carries the quantity held (bitcoin or ether in
   the fund) with a date. If it does, it is a file Grayscale publishes openly and the daily job may read
   it; if not, the funds stay with the weekly hand reading. It writes nothing and commits nothing; the
   result is in the run log. URLs copied from the fund pages on 6 Nov 2026. No dependencies (Node 20). */
import zlib from 'node:zlib';
const FILES = {
  GBTC: ['https://reporting-prod-20231113144948145500000003.s3.us-east-1.amazonaws.com/product-performance/672e88c7-dac6-4fcd-9069-18eef01a2c73.xlsx',
         'https://reporting-prod-20231113144948145500000003.s3.us-east-1.amazonaws.com/product-performance/672e88c7-dac6-4fcd-9069-18eef01a2c73-33.xlsx'],
  BTC:  ['https://reporting-prod-20231113144948145500000003.s3.amazonaws.com/product-performance/9ba286d6-3067-4153-b430-81d9d7a25696.xlsx'],
  ETHE: ['https://reporting-prod-20231113144948145500000003.s3.us-east-1.amazonaws.com/product-performance/585fdb73-c55c-40cd-bb35-e1b532d72e70.xlsx',
         'https://reporting-prod-20231113144948145500000003.s3.us-east-1.amazonaws.com/product-performance/585fdb73-c55c-40cd-bb35-e1b532d72e70-33.xlsx'],
  ETH:  ['https://reporting-prod-20231113144948145500000003.s3.amazonaws.com/product-performance/52edbb6f-93e8-4b73-85f6-6b347706bc2a.xlsx']
};
function unzip(buf) {
  let e = -1; for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not a zip (xlsx) file');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = {};
  for (let k = 0; k < n; k++) {
    const comp = buf.readUInt16LE(p + 10), csz = buf.readUInt32LE(p + 20), fl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + fl), lfl = buf.readUInt16LE(lho + 26), lxl = buf.readUInt16LE(lho + 28);
    const data = buf.subarray(lho + 30 + lfl + lxl, lho + 30 + lfl + lxl + csz);
    out[name] = comp === 8 ? zlib.inflateRawSync(data).toString('utf8') : data.toString('utf8');
    p += 46 + fl + xl + cl;
  }
  return out;
}
const dec = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
function sheetRows(xml, strings, max) {
  const rows = [];
  for (const m of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [...m[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(c => {
      const t = (c[2].match(/t="(\w+)"/) || [])[1], v = ((c[3] || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1], is = ((c[3] || '').match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
      return c[1] + '=' + (t === 's' ? strings[+v] : t === 'inlineStr' ? dec(is || '') : (v ?? ''));
    });
    rows.push(cells.join(' | ')); if (rows.length >= max) break;
  }
  return rows;
}
async function main() {
  for (const [fund, urls] of Object.entries(FILES)) for (const url of urls) {
    console.log('\n=== ' + fund + ' · ' + url.split('/').pop());
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'cryptostatements-issuance (GitHub Actions; one-off spreadsheet test)' } });
      console.log('HTTP', r.status, '·', r.headers.get('content-type'), '·', r.headers.get('content-length'), 'bytes · last-modified', r.headers.get('last-modified'));
      if (!r.ok) continue;
      const Z = unzip(Buffer.from(await r.arrayBuffer()));
      const strings = [...(Z['xl/sharedStrings.xml'] || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
      const sheets = [...(Z['xl/workbook.xml'] || '').matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(m => dec(m[1]));
      console.log('sheets:', sheets.join(', ') || '(none listed)');
      const allText = strings.concat(Object.keys(Z).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).flatMap(k => [...Z[k].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => dec(m[1]))));
      const hits = [...new Set(allText.filter(s => /bitcoin|ether|holding|in (the )?fund|in trust|shares outstanding|per share|quantity|as of/i.test(s)))];
      console.log('labels that matter (' + hits.length + '):', hits.slice(0, 30).join(' ¦ '));
      Object.keys(Z).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort().forEach(k => {
        const all = sheetRows(Z[k], strings, 100000);
        console.log('-- ' + k + ' · ' + all.length + ' rows; first 8:'); all.slice(0, 8).forEach(x => console.log('   ' + x.slice(0, 300)));
        if (all.length > 8) { console.log('   … last 3:'); all.slice(-3).forEach(x => console.log('   ' + x.slice(0, 300))); }
      });
    } catch (e) { console.log('error:', e.message); }
  }
}
main().catch(e => { console.error(e); process.exitCode = 0; });
