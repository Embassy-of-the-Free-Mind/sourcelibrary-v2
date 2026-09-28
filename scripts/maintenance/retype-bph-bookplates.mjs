#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/repair-gallery-image-types.mjs — repairs MALFORMED `type`
 *   values (model narration stored as the enum) back to a vocabulary word; it never
 *   reclassifies a valid `emblem`, and knows nothing of the pages twin, gallery_quality
 *   or the CLIP index. scripts/lib/gallery-image-types.mjs `isTrivialGalleryDetection` —
 *   a write-time gate for small ornaments on NEW detections only; the ~900 rows here are
 *   already written. scripts/maintenance/recompute-gallery-book-rank.mjs — the rank rule
 *   this reuses (inlined; that script runs its own main on import).
 *
 * Retype the Bibliotheca Philosophica Hermetica pelican bookplate as provenance (#5200).
 *
 * WHY: the BPH pastes its ex-libris — a pelican in her piety on a crescent, inside an
 * ouroboros, over a cube with four roses, ringed "PHILOSOPHIA HERMETICA" — on page 2 of
 * nearly every book it lends us. The extraction prompt says ownership bookplates are
 * `type: "exlibris"` at `gallery_quality <= 0.3`, but the model typed this plate `emblem`
 * at 0.85–0.95 about 900 times. For ~230 books it is the ONLY gallery image, so it is the
 * book's gallery face, a collection-cover candidate, and a CLIP row /identify can match
 * a visitor's photo to. It is the detector's biggest cluster, i.e. its artifact.
 *
 * WHAT IT WRITES (only with --apply):
 *   gallery_images.type = 'exlibris', gallery_quality = min(existing, 0.3)
 *   pages.detected_images[i].type / .gallery_quality — the source-of-truth twin, so a
 *     re-materialisation of the gallery row (scripts/lib/gallery-doc.mjs) does not undo it
 *   gallery_images.book_rank recomputed for every touched book (the per-book cap on
 *     /gallery is `book_rank <= 3`; a demoted plate must not keep rank 1)
 *   clip_embeddings.resource_type = 'exlibris' (Supabase; the identify candidate filter
 *     reads it) for the rows that exist
 *   sweep_log: ONE row per gallery image, sweep 'bph-bookplates-2026-09', with the previous
 *     type + quality in `detail` — no new field on the row (field-sprawl invariant)
 *
 * Not written: gallery_text_embeddings has no type column (the type is baked into the
 * embedded text); re-embedding is a paid Gemini call and is left for the nightly cron
 * owner to decide. Nothing is deleted; the crops stay in R2.
 *
 * HOW A ROW QUALIFIES (measured 2026-09-28; 22 crops opened by eye, 21 bookplates, the
 * one false positive — a hand-painted alchemical emblem in a Manchester manuscript —
 * is what NOT_PLATE and the page rule exclude):
 *   A  the description names the library: "Philosophia Hermetica", "Bibliotheca
 *      Philosophica", "Philosoph Hermes", "Ritman Library"
 *   B  a pelican described with the plate's own furniture (hermetic, ouroboros, roses,
 *      Rosicrucian, crescent, cube) on page <= 6 — front matter, or a negative page
 *      number, which is how a back pastedown is numbered
 *   E  a pelican emblem / label / sticker / pasted slip on page <= 6 of a book whose
 *      contributing library IS the BPH (856 of the 866 candidate books)
 *   and never a row whose description says vessel, flask, printer's device, title-page
 *   border, Masonic apron, and the rest of NOT_PLATE — those are the real pelicans.
 *
 * Other people's ex-libris (Thomas South, Dr Albers, Francis King, …) are the same class
 * under the prompt rule but a different concern; they are COUNTED here and written only
 * with --include-other-exlibris.
 *
 * Perceptual hashes were used to check the set (780 of the plate-worded rows sit within
 * Hamming distance 4 of another), not to select it: at distance <= 12 dhash also matches
 * 4,600 circular diagrams. Words plus provenance select; the eye confirms.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/retype-bph-bookplates.mjs             # dry run
 *   node --env-file=.env.production.local scripts/maintenance/retype-bph-bookplates.mjs --apply
 *   … --limit=N                  first N rows only (smoke test)
 *   … --include-other-exlibris   also retype the non-BPH bookplates
 *   … --out=path.json            where the dry-run candidate list goes
 *                                (default scripts/output/bph-bookplates-<date>.json)
 */
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const INCLUDE_OTHER = process.argv.includes('--include-other-exlibris');
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? Infinity);
const OUT = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1]
  ?? `scripts/output/bph-bookplates-${new Date().toISOString().slice(0, 10)}.json`;

const SWEEP = 'bph-bookplates-2026-09';
const MAX_QUALITY = 0.3;
const FRONT_MATTER_MAX_PAGE = 6;

const BPH_NAME = /philosophia hermetica|bibliotheca philosophica|philosoph hermes|ritman library/i;
const PELICAN = /pelican/i;
const PLATE_FURNITURE = /hermetic|ouroboros|\broses\b|rosicrucian|crescent|cub(?:e|ic)|philosophia/i;
const PASTED_THING = /emblem|bookplate|book-plate|ex[- ]?libris|stamp|label|sticker|pasted|slip of paper/i;
const EXLIBRIS = /bookplate|book-plate|ex[- ]?libris/i;
// Real pelicans and real emblems that share the vocabulary: alchemical circulatory
// vessels, printer's devices, title-page borders, Masonic regalia, natural-history plates,
// and the manuscript emblem that was the one by-eye false positive ("rocky mountain").
const NOT_PLATE = /vessel|flask|distill|circulat|retort|apron|jewel|tracing|skeleton|onocrotal|anatom|fountain|tailpiece|initial|ripley|rebis|kneeling|chalice|medallion|vignette|acacia|winged globe|salamander|phoenix|nine woodcut|birds|printer|device|title page|border featuring|cartouche|mountain|crucifix|christ|cherub|pinecone|swan|logo|mannerist|gothic arch|frontispiece/i;
// The plate is a modern offset print; a real emblem in the front matter is cut or engraved.
const PRINTED_IMAGE = /woodcut|engrav|etch/i;

function isBphBook(book) {
  if (!book) return false;
  const lib = `${book.contributing_library || ''} ${book.image_source?.contributing_library || ''} ${book.provider || ''}`;
  return /philosophica hermetica|\bbph\b|ritman/i.test(lib) || book.image_source?.provider === 'bph';
}

/** Which rule admits this row, or null. `plate` says whose bookplate it is. */
function classify(row, book) {
  const d = typeof row.description === 'string' ? row.description : '';
  if (NOT_PLATE.test(d)) return null;
  const front = row.page_number == null || row.page_number <= FRONT_MATTER_MAX_PAGE;
  if (BPH_NAME.test(d)) return { rule: 'A-name', plate: 'bph' };
  if (PELICAN.test(d) && PLATE_FURNITURE.test(d) && front) return { rule: 'B-pelican+furniture', plate: 'bph' };
  if (front && isBphBook(book)) {
    if (PELICAN.test(d) && PASTED_THING.test(d)) return { rule: 'E-bph-book-pelican', plate: 'bph' };
    // "Hermetic Philosophy emblem on a white label" — the plate without the bird named.
    if (/hermetic|philosophia/i.test(d) && /emblem|label|sticker|pasted|stamp/i.test(d) && !PRINTED_IMAGE.test(d)) return { rule: 'G-bph-book-hermetic-label', plate: 'bph' };
    // Any ex-libris in the front matter of a BPH book is provenance, whoever's plate it is.
    if (EXLIBRIS.test(d)) return { rule: 'F-bph-book-exlibris', plate: 'bph-book' };
  }
  if (EXLIBRIS.test(d)) return { rule: 'C-other-exlibris', plate: 'other' };
  return null;
}

const count = (arr, f) => { const m = {}; for (const r of arr) { const v = f(r); m[v] = (m[v] || 0) + 1; } return m; };

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set. Run with: node --env-file=.env.production.local …'); process.exit(1); }
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (APPLY && (!supabaseUrl || !supabaseKey)) { console.error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are required for --apply (clip_embeddings.resource_type)'); process.exit(1); }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const gallery = db.collection('gallery_images');
  const pages = db.collection('pages');
  const books = db.collection('books');

  // The pool: every row that could be a bookplate by its own words, plus anything
  // "hermetic" in front matter (the plate described without its bird). ~3K of ~220K.
  const pool = await gallery.find(
    { $or: [
      { description: BPH_NAME }, { description: PELICAN }, { description: EXLIBRIS },
      { description: /hermetic|philosophia/i, $or: [{ page_number: { $lte: FRONT_MATTER_MAX_PAGE } }, { page_number: null }] },
    ] },
    { projection: { _id: 1, id: 1, page_id: 1, detection_index: 1, book_id: 1, page_number: 1, type: 1, gallery_quality: 1, description: 1 } },
  ).toArray();
  const bookIds = [...new Set(pool.map((r) => r.book_id).filter(Boolean))];
  const bookById = new Map();
  for (let i = 0; i < bookIds.length; i += 500) {
    const docs = await books.find({ id: { $in: bookIds.slice(i, i + 500) } }, { projection: { id: 1, contributing_library: 1, provider: 1, 'image_source.provider': 1, 'image_source.contributing_library': 1 } }).toArray();
    for (const b of docs) bookById.set(b.id, b);
  }

  const classified = [];
  for (const r of pool) {
    const c = classify(r, bookById.get(r.book_id));
    if (c) classified.push({ ...r, ...c });
  }
  const other = classified.filter((r) => r.plate === 'other');
  let todo = classified.filter((r) => r.plate !== 'other' || INCLUDE_OTHER);
  const alreadyDone = todo.filter((r) => r.type === 'exlibris' && typeof r.gallery_quality === 'number' && r.gallery_quality <= MAX_QUALITY);
  todo = todo.filter((r) => !alreadyDone.includes(r)).slice(0, LIMIT);

  console.log(`pool ${pool.length} rows; classified ${classified.length} (${JSON.stringify(count(classified, (r) => r.rule))})`);
  console.log(`BPH plate rows: ${classified.filter((r) => r.plate === 'bph').length} in ${new Set(classified.filter((r) => r.plate === 'bph').map((r) => r.book_id)).size} books; other owners' ex-libris in BPH front matter: ${classified.filter((r) => r.plate === 'bph-book').length}; ex-libris elsewhere: ${other.length}${INCLUDE_OTHER ? ' (INCLUDED)' : ' (counted only; --include-other-exlibris to write)'}`);
  console.log(`already exlibris <= ${MAX_QUALITY}: ${alreadyDone.length}; to write: ${todo.length} (${APPLY ? 'APPLY' : 'dry run'})`);
  console.log(`  by current type ${JSON.stringify(count(todo, (r) => r.type))}; by page ${JSON.stringify(count(todo, (r) => r.page_number == null ? 'null' : r.page_number <= FRONT_MATTER_MAX_PAGE ? '<=6' : '>6'))}`);

  if (!APPLY) {
    fs.mkdirSync('scripts/output', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ sweep: SWEEP, generated_at: new Date().toISOString(), to_write: todo, other_exlibris: other, already_done: alreadyDone.map((r) => r.id) }, null, 1));
    console.log(`dry run: candidate list written to ${OUT}. Re-run with --apply to write.`);
    for (const r of todo.slice(0, 8)) console.log(`  ${r.rule} p${r.page_number} ${r.type}/${r.gallery_quality} ${r.id} | ${(r.description || '').slice(0, 90)}`);
    await client.close();
    return;
  }

  // --- gallery_images + pages twin + sweep_log, one row at a time so every write is logged.
  const now = new Date();
  let galleryModified = 0, twinModified = 0, twinMismatch = 0, logged = 0;
  const touchedBooks = new Set();
  for (const r of todo) {
    const newQuality = Math.min(typeof r.gallery_quality === 'number' ? r.gallery_quality : MAX_QUALITY, MAX_QUALITY);

    // The twin must be the SAME detection: same description at that index, or we do not
    // touch the page (a re-run of extraction can reorder detected_images).
    const page = await pages.findOne({ id: r.page_id }, { projection: { detected_images: 1 } });
    const det = page?.detected_images?.[r.detection_index];
    const twinOk = !!det && (det.description || '') === (r.description || '');

    // Log BEFORE writing. A log row without a write is harmless and re-run-safe; a write
    // without a log loses the previous values — which is what a DNS blip did on the
    // first run (80 rows written, 79 logged).
    const logRow = await recordSweepAction(db, {
      sweep: SWEEP, book_id: r.book_id, action: 'retyped-exlibris',
      detail: { gallery_id: r.id, page_id: r.page_id, detection_index: r.detection_index, rule: r.rule, plate: r.plate, prev_type: r.type ?? null, prev_quality: r.gallery_quality ?? null, new_quality: newQuality, twin: det ? (twinOk ? 'pending' : 'description-mismatch') : 'missing' },
    });
    logged++;

    const res = await gallery.updateOne({ _id: r._id }, { $set: { type: 'exlibris', gallery_quality: newQuality, updated_at: now } });
    galleryModified += res.modifiedCount;

    if (twinOk) {
      const tr = await pages.updateOne({ id: r.page_id }, { $set: { [`detected_images.${r.detection_index}.type`]: 'exlibris', [`detected_images.${r.detection_index}.gallery_quality`]: Math.min(typeof det.gallery_quality === 'number' ? det.gallery_quality : MAX_QUALITY, MAX_QUALITY) } });
      twinModified += tr.modifiedCount;
      await db.collection('sweep_log').updateOne({ _id: logRow._id }, { $set: { 'detail.twin': 'updated' } });
    } else {
      twinMismatch++;
    }
    touchedBooks.add(r.book_id);
    if (logged % 100 === 0) console.log(`  ${logged}/${todo.length} rows; gallery modified ${galleryModified}, twins ${twinModified}`);
  }
  console.log(`gallery_images modified ${galleryModified} (expected ${todo.length}); pages twins modified ${twinModified}, twin mismatch/missing ${twinMismatch}; sweep_log rows ${logged}`);
  if (galleryModified !== todo.length) console.log(`  WARNING: modifiedCount != expected — ${todo.length - galleryModified} rows did not change (already at the target values, or moved under us)`);

  // --- Downstream runs over rows retyped on ANY run, not just this one: a resumed run must
  // still fix the rank and the CLIP row of what an interrupted run retyped (80 rows, 2026-09-28).
  for (const r of alreadyDone) touchedBooks.add(r.book_id);
  const allRetyped = [...todo, ...alreadyDone];

  // --- book_rank: same rule as recompute-gallery-book-rank.mjs / sync-worker, for the touched books only.
  let rankChanged = 0;
  for (const bookId of touchedBooks) {
    const docs = await gallery.find({ book_id: bookId }, { projection: { _id: 1, gallery_quality: 1, page_number: 1, detection_index: 1, book_rank: 1 } }).toArray();
    docs.sort((a, b) => (b.gallery_quality ?? 0) - (a.gallery_quality ?? 0)
      || (a.page_number ?? 0) - (b.page_number ?? 0)
      || (a.detection_index ?? 0) - (b.detection_index ?? 0));
    const ops = [];
    docs.forEach((d, i) => { if (d.book_rank !== i + 1) ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: { book_rank: i + 1 } } } }); });
    if (ops.length) rankChanged += (await gallery.bulkWrite(ops, { ordered: false })).modifiedCount;
  }
  console.log(`book_rank recomputed for ${touchedBooks.size} books; ${rankChanged} image ranks changed`);

  // --- clip_embeddings.resource_type (Supabase). Rows are keyed `gallery-<gallery id>`.
  const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const clipIds = allRetyped.map((r) => `gallery-${r.id}`);
  let clipUpdated = 0, clipErrors = 0;
  for (let i = 0; i < clipIds.length; i += 200) {
    const batch = clipIds.slice(i, i + 200);
    const { data, error } = await sb.from('clip_embeddings').update({ resource_type: 'exlibris' }).in('id', batch).select('id');
    if (error) { clipErrors++; console.error(`  clip batch ${i}: ${error.message}`); continue; }
    clipUpdated += data?.length ?? 0;
  }
  console.log(`clip_embeddings.resource_type set on ${clipUpdated} of ${clipIds.length} ids (${clipIds.length - clipUpdated} not in the CLIP index)${clipErrors ? `; ${clipErrors} batch errors` : ''}`);

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
