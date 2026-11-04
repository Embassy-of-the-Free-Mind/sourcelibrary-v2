#!/usr/bin/env node
// PRIOR ART: scripts/catalog-coverage/archive-acquired.ts — archives page IMAGES, not the Archive's
// own OCR; scripts/import/ia-manifest-direct.mjs — reads the IIIF manifest only. Nothing fetches IA's
// hOCR searchtext as a page-level locator, so this does (#8049, Derek's content screen, 2026-11-04).
//
// Downloads, per campaign book, IA's _hocr_searchtext.txt.gz + _hocr_pageindex.json.gz +
// _scandata.xml and writes one JSON per book: { ia, book_id, n_ours, n_hocr, pages: [text by OUR
// page index] }. hOCR indexes EVERY leaf; our pages follow IIIF /page/nX, which skips leaves with
// addToAccessFormats=false. So the excluded leaves are dropped before the map, and a book whose
// counts still disagree is flagged `mismatch` (never silently shifted).
//
// LOCATOR ONLY. This text is never written to a page, quoted, or counted as a read.
//
// node --env-file=<main>/.env.production.local scripts/import/jcb-1600/fetch-ia-text.mjs \
//   (--campaign jcb-1600-8049 | --ids-file F) --out $JOB_SCRATCH/s5/iatext [--delay-ms 1500] [--limit N] [--ia id,id]
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const campaign = arg('--campaign');
const out = arg('--out');
const delay = Number(arg('--delay-ms', '1500'));
const limit = Number(arg('--limit', '0'));
const only = arg('--ia') ? new Set(arg('--ia').split(',')) : null;
// --ids-file: book ids (one per line) instead of a campaign — used for the recall controls, which
// are books we already hold with stored OCR.
const idsFile = arg('--ids-file');
// --shard i/n: process only books whose position mod n == i (two polite fetchers, no race).
const [shardI, shardN] = (arg('--shard', '0/1')).split('/').map(Number);
if ((!campaign && !idsFile) || !out) { console.error('need --campaign or --ids-file, and --out'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const UA = 'SourceLibrary/1.0 (+https://sourcelibrary.org; locator screen #8049)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, binary) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
      if (r.status === 404) return null;
      if (r.ok) return binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
      if (r.status === 429 || r.status >= 500) { await sleep(10000 * (a + 1)); continue; }
      return null;
    } catch { await sleep(5000 * (a + 1)); }
  }
  throw new Error(`fetch failed ${url}`);
}

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const filter = idsFile ? { id: { $in: fs.readFileSync(idsFile, 'utf8').split(/\s+/).filter(Boolean) } } : { acquisition_campaign: campaign };
const books = await db.collection('books').find(filter,
  { projection: { id: 1, identifier: 1, ia_identifier: 1, pages_count: 1, language: 1, title: 1 } }).toArray();
await c.close();

let done = 0;
books.sort((a, b) => String(a.ia_identifier || a.identifier).localeCompare(String(b.ia_identifier || b.identifier)));
for (const [pos, b] of books.entries()) {
  if (pos % shardN !== shardI) continue;
  const ia = b.ia_identifier || b.identifier;
  if (!ia || (only && !only.has(ia))) continue;
  const f = path.join(out, `${ia}.json`);
  if (fs.existsSync(f)) continue;
  if (limit && done >= limit) break;
  done++;
  const base = `https://archive.org/download/${ia}/${ia}`;
  const rec = { ia, book_id: b.id || String(b._id), language: b.language, n_ours: b.pages_count, status: 'ok' };
  try {
    const idxGz = await get(`${base}_hocr_pageindex.json.gz`, true); await sleep(delay);
    const txtGz = idxGz ? await get(`${base}_hocr_searchtext.txt.gz`, true) : null; await sleep(delay);
    const scan = await get(`${base}_scandata.xml`); await sleep(delay);
    if (!idxGz || !txtGz) { rec.status = 'no-hocr'; }
    else {
      const idx = JSON.parse(zlib.gunzipSync(idxGz).toString());
      const txt = zlib.gunzipSync(txtGz).toString();
      // pageindex rows: [start, end, hocr_start, hocr_end] — start/end are offsets into searchtext.
      const leafText = idx.map(([s, e]) => txt.slice(s, e));
      rec.n_hocr = leafText.length;
      let keep = leafText.map(() => true);
      if (scan) {
        const pages = [...scan.matchAll(/<page\b[^>]*leafNum="(\d+)"[^>]*>([\s\S]*?)<\/page>/g)];
        if (pages.length === leafText.length) {
          keep = pages.map(([, , body]) => !/<addToAccessFormats>\s*false/i.test(body));
        } else rec.scan_note = `scandata ${pages.length} pages vs hocr ${leafText.length}`;
      } else rec.scan_note = 'no scandata';
      rec.pages = leafText.filter((_, i) => keep[i]);
      if (rec.pages.length !== rec.n_ours) rec.status = 'mismatch';
    }
  } catch (e) { rec.status = 'error'; rec.error = String(e.message || e); }
  fs.writeFileSync(f, JSON.stringify(rec));
  console.log(`${new Date().toISOString().slice(11, 19)} ${done} ${ia} ${rec.status} ours=${rec.n_ours} hocr=${rec.n_hocr ?? '-'} kept=${rec.pages?.length ?? '-'}`);
}
console.log('done', done);
