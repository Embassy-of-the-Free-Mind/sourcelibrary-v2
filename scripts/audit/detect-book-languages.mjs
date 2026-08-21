#!/usr/bin/env node
/**
 * Detect each book's real language mix from the per-page OCR `<language>` tag.
 *
 * WHY THIS EXISTS (#4117, split out of #4089)
 * -------------------------------------------
 * `books.languages[]` already exists on 45,675 books, but it is written by
 * `scripts/maintenance/normalize-language-tags.mjs`, which only PARSES the
 * string already in `books.language`. It can turn "Greek-Latin" into two
 * entries; it can never learn that a book catalogued "Greek" is half Latin.
 * On our two copies of the 1495 Aldine Lascaris it ran and confirmed the wrong
 * answer on both.
 *
 * The `<language>` tag the OCR model writes into `pages.ocr.data` IS real
 * per-page detection, and it is already paid for. On those same two copies,
 * independently OCR'd, it returned Latin 178 / Greek 153 and Latin 175 / Greek
 * 151 — near-identical, against two different catalogue answers.
 *
 * DO NOT use `pages.ocr.language` (the FIELD). That is the request parameter
 * (`null`, `"auto-detect"`); reading it as an answer measures your own input.
 *
 * THIS SCRIPT NEVER WRITES. It is the dry-run report #4117 asks for, and the
 * instrument for tuning the "is it really bilingual" threshold before anyone
 * writes anything. There is deliberately no --apply.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/detect-book-languages.mjs --limit=500
 *   node scripts/audit/detect-book-languages.mjs --resume          # long run
 *   node scripts/audit/detect-book-languages.mjs --book-id=69b220ccf79d8af0eab7fd3a
 *
 * Flags:
 *   --out=FILE         JSONL output (default scripts/output/book-languages.jsonl)
 *   --limit=N          stop after N books
 *   --book-id=ID       one book (implies --limit=1, prints detail)
 *   --resume           continue from <out>.checkpoint instead of starting over
 *   --concurrency=N    parallel per-book aggregations (default 6)
 *   --threshold=F      share at which a second language is "real" (default 0.10)
 *   --min-pages=N      fewest tagged pages for a verdict (default 10)
 *   --all              include hidden/unpublished books (default: live only)
 *
 * Checkpointing is not optional here and not a nicety: this is a corpus walk
 * over ~57K books, and three long jobs died mid-walk in one day in July 2026
 * because they streamed a cursor across slow work. Each batch is re-queried by
 * `_id` range; the checkpoint is flushed with every batch.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeLanguageToken, parseLanguageField, languageFamily } from '../lib/language-normalize.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);

const OUT = arg('out', 'scripts/output/book-languages.jsonl');
const CHECKPOINT = `${OUT}.checkpoint`;
const LIMIT = Number(arg('limit', '0')) || 0;
const BOOK_ID = arg('book-id', '');
const RESUME = flag('resume');
const CONCURRENCY = Math.max(1, Number(arg('concurrency', '6')));
const THRESHOLD = Number(arg('threshold', '0.10'));
const MIN_PAGES = Number(arg('min-pages', '10'));
const ALL = flag('all');
const BATCH = 200;
/** Extra thresholds reported so the real one can be chosen from evidence. */
const SENSITIVITY = [0.05, 0.10, 0.15, 0.20, 0.25];

if (process.argv.includes('--apply')) {
  console.error('This script never writes. Removing --apply and continuing would be a lie; refusing instead.');
  console.error('Writing languages[] is gated on a tuned threshold + a reviewed sample — see #4117.');
  process.exit(2);
}

/** Pull the `<language>` tag out of the head of each page and count pages per raw tag. */
async function tagCounts(pages, bookId) {
  return pages.aggregate([
    { $match: { book_id: bookId, 'ocr.data': { $type: 'string' } } },
    // The tag sits in the first 40 chars on ~95% of pages and at 0 on ~61%
    // (sampled 2026-08-21). Capping the input keeps this off the full text.
    { $project: { head: { $substrCP: ['$ocr.data', 0, 300] } } },
    { $project: { tag: { $regexFind: { input: '$head', regex: '<language>([^<]{0,60})</language>' } } } },
    { $group: { _id: { $arrayElemAt: ['$tag.captures', 0] }, n: { $sum: 1 } } },
  ], { maxTimeMS: 60000, allowDiskUse: false }).toArray();
}

/**
 * Turn raw tag counts into normalized per-language page counts.
 * A page tagged "Latin, Greek" counts toward BOTH, so shares can sum above 1.
 * That is deliberate: the alternative (splitting the page's weight) would
 * under-report facing-page editions, which are the whole point of this run.
 */
function profile(rows) {
  const byLang = new Map();
  let tagged = 0, untagged = 0, unparsed = 0;
  for (const r of rows) {
    const raw = r._id;
    if (raw == null) { untagged += r.n; continue; }
    const langs = parseLanguageField(raw);
    if (!langs.length) { unparsed += r.n; continue; }
    tagged += r.n;
    for (const l of langs) byLang.set(l, (byLang.get(l) || 0) + r.n);
  }
  const shares = [...byLang.entries()]
    .map(([lang, n]) => ({ lang, pages: n, share: tagged ? n / tagged : 0 }))
    .sort((a, b) => b.share - a.share || a.lang.localeCompare(b.lang));
  return { tagged, untagged, unparsed, shares };
}

function verdict(book, prof) {
  // The catalogue value may itself be a LIST: 96 of the 229 distinct live
  // `books.language` values are compound strings ("Latin/English",
  // "Hebrew and Aramaic") on 262 live books. Parsing with the single-token
  // normaliser made every one of them look like a mislabel — Comenius's
  // *Orbis Sensualium Pictus* (catalogued "Latin/English", measured English 93%
  // / Latin 91%) is catalogued CORRECTLY and was being reported as contradicted.
  const catalogued = parseLanguageField(book.language);
  const cataloguedSet = new Set(catalogued);
  const current = Array.isArray(book.languages) ? book.languages : null;
  if (!prof.shares.length) {
    return { bucket: prof.tagged || prof.unparsed ? 'unparsed' : 'no_tag', proposed: null, catalogued };
  }
  if (prof.tagged < MIN_PAGES) return { bucket: 'thin', proposed: null, catalogued };

  const top = prof.shares[0];
  const above = prof.shares.filter((s) => s.share >= THRESHOLD);

  // Compare by FAMILY, not by name. "Chinese" and "Classical Chinese" are
  // distinct catalogue values and the same language for this question; without
  // this, 2,387 of 6,230 apparently-bilingual books were one text tagged two
  // ways by the OCR model (measured on the first full run, 2026-08-21).
  const famOf = (l) => languageFamily(l);
  const cataloguedFams = new Set(catalogued.map(famOf));
  const aboveFams = new Set(above.map((s) => famOf(s.lang)));
  /** Catalogue languages the pages actually support. */
  const supported = catalogued.filter((l) => aboveFams.has(famOf(l)));
  /** Catalogue languages the pages do NOT support at this threshold. */
  const unsupported = catalogued.filter((l) => !aboveFams.has(famOf(l)));
  /**
   * Measured languages the catalogue never mentions — one per family, highest
   * share first, so a book is not credited with "Chinese AND Classical Chinese".
   */
  const seenFams = new Set(cataloguedFams);
  const extra = [];
  for (const s of above) {
    const f = famOf(s.lang);
    if (seenFams.has(f)) continue;
    seenFams.add(f);
    extra.push(s.lang);
  }
  /** Variant spellings of a catalogued language, reported but never counted as a second language. */
  const variants = above
    .filter((s) => cataloguedFams.has(famOf(s.lang)) && !cataloguedSet.has(s.lang))
    .map((s) => s.lang);

  // Order: supported catalogue languages first, in catalogue order, so the
  // `languages[0] === language` invariant survives for scalar values; then the
  // rest by measured share.
  const proposed = supported.length ? [...supported, ...extra] : above.map((s) => s.lang);

  let bucket;
  if (!catalogued.length) bucket = 'no_catalogue_value';
  else if (!supported.length) bucket = 'contradict';   // #2184 class — gate on text_role
  else if (extra.length) bucket = 'add_second';        // bilingual candidate
  else if (unsupported.length) bucket = 'unsupported_claim'; // catalogue claims a language the pages don't show
  else bucket = 'agree';

  const changed = !current
    || current.length !== proposed.length
    || current.some((v, i) => v !== proposed[i]);

  return {
    bucket,
    proposed,
    catalogued,
    changed,
    // Catalogued language is present but is NOT the dominant one — pinning it at
    // languages[0] puts a minority language first (both Lascaris copies do this).
    primary_shifted: supported.length > 0 && !cataloguedFams.has(languageFamily(top.lang)),
    unsupported: unsupported.length ? unsupported : null,
    variants: variants.length ? variants : null,
  };
}

/** How many languages would clear each candidate threshold? Feeds the tuning decision. */
function sensitivity(prof) {
  const out = {};
  for (const t of SENSITIVITY) out[t] = prof.shares.filter((s) => s.share >= t).length;
  return out;
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set (set -a; source .env.production.local; set +a).');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  let after = null;
  if (RESUME && fs.existsSync(CHECKPOINT)) {
    after = fs.readFileSync(CHECKPOINT, 'utf8').trim() || null;
    console.error(`resuming after _id ${after}`);
  } else if (!BOOK_ID) {
    fs.writeFileSync(OUT, '');
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  const pages = db.collection('pages');
  const sink = fs.createWriteStream(OUT, { flags: RESUME ? 'a' : 'w' });

  const query = BOOK_ID
    ? { id: BOOK_ID }
    : { pages_ocr: { $gt: 0 }, ...(ALL ? {} : { visible: true }) };
  const projection = { id: 1, title: 1, language: 1, languages: 1, language_multi: 1, pages_ocr: 1, text_role: 1, visible: 1 };

  const totals = { seen: 0, written: 0 };
  const buckets = {};
  const sensTotals = Object.fromEntries(SENSITIVITY.map((t) => [t, 0]));
  const started = process.hrtime.bigint();

  for (;;) {
    const q = after ? { ...query, _id: { $gt: after } } : query;
    const batch = await books.find(q, { projection }).sort({ _id: 1 }).limit(BATCH).maxTimeMS(60000).toArray();
    if (!batch.length) break;

    // Bounded concurrency: Atlas serves the request path from the same cluster.
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const slice = batch.slice(i, i + CONCURRENCY);
      const results = await Promise.all(slice.map(async (book) => {
        try {
          const prof = profile(await tagCounts(pages, book.id));
          return { book, prof, error: null };
        } catch (e) {
          return { book, prof: null, error: String(e && e.message || e) };
        }
      }));
      for (const { book, prof, error } of results) {
        totals.seen++;
        // An error is recorded as a ROW, never skipped silently — an absent
        // book in the output must mean "not reached", not "failed quietly".
        if (error) {
          sink.write(JSON.stringify({ id: book.id, bucket: 'error', error }) + '\n');
          buckets.error = (buckets.error || 0) + 1;
          continue;
        }
        const v = verdict(book, prof);
        const sens = sensitivity(prof);
        for (const t of SENSITIVITY) if (sens[t] > 1) sensTotals[t]++;
        buckets[v.bucket] = (buckets[v.bucket] || 0) + 1;
        sink.write(JSON.stringify({
          id: book.id,
          title: book.title,
          language: book.language,
          catalogued: v.catalogued,
          languages_current: book.languages ?? null,
          language_multi_current: book.language_multi ?? null,
          text_role: book.text_role ?? null,
          pages_ocr: book.pages_ocr ?? null,
          tagged: prof.tagged,
          untagged: prof.untagged,
          unparsed: prof.unparsed,
          shares: prof.shares.map((s) => [s.lang, Number(s.share.toFixed(4)), s.pages]),
          bucket: v.bucket,
          proposed_languages: v.proposed,
          changed: v.changed ?? null,
          primary_shifted: v.primary_shifted ?? null,
          unsupported: v.unsupported ?? null,
          // Same-family variant spellings on this book's pages ("Chinese" AND
          // "Classical Chinese"). Never counted as a second language; recorded
          // because an inconsistent tag vocabulary is itself a finding (#3893).
          variants: v.variants ?? null,
          multi_at: sens,
        }) + '\n');
        totals.written++;
      }
    }

    after = batch[batch.length - 1]._id;
    fs.writeFileSync(CHECKPOINT, String(after));
    const secs = Number(process.hrtime.bigint() - started) / 1e9;
    console.error(`${totals.seen} books · ${(totals.seen / secs).toFixed(1)}/s · ${JSON.stringify(buckets)}`);
    if (BOOK_ID || (LIMIT && totals.seen >= LIMIT)) break;
  }

  await new Promise((r) => sink.end(r));
  await client.close();

  console.error('\n--- summary (DRY RUN — nothing written to the database) ---');
  console.error(`books examined: ${totals.seen}, rows written: ${totals.written} -> ${OUT}`);
  console.error(`buckets: ${JSON.stringify(buckets, null, 1)}`);
  console.error(`\nthreshold sensitivity — books that would be MULTI-language at each cut:`);
  for (const t of SENSITIVITY) {
    console.error(`  >= ${(t * 100).toFixed(0)}%: ${sensTotals[t]} of ${totals.seen}`);
  }
  console.error(`\nActive threshold this run: ${(THRESHOLD * 100).toFixed(0)}% (min ${MIN_PAGES} tagged pages).`);
  console.error('Pick the real one from a hand-labelled sample before ANY write (#4117).');
  console.error('`contradict` rows are #2184 candidates and must gate on text_role — `language`');
  console.error('is the EDITION language, and a sweep that forgot nearly relabelled 547 books.');
}

main().catch((e) => { console.error(e); process.exit(1); });
