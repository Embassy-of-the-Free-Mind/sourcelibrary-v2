#!/usr/bin/env node
/**
 * One book, adjudicated BY HAND from its own pages (#5620): LoC 2021666345
 * (book 69af123a0092756351e4483e) was imported by the "March Chinese:
 * Jesuit-Era Science" campaign as Matteo Ricci's 畸人十篇 (1608). It is the
 * Ming chuanqi play 繡襦記 in the Chen Meigong commentary edition:
 *   p.1  繡襦記序                         (preface)
 *   p.2  signed 艸學人余文熙               (Yu Wenxi, the preface writer LoC names)
 *   p.3  陳眉公先生批評繡襦記卷上目録      (table of contents, 41 scenes)
 *   p.5  附汧國傳 · 唐 太原白行簡撰        (Bai Xingjian's source tale, appended)
 * LoC's own description, stored on the record since import, says the same:
 * "Xiu ru ji (Story of the embroidered coat) by Ming dynasty author Xue Jingun
 * ... reviewed by Chen Jiru (style name Meigong)". So the error is OURS — the
 * campaign attached hand-supplied titles to LCCNs that do not hold those works.
 * LoC romanises 薛近兗 as "Xue Jingun" (兗 read as 袞); the pinyin is Xue Jinyan.
 * The play is also attributed to 徐霖; the byline follows LoC.
 *
 * PRIOR ART: scripts/maintenance/repair-pharar-author-2026-09-24.mjs — same
 * shape (book-keyed hand repair, provenance, sweep_log, Supabase mirror,
 * derived lane). It string-replaces the old name inside derived prose; that
 * cannot work here, where the summaries describe a different BOOK, so they are
 * cleared for the pipeline to re-derive (derived-metadata-lane.md: "clearing is
 * required"). And it backs up to a gitignored file; this one keeps the `before`
 * snapshot in the sweep_log row, so --revert survives the worktree.
 *
 * Writes:
 *   books          title, display_title, english_title, author, author_id,
 *                  published, year, normalized_*, tradition; $unset the Ricci
 *                  derived lane (summary, summary_candidate, reading_summary,
 *                  quality_assessment, quality_score, faceted_tags, locations,
 *                  author_entity_id) and the Ricci work_id/edition_key (a local
 *                  work_id is minted from title+author, so it is WRONG, not
 *                  moved: no alias — the play is not an edition of 畸人十篇).
 *   book_indexes   $unset bookSummary (the only index part that names Ricci;
 *                  vocabulary/people/pageSummaries were read off the pages).
 *   authors        mint `xue-jinyan` (additive; matteo-ricci untouched).
 *   books_catalog  (Supabase) title, display_title, author, year, published,
 *                  summary_text, work_id, quality_score.
 *   gallery_images book_title/book_author/book_year mirrors; captions that name
 *                  Ricci trimmed or withheld (see repairGallery), mirrored onto
 *                  pages.detected_images.
 *   field_provenance + sweep_log rows.
 * Left alone, on purpose: the slug (changing it breaks links), chapters and
 * index (correct, read from the pages), translations, and the first-translation
 * fields (those were resolved against the wrong title, but FT verdicts go
 * through their own resolver — first-translation-claims.md).
 *
 * After --apply: restamp the edition key with
 *   npx tsx scripts/maintenance/materialize-edition-keys.ts --book-id=69af123a0092756351e4483e --apply
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-xiuruji-identity-5620.mjs
 *   node --env-file=.env.production.local scripts/maintenance/repair-xiuruji-identity-5620.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/repair-xiuruji-identity-5620.mjs --revert --apply
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { normalizeTitle, normalizeAuthor } from '../lib/dedup-normalize.mjs';

const RUN = 'repair-xiuruji-identity-5620';
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');

const BOOK_ID = '69af123a0092756351e4483e';
const FROM = { title: '畸人十篇 (Ten Chapters of an Extraordinary Man)', author: 'Matteo Ricci', author_id: 'matteo-ricci' };
const TO = {
  title: '陳眉公先生批評繡襦記 (Xiu ru ji: Story of the Embroidered Coat)',
  display_title: 'Story of the Embroidered Coat',
  english_title: 'Story of the Embroidered Coat',
  author: 'Xue Jinyan (薛近兗)',
  author_id: 'xue-jinyan',
  // LoC dates the commentator (Chen Jiru, 1558–1639) and publisher (Xiao
  // Mingsheng, 1575–1644) but we could not read its imprint date (loc.gov is
  // behind a bot wall). "1608" was the campaign's date for Ricci, not this
  // print, so no year is better than that one. No digits in `published`:
  // sync-books-catalog's deriveYear() would read any number there as the year.
  published: 'late Ming dynasty',
  year: null,
  tradition: ['Chinese'],
};
const WHY = 'pp.1-5 read 繡襦記序 / 陳眉公先生批評繡襦記 / 附汧國傳; LoC description: "Xiu ru ji ... by Ming dynasty author Xue Jingun"; #5620';

const UNSET = ['summary', 'summary_candidate', 'reading_summary', 'quality_assessment', 'quality_score',
  'faceted_tags', 'locations', 'author_entity_id',
  'work_id', 'work_id_confidence', 'work_id_source', 'work_title', 'work_slug',
  'edition_key', 'edition_key_quality'];
const SET_FIELDS = ['title', 'display_title', 'english_title', 'author', 'author_id', 'published', 'year',
  'tradition', 'normalized_title', 'normalized_author'];

const cleanEnv = (v) => (v || '').replace(/\\n/g, '').trim();
const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
const SUPABASE_KEY = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
async function supabasePatch(patch) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: 'no creds' };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${BOOK_ID}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  const b = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, rows: Array.isArray(b) ? b.length : 0 };
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');

if (REVERT) {
  const log = await db.collection('sweep_log').findOne({ sweep: RUN, book_id: BOOK_ID, action: 'identity-repaired-by-hand' }, { sort: { _id: 1 } });
  if (!log) { console.error('no sweep_log row to revert from'); process.exit(1); }
  const { before, before_book_index_summary: idxBefore } = log.detail;
  const set = {}; const unset = {};
  for (const f of [...SET_FIELDS, ...UNSET]) (before[f] === undefined ? (unset[f] = '') : (set[f] = before[f]));
  console.log(`would restore ${Object.keys(set).length} field(s), unset ${Object.keys(unset).length}`);
  if (!APPLY) { console.log('(add --apply)'); await mc.close(); process.exit(0); }
  const r = await books.updateOne({ id: BOOK_ID }, { $set: { ...set, updated_at: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  if (idxBefore) await db.collection('book_indexes').updateOne({ book_id: BOOK_ID }, { $set: { bookSummary: idxBefore } });
  const s = await supabasePatch({ title: before.title, display_title: before.display_title, author: before.author,
    year: before.year ?? null, published: before.published ?? null, work_id: before.work_id ?? null });
  console.log(`reverted book: ${r.modifiedCount}; supabase ${JSON.stringify(s)} (summary_text re-mirrors on the next catalog sync)`);
  const glogs = await db.collection('sweep_log').find({ sweep: RUN, book_id: BOOK_ID, action: 'gallery-caption-repaired' }).sort({ _id: -1 }).toArray();
  for (const g of glogs) {
    const { image_id, page_id, detection_index, before: gb } = g.detail;
    await db.collection('gallery_images').updateOne({ id: image_id }, { $set: gb });
    const pageSet = {};
    if (gb.description !== undefined) pageSet[`detected_images.${detection_index}.description`] = gb.description;
    if (gb.museum_description !== undefined) pageSet[`detected_images.${detection_index}.museum_description`] = gb.museum_description;
    if (Object.keys(pageSet).length) await db.collection('pages').updateOne({ id: page_id }, { $set: pageSet });
  }
  console.log(`reverted gallery images: ${glogs.length}`);
  await mc.close(); process.exit(0);
}

// Gallery lane: each extracted illustration mirrors the book's title/author/year,
// and its captions were written knowing only the (wrong) book identity, so two
// say the woodcuts illustrate Ricci. The sanctioned re-caption tool
// (reground-captions.mjs) makes paid vision calls; this does the $0 part.
//   - mirrors (book_title/book_author/book_year): follow the repaired book;
//   - `description`: the false trailing clause is cut, the pixel description kept;
//   - `museum_description` written about the wrong book: withheld (the original
//     goes to sweep_log), since no trim leaves a true sentence;
//   - subject tag "Jesuit mission": dropped.
// pages.detected_images carries the same captions at `detection_index` — kept in step.
// `museum_description_pre_reground` is history of an earlier rewrite: untouched.
const WRONG_RX = /Ricci|Extraordinary Man|Jiren shipian|Jesuit/;
async function repairGallery() {
  const imgs = await db.collection('gallery_images').find({ book_id: BOOK_ID }).toArray();
  let changed = 0;
  for (const img of imgs) {
    const set = { book_title: TO.display_title, book_author: TO.author, book_year: null };
    const unset = {};
    const before = { book_title: img.book_title, book_author: img.book_author, book_year: img.book_year };
    if (typeof img.description === 'string' && WRONG_RX.test(img.description)) {
      const cut = img.description.replace(/,\s*accompanying the text of Matteo Ricci's 'Ten Chapters of an Extraordinary Man'\.?$/, '.');
      if (WRONG_RX.test(cut)) throw new Error(`${img.id}: description still names the wrong book after the cut: ${cut}`);
      set.description = cut; before.description = img.description;
    }
    if (typeof img.museum_description === 'string' && WRONG_RX.test(img.museum_description)) {
      unset.museum_description = ''; before.museum_description = img.museum_description;
    }
    const subjects = img.metadata?.subjects;
    if (Array.isArray(subjects) && subjects.some((s) => WRONG_RX.test(s))) {
      set['metadata.subjects'] = subjects.filter((s) => !WRONG_RX.test(s)); before['metadata.subjects'] = subjects;
    }
    const noop = img.book_title === set.book_title && img.book_author === set.book_author && img.book_year == null
      && Object.keys(set).length === 3 && !Object.keys(unset).length;
    if (noop) continue;
    changed++;
    console.log(`  gallery ${img.id} p${img.page_number}: ${[...Object.keys(set), ...Object.keys(unset).map((k) => `-${k}`)].join(', ')}`);
    if (!APPLY) continue;
    await recordSweepAction(db, {
      sweep: RUN, book_id: BOOK_ID, action: 'gallery-caption-repaired',
      detail: { image_id: img.id, page_id: img.page_id, detection_index: img.detection_index, before },
    });
    await db.collection('gallery_images').updateOne({ id: img.id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    const pageSet = {}; const pageUnset = {};
    if (set.description) pageSet[`detected_images.${img.detection_index}.description`] = set.description;
    if (unset.museum_description !== undefined) pageUnset[`detected_images.${img.detection_index}.museum_description`] = '';
    if (Object.keys(pageSet).length || Object.keys(pageUnset).length) {
      await db.collection('pages').updateOne({ id: img.page_id },
        { ...(Object.keys(pageSet).length ? { $set: pageSet } : {}), ...(Object.keys(pageUnset).length ? { $unset: pageUnset } : {}) });
    }
  }
  console.log(`gallery images ${APPLY ? 'repaired' : 'to repair'}: ${changed} of ${imgs.length}`);
}

const book = await books.findOne({ id: BOOK_ID });
if (!book) { console.error('book not found'); process.exit(1); }
if (book.title !== FROM.title || book.author !== FROM.author) {
  console.log(`book no longer carries the Ricci identity (title="${book.title}", author="${book.author}")`);
  await repairGallery();
  await mc.close(); process.exit(0);
}

const to = { ...TO, normalized_title: normalizeTitle(TO.title), normalized_author: normalizeAuthor(TO.author) };
console.log(`book     ${BOOK_ID}  (LoC ${book.loc_lccn})`);
for (const f of SET_FIELDS) console.log(`  set    ${f}: ${JSON.stringify(book[f])} -> ${JSON.stringify(to[f])}`);
for (const f of UNSET) if (book[f] !== undefined) console.log(`  unset  ${f}: ${JSON.stringify(book[f]).slice(0, 90)}`);
const idx = await db.collection('book_indexes').findOne({ book_id: BOOK_ID }, { projection: { bookSummary: 1 } });
console.log(`  book_indexes.bookSummary: ${idx?.bookSummary ? 'unset (names Ricci)' : 'absent'}`);
const existing = await db.collection('authors').findOne({ _id: TO.author_id });
console.log(`  authors/${TO.author_id}: ${existing ? `exists (${existing.canonical_name})` : 'mint'}`);
if (!APPLY) { console.log('\n-- dry run (add --apply) --'); await mc.close(); process.exit(0); }

// Backup first, as a sweep_log row: it is the record of the action AND what --revert reads.
const before = {};
for (const f of [...SET_FIELDS, ...UNSET]) if (book[f] !== undefined) before[f] = book[f];
await recordSweepAction(db, {
  sweep: RUN, book_id: BOOK_ID, action: 'identity-repaired-by-hand',
  detail: { why: WHY, before, before_book_index_summary: idx?.bookSummary ?? null, to },
});

const now = new Date();
const minted = await db.collection('authors').updateOne({ _id: TO.author_id }, {
  $setOnInsert: {
    canonical_name: TO.author, slug: TO.author_id,
    // LoC's romanisation is kept as a variant so a LoC-sourced import of another
    // copy resolves here; both forms name only this playwright.
    variants: [TO.author, 'Xue Jingun', '薛近兗'], variant_slugs: [TO.author_id, 'xue-jingun'],
    viaf_id: null, wikidata_id: null, entity_ids: [],
    source: 'hand-adjudicated', built_at: now.toISOString(), note: WHY,
  },
}, { upsert: true });
const unset = Object.fromEntries(UNSET.map((f) => [f, '']));
const r = await books.updateOne({ id: BOOK_ID, author: FROM.author }, { $set: { ...to, updated_at: now }, $unset: unset });
console.log(`authors minted: ${minted.upsertedCount}  book modified: ${r.modifiedCount}`);
if (r.modifiedCount !== 1) { console.error('!! book not modified'); process.exit(1); }
const ix = await db.collection('book_indexes').updateOne({ book_id: BOOK_ID }, { $unset: { bookSummary: '' } });
console.log(`book_indexes modified: ${ix.modifiedCount}`);

await db.collection('field_provenance').insertMany(['title', 'author'].map((field) => ({
  book_id: BOOK_ID, field, value: to[field], previous_value: FROM[field], source: 'hand-adjudicated', run: RUN,
  evidence: { rationale: WHY, adjudicated_by: 'pages read against the LoC description, no model verdict used' },
  created_at: now.toISOString(),
})));

// The book page reads title and "About this book" from the Supabase mirror first.
const s = await supabasePatch({
  title: to.title, display_title: to.display_title, author: to.author, year: null, published: to.published,
  summary_text: null, work_id: null, quality_score: 0,
});
console.log(`supabase: ${JSON.stringify(s)}`);
console.log('provenance + sweep_log written.');
await repairGallery();
console.log('Next: materialize-edition-keys --book-id, then revalidate /book/' + BOOK_ID);
await mc.close();
