#!/usr/bin/env node
/**
 * Triage the `language_review: true` queue against page evidence (#3958).
 *
 * WHY THIS EXISTS
 * ---------------
 * 1,519 live books carry `language_review: true` and nothing drains the queue.
 * A consumer was written in June (#2534,
 * `scripts/maintenance/classify-language-mismatch-content.mjs`) with the right
 * shape — clear the flag, stamp provenance, bump `updated_at` — but it reads its
 * candidate list from `/tmp/noneng-triage.json`, a temp file that is gone and was
 * never reproducible, and it is invoked from nowhere. So the queue has a correctly
 * shaped consumer that cannot be run.
 *
 * Worse, the queue has a live PRODUCER: `crontab.production:106` runs
 * `audit-language-mismatch.mjs --flag` every Sunday at 06:30. It is not a static
 * backlog; it refills weekly.
 *
 * This script is the missing input. It queries the queue from Mongo, joins it to
 * the per-page OCR `<language>` evidence produced by
 * `scripts/audit/detect-book-languages.mjs` (#4117), and sorts each row into a
 * tier that says what should happen to it.
 *
 * THIS SCRIPT NEVER WRITES. Clearing a flag on a published book is a public
 * metadata decision and it happens against a producer that will re-flag some of
 * what you clear; it wants a reviewed diff, not a sweep bolted onto a report.
 * There is deliberately no --apply.
 *
 * THE TWO SIGNALS
 * ---------------
 * PRIMARY — the per-page `<language>` tag, aggregated per book by the #4117
 * detector. Real detection, already paid for, works on every script.
 *
 * FALLBACK — the stopword/script classifier in
 * `scripts/lib/language-content-classify.mjs`, used ONLY for books the tag cannot
 * reach (`no_tag`: OCR predates the tag; `thin`: too few tagged pages). It is
 * blind outside Latin script + Greek + Cyrillic, so it self-limits via
 * `RELIABLE_CATALOGUE_LANGS` — see that file's header before trusting a verdict.
 *
 * Do NOT read `pages.ocr.language` (the FIELD). It holds the request parameter
 * (`null`, `"auto-detect"`); reading it as an answer measures your own input.
 *
 * THE TIERS
 * ---------
 *   clear            Page evidence corroborates the catalogue. The flag is a
 *                    false positive and can be cleared. `add_second` lands here
 *                    too: a missing second language is a #4117 job, not a reason
 *                    to hold a review flag on a correctly catalogued book.
 *   clear_tradition  `contradict`, but the pair is a cross-script scholarly
 *                    tradition (Joseon hanmun, Tibetan Sanskrit, Japanese
 *                    kanbun). Correctly catalogued. MUST NEVER be auto-flipped —
 *                    see `.claude/docs/invariants/language-fields.md`.
 *   defect_edition   The catalogued language IS on the pages but is not dominant
 *                    — a Latin edition of a Greek author, catalogued under the
 *                    original's language. Route to #3261/#2184; the fix is
 *                    `language` -> the edition's, source -> `original_language`,
 *                    and it must gate on `text_role`.
 *   defect_record    The catalogued language is absent from its own pages
 *                    entirely. The real mislabel queue — #2184.
 *   unclear          Evidence is thin, contradictory, or from the classifier
 *                    outside its reliable range. Stays flagged for a human.
 *
 * A tier is a ROUTING claim, never a patch. Note in particular that a
 * contradiction being real does not make the *proposed* language right:
 * Merezhkovsky's *Христос и Антихрист* vol. 2 is catalogued Russian, tagged
 * French on 100% of pages, and is in fact an English translation.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/detect-book-languages.mjs            # produce the evidence first
 *   node scripts/audit/language-review-triage.mjs
 *   node scripts/audit/language-review-triage.mjs --no-fallback --limit=200
 *
 * Flags:
 *   --detector=FILE    #4117 JSONL evidence (default scripts/output/book-languages.jsonl)
 *   --out=FILE         JSONL output (default scripts/output/language-review-triage.jsonl)
 *   --limit=N          stop after N queued books
 *   --concurrency=N    parallel page samples for the fallback (default 6)
 *   --no-fallback      skip the classifier; report tag-less books as `unclear`
 *   --all              include hidden/unpublished books (default: live only)
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { parseLanguageField, languageFamily } from '../lib/language-normalize.mjs';
import {
  classifyPageSample,
  formatDetectedLanguage,
  toClassifierKey,
  RELIABLE_CATALOGUE_LANGS,
} from '../lib/language-content-classify.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);

const DETECTOR = arg('detector', 'scripts/output/book-languages.jsonl');
const OUT = arg('out', 'scripts/output/language-review-triage.jsonl');
const LIMIT = Number(arg('limit', '0')) || 0;
const CONCURRENCY = Math.max(1, Number(arg('concurrency', '6')));
const NO_FALLBACK = flag('no-fallback');
const ALL = flag('all');
/** Pages pulled per book for the fallback, and the fractions sampled from them. */
const SAMPLE_LIMIT = 300;
const SAMPLE_AT = [0.3, 0.5, 0.7];

/**
 * Catalogued -> measured pairs where the "contradiction" is the correct record.
 *
 * A Joseon scholarly work catalogued `Korean` whose pages are Classical Chinese
 * is not mislabelled: provenance, tradition and readership are Korean, the script
 * on the page is literary Chinese. Both facts are true and the record should
 * carry both — an addition to `languages[]`, never a replacement of `language`.
 * This class supplied 211 of the detector's ~1,015 apparent mislabels, i.e. the
 * single largest cluster, exactly as the "suspect the vocabulary first, and
 * hand-check the biggest cluster" rule predicts.
 *
 * Latin-in-vernacular-scholarship belongs to the same family of legitimate
 * cross-script pairs, but it is NOT listed here: it is indistinguishable by page
 * share from the source-vs-edition defect (#3261), so it routes to review rather
 * than to auto-clear. Compared by family, so `Literary Chinese` matches too.
 */
export const CROSS_SCRIPT_TRADITIONS = [
  ['Korean', 'Chinese'],
  ['Japanese', 'Chinese'],
  ['Vietnamese', 'Chinese'],
  ['Tibetan', 'Sanskrit'],
];

export function isCrossScriptTradition(catalogued, measured) {
  const measuredFams = new Set(measured.map(languageFamily));
  return CROSS_SCRIPT_TRADITIONS.some(([cat, meas]) =>
    catalogued.some((c) => languageFamily(c) === languageFamily(cat)) && measuredFams.has(languageFamily(meas)));
}

/** Load the #4117 evidence into a map keyed by book id. Streamed — the file is corpus-sized. */
async function loadDetectorRows(file) {
  if (!fs.existsSync(file)) {
    console.error(`Detector evidence not found: ${file}`);
    console.error('Run `node scripts/audit/detect-book-languages.mjs` first — the page <language> tag');
    console.error('is the primary signal here, and without it this triage is only the fallback classifier.');
    process.exit(1);
  }
  const rows = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let bad = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && r.id) rows.set(r.id, r);
    } catch { bad++; }
  }
  if (bad) console.error(`warning: ${bad} unparseable line(s) in ${file}`);
  return rows;
}

/**
 * Decide a tier from the detector row alone. Returns null when the tag cannot
 * answer and the fallback should be tried.
 */
export function tierFromTags(book, row) {
  const catalogued = row.catalogued?.length ? row.catalogued : parseLanguageField(book.language);
  const shares = row.shares || [];
  const measuredAll = shares.map(([lang]) => lang);

  switch (row.bucket) {
    case 'agree':
      return { tier: 'clear', reason: 'page tags match the catalogue', signal: 'ocr_tag' };
    case 'add_second':
      return {
        tier: 'clear',
        reason: 'catalogue is right but incomplete — second language is a #4117 job, not a review hold',
        signal: 'ocr_tag',
      };
    case 'contradict': {
      if (isCrossScriptTradition(catalogued, measuredAll)) {
        return {
          tier: 'clear_tradition',
          reason: 'cross-script scholarly tradition — correctly catalogued, never auto-flip',
          signal: 'ocr_tag',
        };
      }
      // #4181's distinction: is the catalogued language on the pages AT ALL, or
      // absent from its own book? Present-but-not-dominant is the source-vs-edition
      // class (#3261); wholly absent is the real mislabel (#2184).
      const cataloguedFams = new Set(catalogued.map(languageFamily));
      const presentAtAll = shares.some(([lang, , pages]) => pages > 0 && cataloguedFams.has(languageFamily(lang)));
      return presentAtAll
        ? { tier: 'defect_edition', reason: 'catalogued language present but not dominant — edition vs work', signal: 'ocr_tag' }
        : { tier: 'defect_record', reason: 'catalogued language absent from its own pages', signal: 'ocr_tag' };
    }
    case 'unsupported_claim':
      return { tier: 'unclear', reason: 'catalogue names a language the pages do not show', signal: 'ocr_tag' };
    case 'no_catalogue_value':
      return { tier: 'unclear', reason: 'catalogue language is a placeholder', signal: 'ocr_tag' };
    case 'error':
      return { tier: 'unclear', reason: `detector errored: ${row.error || 'unknown'}`, signal: 'none' };
    case 'no_tag':
    case 'thin':
    case 'unparsed':
      return null; // the tag cannot answer — fall back
    default:
      return null;
  }
}

/**
 * Fallback: read the body text. Mirrors the #2534 triage, including its
 * reliability gate — outside Latin/Greek the classifier cannot see the body, so
 * a low density for the catalogued language proves nothing.
 */
async function tierFromContent(pages, book) {
  const pgs = await pages
    .find({ book_id: book.id, page_number: { $gte: 0 }, 'ocr.data': { $type: 'string', $ne: '' } },
      { projection: { 'ocr.data': 1, page_number: 1 } })
    .sort({ page_number: 1 })
    .limit(SAMPLE_LIMIT)
    .maxTimeMS(30000)
    .toArray();
  if (pgs.length < 3) {
    return { tier: 'unclear', reason: 'too few OCR pages to read', signal: 'none' };
  }
  const texts = SAMPLE_AT.map((f) => pgs[Math.floor(f * (pgs.length - 1))].ocr.data);
  const res = classifyPageSample(texts);
  const catalogued = parseLanguageField(book.language);
  const key = toClassifierKey(catalogued[0] || book.language);
  const curDens = res.dens[key] ?? 0;
  const detail = {
    signal: 'content_classifier',
    dominant: formatDetectedLanguage(res.dominant),
    dominant_score: Number(res.score.toFixed(3)),
    catalogued_density: Number(curDens.toFixed(3)),
    sampled_pages: texts.length,
  };
  if (res.dominant && toClassifierKey(formatDetectedLanguage(res.dominant)) === key) {
    return { tier: 'clear', reason: 'body text is the catalogued language', ...detail };
  }
  if (RELIABLE_CATALOGUE_LANGS.has(key) && res.score >= 0.05 && curDens < 0.015) {
    return { tier: 'defect_record', reason: 'body text is another language, catalogued one absent', ...detail };
  }
  return {
    tier: 'unclear',
    reason: RELIABLE_CATALOGUE_LANGS.has(key)
      ? 'mixed or weak content signal'
      : `classifier cannot read ${catalogued[0] || book.language} — verdict would be an artifact`,
    ...detail,
  };
}

async function main() {
  if (flag('apply')) {
    console.error('This script never writes. Removing --apply and continuing would be a lie; refusing instead.');
    console.error('Clearing a review flag on a published book is a reviewed decision (#3958), not a sweep.');
    process.exit(2);
  }
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set (set -a; source .env.production.local; set +a).');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const detector = await loadDetectorRows(DETECTOR);
  console.error(`loaded ${detector.size} detector rows from ${DETECTOR}`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  const pages = db.collection('pages');

  // Canonical live filter: `visible: true && pages_count > 0` (see /api/books/library).
  const query = {
    language_review: true,
    ...(ALL ? {} : { visible: true, pages_count: { $gt: 0 } }),
  };
  const queue = await books
    .find(query, {
      projection: {
        id: 1, title: 1, language: 1, languages: 1, language_review_detail: 1,
        text_role: 1, pages_ocr: 1, pages_count: 1, visible: 1,
      },
    })
    .limit(LIMIT || 0)
    .maxTimeMS(60000)
    .toArray();
  console.error(`queue: ${queue.length} books with language_review: true${ALL ? '' : ' (live)'}`);

  const sink = fs.createWriteStream(OUT, { flags: 'w' });
  const tiers = {};
  const signals = {};
  let noEvidence = 0;
  let fellBack = 0;

  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    const slice = queue.slice(i, i + CONCURRENCY);
    const results = await Promise.all(slice.map(async (book) => {
      const row = detector.get(book.id);
      let verdict = row ? tierFromTags(book, row) : null;
      if (!verdict) {
        if (!row) noEvidence++;
        if (NO_FALLBACK) {
          verdict = {
            tier: 'unclear',
            reason: row ? `page tags cannot answer (${row.bucket})` : 'no detector evidence for this book',
            signal: 'none',
          };
        } else {
          fellBack++;
          try {
            verdict = await tierFromContent(pages, book);
          } catch (e) {
            // Recorded as a ROW, never skipped — an absent book in the output
            // must mean "not reached", not "failed quietly".
            verdict = { tier: 'unclear', reason: `content sample failed: ${String(e?.message || e)}`, signal: 'none' };
          }
        }
      }
      return { book, row, verdict };
    }));

    for (const { book, row, verdict } of results) {
      tiers[verdict.tier] = (tiers[verdict.tier] || 0) + 1;
      signals[verdict.signal] = (signals[verdict.signal] || 0) + 1;
      sink.write(JSON.stringify({
        id: book.id,
        title: book.title,
        language: book.language,
        catalogued: row?.catalogued ?? parseLanguageField(book.language),
        text_role: book.text_role ?? null,
        pages_ocr: book.pages_ocr ?? null,
        // What the weekly cron claimed when it flagged the book, so the report
        // can be read against the producer's own reasoning.
        flagged: book.language_review_detail
          ? {
            detected: book.language_review_detail.detected ?? null,
            confidence: book.language_review_detail.confidence ?? null,
            bucket: book.language_review_detail.bucket ?? null,
            flagged_at: book.language_review_detail.flagged_at ?? null,
          }
          : null,
        detector_bucket: row?.bucket ?? null,
        shares: row?.shares ?? null,
        proposed_languages: row?.proposed_languages ?? null,
        tier: verdict.tier,
        reason: verdict.reason,
        signal: verdict.signal,
        dominant: verdict.dominant ?? null,
        dominant_score: verdict.dominant_score ?? null,
        catalogued_density: verdict.catalogued_density ?? null,
      }) + '\n');
    }
  }

  await new Promise((r) => sink.end(r));
  await client.close();

  const n = queue.length || 1;
  const pct = (k) => `${(((tiers[k] || 0) / n) * 100).toFixed(1)}%`;
  console.error('\n--- summary (DRY RUN — nothing written to the database) ---');
  console.error(`queued books triaged: ${queue.length} -> ${OUT}`);
  console.error(`tiers: ${JSON.stringify(tiers, null, 1)}`);
  console.error(`signals: ${JSON.stringify(signals, null, 1)}`);
  console.error(`\nno detector evidence: ${noEvidence}${NO_FALLBACK ? '' : `, fell back to the content classifier: ${fellBack}`}`);
  console.error(`\nsafe to clear:      ${(tiers.clear || 0) + (tiers.clear_tradition || 0)} (${pct('clear')} + ${pct('clear_tradition')} tradition)`);
  console.error(`route to #3261:     ${tiers.defect_edition || 0} (edition vs work — gate on text_role)`);
  console.error(`route to #2184:     ${tiers.defect_record || 0} (catalogued language absent from its pages)`);
  console.error(`stays for a human:  ${tiers.unclear || 0}`);
  console.error('\nNothing here is a patch. The write shape for the clear tiers is the one in');
  console.error('classify-language-mismatch-content.mjs: $unset language_review + language_review_detail,');
  console.error('$set language_verified_content + field_provenance.language + language_review_resolved,');
  console.error('and bump updated_at only when `language` itself changes (books_catalog mirrors `language`,');
  console.error('never the review flag). Clearing runs against a live producer — crontab.production:106');
  console.error('re-flags every Sunday 06:30 — so land the clear and its marker together (#3958).');
}

// Run only when invoked directly — the tier helpers above are imported by
// `tests/unit/language-review-triage.test.ts`, and an import must not open a
// Mongo connection or walk the corpus.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
