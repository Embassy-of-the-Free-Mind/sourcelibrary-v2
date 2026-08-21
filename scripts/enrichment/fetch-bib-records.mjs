#!/usr/bin/env node
/**
 * fetch-bib-records.mjs — build the reference set by working BACKWARDS from our
 * own claims, keeping the whole bibliographic record. (#3455, #3459)
 *
 * THE PRINCIPLE
 * -------------
 * "First English translation" asserts an unprovable universal negative. No
 * search establishes it — a catalogue returns only *nothing found*. The fix is
 * to assert absence against a NAMED, DATED, BOUNDED reference set rather than
 * against the world. This script builds that reference set.
 *
 * DRIVEN FROM CLAIMS, NOT FROM THE REGISTRY
 * -----------------------------------------
 * Do NOT try to fill the 24,061 existing `translation_catalogs` rows: none
 * carries an identifier, so there is no key to re-fetch them by, and most are
 * translations of works we do not hold. Instead, for each book we publicly badge
 * "First Translation", ask the authority *"does a complete English translation
 * of this work already exist?"* and keep whatever comes back whole.
 * `translation_catalogs` then fills as a byproduct, in the order that matters:
 * rows about books we hold and claim.
 *
 * QUERY BY AUTHOR, MATCH LOCALLY — and why the obvious approach fails
 * -------------------------------------------------------------------
 * The intuitive query is English-title-to-English-title: cross-language title
 * matching notoriously fails ("Noctes Atticae" vs "Attic Nights" share no
 * tokens), so use `books.english_title`. Measured 2026-07-29, that returns
 * essentially nothing — 96 queries, 7 records, 0 priors across all 12
 * traditions including Latin and Greek.
 *
 * The reason is that `books.english_title` is an AI-rendered GLOSS of the
 * original title page, not a bibliographic access point:
 *
 *   "Four Volumes of Divine and Human Marvels. First, on the Marvels of Sacred
 *    Scripture. Second, on the Marvelous Propositions of the Blessed Apostle…"
 *   "A short treatise on the nature of the elements, and how they cause wind,
 *    rain, lightning and thunder, [et]c. , Written in Low German by…"
 *
 * No English edition was ever published under those strings, so an exact-phrase
 * title search cannot match — and the title an English edition WAS published
 * under is precisely the unknown we are trying to discover. Querying on it
 * assumes the answer.
 *
 * So: query by AUTHOR (a stable access point across languages), pull the
 * author's records, and resolve work identity locally against the ORIGINAL
 * title — which is what MARC `240` uniform title carries for translations.
 * Measured on the same endpoint: `bath.author="Ficino"` → 88 records, 8 with
 * `041`; `bath.author="Paracelsus"` → 120 records, 4 with `041`.
 *
 * This is also much cheaper in requests: authors repeat across the badged set,
 * so one query serves every book by that author, and the records are stored
 * once and reused.
 *
 * COST
 * ----
 * FREE. loc.gov has no per-call fee and needs no auth; rate limits, not dollars,
 * are the constraint. No LLM call anywhere in this script — a reference-set hit
 * is a deterministic lookup, which is the entire point: every book the
 * catalogue resolves is a book Tier-2 verification never has to pay for.
 *
 * WHAT IT REPORTS
 * ---------------
 * The residue: badged books for which the reference set finds NO complete prior
 * English translation. That number sizes every downstream decision and is
 * currently unknown.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/enrichment/fetch-bib-records.mjs --limit 50            # dry-run
 *   node scripts/enrichment/fetch-bib-records.mjs --limit 50 --apply
 *   node scripts/enrichment/fetch-bib-records.mjs --book-id <id> --apply
 *   node scripts/enrichment/fetch-bib-records.mjs --lang la --limit 200 --apply
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { withMongo } from '../lib/mongo.mjs';
import {
  parseMarcXmlRecords,
  buildBibRecord,
  projectToCatalogRow,
} from '../lib/bib-record.mjs';
import { toSourceIso } from '../lib/translation-catalog-record.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'output');
const DATE = new Date().toISOString().slice(0, 10);

const APPLY = process.argv.includes('--apply');
const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};
const LIMIT = parseInt(argOf('--limit') ?? '50', 10);
const BOOK_ID = argOf('--book-id');
const LANG = argOf('--lang');
// --stratified N: sample N badged books PER LANGUAGE, restricted to books that
// carry a real `english_title`. This is the per-tradition coverage measurement:
// a null result only means something if the query itself was answerable, and a
// romanized vernacular title ("Thor bu bsKang rgyun gsol kha") is not a query
// LoC can answer. Without this restriction every non-Latin tradition reports
// 100% residue and the number measures our metadata, not the reference set.
const STRATIFIED = argOf('--stratified') ? parseInt(argOf('--stratified'), 10) : null;

// ── Reference set manifest ───────────────────────────────────────────────────
// A stated boundary is the whole point: the badge asserts absence FROM THIS SET,
// not absence from the world. Anything rendered to a reader must be able to name
// what was searched and when.
const REFERENCE_SET = {
  version: '1',
  snapshot_date: DATE,
  sources: [
    {
      id: 'loc',
      name: 'Library of Congress (SRU gateway, lcdb)',
      endpoint: 'http://lx2.loc.gov:210/lcdb',
      record_format: 'marcxml',
      auth: 'none',
      coverage: 'US imprint depth; strong post-1900 monographs, thin on continental scholarly translation',
      known_gaps: [
        'European scholarly presses (Brill, Brepols) under-represented',
        'pre-1900 translations inconsistently catalogued',
        'journal-published translations largely absent',
      ],
    },
  ],
};

// ── LoC SRU ──────────────────────────────────────────────────────────────────

const SRU_BASE = 'http://lx2.loc.gov:210/lcdb';
const REQUEST_DELAY_MS = 1100; // be a good citizen; rate limits are the constraint
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** CQL needs doubled double-quotes; strip characters that break the parser. */
function cqlTerm(s) {
  return String(s || '')
    .replace(/["\\]/g, ' ')
    .replace(/[()=<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function sruSearch({ title, author, maximumRecords = 5 }) {
  const clauses = [];
  if (title) clauses.push(`bath.title="${cqlTerm(title)}"`);
  if (author) clauses.push(`bath.author="${cqlTerm(author)}"`);
  if (!clauses.length) return { xml: null, query: null };

  const query = clauses.join(' and ');
  const url = `${SRU_BASE}?version=1.1&operation=searchRetrieve`
    + `&query=${encodeURIComponent(query)}`
    + `&maximumRecords=${maximumRecords}&recordSchema=marcxml`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(45_000),
    headers: { 'User-Agent': 'SourceLibrary/1.0 (+https://sourcelibrary.org; reference-set build)' },
  });
  if (!res.ok) throw new Error(`SRU ${res.status} ${res.statusText}`);
  return { xml: await res.text(), query };
}

// ── Book → query terms ───────────────────────────────────────────────────────

const GENERIC_AUTHORS = /^(anonymous|anon\.?|unknown|various|various authors|multiple authors|n\/a)$/i;

/**
 * The author term to search on. "Last, First" → "Last"; a generic/collective
 * "author" is not an access point and yields pure noise, so we refuse it and
 * record the book as unqueryable rather than pretending it was checked.
 */
function queryAuthor(book) {
  let a = (book.author || '').trim();
  if (!a || GENERIC_AUTHORS.test(a)) return '';
  // Multiple authors separated by ';' — take the first.
  a = a.split(';')[0].trim();
  a = a.includes(',') ? a.split(',')[0].trim() : a;
  // Drop dates and parentheticals that CQL treats as separate terms.
  a = a.replace(/\([^)]*\)/g, '').replace(/\d{3,4}/g, '').trim();
  return a.length >= 3 ? a : '';
}

// ── Local work-identity matching ─────────────────────────────────────────────

const TITLE_STOP = new Set([
  'the', 'and', 'with', 'from', 'that', 'this', 'for', 'des', 'der', 'die', 'und',
  'liber', 'libri', 'opus', 'opera', 'book', 'books', 'volume', 'tractatus',
  'english', 'translation', 'translated', 'works', 'text', 'new', 'notes',
  'introduction', 'edition', 'edited', 'selected',
]);

function titleTokens(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !TITLE_STOP.has(t));
}

/**
 * Does this MARC record describe the same work as this book?
 *
 * Matches the book's ORIGINAL title against the record's MARC 240 uniform title
 * first — for a translation, 240 carries the original title, which is exactly
 * the join we need — then falls back to 245. Asymmetric coverage: we ask how
 * much of the book's title is present in the record's, because a record title
 * legitimately carries subtitle and apparatus the book's does not.
 *
 * Conservative by design: this feeds a residue COUNT and demote CANDIDATES for
 * human sign-off, never an automatic flag change.
 */
export function workIdentityScore(book, bib) {
  const bookToks = [
    ...titleTokens(book.title),
    ...titleTokens(book.work_title),
  ];
  if (!bookToks.length) return { score: 0, basis: 'no book title tokens' };

  const candidates = [
    ['uniform_title(240)', bib.uniform_title],
    ['title(245)', bib.title],
  ].filter(([, v]) => v);

  let best = { score: 0, basis: 'no overlap' };
  for (const [basis, value] of candidates) {
    const recToks = new Set(titleTokens(value));
    if (!recToks.size) continue;
    const uniqBook = [...new Set(bookToks)];
    const hits = uniqBook.filter((t) => recToks.has(t)).length;
    const score = hits / uniqBook.length;
    if (score > best.score) best = { score, basis, matched: hits, of: uniqBook.length };
  }
  return best;
}

const MIN_WORK_IDENTITY = 0.5;

// ── Main ─────────────────────────────────────────────────────────────────────

await withMongo(async (db) => {
  const books = db.collection('books');
  const bibRecords = db.collection('bib_records');

  const PROJECTION = {
    id: 1, title: 1, english_title: 1, work_title: 1, author: 1,
    language: 1, original_language: 1, year: 1, work_id: 1,
    first_translation_status: 1,
  };

  let cohort;
  if (STRATIFIED) {
    // Equal-sized sample per tradition, English-titled only, so per-language
    // residue rates are comparable to one another.
    const base = {
      is_first_translation: true,
      visible: true,
      english_title: { $exists: true, $nin: [null, ''] },
    };
    const langs = await books.aggregate([
      { $match: base },
      { $group: { _id: '$language', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 12 },
    ]).toArray();
    cohort = [];
    for (const { _id: lang } of langs) {
      const slice = await books.find({ ...base, language: lang }, { projection: PROJECTION })
        .limit(STRATIFIED).toArray();
      cohort.push(...slice);
    }
  } else {
    const query = BOOK_ID
      ? { id: BOOK_ID }
      : { is_first_translation: true, visible: true, ...(LANG ? { language: LANG } : {}) };
    cohort = await books.find(query, { projection: PROJECTION })
      .limit(BOOK_ID ? 1 : LIMIT).toArray();
  }

  console.log(`Reference set v${REFERENCE_SET.version} (${REFERENCE_SET.snapshot_date})`);
  console.log(`Sources: ${REFERENCE_SET.sources.map((s) => s.name).join(', ')}`);
  console.log(`Cohort: ${cohort.length} badged book(s)${LANG ? ` [lang=${LANG}]` : ''}\n`);

  if (APPLY) {
    await bibRecords.createIndex({ _key: 1 }, { unique: true }).catch(() => {});
    await bibRecords.createIndex({ 'identifiers.lccn': 1 }).catch(() => {});
    await bibRecords.createIndex({ work_type: 1, completeness: 1 }).catch(() => {});
  }

  const perBook = [];
  const tally = { queried: 0, http_errors: 0, records_seen: 0, records_stored: 0, no_identifier: 0 };
  const workTypeTally = {};
  const byTradition = {};
  let withCompletePrior = 0;
  let unqueryable = 0;

  // One SRU query per distinct AUTHOR, reused across every book by that author.
  const authorCache = new Map();

  async function recordsForAuthor(author) {
    if (authorCache.has(author)) return authorCache.get(author);
    let result = { bibs: [], sruQuery: null, error: null };
    try {
      tally.queried++;
      const { xml, query: sruQuery } = await sruSearch({ author, maximumRecords: 40 });
      result.sruQuery = sruQuery;
      if (xml) {
        const recs = await parseMarcXmlRecords(xml);
        tally.records_seen += recs.length;
        for (const rec of recs) {
          let bib;
          try {
            bib = buildBibRecord({ rec, source: 'loc', rawXml: xml, query: sruQuery });
          } catch {
            // A record with no external identifier is exactly what we refuse to
            // store — an unre-checkable row is how the current registry got stuck.
            tally.no_identifier++;
            continue;
          }
          workTypeTally[bib.work_type] = (workTypeTally[bib.work_type] || 0) + 1;
          result.bibs.push(bib);
        }
      }
    } catch (err) {
      result.error = err.message;
      tally.http_errors++;
    }
    await sleep(REQUEST_DELAY_MS);
    authorCache.set(author, result);
    return result;
  }

  for (const book of cohort) {
    const author = queryAuthor(book);

    const bookResult = {
      book_id: book.id,
      book_title: book.title,
      query_author: author,
      queryable: Boolean(author),
      sru_query: null,
      error: null,
      author_records_seen: 0,
      records: [],
    };

    if (!author) {
      // Not "no prior exists" — "we could not ask". Kept distinct in the report:
      // conflating them is how an unasked question becomes a confident negative.
      bookResult.skip_reason = 'no usable author access point (anonymous/collective)';
      perBook.push(bookResult);
      unqueryable++;
      process.stdout.write(`  ${book.id} · ${String(book.title).slice(0, 44).padEnd(44)} SKIPPED (no author)\n`);
      continue;
    }

    const { bibs, sruQuery, error } = await recordsForAuthor(author);
    bookResult.sru_query = sruQuery;
    bookResult.error = error;
    bookResult.author_records_seen = bibs.length;

    for (const bib of bibs) {
      const identity = workIdentityScore(book, bib);
      if (identity.score < MIN_WORK_IDENTITY) continue;

      if (APPLY) {
        await bibRecords.updateOne(
          { _key: bib._key },
          { $set: bib, $addToSet: { seen_for_books: book.id } },
          { upsert: true },
        );
        tally.records_stored++;
      }

      bookResult.records.push({
        key: bib._key,
        title: bib.title,
        uniform_title: bib.uniform_title,
        work_identity: identity,
        work_type: bib.work_type,
        work_type_evidence: bib.work_type_evidence,
        completeness: bib.completeness,
        completeness_evidence: bib.completeness_evidence,
        item_language: bib.item_language,
        pub_year: bib.pub_year,
        original_languages: bib.original_languages,
        catalog_row: projectToCatalogRow(bib, {
          sourceLanguageIso: toSourceIso(book.original_language || book.language) ?? undefined,
        }),
      });
    }

    // The residue question, per book: is there a COMPLETE prior ENGLISH
    // translation? Language matters — a French translation defeats nothing.
    const priors = bookResult.records.filter(
      (r) => r.work_type === 'translation'
        && r.completeness === 'complete'
        && (!r.item_language || r.item_language.startsWith('eng')),
    );
    bookResult.complete_prior_count = priors.length;
    bookResult.language = book.language ?? 'unknown';
    if (priors.length) withCompletePrior++;

    // Per-tradition coverage — the measurement that sizes everything else.
    const lang = bookResult.language;
    byTradition[lang] ??= { books: 0, queryable: 0, author_hits: 0, work_matches: 0, translation_record: 0, complete_prior: 0 };
    byTradition[lang].books++;
    byTradition[lang].queryable++;
    if (bibs.length) byTradition[lang].author_hits++;
    if (bookResult.records.length) byTradition[lang].work_matches++;
    if (bookResult.records.some((r) => r.work_type === 'translation')) byTradition[lang].translation_record++;
    if (priors.length) byTradition[lang].complete_prior++;

    perBook.push(bookResult);
    process.stdout.write(
      `  ${book.id} · ${String(book.title).slice(0, 40).padEnd(40)} `
      + `auth_recs=${String(bibs.length).padStart(3)} `
      + `work_match=${String(bookResult.records.length).padStart(2)} `
      + `priors=${bookResult.complete_prior_count}\n`,
    );
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  const asked = perBook.length - unqueryable;
  const residue = asked - withCompletePrior;
  console.log('\n─── Reference-set pass ───────────────────────────────────────');
  console.log('  author queries issued :', tally.queried, `(http errors: ${tally.http_errors}, distinct authors: ${authorCache.size})`);
  console.log('  MARC records seen     :', tally.records_seen);
  console.log('  records stored        :', tally.records_stored, APPLY ? '' : '(dry-run — not written)');
  console.log('  refused, no identifier:', tally.no_identifier);
  console.log('  work_type distribution:', workTypeTally);

  console.log('\n─── The residue ──────────────────────────────────────────────');
  console.log(`  cohort                                          : ${perBook.length}`);
  console.log(`  UNASKABLE (no author access point)              : ${unqueryable}`);
  console.log(`  asked                                           : ${asked}`);
  console.log(`  ...with a COMPLETE English prior in this set    : ${withCompletePrior}`);
  console.log(`  RESIDUE (asked, nothing found → needs Tier-2)   : ${residue}`);
  console.log('\n  "Unaskable" is NOT "no prior exists". A book with an anonymous or');
  console.log('  collective author has no access point in this reference set, so it was');
  console.log('  never checked — counting it as a clean negative would manufacture');
  console.log('  exactly the false confidence this whole approach exists to remove.');
  if (asked) {
    const pct = ((residue / asked) * 100).toFixed(1);
    console.log(`\n  residue rate (of asked)                        : ${pct}%`);
    console.log('  Extrapolated Tier-2 cost at ~58k tokens/book:');
    console.log(`    this sample          ${(residue * 58_000 / 1e6).toFixed(2)}M tokens`);
    console.log(`    full public badge set (6,096 books) ≈ ${(6096 * (residue / asked) * 58_000 / 1e6).toFixed(0)}M tokens`);
    console.log('  NOTE: an extrapolation from a small sample, not a measurement.');
    console.log('  Any large paid run needs explicit cost sign-off.');
  }

  console.log('\n─── Coverage per tradition ───────────────────────────────────');
  console.log('  auth_hit = the author returned ANY record (is the author in this set at all?)');
  console.log('  work_mat = a returned record resolved to THIS work');
  console.log('  trans/prior = of those, a translation / a COMPLETE English prior');
  console.log(`  ${'language'.padEnd(14)} ${'asked'.padStart(5)} ${'auth_hit'.padStart(8)} ${'work_mat'.padStart(8)} ${'trans'.padStart(6)} ${'prior'.padStart(6)}`);
  const traditionRows = Object.entries(byTradition).sort((a, b) => b[1].books - a[1].books);
  for (const [lang, s] of traditionRows) {
    console.log(
      `  ${String(lang).padEnd(14)} ${String(s.queryable).padStart(5)} ${String(s.author_hits).padStart(8)} `
      + `${String(s.work_matches).padStart(8)} ${String(s.translation_record).padStart(6)} ${String(s.complete_prior).padStart(6)}`,
    );
  }
  console.log('\n  Read auth_hit FIRST. A tradition where the authors themselves return');
  console.log('  nothing is a COVERAGE gap in the reference set, not evidence that we are');
  console.log('  first — and a first-claim there currently rests on no evidence at all.');
  console.log('  Only where auth_hit is high does a zero in `prior` start to mean something.');

  console.log('\n  Absence here means absence FROM THIS SET, not from the world:');
  for (const s of REFERENCE_SET.sources) {
    console.log(`    ${s.name} — gaps: ${s.known_gaps.join('; ')}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `bib-records-pass-${DATE}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    reference_set: REFERENCE_SET,
    applied: APPLY,
    cohort_size: perBook.length,
    tally,
    work_type_distribution: workTypeTally,
    by_tradition: byTradition,
    books_with_complete_prior: withCompletePrior,
    unqueryable,
    asked,
    residue,
    books: perBook,
  }, null, 2));
  console.log(`\nWrote ${outPath}`);
  if (!APPLY) console.log('DRY-RUN — nothing written to bib_records. Re-run with --apply.');
});
