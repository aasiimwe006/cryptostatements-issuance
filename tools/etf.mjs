/* etf.mjs — CRYPTO STATEMENTS · spot crypto ETF holdings from the issuers' own files (r282)

   Market context for the figure cards, kept apart from the record. Run daily by the workflow. For each
   fund in FUNDS, reads the issuer's own published holdings file and appends one row per as-of date not
   yet held: the as-of date the issuer prints, shares outstanding, the crypto quantity held and its
   market value. A day's flow is the change in the quantity held from the previous row, so it is what
   the issuer's own files show, not an aggregator's estimate. The issuers publish only the latest file,
   so the history starts on the first run and grows a business day at a time; a stored row is never
   altered. A fund whose file cannot be read or parsed is skipped for the day and says so in the log;
   nothing is estimated. A failure here does not fail the workflow's other steps.
   Starts with BlackRock's iShares Bitcoin Trust (IBIT), by the founder's decision of 6 Nov 2026; other
   issuers are added one at a time, each with its own parser, once its file has been checked by hand.
   No dependencies (Node 20).                                                                          */
import fs from 'node:fs';
import zlib from 'node:zlib';
const OUT = 'etf.json';
const num = s => +String(s || '').replace(/[",\s]/g, '');
const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
function csvLine(l) { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(x => x.trim()); }
/* iShares product CSV: a header block ("Fund Holdings as of", "Shares Outstanding"), then a holdings table. */
function ishares(text, asset) {
  const L = text.split(/\r?\n/), get = k => { const l = L.find(x => x.startsWith(k)); return l ? csvLine(l)[1] : null; };
  const m = (get('Fund Holdings as of') || '').match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/); if (!m) throw new Error('no as-of date');
  const date = `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2, '0')}`, shares = num(get('Shares Outstanding'));
  const hi = L.findIndex(x => x.startsWith('Ticker,')); if (hi < 0) throw new Error('no holdings table');
  const H = csvLine(L[hi]), iq = H.indexOf('Quantity'), iv = H.indexOf('Market Value'), it = H.indexOf('Ticker');
  const row = L.slice(hi + 1).map(csvLine).find(r => r[it] === asset); if (!row) throw new Error('no ' + asset + ' line');
  const qty = num(row[iq]), mv = num(row[iv]); if (!(qty > 0) || !(shares > 0)) throw new Error('unreadable figures');
  return { date, shares, qty, mv };
}
/* r283 · the other issuers, each checked by hand in a browser on 6 Nov 2026 before its reader was written. */
const mdy = s => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[1]}-${m[2]}` : null; };
const htmlLines = h => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').split('\n').map(x => x.trim()).filter(Boolean);
const after = (L, label, from = 0) => { const i = L.indexOf(label, from); return i < 0 ? null : L[i + 1]; };
/* The labelled block that carries a date within its next lines (a menu item with the same words carries none). */
const anchor = (L, label) => L.findIndex((x, i) => x === label && mdy(L.slice(i, i + 4).join(' ')));
/* ARK's holdings CSV: one line per holding, the bitcoin quantity rounded to whole coins by ARK; no shares-outstanding field. */
function arkCsv(text, ticker) {
  const L = text.split(/\r?\n/), H = csvLine(L[0]).map(x => x.toLowerCase()), r = L.slice(1).map(csvLine).find(x => x[H.indexOf('ticker')] === ticker);
  if (!r) throw new Error('no ' + ticker + ' line'); const date = mdy(r[H.indexOf('date')]), qty = num(r[H.indexOf('shares')]), mv = num(String(r[H.indexOf('market value ($)')]).replace('$', ''));
  if (!date || !(qty > 0)) throw new Error('unreadable figures'); return { date, shares: null, qty, mv, rounded: true };
}
/* Grayscale fund pages: "Key Fund Information / As of MM/DD/YYYY", then label and value pairs. */
function grayscale(html, label) {
  const L = htmlLines(html), k = anchor(L, 'Key Fund Information'); if (k < 0) throw new Error('no dated Key Fund Information');
  const date = mdy(L.slice(k, k + 4).join(' ')), qty = num(after(L, label, k)), shares = num(after(L, 'SHARES OUTSTANDING', k)), mv = num(String(after(L, 'ASSETS UNDER MANAGEMENT (NON-GAAP)', k) || '').replace('$', ''));
  if (!date || !(qty > 0)) throw new Error('unreadable figures'); return { date, shares: shares || null, qty, mv: mv || null };
}
/* Bitwise's BITB page: "Fund Holdings / Data as of MM/DD/YYYY", the holding row after the header row; "Fund Details" for shares. */
function bitwise(html, rowName = 'BITCOIN', qtyLabel = 'Bitcoin in Trust') {
  const L = htmlLines(html), h = anchor(L, 'Fund Holdings'); if (h < 0) throw new Error('no dated Fund Holdings');
  const date = mdy(L.slice(h, h + 4).join(' ')), row = L.indexOf(rowName, h), qty = num(after(L, qtyLabel, row)), mv = num(String(after(L, 'Market Value', row) || '').replace('$', ''));
  const d = anchor(L, 'Fund Details'), shares = d >= 0 ? num(after(L, 'Shares Outstanding', d)) : null;
  if (!date || !(qty > 0)) throw new Error('unreadable figures'); return { date, shares: shares || null, qty, mv: mv || null };
}
/* r286 · Grayscale's published spreadsheets. Its fund pages refuse the job, but each page links a "product performance"
   workbook on Amazon S3 that opens freely (tested 6 Nov 2026). Sheet "Daily Performance": one row per business day with
   shares outstanding, NAV per share and AUM; sheet "Holdings": the asset per share, for the latest date only. The file
   never prints the quantity held, so for the Holdings date the job computes it as shares outstanding x asset per share,
   both Grayscale's own figures, and marks the row computed (by the founder's decision of 6 Nov 2026). It matched the
   fund pages within the rounding of the per-share figure on all four funds. Earlier days carry shares, NAV and AUM
   only: the change in shares outstanding is Grayscale's own record of creations and redemptions, and is never turned
   into bitcoin with a per-share figure from another day. Rows are kept from 2024-01-01 (GBTC's conversion to an ETF). */
function unzip(buf) {
  let e = -1; for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not an xlsx file');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = {};
  for (let k = 0; k < n; k++) {
    const comp = buf.readUInt16LE(p + 10), csz = buf.readUInt32LE(p + 20), fl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + fl), lfl = buf.readUInt16LE(lho + 26), lxl = buf.readUInt16LE(lho + 28);
    const data = buf.subarray(lho + 30 + lfl + lxl, lho + 30 + lfl + lxl + csz);
    out[name] = comp === 8 ? zlib.inflateRawSync(data).toString('utf8') : data.toString('utf8'); p += 46 + fl + xl + cl;
  }
  return out;
}
const xdec = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
function xlsxSheets(buf) {
  /* tags may carry a namespace prefix (VanEck writes <x:row>, <x:c>, <x:t>) */
  const Z = unzip(buf), S = [...(Z['xl/sharedStrings.xml'] || '').matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(m => xdec([...m[1].matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(x => x[1]).join('')));
  const names = [...(Z['xl/workbook.xml'] || '').matchAll(/<(?:\w+:)?sheet [^>]*name="([^"]+)"/g)].map(m => xdec(m[1])), out = {};
  names.forEach((nm, i) => { const xml = Z['xl/worksheets/sheet' + (i + 1) + '.xml'] || '';
    out[nm] = [...xml.matchAll(/<(?:\w+:)?row[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)].map(m => { const r = {};
      for (const c of m[1].matchAll(/<(?:\w+:)?c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) { const t = (c[2].match(/t="(\w+)"/) || [])[1], v = ((c[3] || '').match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/) || [])[1], is = ((c[3] || '').match(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/) || [])[1];
        r[c[1]] = t === 's' ? S[+v] : t === 'inlineStr' ? xdec(is || '') : v; } return r; }); });
  return out;
}
function grayscaleXlsx(buf, asset) {
  const W = xlsxSheets(buf), D = W['Daily Performance'], H = W['Holdings']; if (!D || !D.length || !H || !H.length) throw new Error('sheets not found');
  const col = (rows, label) => Object.keys(rows[0]).find(k => rows[0][k] === label);
  const cd = col(D, 'Date'), cs = col(D, 'Shares Outstanding'), cn = col(D, 'NAV Per Share'), ca = col(D, 'AUM');
  if (!cd || !cs) throw new Error('Daily Performance columns not found');
  const hr = H.slice(1).find(r => r[col(H, 'Name')] === asset); if (!hr) throw new Error('no ' + asset + ' in Holdings');
  const hDate = hr[col(H, 'Date')], aps = num(hr[col(H, 'Asset/Share')]);
  return D.slice(1).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r[cd] || '') && r[cd] >= '2024-01-01' && num(r[cs]) > 0).map(r => {
    const row = { date: r[cd], shares: num(r[cs]), nav: r[cn] != null ? num(r[cn]) : null, mv: r[ca] != null ? num(r[ca]) : null };
    if (r[cd] === hDate && aps > 0) Object.assign(row, { aps, qty: Math.round(row.shares * aps * 1e4) / 1e4, computed: true });
    return row; });
}
/* r287 · the smaller issuers, each checked by hand in the founder's browser on 7 Nov 2026 before its reader was written. */
/* VanEck's daily holdings workbook (the "Download XLS" link on the fund's Holdings tab): "Daily Holdings (%)  MM/DD/YYYY",
   then Number | Holding Name | Shares | Market Value; VanEck rounds the coin quantity to whole coins. */
function vaneckXlsx(buf, holding) {
  const W = xlsxSheets(buf), R = Object.values(W)[0] || [], cells = r => Object.values(r).map(v => String(v ?? '').trim());
  const date = mdy(R.map(cells).flat().find(v => /Daily Holdings/i.test(v)) || ''); if (!date) throw new Error('no holdings date');
  const hi = R.findIndex(r => cells(r).includes('Holding Name')); if (hi < 0) throw new Error('no header');
  const H = R[hi], k = lab => Object.keys(H).find(c => String(H[c]).trim() === lab), row = R.slice(hi + 1).find(r => String(r[k('Holding Name')] || '').trim() === holding);
  if (!row) throw new Error('no ' + holding + ' line'); const qty = num(row[k('Shares')]), mv = num(String(row[k('Market Value (US$)')] || '').replace('$', ''));
  if (!(qty > 0)) throw new Error('unreadable figures'); return { date, shares: null, qty, mv: mv || null, rounded: true };
}
/* Invesco's fund pages load holdings from its open, unauthenticated data service (no key or token): units and market value per holding. */
function invescoJson(text, name) {
  const j = JSON.parse(text), h = (j.holdings || []).find(x => x.issuerName === name); if (!h) throw new Error('no ' + name);
  const date = String(j.effectiveBusinessDate || j.effectiveDate || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(h.units > 0)) throw new Error('unreadable figures');
  return { date, shares: null, qty: +h.units, mv: h.marketValueBase || null };
}
/* WisdomTree's fund page loads holdings from its open JSON (no key): one row per holding with shares and market value. */
function wisdomtreeJson(text, ticker) {
  const h = JSON.parse(text).find(x => x.securityTicker === ticker); if (!h) throw new Error('no ' + ticker);
  const date = String(h.dt || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(h.shares > 0)) throw new Error('unreadable figures');
  return { date, shares: null, qty: +h.shares, mv: h.marketValueBase || null };
}
const GS3 = 'https://reporting-prod-20231113144948145500000003.s3.us-east-1.amazonaws.com/product-performance/';
const FUNDS = [
  { id: 'IBIT', name: 'iShares Bitcoin Trust ETF', issuer: 'BlackRock (iShares)', asset: 'BTC',
    url: 'https://www.ishares.com/us/products/333011/ishares-bitcoin-trust-etf/latest-holdings.csv', parse: t => ishares(t, 'BTC') },
  { id: 'GBTC', name: 'Grayscale Bitcoin Trust ETF', issuer: 'Grayscale', asset: 'BTC', page: 'https://etfs.grayscale.com/gbtc', url: GS3 + '672e88c7-dac6-4fcd-9069-18eef01a2c73.xlsx', binary: true, parse: b => grayscaleXlsx(b, 'BTC') },
  { id: 'BTC', name: 'Grayscale Bitcoin Mini Trust ETF', issuer: 'Grayscale', asset: 'BTC', page: 'https://etfs.grayscale.com/btc', url: GS3 + '9ba286d6-3067-4153-b430-81d9d7a25696.xlsx', binary: true, parse: b => grayscaleXlsx(b, 'BTC') },
  { id: 'ARKB', name: 'ARK 21Shares Bitcoin ETF', issuer: 'ARK Invest and 21Shares', asset: 'BTC',
    url: 'https://assets.ark-funds.com/fund-documents/funds-etf-csv/ARK_21SHARES_BITCOIN_ETF_ARKB_HOLDINGS.csv', parse: t => arkCsv(t, 'BTC') },
  { id: 'BITB', name: 'Bitwise Bitcoin ETF', issuer: 'Bitwise', asset: 'BTC', url: 'https://bitbetf.com/', parse: bitwise },
  { id: 'HODL', name: 'VanEck Bitcoin ETF', issuer: 'VanEck', asset: 'BTC', url: 'https://www.vaneck.com/us/en/investments/bitcoin-etf-hodl/downloads/holdings/', binary: true, parse: b => vaneckXlsx(b, 'Bitcoin') },
  { id: 'BTCO', name: 'Invesco Galaxy Bitcoin ETF', issuer: 'Invesco and Galaxy', asset: 'BTC', page: 'https://www.invesco.com/us/en/financial-products/etfs/invesco-galaxy-bitcoin-etf.html',
    url: 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/46091J101/holdings/fund?idType=cusip&productType=ETF', parse: t => invescoJson(t, 'PHYSICAL BITCOIN') },
  { id: 'BTCW', name: 'WisdomTree Bitcoin Fund', issuer: 'WisdomTree', asset: 'BTC', page: 'https://www.wisdomtree.com/us/products/crypto/btcw', url: 'https://www.wisdomtree.com/api/fund-holdings/48684713', parse: t => wisdomtreeJson(t, 'BTC') },
  { id: 'ETHA', name: 'iShares Ethereum Trust ETF', issuer: 'BlackRock (iShares)', asset: 'ETH',
    url: 'https://www.ishares.com/us/products/337614/ishares-ethereum-trust-etf/latest-holdings.csv', parse: t => ishares(t, 'ETH') },
  { id: 'ETHE', name: 'Grayscale Ethereum Staking ETF', issuer: 'Grayscale', asset: 'ETH', page: 'https://etfs.grayscale.com/ethe', url: GS3 + '585fdb73-c55c-40cd-bb35-e1b532d72e70.xlsx', binary: true, parse: b => grayscaleXlsx(b, 'ETH'), staking: true },
  { id: 'ETHW', name: 'Bitwise Ethereum ETF', issuer: 'Bitwise', asset: 'ETH', url: 'https://ethwetf.com/', parse: t => bitwise(t, 'ETHEREUM', 'ETH in Trust') },
  { id: 'ETHV', name: 'VanEck Ethereum ETF', issuer: 'VanEck', asset: 'ETH', url: 'https://www.vaneck.com/us/en/investments/ethereum-etf-ethv/downloads/holdings/', binary: true, parse: b => vaneckXlsx(b, 'Ether') },
  { id: 'QETH', name: 'Invesco Galaxy Ethereum ETF', issuer: 'Invesco and Galaxy', asset: 'ETH', page: 'https://www.invesco.com/us/en/financial-products/etfs/invesco-galaxy-ethereum-etf.html',
    url: 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/46148D107/holdings/fund?idType=cusip&productType=ETF', parse: t => invescoJson(t, 'PHYSICAL ETHER') },
  { id: 'ETH', name: 'Grayscale Ethereum Staking Mini ETF', issuer: 'Grayscale', asset: 'ETH', page: 'https://etfs.grayscale.com/eth', url: GS3 + '52edbb6f-93e8-4b73-85f6-6b347706bc2a.xlsx', binary: true, parse: b => grayscaleXlsx(b, 'ETH'), staking: true }
];
/* No reader, read by hand weekly instead (checked 7 Nov 2026): Franklin (EZBC, EZET), whose figures load through an API
   that refuses a direct request (403); CoinShares (BRRR), whose holdings come from an API called with a key embedded in
   its page, which the job does not copy; 21Shares (TETH), whose holdings file is generated in the browser.
   Fidelity (FBTC, FETH) has no reader. Checked 6 Nov 2026: the figure ("Total bitcoin in fund") is on Fidelity's
   quote page, but the page loads it through a token-protected research API (a direct request is refused, 403),
   Fidelity publishes no holdings file, and its SEC filings carry bitcoin held only once a year (10-K). Nothing is
   scraped around a login wall. Instead the founder reads the figure from Fidelity's own quote page each week
   (a scheduled check, like bStocks) and commits it to etf_hand.json; this job copies those rows in, each marked
   as read by hand, so they are never mistaken for a file the job fetched. */
const HAND = 'etf_hand.json';
/* r284 · one request at a time per host, a pause between requests to the same host, and one polite retry when a host
   says "too many requests". r285 · a host that still refuses is not asked again in the same run: Grayscale answered
   429 to every request from the runner on 6 Nov 2026, even paced and retried, which is a refusal, not a rate. The job
   does not disguise itself as a browser to get past it; Grayscale's funds are then read by hand in the weekly check. */
const sleep = ms => new Promise(r => setTimeout(r, ms)), lastHit = {}, refused = {};
async function politeGet(url, binary) {
  const host = new URL(url).host;
  if (refused[host]) throw new Error('skipped: ' + host + ' refused this run');
  for (let i = 0; i < 2; i++) {
    const wait = (lastHit[host] || 0) + 4000 - Date.now(); if (wait > 0) await sleep(wait);
    lastHit[host] = Date.now();
    const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'cryptostatements-issuance (GitHub Actions; daily holdings copy)', accept: 'text/csv,text/html,text/plain,*/*' } });
    if (r.status === 429 && i < 1) { const ra = +(r.headers.get('retry-after') || 0); const ms = Math.min(120000, Math.max(15000, ra * 1000)) * (i + 1); console.error('  ' + host + ' 429, waiting ' + Math.round(ms / 1000) + ' s'); await sleep(ms); continue; }
    if (r.status === 429) { refused[host] = true; throw new Error('HTTP 429 after a retry; ' + host + ' not asked again this run'); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return binary ? Buffer.from(await r.arrayBuffer()) : r.text();
  }
  refused[host] = true; throw new Error('HTTP 429 after a retry; ' + host + ' not asked again this run');
}
async function main() {
  /* A stored file that does not parse is never overwritten: that would lose the history it holds. */
  let prev = null;
  if (fs.existsSync(OUT)) { try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); }
    catch (e) { console.error(OUT + ' does not parse (' + e.message + '); left untouched, nothing written today. Restore it from git history.'); return; } }
  const doc = { about: 'Spot crypto ETF holdings as each issuer publishes them in its own holdings file: as-of date, shares outstanding, quantity held and market value, one row per as-of date, appended and never altered. A flow is the change in quantity between rows. Context for CRYPTO STATEMENTS figure cards, kept apart from the record. Written by tools/etf.mjs.',
    updated: new Date().toISOString(), funds: (prev && prev.funds) || {} };
  for (const F of FUNDS) {
    const held = (doc.funds[F.id] && doc.funds[F.id].rows) || [];
    try {
      const got = F.parse(await politeGet(F.url, F.binary)), list = Array.isArray(got) ? got : [got]; let added = 0;
      for (const x of list) {
        const i = held.findIndex(h => h.date === x.date);
        if (i < 0) { held.push(x); added++; }
        else if (x.qty && !held[i].qty) { held[i] = Object.assign({}, held[i], x); added++; }   // the day's per-share figure arrives on a later run: fill, never overwrite a stored quantity
        else if (held[i].hand && !held[i].file) { held[i] = Object.assign({}, x, { handCheck: held[i].qty }); added++; } // a hand reading superseded by the issuer's file keeps its figure as a cross-check
      }
      const L = list.find(x => x.qty) || list[0];
      console.log(F.id, list.length > 1 ? list.length + ' days in file, ' + added + ' new or filled; ' : '', L.date, L.qty != null ? L.qty + ' ' + F.asset + (L.computed ? ' (computed: shares x per share)' : '') : '', L.shares ? L.shares + ' shares' : '');
      held.sort((a, b) => a.date.localeCompare(b.date));
    } catch (e) { console.error(F.id, e.message); }
    doc.funds[F.id] = { name: F.name, issuer: F.issuer, asset: F.asset, src: F.url, page: F.page || null, computed: !!F.binary, staking: !!F.staking, rows: held };
  }
  /* Hand-read rows (Fidelity), committed by the founder to etf_hand.json: {funds:{FBTC:{name,issuer,asset,src,rows:[{date,qty,read,by}]}}}.
     Copied in as they are; a row already held for that date is not replaced. */
  if (fs.existsSync(HAND)) {
    try { const H = JSON.parse(fs.readFileSync(HAND, 'utf8'));
      for (const [id, f] of Object.entries(H.funds || {})) {
        const held = (doc.funds[id] && doc.funds[id].rows) || [];
        for (const r of f.rows || []) { if (!(r.date && r.qty > 0)) continue; const i = held.findIndex(h => h.date === r.date);
          if (i < 0) { held.push(Object.assign({ hand: true }, r)); console.log(id, r.date, r.qty, 'read by hand'); }
          else if (!held[i].hand && held[i].handCheck == null) { held[i] = Object.assign({}, held[i], { handCheck: r.qty }); console.log(id, r.date, 'hand reading kept as a cross-check:', r.qty, 'against', held[i].qty); } }
        held.sort((a, b) => a.date.localeCompare(b.date));
        const auto = FUNDS.find(x => x.id === id);   // a fund with a reader keeps its own description; only Fidelity is hand-only
        doc.funds[id] = auto ? Object.assign(doc.funds[id] || { name: auto.name, issuer: auto.issuer, asset: auto.asset, src: auto.url, staking: !!auto.staking }, { rows: held })
                             : { name: f.name, issuer: f.issuer, asset: f.asset, src: f.src, hand: true, weekly: true, rows: held };
      }
    } catch (e) { console.error(HAND, 'not read:', e.message); }
  }
  fs.writeFileSync(OUT, JSON.stringify(doc) + '\n');
  console.log('etf.json written:', Object.entries(doc.funds).map(([k, v]) => k + ' ' + v.rows.length).join(', '));
}
main().catch(e => { console.error(e); process.exitCode = 0; });
