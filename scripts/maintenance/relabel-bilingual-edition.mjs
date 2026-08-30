#!/usr/bin/env node
/**
 * Relabel an edition whose LEAVES carry two languages but whose catalogue record
 * names one — from the evidence the leaves themselves supply.
 *
 * `.claude/docs/invariants/language-fields.md` ranks the per-page `<language>`
 * tag inside `pages.ocr.data` as the strongest language signal we hold: genuine
 * per-page detection by the model that read the leaf, already paid for. It also
 * names the gap this script fills — `normalize-language-tags.mjs` *parses* the
 * string already in `books.language` and so can split "Greek-Latin" into two,
 * but "a book tagged `Greek` that is half Latin stays `["Greek"]`". Detection is
 * exactly what it cannot do.
 *
 * The Ximénez Popol Vuh is that book. It is catalogued `K'iche' Maya`; its own
 * page tags say `K'iche', Spanish` on 111 of 132 leaves, because Ximénez wrote
 * the K'iche' and his Spanish translation in parallel columns. Under the
 * one-language record, every Spanish surface in the product is blind to it.
 *
 * WHAT IT WRITES, and nothing else:
 *   language        the compound value, in the corpus's existing shape
 *                   ("Nahuatl-Spanish", "Greek-Latin" — 96 of 229 live values
 *                   are already list-shaped strings)
 *   languages[]     the parsed list, ordered by measured page share
 *   language_multi  true
 *
 * It does NOT touch `original_language` (a claim about the WORK, not this
 * edition), `text_role`, or anything else. Rule 1 of the invariant — never
 * derive a language correction without gating on `text_role` — is honoured by
 * refusing any book that is not `text_role: original`: a translation edition's
 * `language` is legitimately the translator's language and is not evidence of
 * anything being wrong.
 *
 * DRY RUN BY DEFAULT. Prints the page-tag tally it is reasoning from, so the
 * proposal can be judged against the evidence rather than taken on trust.
 *
 *   node --env-file=.env.production.local scripts/maintenance/relabel-bilingual-edition.mjs --book=<id>
 *   node --env-file=.env.production.local scripts/maintenance/relabel-bilingual-edition.mjs --book=<id> --commit
 */
import { MongoClient } from 'mongodb';
import { parseLanguageField, sameLanguageFamily } from '../lib/language-normalize.mjs';

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const BOOK = arg('book');
const COMMIT = process.argv.includes('--commit');
/** A language must appear on at least this share of tagged pages to be named. */
const MIN_PAGE_SHARE = Number(arg('min-share') || 0.15);

if (!BOOK) { console.error('usage: --book=<book id> [--commit] [--min-share=0.15]'); process.exit(2); }

/**
 * The languages one page's OCR envelope declares, canonicalised.
 *
 * The `<language>` tag has NO controlled vocabulary — `.claude/docs/invariants/
 * language-fields.md` lists `Ancient Greek`, bare `de`, `early new high german`,
 * `None` — so the parsing is delegated to `language-normalize`, the repo's one
 * normaliser, rather than re-implemented here. That module already knows the
 * things a local split gets wrong: it refuses `N/A` before any delimiter split
 * (which is what stops "N/A" becoming two languages called `n` and `a`), folds
 * ISO codes, and maps the spelling variants. Writing a fifth vocabulary is the
 * thing the invariant explicitly warns against.
 */
function tagLanguages(ocrData) {
  const m = String(ocrData || '').match(/<language>([^<]{0,200})<\/language>/i);
  return m ? parseLanguageField(m[1]) : [];
}

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');

const book = await db.collection('books').findOne(
  { id: BOOK },
  { projection: { id: 1, title: 1, language: 1, languages: 1, language_multi: 1, text_role: 1, pages_count: 1 } },
);
if (!book) { console.error(`No book with id ${BOOK}`); await client.close(); process.exit(1); }
if (book.text_role && book.text_role !== 'original') {
  console.error(`Refusing: text_role is ${JSON.stringify(book.text_role)}. On a translation edition, \`language\` is the translator's language and is not evidence of a mislabel (language-fields.md, rule 1).`);
  await client.close();
  process.exit(1);
}

const pages = await db.collection('pages').find({ book_id: BOOK }).project({ 'ocr.data': 1 }).toArray();
const tally = new Map();
let tagged = 0;
for (const p of pages) {
  const tags = tagLanguages(p.ocr?.data);
  if (!tags.length) continue;
  tagged++;
  // One vote per language per page, and per FAMILY rather than per label: the
  // measured artifact this prevents is a model emitting two names for one text
  // ("Chinese" + "Classical Chinese" was 38% of the corpus's apparently-bilingual
  // books on the first detector run). `languageFamily` is what that rule lives
  // in; here it is enough to de-duplicate the page's own list through it.
  const seen = [];
  for (const t of tags) if (!seen.some((s) => sameLanguageFamily(s, t))) seen.push(t);
  for (const t of seen) tally.set(t, (tally.get(t) || 0) + 1);
}

console.log(`${book.title}`);
console.log(`  id=${book.id}  catalogued language=${JSON.stringify(book.language)}  languages=${JSON.stringify(book.languages)}`);
console.log(`  ${pages.length} pages, ${tagged} carry a <language> tag`);
if (!tagged) { console.error('No page tags to reason from — nothing to propose.'); await client.close(); process.exit(1); }

const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
for (const [lang, n] of ranked) {
  const share = n / tagged;
  console.log(`    ${String(n).padStart(5)} pages (${(100 * share).toFixed(1)}%)  ${lang}${share >= MIN_PAGE_SHARE ? '' : '   — below the bar, not named'}`);
}

const detected = ranked.filter(([, n]) => n / tagged >= MIN_PAGE_SHARE).map(([lang]) => lang);
if (detected.length < 2) {
  console.log(`\nThe leaves name ${detected.length} language above ${(100 * MIN_PAGE_SHARE).toFixed(0)}% — this is not a bilingual edition by the page tags. Nothing to do.`);
  await client.close();
  process.exit(0);
}

/**
 * The CATALOGUED language stays first, and the detected ones are appended.
 *
 * Ordering purely by measured page share is the obvious thing and it is wrong.
 * On the Ximénez Popol Vuh, Spanish is tagged on 96% of leaves and K'iche' on
 * 89% — Ximénez's Spanish column runs a little further into the front matter and
 * the Escolios — so a share-ordered rule renames the K'iche' Popol Vuh
 * "Spanish-K'iche'". Which language a bilingual edition principally IS is a
 * curatorial judgement already recorded in `books.language`; the leaves are
 * evidence that something is MISSING from it, never that it is backwards. This
 * is the invariant's own rule for the Korean/hanmun class ("an addition, never a
 * replacement of `language`") applied to a different pair, and it also keeps
 * `languages[0] === language`'s first element (rule 4) meaning what it says.
 */
const catalogued = parseLanguageField(book.language);
const languages = [...catalogued];
for (const d of detected) if (!languages.some((l) => sameLanguageFamily(l, d))) languages.push(d);
if (languages.length === catalogued.length) {
  console.log('\nThe leaves name nothing the catalogue does not already say. Nothing to do.');
  await client.close();
  process.exit(0);
}
// The compound scalar keeps the catalogue's own shape — 96 of 229 live
// `books.language` values are already list-shaped strings ("Nahuatl-Spanish",
// "Greek-Latin"), so this adds no new convention.
const language = languages.join('-');

console.log(`\nPROPOSED`);
console.log(`  language:       ${JSON.stringify(book.language)}  →  ${JSON.stringify(language)}`);
console.log(`  languages:      ${JSON.stringify(book.languages)}  →  ${JSON.stringify(languages)}`);
console.log(`  language_multi: ${JSON.stringify(book.language_multi)}  →  true`);

if (!COMMIT) {
  console.log('\nDRY RUN — pass --commit to write.');
  await client.close();
  process.exit(0);
}

const res = await db.collection('books').updateOne(
  { id: BOOK },
  { $set: { language, languages, language_multi: true, updated_at: new Date() } },
);
console.log(`\nmatched=${res.matchedCount} modified=${res.modifiedCount}`);
console.log('`updated_at` bumped so the Supabase catalog sync picks the row up — run scripts/maintenance/sync-books-catalog.mjs (or wait for the cron).');
await client.close();
