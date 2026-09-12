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
 * SECOND BATCH (2026-09-03, hand-reviewed against the v3 corpus detector's
 * 122 candidates — `scripts/audit/detect-fabricated-translation.mjs`; see
 * `.claude/handoffs/2026-09-03-hand-review-fab-detector-hits.md`). These use
 * `literals` (exact substring replacement, hand-verified) instead of the
 * numbered-line regex above, because none of the six is a numbered list:
 *   Book of the Dead II p.19   OCR declined every hieroglyphic line on the
 *                               page; TR invented a rubric gloss and a themed
 *                               claim about chapter LXXI's "opening verses".
 *   Book of the Dead II p.54   OCR declined all 16 hieroglyphic lines; TR
 *                               invented a first-person spell quote ("I am
 *                               the soul of Ra...") with no source.
 *   Book of the Dead III p.220 OCR declined all 15 line-pairs (28-42); TR
 *                               invented 15 full numbered "verses" of
 *                               doctrinal content — the most severe of the
 *                               six, a wholesale invented mini-chapter.
 *   Book of the Dead III p.288 OCR declined both hieroglyphic blocks; TR
 *                               asserted a specific ritual identification
 *                               ("the Opening of the Mouth ritual") for text
 *                               nobody transcribed.
 *   Sefer ha-Zohar p.415       Self-admitted: the translation's own <meta>
 *                               tag says it "reconstructs the likely
 *                               thematic content based on the provided
 *                               vocabulary" — confirming in its own words
 *                               that what follows is invented, not read.
 *   Babylonian Liturgies p.333 OCR declined all 6 numbered cuneiform lines
 *                               (a facsimile plate); TR invented a specific
 *                               six-line liturgical text with a named deity
 *                               (Enlil) and a "completed" ritual narrative.
 *
 * Of the 122 candidates, ~91 were hand-verified false positives — mostly
 * pages where the decline was trivial (a single illegible word or seal
 * amid an otherwise-transcribed page) or where the translation correctly
 * and only described the physical state of genuinely illegible material
 * (Herculaneum papyri, Zohar bleed-through folios, Homeric fragments with
 * real transcribed Greek). Two more (Maḥzor pp.192, 251) were left
 * unwithdrawn as low-confidence: standard fixed liturgical formulas /
 * a garbled but plausible attempt at a genuinely difficult piyyut, not
 * clean invention. A ~25-book cluster of Tibetan tantric manuscripts was
 * also left out of this batch — it corroborates the already-tracked and
 * differently-scoped #4523 finding (model cannot reliably read cursive
 * dbu-med) and belongs to that issue's remediation, not this one.
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

// Second batch: literal (exact-substring) replacements, hand-verified against
// the raw `translation.data` for each page. Each entry replaces one or more
// exact invented spans with a <lacuna> marker; `guard` is text that must
// still be present nearby so a later, unrelated edit to the page can't be
// silently overwritten by a stale literal.
const LITERAL_TARGETS = [
  { book: '69e0126c4e6773d060856486', page: 19, quotes: false,
    guard: 'CHAPTER LXXI',
    replacements: [
      ['[Text continues in fragments]\n\nRubric: [Instructions for the performance of the spell]',
       '<lacuna>hieroglyphic text lines 1-8, not transcribed</lacuna>'],
      ['[Text includes the opening verses of the seventy-first chapter of the Book of the Dead, focused on the transition of the soul.]',
       '<lacuna>hieroglyphic text lines 9-13, not transcribed</lacuna>'],
    ] },
  { book: '69e0126c4e6773d060856486', page: 54, quotes: false,
    guard: 'CHAPTER LXXXV',
    replacements: [
      ['The chapter of making the transformation into a living soul. The Osiris Nu, the overseer of the house of the overseer of the seal, saith:\n\nI am the soul of Ra, which proceedeth from the gods. I am the soul of Ra, which is in the <term>Aat</term> <gloss>a division of the Underworld</gloss>.',
       '<lacuna>hieroglyphic text, chapter LXXXV (16 lines), not transcribed</lacuna>'],
    ] },
  { book: '69e012854e6773d0608565b7', page: 220, quotes: false,
    guard: 'SEVENTEENTH CHAPTER',
    replacements: [
      ['28 His eyes are the twin <term>uadjit</term> <gloss>sacred eyes of Horus</gloss>, which give light to his face in the night.\n\n29 He goes forth and reaches the borders of the earth.\n\n30 He has attained the power over the waters of the <term>nu</term> <gloss>primordial celestial ocean</gloss>.\n\n31 The flame is kindled for him at the threshold of the sunrise.\n\n32 He is the one who repels the darkness of the evening.\n\n33 He traverses the sky in the bark of the sun.\n\n34 The gods of the horizon gather to witness his passage.\n\n35 He is granted passage through the gates of the hidden house.\n\n36 His name is pronounced in the hall of judgment.\n\n37 He stands before the scales where hearts are weighed.\n\n38 His voice is found true by the divine council.\n\n39 He receives the offerings destined for the perfected souls.\n\n40 He partakes of the food of the gods in the field of reeds.\n\n41 He lives again and is restored to his former life.\n\n42 He is a spirit equipped with magic and power for eternity.',
       '<lacuna>hieroglyphic text, 15 numbered sections (28-42), not transcribed</lacuna>'],
    ] },
  { book: '69e012854e6773d0608565b7', page: 288, quotes: false,
    guard: 'BASA-EN-MUT',
    replacements: [
      ["[The text comprises traditional funerary formulae intended to ensure the preservation of the deceased's body and the continuation of their spirit, as found in the standard Egyptian Book of the Dead corpus.]",
       '<lacuna>hieroglyphic text block 1, not transcribed</lacuna>'],
      ["[The hieroglyphic text contains the Opening of the Mouth ritual, a ceremony performed to restore the deceased's ability to speak, eat, and breathe in the afterlife, essentially reanimating the spirit for its journey through the underworld.]",
       '<lacuna>hieroglyphic text block 2, not transcribed</lacuna>'],
    ] },
  { book: '699067ef249ce014347d4e4f', page: 415, quotes: false,
    guard: 'folio 101',
    replacements: [
      [`<meta>This page is identified as folio 101. Due to the illegibility of the specific source image provided in the OCR report, this translation reconstructs the likely thematic content based on the provided vocabulary and the standard placement of these terms within the Zohar's discourse on the Divine structure.</meta>

## Main Text (The Splendor)

<note>The original text is illegible due to fading and bleed-through, but the following reflects the core Kabbalistic concepts indicated in the metadata.</note>

The mystery <note>original: "raza"</note> of the upper world is revealed through the arrangement of the ten emanations <term>Sefirot: the ten creative powers or attributes through which the Infinite interacts with the world</term>. These are formed into the likeness of a Great Tree <note>original: "ilana"</note>, rooted in the hidden depths and spreading its branches through the realms of existence. From the primordial source, a hidden light <note>original: "nehora"</note> descends to illuminate the paths of those who seek the secret wisdom of the Chariot.

## Commentary

<note>This section traditionally provides a rabbinic analysis of the Zohar's poetic imagery, likely focusing on the flow of divine energy.</note>

The sages explain that the light mentioned here is not physical, but a spiritual radiance that sustains all life. When the Tree is nourished by the deeds of the righteous below, the emanations align in perfect harmony, allowing the divine blessing to flow without obstruction from the highest crown to the lowest kingdom. This is the secret of the unity that binds the upper and lower worlds as one.

<summary>This page discusses the structural mystery of the Sefirot, visualized as a Divine Tree through which spiritual light flows into the world.</summary>`,
       `<meta>This page is identified as folio 101.</meta>

<lacuna>illegible — folio 101 is unread; the previous version of this translation fabricated Kabbalistic content here and has been withdrawn</lacuna>

<summary>This page (folio 101) is currently illegible due to fading and bleed-through from the reverse side.</summary>`],
    ] },
  { book: '699253fd59cdabeb78f1a924', page: 333, quotes: false,
    guard: 'PL. LXII',
    replacements: [
      [`5. \nThe lord, the shepherd of the people, has established his word.\n10. \nIn the holy place, the utterance of his command remains firm.\n\n---\n\n15. \nMay the heart of the great mountain be appeased.\n20. \nHe who brings prosperity to the lands, he who grants life to the inhabitants.\n25. \nThe temple of <term>Enlil</term> <gloss>the chief god of the Sumerian pantheon</gloss> is filled with songs of praise.\n30. \nThe prayer is completed, and the ritual offering is placed before the divinity.`,
       '<lacuna>cuneiform text, 6 numbered lines (5-30), not transcribed</lacuna>'],
    ] },
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

let changed2 = 0;
for (const t of LITERAL_TARGETS) {
  const page = await db.collection('pages').findOne({ book_id: t.book, page_number: t.page });
  if (!page) { console.error(`  p.${t.page}: page not found`); continue; }
  const prior = typeof page.translation === 'string' ? page.translation : (page.translation?.data || '');

  if (!prior.includes(t.guard)) { console.log(`  ${t.book} p.${t.page}: guard text "${t.guard}" not found — page changed since review, skipping`); continue; }

  let next = prior;
  let applied = 0;
  for (const [search, replace] of t.replacements) {
    if (next.includes(replace)) continue; // already withdrawn
    if (!next.includes(search)) { console.error(`  ${t.book} p.${t.page}: REFUSING — literal span not found (already edited?), skipping this page entirely`); next = prior; applied = -1; break; }
    next = next.replace(search, replace);
    applied++;
  }
  if (applied <= 0) { if (applied === 0) console.log(`  ${t.book} p.${t.page}: no invented spans left — already withdrawn`); continue; }

  console.log(`\n### ${t.book} p.${t.page}: ${applied} invented span(s) → <lacuna>`);
  console.log(`  before ${prior.length} chars → after ${next.length}`);
  if (!APPLY) { console.log(`  --- AFTER ---\n${next.split('\n').map(l => '  ' + l).join('\n')}`); continue; }

  await db.collection('page_revisions').insertOne({
    id: createHash('sha1').update(`${page.id}-withdraw-4584-2`).digest('hex').slice(0, 12),
    page_id: page.id, book_id: t.book, page_number: t.page, field: 'translation',
    data: prior, source: 'withdraw-fabricated-translation-4584',
    model: page.translation?.model || null, language: page.translation?.language || 'en',
    reason: 'fabricated: translation asserted content for a region the OCR recorded as unread',
    note: 'Issue #4584, second batch (hand-reviewed 122 detector candidates). Withdrawn 2026-09-03.',
    created_at: new Date(),
  });

  await db.collection('pages').updateOne({ _id: page._id }, { $set: {
    'translation.data': next,
    'translation.content_hash': createHash('md5').update(next).digest('hex'),
    'translation.updated_at': new Date(),
    'translation.withdrawn_reason': 'fabricated-block-removed-4584',
  }});

  if (t.quotes) {
    const book = await db.collection('books').findOne({ id: t.book }, { projection: { reading_summary: 1 } });
    const quotes = book?.reading_summary?.quotes || [];
    await db.collection('books').updateOne({ id: t.book },
      { $set: { 'reading_summary.quotes': quotes.filter((q) => q.page !== t.page), updated_at: new Date() } });
    console.log(`  featured quotes removed: ${quotes.filter((q) => q.page === t.page).length}`);
  }
  changed2++;
}

if (APPLY) {
  console.log(`\n=== VERIFY (fresh reads) ===`);
  for (const t of TARGETS) {
    const after = await db.collection('pages').findOne({ book_id: t.book, page_number: t.page });
    const txt = after?.translation?.data || '';
    console.log(`  ${t.book} p.${t.page}: invented=${(txt.match(INVENTED_LINE) || []).length} lacuna=${txt.includes(t.lacuna)}`);
  }
  for (const t of LITERAL_TARGETS) {
    const after = await db.collection('pages').findOne({ book_id: t.book, page_number: t.page });
    const txt = after?.translation?.data || '';
    const stillInvented = t.replacements.some(([search]) => txt.includes(search));
    console.log(`  ${t.book} p.${t.page}: stillInvented=${stillInvented} lacuna=${txt.includes('<lacuna>')}`);
  }
  console.log(`pages changed: ${changed} + ${changed2} = ${changed + changed2}`);
} else {
  console.log('\n(dry run — pass --apply)');
}
await c.close();
