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
import { buildSearchEffort, effortToAttempt, SCREEN, VERDICT } from '../lib/search-effort.mjs';
import { appendAttempt } from '../lib/ft-attempt-log.mjs';
import {
  titleTokens as toks,
  bookTitleTokens,
  matchWorkIdentity,
  normaliseTitle as norm,
  STRONG_WORK_IDENTITY as STRONG,
  hasCjk,
  cjkRuns,
} from '../lib/work-identity-match.mjs';
import { languageMismatch } from '../lib/source-language-match.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'output');
const BULK_DIR = path.join(OUT_DIR, 'loc-bulk');
const WIKIDATA_DIR = path.join(OUT_DIR, 'wikidata');
const ESTC_DIR = path.join(OUT_DIR, 'estc');
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
 *   untranslated      — everything we HOLD in a non-English language and have
 *                       NOT translated. Here `none_found` is neither a claim nor
 *                       a missed claim: it is a WORK QUEUE. See below.
 *
 * These must never be pooled. The same verdict string carries a different meaning
 * in each — "our claim held", "we may have a claim we never made", "nobody has
 * done this yet" — so every effort records which cohort produced it.
 *
 * WHY `untranslated` IS THE COHORT THAT CAN TOLERATE 27% RECALL
 * ------------------------------------------------------------
 * The first two cohorts publish. A missed prior there becomes a false public
 * claim, which is why low recall is disqualifying and why `none_found` must not
 * be counted.
 *
 * Prioritisation publishes nothing. It ranks what to translate next, and the two
 * error directions cost completely different things:
 *
 *   a MISSED prior (low recall)  → a book sits higher in the queue than it
 *                                  deserves. Worst case we translate something
 *                                  that already exists in English. Recoverable,
 *                                  visible on reading, harms nobody.
 *   a FALSE prior (low precision)→ we silently drop a genuinely untranslated work
 *                                  off the queue and never revisit it.
 *
 * So prioritisation needs PRECISION on "already done", not recall — and precision
 * is the direction this instrument is strong in: 32/32 live identity
 * confirmations on the demote packet, and zero contradictions across the 399
 * books an independent classifier calls never_translated. Every prior we DO find
 * removes a book from the queue with high confidence; the ones we miss just leave
 * the queue noisier than ideal.
 *
 * That is the same evidence, at the same 27% recall, doing a job it is actually
 * fit for.
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
  // Applied only when BOTH sides resolve to a known language — see
  // scripts/lib/source-language-match.mjs. `books.language` is the EDITION
  // language, so an absent `original_language` means "unknown", never "mismatch",
  // and the same is true of a catalogue identifier we cannot read. Rejecting on a
  // guess here discards real priors: the previous MARC-code-only comparison did
  // exactly that to every Wikidata row.
  const langReason = languageMismatch(book.original_language, row);
  if (langReason) {
    return { screen: SCREEN.WRONG_LANGUAGE, reason: langReason };
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
// Third source (#3522). ESTC is not "more records" — it is the catalogue that
// records what LoC omits for 1473-1800, which is where this corpus lives and
// where LoC is structurally thin (~96% of its English records declare no
// translation marker at all). Its `search_titles` carries the MARC 240 uniform
// title with `$l English` as a matter of course, which is the exact key
// work-identity-match.mjs is built and gold-tested against.
const estcFiles = fs.existsSync(ESTC_DIR)
  ? fs.readdirSync(ESTC_DIR).filter((f) => /^estc-translations\..*\.jsonl$/.test(f)).map((f) => path.join(ESTC_DIR, f))
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
let estcRows = 0;
for (const file of [...files, ...wikidataFiles, ...estcFiles]) {
  const isWikidata = wikidataFiles.includes(file);
  const isEstc = estcFiles.includes(file);
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    rowCount++;
    if (isWikidata) wikidataRows++;
    if (isEstc) estcRows++;
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
  // The version names the GENERATION, and adding a source mints a new one — an
  // effort recorded against `loc-2016.p43.v1` was answered by a set that could
  // not see 1473-1800, and must not be read as though it could. `search_efforts`
  // is immutable so a stale negative re-opens; `screening_decisions` is keyed on
  // (work, prior) and is re-applied across generations, so human judgement
  // survives the bump while machine negatives do not.
  version: `loc-2016.p${files.length}.v1`,   // overwritten below — see the note there
  sources: [
  ...(estcFiles.length ? [{
    id: 'estc',
    name: 'English Short Title Catalogue (via CERL)',
    endpoint: 'https://datb.cerl.org/estc/_search',
    snapshot_date: '2026-08-07',
    record_count: 0, // set below, once counted
    coverage: 'English translations among English imprints 1473-1800, declared by a '
      + 'MARC 240 uniform title with `$l English` or by a translator relator term. '
      + '22,538 of 487,427 records examined (4.6%)',
    known_gaps: [
      'BOUNDARY: covers imprints 1473-1800 ONLY. A translation published after 1800 '
        + 'is absent BY CONSTRUCTION, not by evidence — and 80.8% of this corpus\'s '
        + 'known Latin/Greek priors are post-1950 imprints. ESTC complements LoC at '
        + 'the early-modern end; it does not replace it.',
      'English imprints only — a prior English translation printed at Amsterdam, '
        + 'Leiden or Paris (common for exile and Catholic presses) is out of scope',
      'no LCCN and no Q-number; the citable identifier is the ESTC S/R/T/N-number',
      'ESTC records the IMPRINT, so a translation reprinted without a new edition '
        + 'statement may appear once rather than per issue',
    ],
  }] : []),
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
      // RECALL CEILING — the 35.2% of rows (41,678 of 118,352) with no MARC 240.
      // These were unreachable as a confirmed match until 2026-08-01: work
      // identity was established by 240 containment alone and the 245 fallback
      // was capped below the confirmation threshold, so over a third of the set
      // could only ever yield `none_found`. The 245 path can now confirm, but
      // only under author corroboration, which leaves the residue named here.
      'RECALL CEILING: 35.2% of rows carry no 240 uniform title. They are now '
        + 'reachable through 245 display-title containment, but ONLY when an author '
        + 'access point agrees — so for an anonymous work, or one of ours with no '
        + 'usable author, a third of this set remains unconfirmable and `none_found` '
        + 'is still over-reported there.',
      'a 245 confirmation resting on a single generic container token ("letters", '
        + '"writings", "complete") is weak work identity; those candidates are held '
        + 'at `unresolved` for screening rather than counted either way',
      // A second, related gap: scholarly editions that print an ancient text
      // alongside its translation are frequently catalogued with NO 041 at all
      // (Langdon\'s *Babylonian Liturgies* has none; 22 of 23 LoC records for
      // Budge\'s *Book of the Dead* have none). The extraction filter requires
      // 041$h, so that whole class is absent from the set by construction.
      'scholarly editions printing a text WITH its translation often carry no 041 '
        + 'and are therefore excluded from this set entirely',
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
const ES = REFERENCE_SET.sources.find((s) => s.id === 'estc');
if (ES) ES.record_count = estcRows;
// This assignment is the one that counts — it overwrites the literal above, so
// a source added to `sources` without being named HERE is silently invisible in
// the version string, and every effort it answers would be filed under a
// generation that never saw it.
REFERENCE_SET.version = `loc-2016.p${files.length}`
  + `${wikidataFiles.length ? `+wd-${WIKIDATA_SNAPSHOT}` : ''}`
  + `${estcFiles.length ? '+estc-2026-08-07' : ''}`
  + `.v${estcFiles.length ? '3' : '2'}`;

console.log(`Reference set ${REFERENCE_SET.version}: ${rowCount.toLocaleString()} English translations, `
  + `${bySurname.size.toLocaleString()} distinct surnames (${files.length}/43 parts`
  + `${estcRows ? `, ${estcRows.toLocaleString()} ESTC` : ''})\n`);

await withMongo(async (db) => {
  // Re-apply durable screening judgements. Without this, every new snapshot or
  // code change resets all screening to `unresolved` and the human work is lost.
  const decisionRows = await db.collection('screening_decisions').find({}).toArray();
  const decisionByWork = new Map(decisionRows.map((d) => [d.work, d]));
  if (decisionByWork.size) {
    console.log(`Carrying forward ${decisionByWork.size} screening decision(s) from previous passes.\n`);
  }

  // ── Third source: our own translation_classification ───────────────────────
  //
  // 9,908 rows built Feb–Jul 2026, 2,755 of them asserting a prior or partial
  // English translation and 2,564 naming a translator, title and publisher. It
  // answered much of this question before the reference set was built, and was
  // used only as the yardstick for measuring recall. That is backwards: a source
  // that holds known priors belongs IN the set.
  //
  // It is not a catalogue, and it is not treated as one. Every row is a model's
  // assertion, so no row here can produce `prior_found` on its own — see
  // tcCandidate() below.
  const tcRows = await db.collection('translation_classification').find(
    { classification: { $in: ['previously_translated', 'partially_translated'] } },
    { projection: { book_id: 1, classification: 1, known_translation: 1, reasoning: 1, model: 1, classified_at: 1, confidence: 1, title: 1 } },
  ).toArray();

  // Join by our own work clustering as well as by book id. A prior translation
  // established for one edition of a work is established for every edition of it
  // — `books.work_id` is the canonical work key (see CLAUDE.md), and it reaches
  // 467 cohort books that were never classified themselves.
  const tcBooks = await db.collection('books').find(
    { id: { $in: tcRows.map((r) => r.book_id) } },
    { projection: { id: 1, work_id: 1 } },
  ).toArray();
  const workIdOf = new Map(tcBooks.map((b) => [b.id, b.work_id]));
  const tcByBookId = new Map();
  const tcByWorkId = new Map();
  for (const r of tcRows) {
    tcByBookId.set(r.book_id, r);
    const wid = workIdOf.get(r.book_id);
    if (!wid) continue;
    if (!tcByWorkId.has(wid)) tcByWorkId.set(wid, []);
    tcByWorkId.get(wid).push(r);
  }

  REFERENCE_SET.sources.unshift({
    id: 'translation_classification',
    name: 'Source Library — internal translation classification (model-attributed priors)',
    endpoint: 'mongodb://bookstore/translation_classification',
    snapshot_date: DATE,
    record_count: tcRows.length,
    coverage: 'books in our own corpus classified as having a prior or partial English '
      + 'translation, 2,564 of them naming a translator, title and publisher',
    known_gaps: [
      // Stated first because it caps what any candidate from this source can mean.
      'NOT A CATALOGUE: every row is an assertion by gemini-2.5-flash or '
        + 'gemini-3-flash-preview, unverified against any bibliographic record. An '
        + 'attribution here is a LEAD to be checked, never a confirmed prior, so no '
        + 'candidate from this source can close a question on its own.',
      'covers only the 9,908 books that were classified — it cannot answer about a '
        + 'book it never saw, and says nothing about the rest of the corpus',
      'its `never_translated` rows are an absence claim by a model and are '
        + 'deliberately NOT used as evidence of absence',
      '1,984 of its 9,908 rows no longer resolve to a live books.id',
    ],
  });
  REFERENCE_SET.version += `+tc-${DATE}`;
  console.log(`Reference set now ${REFERENCE_SET.version} — added translation_classification `
    + `(${tcRows.length.toLocaleString()} attributed priors, ${tcByWorkId.size.toLocaleString()} distinct works)\n`);

  /**
   * Build a candidate from a translation_classification row.
   *
   * ALWAYS `unresolved`, for both classifications. The mechanical screen rejects
   * only on structural grounds and defers anything needing bibliographic
   * judgement, and a model's attribution is exactly that — `Kessinger 2004` may
   * be a real reprint or a hallucination, and only reading a record settles it.
   *
   * Marking these `prior_translation` would let an unverified model claim drive a
   * `prior_found` verdict; marking `partial_translation` would let it drive
   * `only_partial_found`, which reads as "no prior COMPLETE translation exists" —
   * an absence claim we cannot support from this source either. `unresolved`
   * blocks `none_found` and asserts nothing, which is the whole of what we know.
   */
  const tcCandidate = (row, basis) => ({
    source: 'translation_classification',
    identifiers: { book_id: row.book_id },
    title: row.title,
    year: null,
    known_translation: row.known_translation || undefined,
    work_identity: { score: 1, hits: 1, basis },
    screen: SCREEN.UNRESOLVED,
    reason: `[${row.classification}] ${row.known_translation || row.reasoning || 'no attribution recorded'} `
      + `— asserted by ${row.model} on ${new Date(row.classified_at).toISOString().slice(0, 10)}`
      + `${row.confidence != null ? ` (self-reported confidence ${row.confidence})` : ''}; `
      + 'unverified against any catalogue, needs screening',
  });

  const ELIGIBLE = {
    visible: true,
    pages_translated: { $gt: 0 },
    language: { $nin: [null, 'English'] },
  };

  /**
   * Everything we hold in a non-English language with no English translation yet.
   *
   * Deliberately NOT gated on `visible`. 43,607 of these are held but
   * unpublished, and 30,844 of those are already OCR'd — i.e. translation-ready
   * today. Asking only about the visible shelf would hide the entire pool the
   * question is about.
   *
   * Rights-class exclusions are absolute: a work we cannot publish must never
   * reach a translation queue, however untranslated it is. The regex covers the
   * standing classes plus the Kloss manuscript withdrawal, which is a removal at
   * a partner's request and does not match the generic pattern.
   */
  const UNTRANSLATED = {
    language: { $nin: [null, 'English'] },
    pages_count: { $gt: 0 },
    $or: [
      { pages_translated: { $lte: 0 } },
      { pages_translated: null },
      { pages_translated: { $exists: false } },
    ],
    hidden_reason: { $not: /copyright|takedown|dmca|kloss_manuscripts_removed/i },
  };

  const query = COHORT === 'inverse'
    ? { ...ELIGIBLE, is_first_translation: { $ne: true }, ...(LANG ? { language: LANG } : {}) }
    : COHORT === 'untranslated'
      ? { ...UNTRANSLATED, ...(LANG ? { language: LANG } : {}) }
      : { is_first_translation: true, visible: true, ...(LANG ? { language: LANG } : {}) };
  let cursor = db.collection('books').find(query, {
    projection: { id: 1, title: 1, work_title: 1, author: 1, language: 1, original_language: 1, year: 1, work_id: 1 },
  });
  if (LIMIT) cursor = cursor.limit(LIMIT);
  const books = await cursor.toArray();
  console.log(`Books in the ${COHORT} cohort: ${books.length}\n`);

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
      // Dedupe on a key that EVERY source has. This was `r.lccn`, which is
      // absent on Wikidata and ESTC rows alike — so `seen.add(undefined)` on the
      // first such row collapsed every subsequent one to a duplicate and dropped
      // the whole non-LoC pool to a single record. Silent, and in the direction
      // this subsystem always fails: fewer candidates found, read as no prior.
      const seen = new Set();
      for (const g of grams) {
        for (const r of byCjkGram.get(g) || []) {
          const key = r.lccn || r.estc_id || r.wikidata_edition || `${r.source}:${r.title}:${r.year}`;
          if (seen.has(key)) continue;
          seen.add(key); pool.push(r);
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
          // Full name strings, so the 245 fallback can discount personal-name
          // tokens sitting inside the titles themselves ("The Iliad of Homer").
          authorNames: [book.author, row.author, ...(row.added_entries || [])].filter(Boolean),
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
          // Which source retrieved this. Without it a candidate's provenance is
          // unrecoverable — the two catalogues were distinguishable only by an
          // empty LCCN, and recall cannot be measured per-source at all.
          source: row.source,
          // Every source's own citable identifier. ESTC records carry no LCCN
          // and no Q-number, so without this branch an ESTC candidate would
          // arrive with `{wikidata_edition: undefined, wikidata_work: undefined}`
          // — an unciteable prior, which defeats the entire reason for adding
          // the source. An ESTC S/R/T/N-number resolves at
          // estc.bl.uk / datb.cerl.org and is a standard bibliographic citation.
          identifiers: row.lccn
            ? { lccn: row.lccn }
            : row.estc_id
              ? { estc_id: row.estc_id }
              : { wikidata_edition: row.wikidata_edition, wikidata_work: row.wikidata_work },
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

    // ── translation_classification lane ──────────────────────────────────────
    //
    // A JOIN, not a search: keyed on our own book id and work id, so it answers
    // for books no catalogue index can reach and needs no access point. It runs
    // regardless of `searchable` for exactly that reason.
    const tcDirect = tcByBookId.get(book.id);
    const tcViaWork = (book.work_id ? tcByWorkId.get(book.work_id) ?? [] : [])
      .filter((r) => r.book_id !== book.id);
    queries.push({
      source: 'translation_classification',
      query: `book_id="${book.id}"${book.work_id ? ` OR work_id="${book.work_id}"` : ''} over ${REFERENCE_SET.version}`,
      result_count: (tcDirect ? 1 : 0) + tcViaWork.length,
    });
    for (const [row, basis] of [
      ...(tcDirect ? [[tcDirect, 'same_book']] : []),
      ...tcViaWork.map((r) => [r, 'shared_work_id']),
    ]) {
      const c = tcCandidate(row, basis);
      // A human judgement about this work still outranks the lead, exactly as it
      // does for a catalogue row.
      const decided = decisionByWork.get(book.work_title || book.title);
      if (decided) {
        c.screen = decided.screen;
        c.reason = `[carried forward ${new Date(decided.decided_at).toISOString().slice(0, 10)}] ${decided.reason}`;
      }
      candidates.push(c);
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
  // The Mongo document is deliberately self-contained: every effort embeds the
  // reference set and inherits its gaps, because a limitation named once in a
  // manifest and never surfaced on the claim it undermines is not a disclosure.
  //
  // In the FILE that is pure duplication — the identical manifest is already the
  // top-level `reference_set` key, and it is 87% of every effort's bytes (6,383
  // of 7,346). At 57,764 untranslated books that is ~420MB of the same paragraph
  // repeated. Strip it from the file only; what goes to Mongo is untouched.
  fs.writeFileSync(outPath, JSON.stringify({
    reference_set: REFERENCE_SET,
    code_version: CODE_VERSION,
    note: 'per-effort `reference_set` and `limitations` are stripped here — they are '
      + 'identical on every effort and are the top-level `reference_set` above. The '
      + 'documents written to Mongo by --apply keep them.',
    verdicts: verdictTally,
    by_tradition: byTradition,
    efforts: efforts.map(({ reference_set, limitations, ...rest }) => rest),
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

  // ONE LEDGER (#3881 pass 1): every searchable effort also lands in
  // `first_translation_attempts` as one compact row — the canonical ledger the
  // derive/reconcile pipeline reads. search_efforts stays as the detail
  // archive behind transcript_ref. Idempotent per effort ($setOnInsert).
  // ACTUATION (#3776): the 05:30 derive reads these rows. They resolve to
  // tier1_catalog, which the reconcile valve does not admit — no badge moves.
  let ledgered = 0;
  for (const e of efforts) {
    const attempt = effortToAttempt(e);
    if (attempt && await appendAttempt(db, attempt)) ledgered++;
  }
  console.log(`LEDGER — ${ledgered} attempt row(s) appended to first_translation_attempts (searchable efforts only; the 05:30 derive will read them).`);
},
/**
 * `noTimeout` is REQUIRED — this walks a whole cohort (5,947 badged / 10,126
 * inverse / 57,599 untranslated) against a 126,558-row reference set.
 *
 * FOURTH occurrence of the same watchdog in this subsystem: the demote packet
 * died at 31 of 33 works, the source-language screen at 2,000 of 17,072, the LoC
 * Mongo load at part 30 of 43. Each exited 0 having done a PREFIX of the work.
 *
 * It is worst here. A truncated search leaves `search_efforts` covering only the
 * head of the cohort, and `latestEffortPerBook()` will happily read that as the
 * current generation — so books the search never reached keep an older, staler
 * verdict while the run reports success. Recall computed over the mixture is
 * meaningless, and nothing about it looks wrong.
 */
{ noTimeout: true });
