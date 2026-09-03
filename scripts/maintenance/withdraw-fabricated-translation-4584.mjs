#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/quarantine-fabricated-ocr.mjs (#4149) does this
 * for fabricated OCR on BLANK leaves — it preserves to `page_revisions` then
 * `$unset`s the field. This borrows its method but cannot reuse it: there the
 * OCR is wrong and there is no correct text, so the field is removed wholesale.
 * Here the OCR is CORRECT (it honestly declined) and only PART of the
 * translation is invented, so the fix is surgical rather than a delete.
 *
 * Withdraws fabricated translations — content asserted for a region the OCR
 * recorded as unread (#4584).
 *
 * TARGETS (each verified BY HAND before being listed here; the corpus detector
 * that surfaced them ran at ~8% precision, so its output is a work list and
 * never an authority):
 *   Urkunden IV p.24        20 invented lines of funerary formulae, one of
 *                           which was promoted to a featured quote. WITHDRAWN.
 *   Book of the Dead II     pp.33-34: OCR transcribed NO hieroglyphs
 *                           ("[Hieroglyphic text lines 1-28]") and the
 *                           translation supplied numbered <note> claims about
 *                           what those lines say. Milder than p.24 — the
 *                           content sits in AI-marked <note> tags rather than
 *                           being served as the source's words — but it still
 *                           tells a reader what an unread line 29 contains.
 *
 * WHAT WENT WRONG. The OCR read the German apparatus correctly and recorded the
 * glyph block as unread — `[Hieroglyphic text lines x+1 through 20]`. The
 * translation phase then rendered those twenty unread lines as twenty lines of
 * English funerary formulae with no source. One of them was promoted into the
 * book's `reading_summary.quotes` and served on a `visible: true` book as a
 * quotation of Sethe, complete with an interpretive gloss about the ideal of
 * Maat, for a sentence that does not exist.
 *
 * WHAT THIS DOES, IN ORDER
 *   1. Re-reads the page NOW and asserts the fabrication is still present.
 *      A stale work list must never be able to edit a page's text.
 *   2. Writes the full prior translation to `page_revisions` with
 *      `source: 'withdraw-fabricated-translation-4584'` — nothing is destroyed
 *      and the fabrication stays auditable.
 *   3. Replaces ONLY the invented lines with a single <lacuna> marker, keeping
 *      the legitimate translation of the German apparatus (title, the Hermann/
 *      Anthes citation, "Only the final lines are preserved").
 *   4. Removes the invented featured quote from `reading_summary.quotes`.
 *
 * WHY <lacuna> AND NOT A FLAG: `<lacuna>` (#4605, merged) is registered in
 * EDITORIAL_WRAPPERS in both stripper twins, so its content is dropped from
 * quotes, ngrams, embeddings, PDF and EPUB. A flag would leave the text in
 * place for every consumer that reads `translation.data` and checks no flags.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/withdraw-fabricated-translation-4584.mjs [--apply]
 */
import { MongoClient } from 'mongodb';
import { createHash } from 'crypto';

const APPLY = process.argv.includes('--apply');
const TARGETS = [
  { book: '69e013c593b116d24238b3d7', page: 24,
    lacuna: '<lacuna>20 lines of hieroglyphic text, not transcribed</lacuna>',
    anchor: /(<note>A large diagram[^<]*<\/note>)/, quotes: true },
  { book: '69e0126c4e6773d060856486', page: 33,
    lacuna: '<lacuna>hieroglyphic text lines 1-34, not transcribed</lacuna>',
    anchor: /(<header>[^<]*<\/header>)/, quotes: false },
  { book: '69e0126c4e6773d060856486', page: 34,
    lacuna: '<lacuna>hieroglyphic text block, not transcribed</lacuna>',
    anchor: /(<header>[^<]*<\/header>)/, quotes: false },
];

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

// Matches both observed shapes: "x+3. …" (Urkunden) and "29. <note>…" (Book of the Dead).
const INVENTED_LINE = /^\s*(?:x\+)?\d+\.\s+\S.*(?:\n|$)/gm;

let changed = 0;
for (const t of TARGETS) {
  const page = await db.collection('pages').findOne({ book_id: t.book, page_number: t.page });
  if (!page) { console.error(`  p.${t.page}: page not found`); continue; }
  const prior = typeof page.translation === 'string' ? page.translation : (page.translation?.data || '');

  // (1) Assert on the LIVE document. A stale work list must not edit a page.
  const invented = prior.match(INVENTED_LINE) || [];
  if (invented.length < 5) { console.log(`  ${t.book} p.${t.page}: ${invented.length} invented lines — already withdrawn or changed, skipping`); continue; }

  const stripped = prior.replace(INVENTED_LINE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
  const next = stripped.includes(t.lacuna) ? stripped : stripped.replace(t.anchor, `$1\n\n${t.lacuna}`);
  if (!next.includes(t.lacuna)) { console.error(`  ${t.book} p.${t.page}: REFUSING — anchor missing, the gap would vanish silently`); continue; }

  console.log(`\n### ${t.book} p.${t.page}: ${invented.length} invented lines → <lacuna>`);
  console.log(`  before ${prior.length} chars → after ${next.length}`);
  if (!APPLY) { console.log(`  --- AFTER ---\n${next.split('\n').map(l => '  ' + l).join('\n')}`); continue; }

  // (2) Preserve. Nothing is destroyed.
  await db.collection('page_revisions').insertOne({
    id: createHash('sha1').update(`${page.id}-withdraw-4584`).digest('hex').slice(0, 12),
    page_id: page.id, book_id: t.book, page_number: t.page, field: 'translation',
    data: prior, source: 'withdraw-fabricated-translation-4584',
    model: page.translation?.model || null, language: page.translation?.language || 'en',
    reason: 'fabricated: translation asserted content for a region the OCR recorded as unread',
    note: 'Issue #4584. Withdrawn 2026-09-03; invented lines replaced with a <lacuna> marker.',
    created_at: new Date(),
  });

  // (3) Replace the text.
  await db.collection('pages').updateOne({ _id: page._id }, { $set: {
    'translation.data': next,
    'translation.content_hash': createHash('md5').update(next).digest('hex'),
    'translation.updated_at': new Date(),
    'translation.withdrawn_reason': 'fabricated-block-removed-4584',
  }});

  // (4) Remove any featured quote drawn from the withdrawn region.
  if (t.quotes) {
    const book = await db.collection('books').findOne({ id: t.book }, { projection: { reading_summary: 1 } });
    const quotes = book?.reading_summary?.quotes || [];
    await db.collection('books').updateOne({ id: t.book },
      { $set: { 'reading_summary.quotes': quotes.filter((q) => q.page !== t.page), updated_at: new Date() } });
    console.log(`  featured quotes removed: ${quotes.filter((q) => q.page === t.page).length}`);
  }
  changed++;
}

if (APPLY) {
  console.log(`\n=== VERIFY (fresh reads) ===`);
  for (const t of TARGETS) {
    const after = await db.collection('pages').findOne({ book_id: t.book, page_number: t.page });
    const txt = after?.translation?.data || '';
    console.log(`  ${t.book} p.${t.page}: invented=${(txt.match(INVENTED_LINE) || []).length} lacuna=${txt.includes(t.lacuna)}`);
  }
  console.log(`pages changed: ${changed}`);
} else {
  console.log('\n(dry run — pass --apply)');
}
await c.close();
