#!/usr/bin/env node
/**
 * ft-reference-set-search.mjs — run every badged book against the reference set
 * and record the SEARCH, not just the answer. (#3459)
 *
 * This is the read side of the reference set built by ingest-loc-bulk.mjs. For
 * each book we publicly badge "First Translation", it asks one bounded question:
 *
 *     Does a complete English translation of this work already exist in
 *     <named reference set, at <snapshot date>>?
 *
 * and writes a `search_efforts` document holding the proposition, the reference
 * set with its declared gaps, the queries, every candidate WITH its screening
 * reason, and the git SHA of the code that ran it. See scripts/lib/search-effort.mjs
 * for why each of those is load-bearing.
 *
 * FREE and deterministic — the reference set is local, so this is index lookups,
 * not network calls. Re-running it over the same snapshot yields byte-identical
 * efforts, which is the property that makes a negative checkable by someone else.
 *
 * IT NEVER FLIPS A BADGE. Screening here is MECHANICAL and conservative: it can
 * reject a candidate on structural grounds (a study, a different work, a later
 * publication) but it marks anything genuinely arguable `unresolved`, which
 * blocks a `none_found` verdict rather than quietly rounding to "we're first".
 * Those go to human/model screening with the record attached.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ft-reference-set-search.mjs                    # dry-run
 *   node scripts/eval/ft-reference-set-search.mjs --apply
 *   node scripts/eval/ft-reference-set-search.mjs --lang Latin --limit 200
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { withMongo } from '../lib/mongo.mjs';
import { buildSearchEffort, SCREEN, VERDICT } from '../lib/search-effort.mjs';
import {
  titleTokens as toks,
  bookTitleTokens,
  matchWorkIdentity,
  normaliseTitle as norm,
  STRONG_WORK_IDENTITY as STRONG,
  hasCjk,
  cjkRuns,
} from '../lib/work-identity-match.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'output');
const BULK_DIR = path.join(OUT_DIR, 'loc-bulk');
const WIKIDATA_DIR = path.join(OUT_DIR, 'wikidata');
const DATE = new Date().toISOString().slice(0, 10);
const WIKIDATA_SNAPSHOT = DATE;

const APPLY = process.argv.includes('--apply');
const argOf = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };
const LANG = argOf('--lang');
const LIMIT = argOf('--limit') ? parseInt(argOf('--limit'), 10) : null;
/**
 * Which population to search.
 *
 *   badged  (default) — books we already claim. A `none_found` here means our
 *                       public claim survives the search.
 *   inverse           — visible translated non-English books we do NOT badge.
 *                       A `none_found` here means something entirely different:
 *                       a work we may have translated first and never claimed.
 *
 * These must never be pooled. The same verdict string carries opposite meaning in
 * the two cohorts — one is "our claim held", the other is "we may have a claim we
 * never made" — so every effort records which cohort produced it.
 */
const COHORT = argOf('--cohort') ?? 'badged';

const CODE_VERSION = (() => {
  try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); }
  catch { throw new Error('cannot resolve git SHA — an unpinned search effort is not reproducible'); }
})();

// ── Normalisation & work identity live in scripts/lib/work-identity-match.mjs ──
// (pure, so the gold set in tests/unit/reference-set-work-identity.test.ts can
//  exercise them without importing this script and triggering its main body).

const GENERIC_AUTHOR = /^(anonymous|anon\.?|unknown|various|various authors|multiple authors|n\/a|—|-)$/i;

/**
 * Collection/holding-institution names are not authors. Using one as an access
 * point buckets hundreds of unrelated manuscripts under a single surname and
 * produces pure noise.
 */
const COLLECTION_AUTHOR = /\b(collection|monastery|library|archive|museum|temple|dzong)\b/i;

/**
 * Author surname for indexing, or '' when there is no usable access point.
 *
 * The parenthetical is where a romanized name often lives — `（宋）邵雍 (Shao Yong)`
 * is a dynasty marker in CJK plus the *searchable* form in Latin script.
 * Blindly stripping parentheticals (the ordinary case: dates, qualifiers) threw
 * that away and left an unindexable CJK remnant, which is why 355 of 450 Chinese
 * badged books reported as having no author at all.
 */
function surname(a) {
  if (!a) return '';
  const raw = a.trim();
  if (GENERIC_AUTHOR.test(raw) || COLLECTION_AUTHOR.test(raw)) return '';

  const fromMain = (s) => {
    let c = s.replace(/\d{3,4}/g, '').split(';')[0].trim();
    if (c.includes(',')) c = c.split(',')[0];
    const w = norm(c).split(/\s+/).filter((x) => x.length > 1);
    return w[w.length - 1] || '';
  };

  // Prefer the name outside parentheses; fall back to a Latin-script
  // parenthetical when what remains has no Latin content to index.
  const outside = fromMain(raw.replace(/\([^)]*\)/g, ' '));
  if (outside) return outside;
  for (const m of raw.matchAll(/\(([^)]*)\)/g)) {
    const inner = fromMain(m[1]);
    if (inner) return inner;
  }
  return '';
}

// Retrieve generously; screening is what rejects. STRONG comes from the shared
// lib so the gold set and the run agree on the same threshold by construction.
const MIN_CANDIDATE = 0.34;

// ── Mechanical screening ─────────────────────────────────────────────────────

const PARTIAL_RE = /\bselections?\b|\bexcerpts?\b|\babridg|\banthology\b|\bpassages\b|\breader\b/i;

/** Our own translations are being published now, so that is the prior ceiling. */
const OUR_TRANSLATION_YEAR = new Date().getFullYear();

/**
 * Language name → the MARC-21 language codes that can legitimately represent it.
 * Several have both a bibliographic and a historical variant in real records
 * (Greek appears as both `gre` and `grc`), so this maps to a SET, not a code.
 */
const MARC3_CODES = {
  latin: ['lat'],
  greek: ['gre', 'grc'], 'ancient greek': ['gre', 'grc'], 'classical greek': ['gre', 'grc'],
  german: ['ger'], french: ['fre'], italian: ['ita'], dutch: ['dut'], spanish: ['spa'],
  hebrew: ['heb'], aramaic: ['arc'], arabic: ['ara'], persian: ['per'],
  sanskrit: ['san'], pali: ['pli'], tamil: ['tam'],
  chinese: ['chi'], 'classical chinese': ['chi'], japanese: ['jpn'], korean: ['kor'],
  tibetan: ['tib'], syriac: ['syr'], armenian: ['arm'], russian: ['rus'],
  egyptian: ['egy'], akkadian: ['akk'], sumerian: ['sux'],
};

/**
 * Screen ONE candidate. Structural rejections only.
 *
 * Anything requiring real bibliographic judgement returns `unresolved`, which
 * blocks `none_found`. That asymmetry is deliberate: a wrong rejection quietly
 * preserves a possibly-false badge, so the safe default when uncertain is to
 * keep the question open, not to close it.
 */
export function screenCandidate(book, row, identity) {
  const reasonBits = [`work-identity ${identity.score.toFixed(2)}`];

  if (identity.score < STRONG) {
    return { screen: SCREEN.DIFFERENT_WORK, reason: `weak title overlap (${reasonBits})` };
  }

  // A prior must precede OUR TRANSLATION, not the original edition we hold.
  //
  // `book.year` is the year of the source edition (e.g. a 1546 Latin printing).
  // Comparing a candidate against it rejects every real prior, because English
  // translations of an early-modern text are necessarily later than the text:
  // Boethius 1969 > 1546 reads as "later" when it is precisely the prior we are
  // hunting. That inversion silently screened out 100% of candidates on the
  // first run of this script.
  //
  // Our translations are published now, so the ceiling is the current year.
  const rowYear = parseInt(row.year, 10);
  if (Number.isFinite(rowYear) && rowYear > OUR_TRANSLATION_YEAR) {
    return {
      screen: SCREEN.LATER,
      reason: `record published ${rowYear}, after our translation (${OUR_TRANSLATION_YEAR}) — cannot be a prior`,
    };
  }

  const title = `${row.title} ${row.subtitle} ${row.uniform_title}`;
  if (PARTIAL_RE.test(title)) {
    return { screen: SCREEN.PARTIAL, reason: `title indicates selections/excerpts: "${row.title}"` };
  }

  // Source-language agreement. A Latin->English translation does not defeat a
  // Greek->English first claim.
  //
  // Only applied when we actually know our source language: `books.language` is
  // the EDITION language, not necessarily the language the work was composed in,
  // so an absent `original_language` means "unknown", never "mismatch". Rejecting
  // on a guess here would discard real priors.
  const bookSrc = norm(book.original_language);
  const expected = MARC3_CODES[bookSrc];
  if (expected && row.original_languages?.length
      && !row.original_languages.some((l) => expected.includes(l))) {
    return {
      screen: SCREEN.WRONG_LANGUAGE,
      reason: `record translates from ${row.original_languages.join('/')}, our source is ${bookSrc} (${expected.join('/')})`,
    };
  }

  // A strong work match, right language, not obviously partial, not later.
  // Whether it is genuinely COMPLETE and genuinely the SAME work needs a human
  // or a scoped model call with the MARC record in front of it.
  return {
    screen: SCREEN.UNRESOLVED,
    reason: `strong work match (${identity.score.toFixed(2)}) from ${row.original_languages?.join('/') || '?'} `
      + `published ${row.year || '?'} — needs screening for completeness and work identity`,
  };
}

// ── Reference set ────────────────────────────────────────────────────────────

/**
 * Fields every reference-set row must carry. A part written by an older or
 * different extractor is REFUSED rather than silently contributing rows with
 * missing keys.
 *
 * This is not hypothetical. Eight parts produced by a prototype extractor used
 * `uniform`/`orig`/`added` where the production one writes
 * `uniform_title`/`original_languages`/`added_entries`. Mixed into the same
 * directory they parsed fine, indexed fine, and produced plausible output — but
 * every row from those parts had no uniform title and no source language, so
 * work identity fell back to the 245 display title and real matches (Genji
 * monogatari) scored 0.50 instead of 1.00 and were screened out as different
 * works. Nothing failed; the reference set was just quietly worse.
 *
 * Same shape as the paired-artifact failures in CLAUDE.md: two producers, one
 * consumer, an assumed correspondence nobody checked.
 */
// Applies to the LoC extract only. Wikidata rows are produced by a different
// script with its own shape (no LCCN — the identifier is a Q-number), so the
// guard would reject a perfectly good source.
const REQUIRED_ROW_FIELDS = ['lccn', 'title', 'uniform_title', 'original_languages', 'item_language', 'added_entries'];

function loadReferenceSet() {
  if (!fs.existsSync(BULK_DIR)) {
    throw new Error(`no reference set at ${BULK_DIR} — run scripts/enrichment/ingest-loc-bulk.mjs first`);
  }
  const files = fs.readdirSync(BULK_DIR).filter((f) => /^eng-translations\.part\d+\.jsonl$/.test(f));
  if (!files.length) throw new Error(`no extracted parts in ${BULK_DIR}`);

  for (const f of files) {
    const full = path.join(BULK_DIR, f);
    const firstLine = fs.readFileSync(full, 'utf8').split('\n', 1)[0];
    if (!firstLine.trim()) throw new Error(`${f} is empty — re-extract it`);
    let row;
    try { row = JSON.parse(firstLine); } catch { throw new Error(`${f} is not valid JSONL`); }
    const missing = REQUIRED_ROW_FIELDS.filter((k) => !(k in row));
    if (missing.length) {
      throw new Error(
        `${f} was written by an incompatible extractor (missing: ${missing.join(', ')}). `
        + 'Delete it and re-run scripts/enrichment/ingest-loc-bulk.mjs for that part. '
        + 'Mixing schemas silently degrades work identity rather than failing.',
      );
    }
  }
  return files.map((f) => path.join(BULK_DIR, f));
}

// ── Main ─────────────────────────────────────────────────────────────────────

const files = loadReferenceSet();
// Second source. Presence in ANY catalogue proves a translation exists, so
// breadth is worth having even where a source is thin — and Wikidata carries a
// native-script work title on 44.7% of rows against LoC's 2.3%, which is the one
// place it materially extends reach.
const wikidataFiles = fs.existsSync(WIKIDATA_DIR)
  ? fs.readdirSync(WIKIDATA_DIR).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(WIKIDATA_DIR, f))
  : [];
const bySurname = new Map();
// Title-token index. An anonymous work has no author access point, but its TITLE
// is one — and 771 of the 991 books previously reported "not searchable" had a
// perfectly good title and merely lacked a usable author. Reporting those as
// unaskable understated what the reference set could actually answer.
const byTitleToken = new Map();
const byCjkGram = new Map();
let rowCount = 0;

let wikidataRows = 0;
for (const file of [...files, ...wikidataFiles]) {
  const isWikidata = wikidataFiles.includes(file);
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    rowCount++;
    if (isWikidata) wikidataRows++;
    for (const name of [row.author, ...(row.added_entries || [])].filter(Boolean)) {
      const sn = surname(name);
      if (!sn || sn.length < 3) continue;
      if (!bySurname.has(sn)) bySurname.set(sn, []);
      bySurname.get(sn).push(row);
    }
    for (const t of new Set([...toks(row.uniform_title), ...toks(row.title)])) {
      if (!byTitleToken.has(t)) byTitleToken.set(t, []);
      byTitleToken.get(t).push(row);
    }
    // Original-script index. Keyed on every 3-char window of each CJK run so a
    // containment match is reachable by lookup rather than a full scan.
    for (const run of cjkRuns(`${row.vernacular_uniform_title || ''} ${row.vernacular_title || ''}`)) {
      for (let i = 0; i + 3 <= run.length; i++) {
        const g = run.slice(i, i + 3);
        if (!byCjkGram.has(g)) byCjkGram.set(g, []);
        byCjkGram.get(g).push(row);
      }
    }
  }
}

/**
 * Candidate pool for a book with no author access point: the rarest of its title
 * tokens. Rarest keeps the pool small and specific — a common word like
 * "geometrie" would drag in thousands of unrelated rows, while an unusual one
 * ("itinerarium") lands on a handful. Pools above the cap are refused rather
 * than truncated, because a silently truncated pool is a search that reports a
 * negative it never actually performed.
 */
const MAX_TITLE_POOL = 4000;
function titlePool(bookToks) {
  let best = null;
  for (const t of bookToks) {
    const rows = byTitleToken.get(t);
    if (!rows) continue;
    if (!best || rows.length < best.rows.length) best = { token: t, rows };
  }
  if (!best) return { token: null, rows: [], refused: false };
  if (best.rows.length > MAX_TITLE_POOL) {
    return { token: best.token, rows: [], refused: true };
  }
  return { ...best, refused: false };
}

const REFERENCE_SET = {
  version: `loc-2016.p${files.length}.v1`,
  sources: [
  ...(wikidataFiles.length ? [{
    id: 'wikidata',
    name: 'Wikidata — English editions of non-English works (P629)',
    endpoint: 'https://query.wikidata.org/sparql',
    snapshot_date: WIKIDATA_SNAPSHOT,
    record_count: 0, // set below, once counted
    coverage: 'English editions linked by `edition or translation of` to a non-English work',
    known_gaps: [
      'the edition-of relation is essentially unpopulated outside Western literature: '
        + 'Tibetan 0, Classical Chinese 0, Syriac 0, Sanskrit 29 against 4,493 Sanskrit works. '
        + 'This source does NOT close the gaps LoC leaves.',
      'Welsh is ~30% of rows from a bulk import and never matches this corpus',
      'community-curated, so absence reflects modelling effort rather than the world',
    ],
  }] : []),
  {
    id: 'loc',
    name: 'Library of Congress MDSConnect Books-All',
    endpoint: 'https://www.loc.gov/cds/products/MDSConnect-books_all.html',
    snapshot_date: '2016-12-31',
    parts_ingested: files.length,
    parts_total: 43,
    record_count: rowCount,
    coverage: 'English translations (MARC 041$h present, item language eng) from the LoC book catalogue',
    known_gaps: [
      'snapshot ends 2016 — later translations absent by construction, not by evidence',
      'European scholarly presses (Brill, Brepols) under-represented relative to US imprints',
      'journal-published and dissertation translations largely uncatalogued',
      // The most consequential gap in this set, stated first because a CJK
      // `none_found` would otherwise read as evidence when it is nearly vacuous.
      'CJK works are reachable ONLY via an original-script (MARC 880) title, and '
        + 'LoC English-translation records almost never carry one: 205 of 8,774 '
        + 'CJK-source rows (2.3%). Romanized matching is unusable (mixed '
        + 'pinyin/Wade-Giles, differing syllable segmentation), so a `none_found` '
        + 'for a Chinese, Japanese or Korean work is close to uninformative here '
        + 'and needs a CJK-native catalogue or Wikidata before it means anything.',
      'other non-Latin traditions are reachable only via romanized 240 uniform titles, '
        + 'so a differing romanization scheme (Wylie variants) hides a real match',
      'the romanized generic-term stoplist was assembled without a specialist reader '
        + 'and may exclude a genuine match',
      ...(files.length < 43 ? [`only ${files.length} of 43 catalogue parts ingested`] : []),
    ],
  }],
};
const WD = REFERENCE_SET.sources.find((s) => s.id === 'wikidata');
if (WD) WD.record_count = wikidataRows;
REFERENCE_SET.version = `loc-2016.p${files.length}${wikidataFiles.length ? `+wd-${WIKIDATA_SNAPSHOT}` : ''}.v2`;

console.log(`Reference set ${REFERENCE_SET.version}: ${rowCount.toLocaleString()} English translations, `
  + `${bySurname.size.toLocaleString()} distinct surnames (${files.length}/43 parts)\n`);

await withMongo(async (db) => {
  // Re-apply durable screening judgements. Without this, every new snapshot or
  // code change resets all screening to `unresolved` and the human work is lost.
  const decisionRows = await db.collection('screening_decisions').find({}).toArray();
  const decisionByWork = new Map(decisionRows.map((d) => [d.work, d]));
  if (decisionByWork.size) {
    console.log(`Carrying forward ${decisionByWork.size} screening decision(s) from previous passes.\n`);
  }

  const ELIGIBLE = {
    visible: true,
    pages_translated: { $gt: 0 },
    language: { $nin: [null, 'English'] },
  };
  const query = COHORT === 'inverse'
    ? { ...ELIGIBLE, is_first_translation: { $ne: true }, ...(LANG ? { language: LANG } : {}) }
    : { is_first_translation: true, visible: true, ...(LANG ? { language: LANG } : {}) };
  let cursor = db.collection('books').find(query, {
    projection: { id: 1, title: 1, work_title: 1, author: 1, language: 1, original_language: 1, year: 1, work_id: 1 },
  });
  if (LIMIT) cursor = cursor.limit(LIMIT);
  const books = await cursor.toArray();
  console.log(`Badged visible books: ${books.length}\n`);

  const efforts = [];
  const verdictTally = {};
  const byTradition = {};

  for (const book of books) {
    const sn = surname(book.author);
    const lang = book.language || 'unknown';
    byTradition[lang] ??= { books: 0, searchable: 0, candidates: 0, unresolved: 0, prior: 0 };
    byTradition[lang].books++;

    const bookToks = bookTitleTokens(book.title, book.work_title);

    // Two access points, tried in order of specificity. An author is the better
    // one; a title is a real one, not a fallback to be skipped.
    let pool = [];
    const queries = [];
    const candidates = [];
    let refusedPool = false;

    if (sn) {
      pool = bySurname.get(sn) || [];
      queries.push({
        source: 'loc',
        query: `author_surname="${sn}" over ${REFERENCE_SET.version}`,
        result_count: pool.length,
      });
    } else if (hasCjk(`${book.title} ${book.work_title || ''}`)) {
      // Original-script access point: the only one available for a CJK title
      // with no usable author and no Latin tokens.
      const grams = new Set();
      for (const run of cjkRuns(`${book.title} ${book.work_title || ''}`)) {
        for (let i = 0; i + 3 <= run.length; i++) grams.add(run.slice(i, i + 3));
      }
      const seen = new Set();
      for (const g of grams) {
        for (const r of byCjkGram.get(g) || []) {
          if (seen.has(r.lccn)) continue;
          seen.add(r.lccn); pool.push(r);
        }
      }
      queries.push({
        source: 'loc',
        query: `cjk_trigrams=[${[...grams].slice(0, 6).join(',')}] over ${REFERENCE_SET.version}`,
        result_count: pool.length,
      });
    } else if (bookToks.length) {
      const tp = titlePool(bookToks);
      pool = tp.rows;
      refusedPool = tp.refused;
      queries.push({
        source: 'loc',
        query: tp.token
          ? `title_token="${tp.token}" over ${REFERENCE_SET.version}`
          : `no indexed title token over ${REFERENCE_SET.version}`,
        result_count: tp.rows.length,
        ...(tp.refused ? { refused: `pool exceeded ${MAX_TITLE_POOL} rows — token too common to search on` } : {}),
      });
    }

    // Searchable means an access point existed AND we could actually run the
    // query. A refused (over-large) pool is NOT a clean negative.
    // A CJK title yields no Latin tokens but IS searchable via original script,
    // so token emptiness alone must not mark a book unaskable.
    const hasVernacular = [book.title, book.work_title].filter(Boolean).some(hasCjk);
    const searchable = queries.length > 0 && (bookToks.length > 0 || hasVernacular) && !refusedPool;

    if (searchable) {
      byTradition[lang].searchable++;
      for (const row of pool) {
        // Uniform-title containment first: it is the work-identity test. Fall
        // back to display-title overlap only when there is no 240 to use.
        const best = matchWorkIdentity(bookToks, row, {
          bookTitles: [book.title, book.work_title].filter(Boolean),
          bookAuthorSurname: sn || surname(book.author),
          recordAuthorSurnames: [row.author, ...(row.added_entries || [])]
            .filter(Boolean).map(surname).filter(Boolean),
        });
        if (!best || best.score < MIN_CANDIDATE) continue;
        let { screen, reason } = screenCandidate(book, row, best);
        // A judgement already made about this work outranks the mechanical
        // screen — it was made with the record in front of a human.
        const prior = decisionByWork.get(book.work_title || book.title);
        if (prior && screen === SCREEN.UNRESOLVED) {
          screen = prior.screen;
          reason = `[carried forward ${new Date(prior.decided_at).toISOString().slice(0, 10)}] ${prior.reason}`;
        }
        candidates.push({
          identifiers: { lccn: row.lccn },
          title: row.title,
          uniform_title: row.uniform_title || undefined,
          year: row.year,
          original_languages: row.original_languages,
          publisher: row.publisher || undefined,
          record_author: row.author || undefined,
          work_identity: best,
          screen,
          reason,
        });
      }
    }

    const effort = buildSearchEffort({
      bookId: book.id,
      workId: book.work_id,
      proposition: `Does a complete English translation of "${book.work_title || book.title}"`
        + `${book.author ? ` by ${book.author}` : ''} exist in the reference set`
        + `${book.year ? `, published before ${book.year}` : ''}?`,
      referenceSet: REFERENCE_SET,
      queries,
      candidates,
      searchable,
      codeVersion: CODE_VERSION,
    });

    effort.cohort = COHORT;
    efforts.push(effort);
    verdictTally[effort.verdict] = (verdictTally[effort.verdict] || 0) + 1;
    byTradition[lang].candidates += candidates.length;
    byTradition[lang].unresolved += candidates.filter((c) => c.screen === SCREEN.UNRESOLVED).length;
    byTradition[lang].prior += candidates.filter((c) => c.screen === SCREEN.PRIOR).length;
  }

  console.log(`─── Verdicts (cohort: ${COHORT}) ──────────────────────────────`);
  for (const [v, n] of Object.entries(verdictTally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.padEnd(22)} ${String(n).padStart(5)}`);
  }
  console.log(COHORT === 'inverse'
    ? '\n  INVERSE COHORT — these books carry NO badge. Here `none_found` does not\n'
      + '  confirm a claim, it SURFACES a possible one: a work with no English\n'
      + '  translation in the reference set that we have translated and never claimed.\n'
      + '  It is a candidate for the first-translation pipeline, not a verdict.'
    : '\n  none_found means "nothing found in THIS set", never "we are first".');
  console.log('  not_searchable means we could not ask — it is not a clean negative.');
  console.log('  inconclusive means a real candidate needs screening before any claim.');

  console.log('\n─── By tradition ─────────────────────────────────────────────');
  console.log(`  ${'language'.padEnd(14)} ${'books'.padStart(5)} ${'askable'.padStart(7)} ${'cands'.padStart(6)} ${'unresolved'.padStart(10)}`);
  for (const [l, s] of Object.entries(byTradition).sort((a, b) => b[1].books - a[1].books).slice(0, 16)) {
    console.log(`  ${l.padEnd(14)} ${String(s.books).padStart(5)} ${String(s.searchable).padStart(7)} `
      + `${String(s.candidates).padStart(6)} ${String(s.unresolved).padStart(10)}`);
  }

  const needScreening = efforts.filter((e) => e.verdict === VERDICT.INCONCLUSIVE);
  console.log(`\n  ${needScreening.length} book(s) have candidates awaiting screening.`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `ft-reference-set-search-${COHORT}-${DATE}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    reference_set: REFERENCE_SET,
    code_version: CODE_VERSION,
    verdicts: verdictTally,
    by_tradition: byTradition,
    efforts,
  }, null, 2));
  console.log(`\nWrote ${outPath}`);

  if (!APPLY) {
    console.log('DRY-RUN — nothing written to search_efforts. Re-run with --apply.');
    return;
  }

  const coll = db.collection('search_efforts');
  await coll.createIndex({ effort_id: 1 }, { unique: true });
  await coll.createIndex({ book_id: 1, run_at: -1 });
  await coll.createIndex({ verdict: 1 });
  let written = 0;
  for (let i = 0; i < efforts.length; i += 500) {
    const res = await coll.bulkWrite(efforts.slice(i, i + 500).map((e) => ({
      updateOne: { filter: { effort_id: e.effort_id }, update: { $set: e }, upsert: true },
    })), { ordered: false });
    written += res.upsertedCount + res.modifiedCount + res.matchedCount;
  }
  console.log(`APPLIED — ${written} search_efforts upserted (no badge was changed).`);
});
