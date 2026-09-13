#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/bulk-archive-alignment.mjs (#3368 — detects the IMAGE-side leaf shift by
 * dHash against IIIF, one sampled book at a time; says nothing about the text and does not know WHY
 * the shift happens); scripts/eval/ia-ocr-delivered-quality.mjs (#4790 — found the text-side shift on
 * one paid page per book); hetzner:/root/sl-ia-cache/pagenum-continuity.mjs (folio continuity inside
 * the written text — BLIND to this defect, see below). Nothing in the repo reads IA scandata.
 *
 * ia-ocr-leaf-drift — READ-ONLY, zero-model-call detector: for every book the IA OCR ingester wrote,
 * which written pages carry the text of the WRONG leaf, relative to (a) the record's own source leaf
 * (`pages.photo`, IIIF) and (b) the image the reader is actually shown (`archived_photo`)? (#4790)
 *
 * THE MECHANISM, measured 2026-09-13 on Open Court 1887 and Possidius (folio probes on both image
 * sets, IA scandata, the leaves cache):
 *   - IA's `_scandata.xml` marks leaves `addToAccessFormats=false` (colour cards, "Delete" leaves).
 *     BOTH the BookReader/IIIF page index (`/page/n<k>`) AND the `_djvu.xml` <OBJECT> sequence SKIP
 *     those leaves. So XML object k IS IIIF leaf n<k>: the correct offset is 0 for every book.
 *   - The bulk-JP2 archiver (#3368) numbered images by the zip ordinal, which does NOT skip them:
 *     archived `<p>.jpg` is scandata leaf p−1, i.e. E(p−1) leaves BEHIND the IIIF page, where E(L)
 *     is the number of excluded leaves before L. The shift grows at every interior excluded leaf.
 *   - The gate's reference pages were OCR'd from those archived images (or, for Possidius, from a
 *     pre-repair image set), so the offset vote fitted the XML to the SHIFTED images at the front:
 *     offset = −E(front). That offset is wrong against IIIF everywhere (whole book), and wrong
 *     against the shown image from the first interior excluded leaf on.
 *   - Folio continuity inside the written text cannot see any of this: the text is a fixed shift of
 *     an internally continuous sequence. Only the images (or scandata) carry the discontinuity.
 *
 * So per written page, deterministically:
 *   wrong_vs_source (IIIF)  ⇔ offset ≠ 0
 *   wrong_vs_shown  (image) ⇔ bulk-archived ? offset ≠ −E(p−1) : offset ≠ 0
 * Validated on the 9 cases hand-checked on #4790 (4 text-side, 5 image-side): all nine agree.
 *
 * Writes NOTHING to Mongo; fetches scandata at ≤ 2 req/s and caches it as `<id>.scandata.json`.
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/ia-ocr-leaf-drift.mjs [--limit N] [--book <id>] [--cache /root/sl-ia-cache] [--out <jsonl>]
 *   node scripts/audit/ia-ocr-leaf-drift.mjs --stage=images   # dHash the image side; needs the rows above (≈2 IIIF fetches/page, ≤2/s)
 */
import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../lib/mongo.mjs';
import { iaFetch } from '../lib/ia-ocr-meta.mjs';
import { normalizeLanguageToken } from '../lib/language-normalize.mjs';
import { hashBuffer, hammingHex, HASH_MATCH } from '../lib/page-alignment.mjs';

const arg = (k, d) => { const eq = process.argv.find((a) => a.startsWith(`${k}=`)); if (eq) return eq.slice(k.length + 1); const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LIMIT = +arg('--limit', 100000), BOOK = arg('--book', null), CACHE = arg('--cache', '/root/sl-ia-cache');
const OUT = arg('--out', path.join(CACHE, '_runs', 'leaf-drift-2026-09-13.jsonl'));
const SOURCE = 'ia_djvu';
const STAGE = arg('--stage', 'offsets'); // offsets (default) | images

/**
 * --stage=images: is each bulk-archived written book's IMAGE set aligned with IIIF, or shifted as
 * scandata predicts? bulk-archive-alignment.mjs (#3368) tests a shift of exactly +1, so a book whose
 * shift GROWS at an interior excluded leaf (Open Court: 1, then 3) comes out "ambiguous". Here each
 * sampled page's archived image is hashed against IIIF at the ALIGNED leaf (n<p−1>) and at the
 * PREDICTED leaf (n<p−1−E(p−1)>); pages with E = 0 cannot discriminate and are not sampled.
 * Then the 2×2 the repair needs: image verdict × text offset → pages wrong ON SCREEN.
 */
async function stageImages(rows) {
  const IMG_OUT = OUT.replace(/\.jsonl$/, '') + '.images.jsonl';
  const done = new Set(fs.existsSync(IMG_OUT) ? fs.readFileSync(IMG_OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).book_id) : []);
  const out = fs.createWriteStream(IMG_OUT, { flags: 'a' });
  const thumb = (u) => String(u).replace(/\/full\/(full|pct:\d+)\//, '/full/pct:12/');
  let lastIa = 0;
  const hashUrl = async (u) => { if (/archive\.org/.test(u)) { const w = 550 - (Date.now() - lastIa); if (w > 0) await new Promise((r) => setTimeout(r, w)); lastIa = Date.now(); } const r = await fetch(u, { headers: { 'User-Agent': 'SourceLibrary ia-ocr (team@sourcelibrary.org)' }, signal: AbortSignal.timeout(45000) }); if (!r.ok) throw new Error(`http ${r.status}`); return hashBuffer(Buffer.from(await r.arrayBuffer())); };
  await withMongo(async (db) => {
    const P = db.collection('pages'); let n = 0;
    for (const r of rows) {
      if (done.has(r.book_id) || !r.has_scandata || !r.bulk_pages) continue;
      const E = (L) => r.excluded.filter((x) => x < L).length;
      const pages = await P.find({ book_id: r.book_id, hidden: { $ne: true }, 'ocr.source': SOURCE, 'archive_metadata.source': 'bulk_jp2' }, { projection: { page_number: 1, photo: 1, archived_photo: 1 } }).sort({ page_number: 1 }).toArray();
      const usable = pages.filter((p) => /\/page\/n\d+\//.test(p.photo || '') && /^https?:/.test(p.archived_photo || '') && E(p.page_number - 1) >= 1);
      const picks = []; for (let i = 1; i <= 3; i++) { const p = usable[Math.floor(usable.length * (i / 4))]; if (p && !picks.includes(p)) picks.push(p); }
      const votes = { aligned: 0, shifted: 0, checked: 0 }; const detail = [];
      for (const p of picks) {
        try {
          const k = +p.photo.match(/\/page\/n(\d+)\//)[1]; const pred = k - E(p.page_number - 1); if (pred < 0) continue;
          const ah = await hashUrl(p.archived_photo);
          const dA = hammingHex(ah, await hashUrl(thumb(p.photo)));
          const dP = hammingHex(ah, await hashUrl(thumb(p.photo.replace(/\/page\/n\d+\//, `/page/n${pred}/`))));
          votes.checked++; detail.push({ page: p.page_number, E: E(p.page_number - 1), dAligned: dA, dPredicted: dP });
          if (dA <= HASH_MATCH && dA < dP) votes.aligned++; else if (dP <= HASH_MATCH && dP < dA) votes.shifted++;
        } catch (e) { detail.push({ page: p.page_number, err: e.message.slice(0, 40) }); }
      }
      const verdict = !votes.checked ? 'unknown' : votes.aligned === votes.checked ? 'aligned' : votes.shifted === votes.checked ? 'shifted' : 'ambiguous';
      // pages wrong ON SCREEN under the verdict
      let wrongShown = null;
      if (verdict === 'aligned') wrongShown = r.offset !== 0 ? r.written : 0;
      else if (verdict === 'shifted') { const w = await P.find({ book_id: r.book_id, hidden: { $ne: true }, 'ocr.source': SOURCE }, { projection: { page_number: 1, 'archive_metadata.source': 1 } }).toArray(); wrongShown = w.filter((p) => (p.archive_metadata?.source === 'bulk_jp2') ? r.offset !== -E(p.page_number - 1) : r.offset !== 0).length; }
      out.write(JSON.stringify({ book_id: r.book_id, language: r.language, title: r.title, offset: r.offset, written: r.written, bulk_pages: r.bulk_pages, sampled: picks.length, verdict, votes, detail, wrong_shown: wrongShown }) + '\n'); n++;
      if (n % 25 === 0) console.log(`  ${n} books imaged`);
    }
  }, { timeoutMs: 4 * 60 * 60 * 1000 });
  out.end();
  const img = fs.readFileSync(IMG_OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const cell = (v, o) => img.filter((r) => r.verdict === v && (o === 'zero' ? r.offset === 0 : r.offset !== 0));
  console.log(`\nimage verdict × text offset — ${img.length} bulk-archived written books with a discriminating page (E ≥ 1):`);
  console.log('verdict   | offset 0: books / pages wrong on screen | offset≠0: books / pages wrong on screen');
  for (const v of ['aligned', 'shifted', 'ambiguous', 'unknown']) { const a = cell(v, 'zero'), b = cell(v, 'nonzero'); const sum = (xs) => xs.reduce((s, r) => s + (r.wrong_shown ?? 0), 0); console.log(`${v.padEnd(9)} | ${a.length} / ${v === 'ambiguous' || v === 'unknown' ? '?' : sum(a)} | ${b.length} / ${v === 'ambiguous' || v === 'unknown' ? '?' : sum(b)}`); }
  const resolved = img.filter((r) => r.wrong_shown != null);
  console.log(`resolved books ${resolved.length}: reader-visible wrong pages ${resolved.reduce((s, r) => s + r.wrong_shown, 0)} in ${resolved.filter((r) => r.wrong_shown > 0).length} books | unresolved (ambiguous/unknown) ${img.length - resolved.length} books, ${img.filter((r) => r.wrong_shown == null).reduce((s, r) => s + r.written, 0)} written pages`);
}
if (STAGE === 'images') { await stageImages(fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))); process.exit(0); }

/** scandata → { leaves, excluded: [leafNum...] }, cached. null when the item has no scandata. */
async function scandata(id) {
  const f = path.join(CACHE, `${id}.scandata.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const res = await iaFetch(`https://archive.org/download/${id}/${id}_scandata.xml`);
  if (!res.ok) { fs.writeFileSync(f, 'null'); return null; }
  const xml = await res.text();
  const excluded = []; let leaves = 0;
  for (const m of xml.matchAll(/<page leafNum="(\d+)">([\s\S]*?)<\/page>/g)) { leaves++; if (/<addToAccessFormats>\s*false\s*</i.test(m[2])) excluded.push(+m[1]); }
  const out = leaves ? { leaves, excluded } : null;
  fs.writeFileSync(f, JSON.stringify(out)); return out;
}

await withMongo(async (db) => {
  const P = db.collection('pages');
  const q = { type: 'ia_ocr_ingest', 'details.pages_written': { $gt: 0 } }; if (BOOK) q.book_id = BOOK;
  const ids = [...new Set((await db.collection('book_events').find(q, { projection: { book_id: 1 } }).toArray()).map((e) => e.book_id))].slice(0, LIMIT);
  console.log(`${ids.length} written books`);
  const done = new Set(fs.existsSync(OUT) && !BOOK ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).book_id) : []);
  const out = fs.createWriteStream(OUT, { flags: BOOK ? 'w' : 'a' });
  let n = 0; const t0 = Date.now();
  for (const bid of ids) {
    if (done.has(bid)) continue;
    const b = await db.collection('books').findOne({ id: bid }, { projection: { id: 1, title: 1, language: 1, ia_identifier: 1, image_source: 1 } });
    if (!b) continue;
    const iaId = b.ia_identifier || b.image_source?.identifier || null;
    const lang = (normalizeLanguageToken(b.language) || '?').toLowerCase().split(/[-,\s]/)[0];
    const pages = await P.find({ book_id: bid, hidden: { $ne: true } }, { projection: { page_number: 1, 'ocr.source': 1, 'ocr.agreement_ref.offset': 1, 'archive_metadata.source': 1, archived_photo: 1 } }).sort({ page_number: 1 }).toArray();
    const written = pages.filter((p) => p.ocr?.source === SOURCE);
    // The applied offset: recorded on pages written after 2026-09-12; the first apply run had no offset search (0).
    const offsets = new Set(written.map((p) => p.ocr?.agreement_ref?.offset ?? 0)); const offset = [...offsets][0] ?? 0;
    const sd = iaId ? await scandata(iaId) : null;
    const leavesCache = iaId && fs.existsSync(path.join(CACHE, `${iaId}.leaves.json`)) ? JSON.parse(fs.readFileSync(path.join(CACHE, `${iaId}.leaves.json`), 'utf8')).length : null;
    const row = { book_id: bid, ia_id: iaId, language: lang, title: (b.title || '').slice(0, 60), pages: pages.length, written: written.length, offset, offsets: [...offsets], has_scandata: !!sd,
      scandata_leaves: sd?.leaves ?? null, excluded: sd?.excluded ?? null, xml_objects: leavesCache, access_matches_xml: sd && leavesCache != null ? sd.leaves - sd.excluded.length === leavesCache : null,
      bulk_pages: pages.filter((p) => p.archive_metadata?.source === 'bulk_jp2').length, archived_pages: pages.filter((p) => /^https?:/.test(p.archived_photo || '')).length,
      wrong_vs_source: offset !== 0 ? written.length : 0, wrong_vs_shown: null, first_wrong_shown_page: null, interior_excluded: null };
    if (sd) {
      const E = (L) => sd.excluded.filter((x) => x < L).length;
      let wrong = 0, first = null;
      for (const p of written) {
        const bulk = p.archive_metadata?.source === 'bulk_jp2';
        const bad = bulk ? offset !== -E(p.page_number - 1) : offset !== 0;
        if (bad) { wrong++; if (first == null) first = p.page_number; }
      }
      row.wrong_vs_shown = wrong; row.first_wrong_shown_page = first;
      row.interior_excluded = sd.excluded.filter((x) => x > 0 && x < (pages[pages.length - 1]?.page_number ?? 0) - 1).length;
    }
    out.write(JSON.stringify(row) + '\n'); n++;
    if (n % 50 === 0) console.log(`  ${n} books | ${((Date.now() - t0) / 1000 / n).toFixed(1)}s/book`);
  }
  out.end();
  // ---------- summary ----------
  const all = fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const sum = (xs, f) => xs.reduce((s, r) => s + (f(r) || 0), 0);
  console.log(`\nbooks ${all.length} | with scandata ${all.filter((r) => r.has_scandata).length} | access-leaf count == XML objects: ${all.filter((r) => r.access_matches_xml === true).length} yes / ${all.filter((r) => r.access_matches_xml === false).length} no | offsets: ${JSON.stringify(all.reduce((m, r) => ((m[r.offset] = (m[r.offset] || 0) + 1), m), {}))} | mixed-offset books ${all.filter((r) => r.offsets.length > 1).length}`);
  console.log('\nlanguage | books | written pages | books offset≠0 (text ≠ source leaf) | their written pages | books with pages ≠ shown image | such pages | books with interior excluded leaves | bulk-archived books');
  const langs = [...new Set(all.map((r) => r.language))].sort();
  for (const l of ['ALL', ...langs]) {
    const xs = l === 'ALL' ? all : all.filter((r) => r.language === l);
    const off = xs.filter((r) => r.offset !== 0), shown = xs.filter((r) => r.wrong_vs_shown > 0);
    console.log(`${l.padEnd(8)} | ${xs.length} | ${sum(xs, (r) => r.written)} | ${off.length} | ${sum(off, (r) => r.written)} | ${shown.length} | ${sum(shown, (r) => r.wrong_vs_shown)} | ${xs.filter((r) => r.interior_excluded > 0).length} | ${xs.filter((r) => r.bulk_pages > 0).length}`);
  }
  console.log('\nworst 12 books by pages ≠ shown image:');
  for (const r of [...all].sort((a, b) => (b.wrong_vs_shown || 0) - (a.wrong_vs_shown || 0)).slice(0, 12)) console.log(`  ${r.book_id} ${r.language.padEnd(8)} ${r.title.slice(0, 40).padEnd(40)} offset ${r.offset} | written ${r.written} | ≠shown ${r.wrong_vs_shown} from p.${r.first_wrong_shown_page} | ≠source ${r.wrong_vs_source} | excluded leaves ${JSON.stringify((r.excluded || []).slice(0, 8))}${(r.excluded || []).length > 8 ? '…' : ''} | bulk ${r.bulk_pages}/${r.pages}`);
}, { timeoutMs: 4 * 60 * 60 * 1000 });
