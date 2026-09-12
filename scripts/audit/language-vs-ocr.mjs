#!/usr/bin/env node
/**
 * language-vs-ocr.mjs — adjudicate `books.language` against the TEXT. (#4654)
 *
 * PRIOR ART:
 *   scripts/maintenance/backfill-language-from-ocr.mjs — reads the same
 *     `<language>` tags out of `ocr.data`, but ONLY for books whose catalogue
 *     language is "Unknown". It fills blanks; it can never contradict a wrong
 *     label, which is the entire failure class here.
 *   scripts/maintenance/audit-language-mismatch.mjs — compares `ai_metadata.language`
 *     (the librarian model's title-page read) to the catalogue label. Complementary:
 *     that reads ONE page's metadata block, this reads the language the OCR
 *     declared on every page it transcribed. Findings feed the same review queue.
 *   scripts/audit/detect-book-languages.mjs — earlier detection pass.
 *
 * WHY CONTENT, NOT VOTES
 *   `books.language` has 3,649 books with disagreeing metadata claims and 79,982
 *   with no provenance at all. Two adjudication rules were measured and both
 *   corrupt data: preferring the catalogue breaks Theophrastus (its catalogue
 *   says English for a Greek/Latin text); majority vote turns the Demotic Magical
 *   Papyrus and the Mixtec Codex Nuttall into "English", because the catalogue's
 *   language-of-DESCRIPTION repeats across sources and outvotes the truth. Any
 *   rule that rewards agreement destroys the specific value.
 *
 *   The text does not vote. Summa Pisanella is labelled Spanish and its OCR says
 *   Latin on 12 of 12 pages; Vitoria is labelled Russian and says Latin on 9 of 12.
 *
 * WHY IT FLAGS RATHER THAN OVERWRITES
 *   Disagreement is often legitimate. `language` is the EDITION's language, so a
 *   Latin work in an English translation edition SHOULD read English while its
 *   pages read Latin. Bilingual editions (Graece et Latine) disagree by nature.
 *   Only two slices are auto-correctable, both encoded below.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/language-vs-ocr.mjs [--limit=N] [--apply]
 *   Dry run by default. --apply corrects ONLY the unambiguous slice and flags the rest.
 */

import { MongoClient } from 'mongodb';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const APPLY = argv.includes('--apply');
const LIMIT = parseInt(arg('limit', '500'), 10);
const PAGES = parseInt(arg('pages', '12'), 10);
const MIDDLE_FROM = parseFloat(arg('from', '0.35'));    // start sampling at this fraction of the book
const MIN_PAGES = 6;          // below this the OCR vote is too thin to act on
const UNANIMITY = 0.9;        // share of tagged pages agreeing, for auto-correct

const norm = (s) => String(s ?? '').trim().toLowerCase();
// Values that are not languages: IA leaks record types and bare ISO stubs.
const NOT_A_LANGUAGE = /^(books?|texts?|additional_collections|unknown|und|mul|zxx|an|ne|dz|tib|lb|n\/a|none|-)$/i;
// A multi-language label is a legitimate description of a bilingual edition.
const MULTI = /[/,;&]| and | et /i;

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const books = db.collection('books');
const pagesCol = db.collection('pages');

const candidates = await books.find(
  { pages_ocr: { $gt: 0 }, language: { $exists: true, $ne: null } },
  { projection: { id: 1, title: 1, language: 1, original_language: 1, text_role: 1,
    pages_count: 1, 'field_provenance.language': 1 } })
  .limit(LIMIT).toArray();

/**
 * Collect the OCR's own <language> votes for a batch of books.
 *
 * One page query PER BOOK timed out against Atlas at 300 books, and pulling
 * `ocr.data` client-side ships whole page transcriptions across the wire to read
 * a 20-character tag. So the tag is extracted SERVER-side with $regexFind and
 * only the captured string comes back — the payload is the answer, not the text.
 */
async function ocrLanguageVotes(batch) {
  const windows = batch.map((b) => {
    const n = b.pages_count ?? 0;
    // Short books have no reliable "middle"; read what there is past page 2.
    const start = n >= 40 ? Math.floor(n * MIDDLE_FROM) : Math.min(2, Math.max(0, n - 1));
    return { book_id: b.id, page_number: { $gt: start, $lte: start + PAGES } };
  });
  const out = new Map();
  const rows = await pagesCol.aggregate([
    // SAMPLE THE MIDDLE OF EACH BOOK, as a FRACTION of its length.
    // Front matter is routinely a different language from the text — the Teubner
    // Sextus Empiricus is GREEK with a LATIN praefatio, and a first-12-pages vote
    // called it Latin. A fixed offset does not fix that either: Teubner prefaces
    // run tens of pages, and it still read Latin at page 11. So the window starts
    // at MIDDLE_FROM of each book's own length.
    { $match: { $or: windows } },
    { $project: { book_id: 1, m: { $regexFind: { input: { $ifNull: ['$ocr.data', ''] }, regex: /<language>([^<]{1,40})<\/language>/i } } } },
    { $match: { 'm.captures.0': { $nin: [null, ''] } } },
    { $group: { _id: { b: '$book_id', l: { $toLower: { $trim: { input: { $arrayElemAt: ['$m.captures', 0] } } } } }, n: { $sum: 1 } } },
  ], { allowDiskUse: true }).toArray();
  for (const r of rows) {
    const { b, l } = r._id;
    if (!l || l === 'none') continue;
    if (!out.has(b)) out.set(b, new Map());
    out.get(b).set(l, (out.get(b).get(l) ?? 0) + r.n);
  }
  return out;
}

const votesByBook = new Map();
for (let i = 0; i < candidates.length; i += 100) {
  const batch = candidates.slice(i, i + 100);
  for (const [k, v] of await ocrLanguageVotes(batch)) votesByBook.set(k, v);
}

const rows = [];
for (const b of candidates) {
  const votes = votesByBook.get(b.id);
  if (!votes || !votes.size) continue;
  const tagged = [...votes.values()].reduce((a, n) => a + n, 0);
  if (!tagged) continue;
  const ranked = [...votes.entries()].sort((a, b2) => b2[1] - a[1]);
  const [ocrLang, ocrN] = ranked[0];
  const share = ocrN / tagged;
  const label = norm(b.language);
  if (!label || label === ocrLang || label.includes(ocrLang) || ocrLang.includes(label)) continue;

  // Legitimate disagreements — recorded, never corrected.
  let benign = null;
  if (MULTI.test(b.language)) benign = 'catalogue label names several languages (bilingual edition)';
  else if (b.text_role && b.text_role !== 'original') benign = `text_role=${b.text_role}: language is the EDITION's, pages may be the source`;
  else if (norm(b.original_language) === ocrLang) benign = 'label is the edition language; OCR matches original_language';

  const claims = b.field_provenance?.language?.claims ?? [];
  const singleClaim = claims.length <= 1;

  rows.push({
    b, ocrLang, ocrN, tagged, share, benign, singleClaim,
    // AUTO-CORRECT only where the label cannot be right and the text is decisive.
    auto: !benign && (
      NOT_A_LANGUAGE.test(b.language) ||
      (share >= UNANIMITY && tagged >= MIN_PAGES && singleClaim)
    ),
  });
}

const auto = rows.filter((r) => r.auto);
const flag = rows.filter((r) => !r.auto && !r.benign);
const benign = rows.filter((r) => r.benign);
console.log(`scanned ${candidates.length} OCR'd books; ${rows.length} where the label and the text disagree\n`);
console.log(`  AUTO-CORRECTABLE : ${auto.length}  (label is not a language, or OCR is >=${UNANIMITY * 100}% unanimous over >=${MIN_PAGES} pages against a single-claim label)`);
console.log(`  FLAG FOR REVIEW  : ${flag.length}`);
console.log(`  BENIGN           : ${benign.length}  (bilingual label, translation edition, or matches original_language)\n`);
for (const r of auto.slice(0, 12)) {
  console.log(`  FIX  ${r.b.id} "${String(r.b.title).slice(0, 44)}"`);
  console.log(`       ${r.b.language} -> ${r.ocrLang}   (OCR ${r.ocrN}/${r.tagged} pages, ${r.singleClaim ? 'single metadata claim' : 'multi-claim'})`);
}
for (const r of flag.slice(0, 8)) {
  console.log(`  FLAG ${r.b.id} "${String(r.b.title).slice(0, 44)}" — label ${r.b.language}, OCR ${r.ocrLang} ${r.ocrN}/${r.tagged}`);
}

if (!APPLY) { console.log('\nDry run — nothing written.'); await client.close(); process.exit(0); }

const { recordSweepAction } = await import('../lib/sweep-log.mjs');
let fixed = 0, flagged = 0;
for (const r of auto) {
  const res = await books.updateOne({ id: r.b.id, language: r.b.language }, {
    $set: {
      language: r.ocrLang.replace(/^./, (m) => m.toUpperCase()),
      'field_provenance.language': {
        source: 'ocr_content_read', value: r.ocrLang, date: new Date().toISOString(),
        chosen_from: 'ocr_language_tag',
        claims: [...(r.b.field_provenance?.language?.claims ?? []), { source: 'ocr_language_tag', value: r.ocrLang, pages: r.ocrN }],
        replaced: r.b.language,
      },
    },
  });
  if (res.modifiedCount) {
    fixed++;
    await recordSweepAction(db, {
      script: 'language-vs-ocr.mjs', issue: '#4654', collection: 'books', target: r.b.id,
      action: 'language-corrected-from-ocr', detail: `${r.b.language} -> ${r.ocrLang} (${r.ocrN}/${r.tagged} pages)`,
    }).catch(() => {});
  }
}
for (const r of flag) {
  const res = await books.updateOne({ id: r.b.id }, {
    $set: { language_review: { flagged_at: new Date().toISOString(), by: 'language-vs-ocr.mjs',
      label: r.b.language, ocr_says: r.ocrLang, ocr_pages: `${r.ocrN}/${r.tagged}` } },
  });
  if (res.modifiedCount) flagged++;
}
console.log(`\nAPPLIED: ${fixed} corrected, ${flagged} flagged for review`);
await client.close();
