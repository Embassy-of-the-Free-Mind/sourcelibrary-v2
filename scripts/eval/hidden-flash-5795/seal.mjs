#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/sampling.mjs sampleOnePagePerBook — one page per book, but an UNSEEDED $sample
// that requires stored OCR ≥ 200 chars (this population is books whose OCR is still owed); scripts/eval/
// benchmark-seal.mjs — seeded, one page per book, but screens by stored OCR letters and seals a stratum from the
// benchmark registry, not "hidden, OCR owed, not held" per language family. Neither pins the image bytes.
/** #5795 seal: one interior page from up to 30 hidden, OCR-owed, not-held books per language family. READ-ONLY on Mongo. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/hidden-flash-5795/seal.mjs [--work <dir>]
 *
 * Population per family (codeFamily of the FIRST language of books.language — the test isFlashOcrBook uses):
 * visible != true, created_at < 2026-10-04, pages_count > pages_ocr, no pipeline hold. Books sorted by id and
 * shuffled with makeRng(SEED + family index); walked in that order until N have a sealed page. Page: interior
 * (the first and last 10 % of leaves dropped, at least 2 each side when the book has ≥ 6 leaves), pages with no
 * stored OCR first (those are the backlog), candidates shuffled by the same stream; the first whose image fetches
 * is sealed. The image is fetched as production does (getPageSource, 1500 px, JPEG q80) and its sha256 recorded:
 * both arms read these bytes. No screen on content — a blank or mislabelled leaf is part of the answer.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { toLanguageCodes, codeFamily } from '../../lib/language-normalize.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { fetchImageBase64 } from '../ocr-v18-ab.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

export const SEED = 5795; export const N = 30; export const CUTOFF = new Date('2026-10-04T00:00:00Z');
export const FAMILIES = ['fas', 'san', 'pli', 'ara', 'gez'];
const argv = process.argv.slice(2); const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const WORK = opt('work', '/data/scratch/sl/hidden-flash-5795-work');
const OUT = opt('out', 'scripts/eval/results/hidden-flash-5795/sealed.json');
const shuffle = (a, rng) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const client = new MongoClient(process.env.MONGODB_URI); await client.connect(); const db = client.db('bookstore');
const pop = Object.fromEntries(FAMILIES.map((f) => [f, []])); const heldOut = Object.fromEntries(FAMILIES.map((f) => [f, 0]));
for await (const b of db.collection('books').find({ visible: { $ne: true }, created_at: { $lt: CUTOFF }, pages_count: { $gt: 0 } },
  { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, pages_count: 1, pages_ocr: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, 'image_source.provider': 1, created_at: 1 } })) {
  const first = toLanguageCodes(b.language).codes[0]; const fam = first ? codeFamily(first) : null;
  if (!pop[fam] || !((b.pages_count || 0) > (b.pages_ocr || 0))) continue;
  if (b.pipeline_auto?.hold || b.pipeline_auto?.status === 'held') { heldOut[fam]++; continue; }
  pop[fam].push(b);
}
fs.mkdirSync(path.join(WORK, 'images'), { recursive: true });
const sealed = []; const skipped = []; const population = {};
for (const [fi, fam] of FAMILIES.entries()) {
  const rng = makeRng(SEED + fi); const books = shuffle(pop[fam].sort((a, b) => String(a.id).localeCompare(String(b.id))), rng);
  population[fam] = { books: books.length, pages_owed: books.reduce((s, b) => s + (b.pages_count - (b.pages_ocr || 0)), 0), held_excluded: heldOut[fam] };
  let k = 0;
  for (const b of books) {
    if (k >= N) break;
    const pages = await db.collection('pages').find({ book_id: b.id }, { projection: { id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1, 'ocr.model': 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
    const trim = pages.length >= 6 ? Math.max(2, Math.ceil(pages.length * 0.1)) : pages.length >= 3 ? 1 : 0;
    const interior = pages.slice(trim, pages.length - trim).filter((p) => getPageSource(p));
    const hasOcr = (p) => !!(p.ocr?.data && String(p.ocr.data).trim());
    const cands = [...shuffle(interior.filter((p) => !hasOcr(p)), rng), ...shuffle(interior.filter(hasOcr), rng)].slice(0, 3);
    let got = null; const errs = [];
    for (const p of cands) {
      try { const img = await fetchImageBase64(getPageSource(p)); got = { p, img }; break; } catch (e) { errs.push(`${p.page_number}: ${String(e.message).slice(0, 80)}`); }
    }
    if (!got) { skipped.push({ family: fam, book_id: b.id, reason: pages.length === 0 ? 'no page rows' : interior.length === 0 ? 'no interior page with an image' : `image fetch failed (${errs.join('; ')})` }); continue; }
    k++; const slug = `${fam}-${String(k).padStart(2, '0')}`; const buf = Buffer.from(got.img.data, 'base64');
    fs.writeFileSync(path.join(WORK, 'images', `${slug}.jpg`), buf);
    sealed.push({ slug, family: fam, book_id: b.id, title: b.display_title || b.title || null, author: b.author || null, year: b.year ?? b.published ?? null, language: b.language,
      provider: b.image_source?.provider || null, pipeline_status: b.pipeline_auto?.status || null, pages_count: b.pages_count, pages_ocr: b.pages_ocr || 0, page_rows: pages.length,
      page_number: got.p.page_number, page_id: got.p.id, page_has_ocr: hasOcr(got.p), page_ocr_model: got.p.ocr?.model || null,
      image: getPageSource(got.p), image_mime: got.img.mimeType, image_bytes: buf.length, image_sha256: crypto.createHash('sha256').update(buf).digest('hex') });
    console.log(slug, b.id, `p${got.p.page_number}/${pages.length}`, got.p.ocr?.model ? 'has-ocr' : 'no-ocr', String(b.language));
  }
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ issue: 5795, sealed_at: new Date().toISOString(), seed: SEED, n_per_family: N, cutoff: CUTOFF.toISOString(), population, sealed, skipped }, null, 1) + '\n');
console.log(JSON.stringify(population), 'sealed', sealed.length, 'skipped', skipped.length);
await client.close();
