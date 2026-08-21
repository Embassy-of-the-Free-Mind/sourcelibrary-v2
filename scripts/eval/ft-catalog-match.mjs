#!/usr/bin/env node
/**
 * Stage B / Tier-0 — First-Translation catalog-match reuse  (#2780)
 *
 * FREE. No LLM/API calls — pure DB matching. Report by default; `--apply` also
 * records guard-passing matches as durable evidence in the attempt log.
 *
 * We badge ~5,800 books "First Translation" but hold a 24K-row
 * `translation_catalogs` collection (Mongo, db `bookstore`) of KNOWN published
 * English translations. This tool surfaces, for free, the badged books for
 * which a prior English translation ALREADY EXISTS in our own catalog —
 * candidate over-claims we could demote *without any web research*.
 *
 * The history's repeated lesson is "matching/reconcile failure, not a seeding
 * gap" — so this is a matching pass over data we already hold.
 *
 * IMPORTANT — this script NEVER writes a verdict or flips a flag, with or
 * without --apply. It emits a report (JSON + Markdown) of demote *candidates*
 * that queue for Derek's consolidated sign-off. False demotes are the #1
 * historical failure (the "Arithmologia" incident), so matching is conservative
 * and guarded.
 *
 * --apply (evidence only, still no flag change): a guard-passing match means we
 * already hold a prior English translation of this work in our own registry —
 * that is durable, approach-agnostic evidence. Instead of letting it live only
 * in a throwaway report, --apply appends one `found` attempt per demote
 * candidate to `first_translation_attempts` (the same ledger the live producers
 * feed, #2865), keyed on the catalog row so re-runs are idempotent. A future
 * derive step re-vets it through src/lib/ft-prior-guard.ts before any demote, so
 * recording it here cannot itself flip a badge.
 *
 * MATCHING
 *   A badged book matches a catalog row when BOTH signals hold:
 *     (1) author signal  — surname match AND normalized canonical-author overlap
 *     (2) title  signal  — book-title token CONTAINMENT in the catalog
 *                          english_title / canonical_work (asymmetric coverage)
 *   Author-only or title-only is too loose and is dropped.
 *
 * EVIDENCE-QUALITY GUARDS (mirrors src/lib/ft-prior-guard.ts + a source-language
 * guard the TS module does not cover). A catalog match is an auto-demote
 * CANDIDATE only when ALL guards pass:
 *   (a) TRANSLATION not anthology/study      (ANTHOLOGY guard)
 *   (b) completeness == complete             (PARTIAL guard; `unknown` does NOT
 *                                             pass — it is not "complete")
 *   (c) SAME source_language as the book's    (SOURCE_LANG guard) — the catalog
 *       original  (a Latin→En translation      is 100% Latin-source, so it can
 *       does NOT defeat a Greek→En first)      only defeat Latin-source books
 *   (d) person-disambiguated, not a namesake  (NAMESAKE guard) — surname match
 *                                             alone is low-confidence
 *   (e) not a single-volume-vs-whole match    (VOLUME guard, #3044) — a numbered
 *                                             volume of a set is not the same work
 *                                             as the whole "Opera omnia" container
 * Anything failing a guard → "needs_review", never an auto-demote candidate.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ft-catalog-match.mjs            # report only
 *   node scripts/eval/ft-catalog-match.mjs --apply    # report + record evidence
 *
 * Output:
 *   scripts/output/ft-catalog-match-<date>.json
 *   scripts/output/ft-catalog-match-<date>.md
 *   (+ with --apply: found-prior attempts in first_translation_attempts)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { withMongo } from '../lib/mongo.mjs';
import { appendAttempt } from '../lib/ft-attempt-log.mjs';
import { toSourceIso } from '../lib/translation-catalog-record.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'output');
const DATE = new Date().toISOString().slice(0, 10);
const APPLY = process.argv.includes('--apply');
// --audit (#2899, #2885a): report-only alignment audit. Scans the broader set of
// visible, translated, non-English books (not just FT-badged ones) and reports
// per-source-language ("tradition") match precision. Never records attempts —
// it measures catalog coverage, it does not demote. Optional `--lang a,b,c`
// restricts the scan to specific book languages.
const AUDIT = process.argv.includes('--audit');
const LANG_FILTER = (() => {
  const i = process.argv.indexOf('--lang');
  if (i === -1 || !process.argv[i + 1]) return null;
  return process.argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
})();

// ── Text normalisation (mirrors src/lib/ft-prior-guard.ts) ─────────────────────

function normalise(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'the', 'and', 'with', 'from', 'that', 'this', 'for', 'are', 'was',
  'been', 'have', 'has', 'its', 'into', 'upon', 'also', 'very', 'more',
  'some', 'such', 'than', 'being', 'over', 'both', 'each', 'only',
  'english', 'translation', 'translated', 'works', 'text',
  // bibliographic / latin filler that creates spurious title overlap
  'liber', 'libri', 'opus', 'opera', 'book', 'books', 'volume', 'tractatus',
]);

function sigTokens(s) {
  return normalise(s)
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
}

function tokenOverlap(a, b) {
  const ta = new Set(sigTokens(a));
  const tb = new Set(sigTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

/** Fraction of book-title tokens that appear in the prior title (asymmetric). */
function bookTitleCoverage(bookTitle, priorTitle) {
  const bookToks = sigTokens(bookTitle);
  const priorToks = new Set(sigTokens(priorTitle));
  if (bookToks.length === 0) return 0;
  const found = bookToks.filter((t) => priorToks.has(t));
  return found.length / bookToks.length;
}

// ── Volume / part enumeration (mirrors scripts/iiif-discovery/dedupe-candidates.mjs
//    and src/lib/ft-prior-guard.ts checkVolume) ──────────────────────────────────
// A single numbered volume/part of a set is NOT the same work as the whole
// container. "Opera Omnia Vol. 1" ⇔ catalog "Opera omnia" (whole) was the shared
// signature of all 6 false merges in the #2885(b) alignment gold (#3044). Extract
// an explicit enumeration so the guard can reject one-vs-whole and vol-1-vs-vol-2.

// Tibetan pecha volumes are labelled by the consonant order (ka, kha, ga …), so a
// letter token after a volume marker is a real enumeration too.
const TIBETAN_VOLUME_LETTERS = [
  'ka', 'kha', 'ga', 'nga', 'ca', 'cha', 'ja', 'nya', 'ta', 'tha', 'da', 'na',
  'pa', 'pha', 'ba', 'ma', 'tsa', 'tsha', 'dza', 'wa', 'zha', 'za', 'ya', 'ra',
  'la', 'sha', 'sa', 'ha', 'a',
];
const VOLUME_RE_WESTERN = new RegExp(
  '\\b(?:vol(?:ume|umen|s)?|tom(?:e|us|o|i)?|band|bd|teil|th(?:eil)?|part(?:e|s)?|pt|pars|deel|abteilung|fasc(?:icule|iculus)?)\\b\\.?\\s*'
  + `([0-9]+|[ivxlcdm]+|${TIBETAN_VOLUME_LETTERS.join('|')})\\b`,
  'i',
);
const VOLUME_RE_CJK = /第?([0-9〇一二三四五六七八九十百千]+)\s*[卷冊册巻号輯辑編编集]/;
const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
function romanToInt(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]], next = ROMAN[s[i + 1]] || 0;
    n += v < next ? -v : v;
  }
  return n;
}
const CJK_DIGITS = { '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
function cjkNumeral(s) {
  if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
  let total = 0, current = 0;
  for (const ch of s) {
    if (ch in CJK_DIGITS) current = CJK_DIGITS[ch];
    else if (ch === '十') { total += (current || 1) * 10; current = 0; }
    else if (ch === '百') { total += (current || 1) * 100; current = 0; }
    else if (ch === '千') { total += (current || 1) * 1000; current = 0; }
  }
  return total + current;
}

/** Extract a normalized volume/part key from a title, or null if none. */
function volumeKey(title) {
  if (!title) return null;
  const w = title.toLowerCase().match(VOLUME_RE_WESTERN);
  if (w) {
    const raw = w[1];
    if (/^[0-9]+$/.test(raw)) return `w${parseInt(raw, 10)}`;
    if (/^[ivxlcdm]+$/.test(raw)) return `w${romanToInt(raw)}`;
    return `t${raw}`; // Tibetan volume letter
  }
  const c = title.match(VOLUME_RE_CJK);
  if (c) return `c${cjkNumeral(c[1])}`;
  return null;
}

// Generic / collective "authors" whose surname is a meaningless join key — a
// surname match on these is pure noise, never person-disambiguation.
const GENERIC_AUTHORS = new Set([
  'anonymous', 'anon', 'unknown', 'various', 'collective', 'multiple authors',
  'catholic church', 'catholica romana ecclesia',
]);

function isGenericAuthor(author) {
  const n = normalise(author);
  return !n || GENERIC_AUTHORS.has(n) || n.length < 3;
}

function extractSurname(author) {
  if (!normalise(author)) return '';
  // Strip parenthetical role/qualifier markers — "(comm.)", "(ed.)", "(attr.)",
  // "(traditional)" — which are ubiquitous on non-Latin attributions and would
  // otherwise become the surname. (The catalog importer already strips these
  // when it precomputes author_surname, so this aligns the book side.)
  let raw = (author || '').replace(/\([^)]*\)/g, '');
  // Multi-author "Primary; Commentator" → take the primary author (first segment).
  if (raw.includes(';')) raw = raw.split(';')[0];
  // "Surname, Forename" → surname.
  if (raw.includes(',')) return normalise(raw.split(',')[0]);
  const parts = normalise(raw).split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

// ── Source-language normalisation ──────────────────────────────────────────────
// The catalog was originally entirely `source_language: 'la'`; #2899 adds
// non-Latin catalogs (Hebrew/Aramaic via Sefaria, Sanskrit/Pali/etc. via Sacred
// Books of the East, …). Guard (c) can only compare like with like if BOTH the
// book's language and the catalog row's `source_language` are resolved to the
// same ISO bucket.
//
// #3460: this file used to own a private LANG_TO_ISO table and apply it to the
// BOOK side only, comparing the result against the raw catalog string. Any row
// written with a display name ("Sanskrit", "Greek") therefore failed the guard
// against every book — silently disabling all 305 hand-verified
// `claude_subagent_verify` rows, which carry 213 of the catalogue's 385
// `completeness: 'complete'` rows. The mapping now lives in
// scripts/lib/translation-catalog-record.mjs as the single source of truth and
// is applied to both sides.

function bookSourceIso(book) {
  // prefer original_language when present; else the surface language
  for (const raw of [book.original_language, book.language]) {
    const iso = toSourceIso(raw);
    if (iso) return iso;
  }
  return normalise(book.language || '') || normalise(book.original_language || '') || 'unknown';
}

// ── Guards ─────────────────────────────────────────────────────────────────────

const ANTHOLOGY_KEYWORDS = [
  'anthology', 'collected works', 'collected letters', 'selected works',
  'selected writings', 'selections from', 'reader', 'companion', 'works of',
  'writings of', 'sources in', 'sourcebook', 'collected papers',
  'complete works', 'miscellany', 'omnibus',
];

/** (a) Anthology/study guard. Pass = looks like a real translation of THIS work. */
function guardAnthology(book, row) {
  const title = normalise(row.english_title || '');
  const work = normalise(row.canonical_work || '');
  const kw = ANTHOLOGY_KEYWORDS.find((k) => title.includes(k) || work.includes(k));
  if (!kw) return { pass: true, reason: 'no anthology/study keywords' };
  // high containment ⇒ the anthology IS this specific work — don't fire
  const cov = Math.max(
    bookTitleCoverage(book.title, row.english_title || ''),
    bookTitleCoverage(book.title, row.canonical_work || ''),
  );
  if (cov >= 0.8) return { pass: true, reason: `keyword "${kw}" but coverage=${cov.toFixed(2)} — likely this work` };
  return { pass: false, reason: `anthology/study keyword "${kw}" with coverage=${cov.toFixed(2)}` };
}

/** (b) Completeness guard. Pass only when explicitly `complete`. */
function guardComplete(row) {
  const c = (row.completeness || 'unknown').toLowerCase().trim();
  if (c === 'complete') return { pass: true, reason: 'completeness=complete' };
  // partial / excerpts / unknown / "partial/..." → does not defeat first-complete
  return { pass: false, reason: `completeness="${row.completeness ?? 'unset'}" (not complete)` };
}

/** (c) Source-language guard. Pass only when the catalog source matches the book's. */
function guardSourceLang(book, row) {
  const bookIso = bookSourceIso(book);
  // Resolve the catalog side through the SAME map as the book side. Comparing a
  // resolved bucket against a raw display name is what made 305 rows inert.
  const catIso = toSourceIso(row.source_language) || normalise(row.source_language || '');
  if (!catIso) return { pass: false, reason: 'catalog row has no source_language' };
  if (bookIso === 'unknown') return { pass: false, reason: `book source-language unknown (lang="${book.language}")` };
  if (bookIso === catIso) return { pass: true, reason: `source_language match (${catIso})` };
  return { pass: false, reason: `source-language mismatch: book=${bookIso} ("${book.language}") vs catalog=${catIso}` };
}

/**
 * (e) Volume/container guard (#3044). Pass = the pair is NOT a single-volume-
 * vs-whole (or different-volume) mismatch. Fires when exactly one side carries
 * an explicit volume/part enumeration (a single volume of a set matched against
 * the whole opera, or vice-versa), or when both carry enumerations that differ.
 * A single numbered volume of a collected-works set is not the same work as the
 * whole container — auto-demoting on such a match was the shared signature of
 * all 6 false merges in the #2885(b) alignment gold.
 */
function guardVolume(book, row) {
  const bookVol = volumeKey(book.title);
  const priorVol = volumeKey(row.english_title || '') || volumeKey(row.canonical_work || '');
  if (!bookVol && !priorVol) return { pass: true, reason: 'no volume/part enumeration on either side' };
  if (bookVol && priorVol) {
    if (bookVol === priorVol) return { pass: true, reason: `same volume enumeration (${bookVol})` };
    return { pass: false, reason: `different volume enumerations: book=${bookVol} vs catalog=${priorVol}` };
  }
  if (bookVol) return { pass: false, reason: `book is a single volume/part (${bookVol}) but the catalog prior is the whole work/container` };
  return { pass: false, reason: `catalog prior is a single volume/part (${priorVol}) but the book is the whole work/container` };
}

/** (d) Namesake / person-disambiguation guard. Pass = strong author signal. */
function guardNamesake(book, row, authorJaccard) {
  // A bare surname collision is the classic namesake trap. Require either a
  // strong normalized-author overlap OR a forename token corroboration.
  if (authorJaccard >= 0.5) return { pass: true, reason: `author overlap=${authorJaccard.toFixed(2)}` };
  // forename corroboration: any non-surname book-author token present in catalog author
  const bookAuthTokens = sigTokens(book.author || '');
  const catAuthNorm = normalise(
    [row.canonical_author, row.author, row.author_normalized].filter(Boolean).join(' '),
  );
  const corrob = bookAuthTokens.filter((t) => catAuthNorm.includes(t));
  if (corrob.length >= 2) return { pass: true, reason: `multi-token author corroboration (${corrob.join('+')})` };
  return { pass: false, reason: `weak author signal (overlap=${authorJaccard.toFixed(2)}) — possible namesake` };
}

// ── Matching ───────────────────────────────────────────────────────────────────

const MIN_TITLE_COVERAGE = 0.6; // book-title tokens contained in catalog title/work
const MIN_AUTHOR_JACCARD_FOR_MATCH = 0.34; // at least some normalized-author overlap

function authorOverlap(book, row) {
  const bookAuthNorm = book.author || '';
  const catAuthNorm = [row.canonical_author, row.author].filter(Boolean).join(' ');
  // jaccard over significant author tokens (drop surname-only stop effect)
  return tokenOverlap(bookAuthNorm, catAuthNorm);
}

function titleSignal(book, row) {
  // containment of book title in the catalog english_title OR canonical_work
  const cTitle = bookTitleCoverage(book.title, row.english_title || '');
  const cWork = bookTitleCoverage(book.title, row.canonical_work || '');
  return Math.max(cTitle, cWork);
}

// ── Reusable matcher (extracted for #2885 alignment-gold harness) ───────────────
// buildCatalogIndex + matchBookToCatalog are the SAME guarded matching logic
// main() runs — extracted verbatim so the alignment-gold draw can score the
// production Tier-0 links without re-implementing (a simplified re-implementation
// is exactly the "sampler-strawman" that produced fake false-merges, #2880 R2).

/** Index catalog rows by normalised author surname for cheap candidate lookup. */
export function buildCatalogIndex(catRows) {
  const bySurname = new Map();
  for (const row of catRows) {
    const sn = row.author_surname ? normalise(row.author_surname) : extractSurname(row.canonical_author || row.author);
    if (!sn || sn.length < 3) continue;
    if (!bySurname.has(sn)) bySurname.set(sn, []);
    bySurname.get(sn).push(row);
  }
  return bySurname;
}

/**
 * Match ONE book against the catalog index. Returns the per-book result object
 * ({ book_id, tier, match_count, best_match, matches, … }) or null when the book
 * is ineligible or produces no title-signal match. Pure — no DB, no I/O.
 */
export function matchBookToCatalog(book, bySurname) {
  if (!book.id || !book.author || !book.title) return null;
  if (isGenericAuthor(book.author)) return null; // generic-author surname = noise
  const sn = extractSurname(book.author);
  if (!sn || sn.length < 3) return null;
  const candidates = bySurname.get(sn);
  if (!candidates || candidates.length === 0) return null;

  // Score every same-surname candidate; keep those clearing match thresholds.
  const matches = [];
  for (const row of candidates) {
    const aJac = authorOverlap(book, row);
    const tCov = titleSignal(book, row);
    if (tCov < MIN_TITLE_COVERAGE) continue; // need title signal
    if (aJac < MIN_AUTHOR_JACCARD_FOR_MATCH) {
      // surname matched but the rest of the name doesn't — keep ONLY if a
      // strong forename corroboration exists; otherwise drop as too loose.
      const bookAuthTokens = sigTokens(book.author || '');
      const catAuthNorm = normalise([row.canonical_author, row.author].filter(Boolean).join(' '));
      const corrob = bookAuthTokens.filter((t) => catAuthNorm.includes(t));
      if (corrob.length < 2) continue;
    }

    const gAnth = guardAnthology(book, row);
    const gComp = guardComplete(row);
    const gLang = guardSourceLang(book, row);
    const gName = guardNamesake(book, row, aJac);
    const gVol = guardVolume(book, row);

    const guards = {
      ANTHOLOGY: gAnth,
      COMPLETENESS: gComp,
      SOURCE_LANG: gLang,
      NAMESAKE: gName,
      VOLUME: gVol,
    };
    const allPass = gAnth.pass && gComp.pass && gLang.pass && gName.pass && gVol.pass;
    const failed = Object.entries(guards).filter(([, g]) => !g.pass).map(([k]) => k);

    matches.push({
      catalog_id: String(row._id),
      source: row.source || null,
      catalog_author: row.canonical_author || row.author || null,
      english_title: row.english_title || null,
      canonical_work: row.canonical_work || null,
      translator: row.translator || null,
      pub_year: row.pub_year_int ?? row.pub_year ?? null,
      publisher: row.publisher || null,
      completeness: row.completeness ?? null,
      source_language: row.source_language || null,
      url: row.url || row.source_url || null,
      author_overlap: Number(aJac.toFixed(3)),
      title_coverage: Number(tCov.toFixed(3)),
      guards: {
        ANTHOLOGY: gAnth,
        COMPLETENESS: gComp,
        SOURCE_LANG: gLang,
        NAMESAKE: gName,
        VOLUME: gVol,
      },
      all_guards_pass: allPass,
      failed_guards: failed,
    });
  }

  if (matches.length === 0) return null;

  // Best match = most guards passed, then highest combined signal.
  matches.sort((a, b) => {
    const ap = 5 - a.failed_guards.length;
    const bp = 5 - b.failed_guards.length;
    if (ap !== bp) return bp - ap;
    return (b.author_overlap + b.title_coverage) - (a.author_overlap + a.title_coverage);
  });

  const best = matches[0];
  const tier = best.all_guards_pass ? 'demote_candidate' : 'needs_review';

  return {
    book_id: book.id,
    author: book.author,
    title: book.title,
    language: book.language,
    original_language: book.original_language ?? null,
    work_id: book.work_id ?? null,
    book_source_iso: bookSourceIso(book),
    tier,
    match_count: matches.length,
    best_match: best,
    // include up to 3 supporting matches for the report (dedupe by catalog_id)
    matches: matches.slice(0, 3),
  };
}

async function main() {
  await withMongo(async (db) => {
    // In --audit mode, drop the `is_first_translation` constraint: we want to
    // measure how well the catalog COVERS the corpus per tradition, not only
    // which badges are at risk. Optionally restrict to specific languages.
    const badgeQ = {
      ...(AUDIT ? {} : { is_first_translation: true }),
      visible: true,
      pages_translated: { $gt: 0 },
      language: LANG_FILTER
        ? { $in: LANG_FILTER }
        : { $nin: [null, 'en', 'eng', 'English', 'english'] },
    };

    const nBadged = await db.collection('books').countDocuments(badgeQ);
    console.log(
      AUDIT
        ? `[AUDIT] Scanning ${nBadged} visible, translated, non-English books${LANG_FILTER ? ` (langs: ${LANG_FILTER.join(', ')})` : ''}`
        : `Badged books (FT, visible, translated, non-English): ${nBadged}`,
    );

    const books = await db
      .collection('books')
      .find(badgeQ)
      .project({ _id: 0, id: 1, author: 1, title: 1, language: 1, original_language: 1, work_id: 1 })
      .toArray();
    console.log(`Loaded ${books.length} badged books.`);

    // EXCLUDE the contaminated discovery harvest (2026-06-30). 302 rows carry
    // `source: ft_verification_discovery` — unverified Gemini discovery-pass
    // output (all url-less, often fabricated, e.g. "Madame Dupin" translating a
    // 1494 Latin Kabbalistic work). They are NOT real catalog records, and
    // trusting them as a `found_refs` prior produces FALSE DEMOTES (this matcher
    // flagged Reuchlin's De Verbo Mirifico off one). A Tier-0 demote must rest on
    // a real curated catalogue, never a discovery hallucination. (#2885; sibling
    // of the discovery-cron guard #2892.)
    const catRows = await db
      .collection('translation_catalogs')
      .find({ source: { $ne: 'ft_verification_discovery' } })
      .project({
        _id: 1, source: 1, author: 1, author_normalized: 1, author_surname: 1,
        canonical_author: 1, canonical_author_normalized: 1,
        english_title: 1, english_title_normalized: 1, canonical_work: 1, canonical_work_normalized: 1,
        translator: 1, pub_year: 1, pub_year_int: 1, publisher: 1, completeness: 1,
        source_language: 1, url: 1, source_url: 1,
      })
      .toArray();
    console.log(`Loaded ${catRows.length} catalog rows.`);

    // Index catalog rows by author surname for cheap candidate lookup.
    const bySurname = buildCatalogIndex(catRows);
    console.log(`Indexed ${bySurname.size} distinct catalog surnames.`);

    const results = [];
    let scanned = 0;

    for (const book of books) {
      scanned++;
      const r = matchBookToCatalog(book, bySurname);
      if (r) results.push(r);
    }

    // ── Summaries ────────────────────────────────────────────────────────────
    const demote = results.filter((r) => r.tier === 'demote_candidate');
    const review = results.filter((r) => r.tier === 'needs_review');

    const byTier = { demote_candidate: demote.length, needs_review: review.length };

    const countBy = (arr, key) => {
      const m = {};
      for (const r of arr) {
        const k = r[key] || 'unknown';
        m[k] = (m[k] || 0) + 1;
      }
      return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
    };

    // Why needs_review? tally of which guard most-commonly fails on the best match.
    const reviewGuardFails = {};
    for (const r of review) {
      for (const g of r.best_match.failed_guards) reviewGuardFails[g] = (reviewGuardFails[g] || 0) + 1;
    }

    const summary = {
      generated_at: new Date().toISOString(),
      db: 'bookstore',
      badged_books_total: nBadged,
      badged_books_scanned: scanned,
      catalog_rows: catRows.length,
      catalog_source_languages: Object.fromEntries(
        Object.entries(
          catRows.reduce((m, r) => {
            const k = r.source_language || 'unset';
            m[k] = (m[k] || 0) + 1;
            return m;
          }, {}),
        ).sort((a, b) => b[1] - a[1]),
      ),
      books_with_any_match: results.length,
      by_tier: byTier,
      demote_candidates_by_language: countBy(demote, 'language'),
      needs_review_by_language: countBy(review, 'language'),
      needs_review_failed_guard_tally: reviewGuardFails,
    };

    // Per-tradition (source-language) precision view for the alignment audit
    // (#2885a). For each ISO bucket: how many books got a fully-guard-passing
    // catalog match. These are the correctly source-language-gated candidates.
    if (AUDIT) {
      const traditions = {};
      for (const r of results) {
        const iso = r.book_source_iso || 'unknown';
        const t = traditions[iso] || (traditions[iso] = { matched: 0, demote_candidates: 0 });
        t.matched++;
        if (r.tier === 'demote_candidate') t.demote_candidates++;
      }
      summary.by_tradition = Object.fromEntries(
        Object.entries(traditions).sort((a, b) => b[1].demote_candidates - a[1].demote_candidates),
      );
    }

    // ── Empty-bucket assertions (catalog APIs once silently returned 100% NONE)
    console.log('\n=== SUMMARY ===');
    console.log(JSON.stringify(summary, null, 2));
    if (results.length === 0) {
      console.warn('\n[ASSERT] ZERO books matched any catalog row. This is suspicious — '
        + 'verify the catalog is populated and matching fields exist before trusting this.');
    } else {
      console.log(`\n[ASSERT] ${results.length} books matched (${demote.length} demote candidates, ${review.length} needs_review).`);
    }
    if (demote.length === 0) {
      console.warn('[ASSERT] ZERO demote candidates — every match failed at least one guard. '
        + 'Expected for a Latin-only catalog vs a multilingual badged set; not necessarily an error.');
    }

    // ── Keep the match (--apply) ───────────────────────────────────────────────
    // A guard-passing match = our own registry already holds a prior English
    // translation of this work. Record it as durable found-prior evidence so it
    // accumulates instead of evaporating into a report. Still NO flag change.
    if (APPLY && AUDIT) {
      console.warn('\n[AUDIT] --audit is report-only; ignoring --apply (no attempts recorded).');
    }
    if (APPLY && !AUDIT && demote.length) {
      const isoDate = new Date().toISOString();
      let applied = 0;
      for (const r of demote) {
        const m = r.best_match;
        const ok = await appendAttempt(db, {
          // Stable id keyed on the matched catalog row → idempotent across runs.
          attempt_id: `${r.book_id}:tier1_catalog:registry:${m.catalog_id}`,
          book_id: r.book_id,
          work_id: r.work_id || null,
          date: isoDate,
          method: 'tier1_catalog',
          match_key: 'author_title',
          sources_checked: ['translation_catalogs'],
          queries: [[r.author, r.title].filter(Boolean).join(' ').trim()].filter(Boolean),
          result: 'found',
          found_refs: [m.catalog_id],
          priors: [{
            english_title: m.english_title || undefined,
            translator: m.translator || undefined,
            pub_year: m.pub_year != null ? String(m.pub_year) : undefined,
            publisher: m.publisher || undefined,
            completeness: m.completeness || undefined,
            source_url: m.url || undefined,
          }],
          // A guard-passing single-registry match: moderate, not strong (no cross-check).
          evidence_strength: 'moderate',
          independence_score: 0.3,
          model: null,
          notes: `[registry-match] our translation_catalogs holds a guard-passing prior (${m.source || 'catalog'}); author_overlap=${m.author_overlap}, title_coverage=${m.title_coverage}`,
          _src: 'ft-catalog-match',
        });
        if (ok) applied++;
      }
      console.log(`\n[apply] appended ${applied} new found-prior attempts (${demote.length - applied} already present). No flag changed.`);
    } else if (!APPLY && demote.length) {
      console.log(`\n[dry-run] ${demote.length} demote candidates would be recorded as found-prior attempts. Re-run with --apply (records evidence only; no flag change).`);
    }

    // ── Write report ─────────────────────────────────────────────────────────
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const jsonPath = path.join(OUT_DIR, `ft-catalog-match-${DATE}.json`);
    const mdPath = path.join(OUT_DIR, `ft-catalog-match-${DATE}.md`);

    fs.writeFileSync(
      jsonPath,
      JSON.stringify({ summary, demote_candidates: demote, needs_review: review }, null, 2),
    );

    fs.writeFileSync(mdPath, renderMarkdown(summary, demote, review));

    console.log(`\nWrote ${jsonPath}`);
    console.log(`Wrote ${mdPath}`);
  });
}

// ── Markdown rendering ─────────────────────────────────────────────────────────

function renderMarkdown(summary, demote, review) {
  const L = [];
  L.push('# Stage B / Tier-0 — First-Translation catalog-match reuse (#2780)');
  L.push('');
  L.push('**REPORT-ONLY.** No verdict written, no flag flipped. Demote candidates queue for Derek\'s consolidated sign-off.');
  L.push('');
  L.push(`Generated: ${summary.generated_at}`);
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push(`- Badged books (total): **${summary.badged_books_total}**`);
  L.push(`- Catalog rows: **${summary.catalog_rows}** (source languages: ${Object.entries(summary.catalog_source_languages).map(([k, v]) => `${k}=${v}`).join(', ')})`);
  L.push(`- Books with any catalog match: **${summary.books_with_any_match}**`);
  L.push(`- **Demote candidates (all guards pass): ${summary.by_tier.demote_candidate}**`);
  L.push(`- Needs review (a guard failed/ambiguous): ${summary.by_tier.needs_review}`);
  L.push('');
  L.push('### Demote candidates by language');
  L.push('');
  for (const [k, v] of Object.entries(summary.demote_candidates_by_language)) L.push(`- ${k}: ${v}`);
  if (Object.keys(summary.demote_candidates_by_language).length === 0) L.push('- (none)');
  L.push('');
  L.push('### Needs-review by language');
  L.push('');
  for (const [k, v] of Object.entries(summary.needs_review_by_language)) L.push(`- ${k}: ${v}`);
  if (Object.keys(summary.needs_review_by_language).length === 0) L.push('- (none)');
  L.push('');
  L.push('### Needs-review: which guard failed (best match)');
  L.push('');
  for (const [k, v] of Object.entries(summary.needs_review_failed_guard_tally)) L.push(`- ${k}: ${v}`);
  if (Object.keys(summary.needs_review_failed_guard_tally).length === 0) L.push('- (none)');
  L.push('');

  const renderRow = (r) => {
    const m = r.best_match;
    L.push(`### ${r.title}`);
    L.push('');
    L.push(`- Book id: \`${r.book_id}\` — https://sourcelibrary.org/book/${r.book_id}`);
    L.push(`- Author: ${r.author}`);
    L.push(`- Book language: ${r.language} (source ISO: ${r.book_source_iso}${r.original_language ? `, original_language: ${r.original_language}` : ''})`);
    if (r.work_id) L.push(`- work_id: \`${r.work_id}\``);
    L.push(`- Matched catalog row: "${m.english_title}"${m.canonical_work ? ` (work: ${m.canonical_work})` : ''}`);
    L.push(`  - Translator: ${m.translator || '—'} · Year: ${m.pub_year ?? '—'} · Publisher: ${m.publisher || '—'}`);
    L.push(`  - Source: ${m.source || '—'} · catalog source_language: ${m.source_language || '—'} · completeness: ${m.completeness ?? '—'}`);
    if (m.url) L.push(`  - URL: ${m.url}`);
    L.push(`  - Signal: author_overlap=${m.author_overlap}, title_coverage=${m.title_coverage}`);
    L.push(`  - Guards: ${Object.entries(m.guards).map(([k, g]) => `${k}=${g.pass ? 'PASS' : 'FAIL'}`).join(', ')}`);
    for (const [k, g] of Object.entries(m.guards)) {
      if (!g.pass) L.push(`    - ${k} FAIL: ${g.reason}`);
    }
    if (r.match_count > 1) L.push(`  - (${r.match_count} catalog rows matched this book in total)`);
    L.push('');
  };

  L.push('## Demote candidates (all guards pass — candidate over-claims)');
  L.push('');
  if (demote.length === 0) L.push('_None. Every catalog match failed at least one evidence-quality guard._');
  for (const r of demote) renderRow(r);
  L.push('');
  L.push('## Needs review (matched but a guard failed — NOT auto-demote)');
  L.push('');
  L.push(`_${review.length} entries. Showing detail; these require human/web verification before any flag change._`);
  L.push('');
  for (const r of review) renderRow(r);

  return L.join('\n');
}

// Re-export the pure matching helpers so the #2885 alignment-gold draw can reuse
// the exact normalisation/guard logic (never a re-implementation). Importing this
// module must NOT trigger a catalog scan, so main() only runs when invoked directly.
export {
  normalise, sigTokens, tokenOverlap, bookTitleCoverage,
  isGenericAuthor, extractSurname, bookSourceIso,
  guardAnthology, guardComplete, guardSourceLang, guardNamesake, guardVolume,
  volumeKey,
  authorOverlap, titleSignal,
  MIN_TITLE_COVERAGE, MIN_AUTHOR_JACCARD_FOR_MATCH,
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
