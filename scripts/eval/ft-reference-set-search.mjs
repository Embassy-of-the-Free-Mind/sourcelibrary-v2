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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'output');
const BULK_DIR = path.join(OUT_DIR, 'loc-bulk');
const DATE = new Date().toISOString().slice(0, 10);

const APPLY = process.argv.includes('--apply');
const argOf = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };
const LANG = argOf('--lang');
const LIMIT = argOf('--limit') ? parseInt(argOf('--limit'), 10) : null;

const CODE_VERSION = (() => {
  try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); }
  catch { throw new Error('cannot resolve git SHA — an unpinned search effort is not reproducible'); }
})();

// ── Normalisation ────────────────────────────────────────────────────────────

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const STOP = new Set([
  'the', 'and', 'with', 'from', 'that', 'this', 'for', 'des', 'der', 'die', 'und',
  'liber', 'libri', 'opus', 'opera', 'book', 'books', 'volume', 'tractatus',
  'english', 'translation', 'translated', 'works', 'text', 'new', 'notes',
  'introduction', 'edition', 'edited', 'selected', 'sive', 'seu', 'cum',
]);
const toks = (s) => norm(s).split(/\s+/).filter((t) => t.length >= 4 && !STOP.has(t));

const GENERIC_AUTHOR = /^(anonymous|anon\.?|unknown|various|various authors|multiple authors)$/i;
function surname(a) {
  if (!a || GENERIC_AUTHOR.test(a.trim())) return '';
  let c = a.replace(/\([^)]*\)/g, '').replace(/\d{3,4}/g, '').split(';')[0].trim();
  if (c.includes(',')) c = c.split(',')[0];
  const w = norm(c).split(/\s+/).filter((x) => x.length > 1);
  return w[w.length - 1] || '';
}

/**
 * Work-identity score, measured in BOTH directions.
 *
 * LoC 240 uniform titles are deliberately terse ("Iliad."), while our titles
 * carry qualifiers ("Homer, Iliad with Scholia"). Scoring only how much of OUR
 * title the record covers makes an exact uniform-title hit look weak (1/3) —
 * measured 2026-07-29, fixing this direction moved strong matches from 8 to 74
 * over identical data.
 */
function workIdentity(bookToks, candidateTitle) {
  const rt = new Set(toks(candidateTitle));
  if (!rt.size || !bookToks.length) return { score: 0, hits: 0 };
  const hits = bookToks.filter((t) => rt.has(t)).length;
  if (!hits) return { score: 0, hits: 0 };
  return {
    score: Math.max(hits / bookToks.length, hits / rt.size),
    hits,
    book_coverage: hits / bookToks.length,
    record_coverage: hits / rt.size,
  };
}

const MIN_CANDIDATE = 0.34; // retrieve generously; screening is what rejects
const STRONG = 0.6;

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
const bySurname = new Map();
let rowCount = 0;

for (const file of files) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    rowCount++;
    for (const name of [row.author, ...(row.added_entries || [])].filter(Boolean)) {
      const sn = surname(name);
      if (!sn || sn.length < 3) continue;
      if (!bySurname.has(sn)) bySurname.set(sn, []);
      bySurname.get(sn).push(row);
    }
  }
}

const REFERENCE_SET = {
  version: `loc-2016.p${files.length}.v1`,
  sources: [{
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
      'Tibetan, Syriac, Chinese and Arabic source traditions have very thin representation',
      ...(files.length < 43 ? [`only ${files.length} of 43 catalogue parts ingested`] : []),
    ],
  }],
};

console.log(`Reference set ${REFERENCE_SET.version}: ${rowCount.toLocaleString()} English translations, `
  + `${bySurname.size.toLocaleString()} distinct surnames (${files.length}/43 parts)\n`);

await withMongo(async (db) => {
  const query = { is_first_translation: true, visible: true, ...(LANG ? { language: LANG } : {}) };
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

    const bookToks = [...new Set([...toks(book.title), ...toks(book.work_title)])];
    const searchable = Boolean(sn) && bookToks.length > 0;

    const queries = [];
    const candidates = [];

    if (searchable) {
      byTradition[lang].searchable++;
      const pool = bySurname.get(sn) || [];
      queries.push({
        source: 'loc',
        query: `author_surname="${sn}" over ${REFERENCE_SET.version}`,
        result_count: pool.length,
      });

      for (const row of pool) {
        let best = { score: 0 };
        for (const t of [row.uniform_title, row.title]) {
          const id = workIdentity(bookToks, t);
          if (id.score > best.score) best = id;
        }
        if (best.score < MIN_CANDIDATE) continue;
        const { screen, reason } = screenCandidate(book, row, best);
        candidates.push({
          identifiers: { lccn: row.lccn },
          title: row.title,
          uniform_title: row.uniform_title || undefined,
          year: row.year,
          original_languages: row.original_languages,
          publisher: row.publisher || undefined,
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

    efforts.push(effort);
    verdictTally[effort.verdict] = (verdictTally[effort.verdict] || 0) + 1;
    byTradition[lang].candidates += candidates.length;
    byTradition[lang].unresolved += candidates.filter((c) => c.screen === SCREEN.UNRESOLVED).length;
    byTradition[lang].prior += candidates.filter((c) => c.screen === SCREEN.PRIOR).length;
  }

  console.log('─── Verdicts ─────────────────────────────────────────────────');
  for (const [v, n] of Object.entries(verdictTally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.padEnd(22)} ${String(n).padStart(5)}`);
  }
  console.log('\n  none_found means "nothing found in THIS set", never "we are first".');
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
  const outPath = path.join(OUT_DIR, `ft-reference-set-search-${DATE}.json`);
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
