/* registers.mjs — CRYPTO STATEMENTS · nightly re-read of the regulators' registers behind the Exchange
   Register (r219, reviewer redesign step 5)

   Reads registers_watch.json (the rows to re-read, generated from the site's register; r224) and, for every licence row, checks that the
   regulator's own page still shows it:
     esma   ESMA interim MiCA CASP file (CSV): the row's LEI and entity name, parsed exactly; also lists any
            new CASP whose name carries a tracked exchange's name, for review (never added automatically)
     vara   VARA public register page: the licence reference and the entity name
     sfc    SFC lists of virtual asset trading platforms: the entity name
     nydfs  NYDFS regulated entities page: the entity name
     fsra / dfsa / cftc   the row's own firm page: the entity name
   Entity names are matched without a trailing bracket (a brand or former name CS adds); a bracket inside
   a legal name, as in Binance (AD) Limited, is kept.
     jfsa   Japan FSA list of registered crypto-asset exchange service providers, read from the FSA's Excel
            edition (kasoutuka.xlsx, unzipped and read here without dependencies): the registration number
            and the entity name; for rows carrying the assets the register lists, each ticker is checked too
            (a ticker no longer found is flagged; additions are not detected, so the list is re-read by hand)
   Writes registers.json: per register the HTTP result and a fingerprint of the page text (so a change in the
   register is visible even when no tracked row moved), and per row the last date it was found and, if it
   was not found, the date it went missing. A row not found is never removed or relabelled by this job: it is
   flagged for a person to read the register. Logs carry host names only. No dependencies (Node 20).
   REGISTERS_FIXTURES=dir (tests only): read pages from local files instead of the network.          */
import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
const SRC = 'registers_watch.json', OUT = 'registers.json';
const ESMA_CSV = ['https://www.esma.europa.eu/sites/default/files/2024-12/CASPS.csv'];
const JFSA_XLSX = 'https://www.fsa.go.jp/menkyo/menkyoj/kasoutuka.xlsx';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const host = u => { try { return new URL(u).host; } catch (e) { return '?'; } };
const FIX = process.env.REGISTERS_FIXTURES || '';
async function get(url) {
  if (FIX) { const f = FIX + '/' + encodeURIComponent(url); if (!fs.existsSync(f)) throw new Error('no fixture for ' + host(url)); return { status: 200, text: fs.readFileSync(f, 'utf8') }; }
  const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'cryptostatements-registers/1.0 (+https://github.com/aasiimwe006/cryptostatements-issuance)' } });
  if (!r.ok) throw new Error(host(url) + ' HTTP ' + r.status);
  return { status: r.status, text: await r.text() };
}
async function getBuf(url) {
  if (FIX) { const f = FIX + '/' + encodeURIComponent(url); if (!fs.existsSync(f)) throw new Error('no fixture for ' + host(url)); return fs.readFileSync(f); }
  const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'cryptostatements-registers/1.0 (+https://github.com/aasiimwe006/cryptostatements-issuance)' } });
  if (!r.ok) throw new Error(host(url) + ' HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
/* Minimal reader for an .xlsx (a zip of XML files): central directory, stored or deflated entries. Returns
   the text of the shared strings and every worksheet, joined, which is all a presence check needs. */
function xlsxText(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip file');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const files = {};
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    if (/^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(name)) {
      const ln = buf.readUInt16LE(off + 26), lx = buf.readUInt16LE(off + 28), data = buf.slice(off + 30 + ln + lx, off + 30 + ln + lx + csize);
      files[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8'); }
    p += 46 + nl + xl + cl; }
  const strs = (files['xl/sharedStrings.xml'] || '').split(/<\/si>/).map(si => (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join(''));
  const sheets = Object.keys(files).filter(k => k.includes('worksheets')).sort().map(k => files[k].replace(/<c [^>]*t="s"[^>]*>\s*<v>(\d+)<\/v>/g, (m, i) => ' ' + (strs[+i] || '') + ' ').replace(/<is>[\s\S]*?<\/is>/g, m => ' ' + m.replace(/<[^>]+>/g, '') + ' '));
  return strs.join(' ') + ' ' + sheets.join(' ');
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—' };
const norm = t => String(t).normalize('NFKC').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m))
  .replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
const has = (text, s) => !!s && text.includes(norm(s));
function csv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c; }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = (rows.shift() || []).map(h => h.replace(/^﻿/, '').trim());
  return rows.filter(r => r.length > 3).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}
async function main() {
  const doc = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { rows: {}, registers: {} };
  const now = process.env.REGISTERS_NOW ? new Date(process.env.REGISTERS_NOW) : new Date(), today = now.toISOString().slice(0, 10);
  const out = { about: 'Nightly re-read of the regulators’ registers behind the CRYPTO STATEMENTS Exchange Register. rows[exchange|register|entity].date is the last day the row was found on the regulator’s own page; missing_since marks a row not found, for a person to check. Nothing is removed or relabelled automatically.',
    checked: now.toISOString(), registers: {}, rows: {}, review: [] };
  const pages = {}, fingerprint = t => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
  async function page(reg, url) {
    if (pages[url]) return pages[url];
    try { const r = await get(url); const t = norm(r.text); pages[url] = { ok: true, text: t, raw: r.text };
      const fp = fingerprint(t), was = (prev.registers[reg + '|' + url] || {}).fp;
      out.registers[reg + '|' + url] = { register: reg, host: host(url), ok: true, fp, changed: was ? was !== fp : null, read: now.toISOString() };
    } catch (e) { pages[url] = { ok: false, err: e.message }; out.registers[reg + '|' + url] = { register: reg, host: host(url), ok: false, error: e.message, read: now.toISOString() }; console.error('  ', reg, e.message); }
    await sleep(400); return pages[url];
  }
  /* ESMA: one CSV, parsed */
  let esma = null;
  if (doc.exchanges.some(x => x.licences.some(r => r.register === 'esma'))) {
    for (const u of ESMA_CSV) { const p = await page('esma', u); if (p.ok) { esma = csv(p.raw); out.registers['esma|' + u].rows = esma.length; break; } }
  }
  let jfsa;
  const brand = doc.exchanges.map(x => ({ id: x.id, re: new RegExp('\\b' + x.name.replace(/\s*\(.*\)/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i') }));
  for (const x of doc.exchanges) for (const r of x.licences) {
    const key = x.id + '|' + r.register + '|' + r.entity, was = prev.rows[key] || {};
    let found = null, how = '';
    if (r.register === 'jfsa') { if (jfsa === undefined) { jfsa = null; try { const t = norm(xlsxText(await getBuf(JFSA_XLSX))); jfsa = t; out.registers['jfsa|' + JFSA_XLSX] = { register: 'jfsa', host: host(JFSA_XLSX), ok: true, fp: fingerprint(t), changed: ((prev.registers['jfsa|' + JFSA_XLSX] || {}).fp || null) ? prev.registers['jfsa|' + JFSA_XLSX].fp !== fingerprint(t) : null, read: now.toISOString() }; } catch (e) { out.registers['jfsa|' + JFSA_XLSX] = { register: 'jfsa', host: host(JFSA_XLSX), ok: false, error: e.message, read: now.toISOString() }; console.error('   jfsa', e.message); } }
      if (jfsa) { const num = ((r.reference || '').match(/No\.\s*(\d+)/) || [])[1];
        found = has(jfsa, r.entity) && (!num || jfsa.includes('第' + num + '号') || jfsa.includes(num)); how = 'registration number and name in the FSA list (Excel)';
        if (found && r.assets_handled && r.assets_handled.list.length) { const gone = r.assets_handled.list.filter(a => !new RegExp('(^|[^a-z0-9])' + a.toLowerCase() + '([^a-z0-9]|$)').test(jfsa)); if (gone.length) out.review.push({ key, note: 'assets listed by CS no longer found in the FSA list: ' + gone.join(', ') + '; re-read the list' }); } } }
    else if (r.register === 'esma') { if (esma) { const lei = (r.reference || '').replace(/^LEI\s*/, ''); found = esma.some(c => c.ae_lei === lei && norm(c.ae_lei_name) === norm(r.entity) && !c.ac_authorisationEndDate); how = 'LEI and name in the CASP file'; } }
    else { const url = ['vara', 'sfc', 'nydfs'].includes(r.register) ? doc.registers[r.register].url : r.source;
      const p = await page(r.register, url);
      if (p.ok) { const ref = r.register === 'vara' ? (r.reference || '').split(' · ')[0] : '';
        found = has(p.text, r.entity.replace(/\s*\([^)]*\)\s*$/, '')) && (!ref || has(p.text, ref)); how = ref ? 'reference and name on the page' : 'name on the page'; } }
    const row = { register: r.register, how };
    if (found === true) { row.date = today; }
    else { if (was.date) row.date = was.date; if (found === false) { row.missing_since = was.missing_since || today; out.review.push({ key, note: 'not found on ' + r.register + ' on ' + today + '; read the register before changing the row' }); } else row.unchecked = true; }
    out.rows[key] = row;
  }
  if (esma) { const known = new Set(doc.exchanges.flatMap(x => x.licences.filter(r => r.register === 'esma').map(r => (r.reference || '').replace(/^LEI\s*/, ''))));
    for (const c of esma) { const b = brand.find(b => b.re.test(c.ae_lei_name) || b.re.test(c.ae_commercial_name)); if (b && !known.has(c.ae_lei)) out.review.push({ key: b.id + '|esma|' + c.ae_lei_name, note: 'new or untracked CASP naming a tracked exchange: ' + c.ae_lei_name + ' (' + c.ae_competentAuthority + ', ' + c.ac_authorisationNotificationDate + '); check it is the exchange’s own entity before adding' }); } }
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  const R = Object.values(out.rows), ok = R.filter(r => r.date === today).length, miss = R.filter(r => r.missing_since).length, un = R.filter(r => r.unchecked).length;
  console.log(`registers: ${ok} of ${R.length} rows confirmed today; ${miss} not found; ${un} not re-read; ${out.review.length} for review; pages ${Object.values(out.registers).filter(p => p.ok).length}/${Object.keys(out.registers).length} read`);
}
main().catch(e => { console.error('registers failed:', e.message); process.exit(1); });
