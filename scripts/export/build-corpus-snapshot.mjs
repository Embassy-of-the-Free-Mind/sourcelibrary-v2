#!/usr/bin/env node
// Build a versioned corpus snapshot for data licensees (issue #3327).
//
// The deliverable behind the /licensing rate card's "delivered as structured
// data via the API or dataset export — no crawling required." Produces
// per-language gzipped JSONL shards (one record per book, pages inline with
// OCR + translation) plus a manifest with checksums, counts, and the license
// block. Shards go to a private channel (R2 presigned URLs per licensee) —
// never a public listing.
//
// Text is read straight from Mongo, so it is inherently CLEAN: the Trithemian
// zero-width provenance marks are applied at serve time (quote/download/PDF
// routes via src/lib/steganographia.ts), never stored. The verify phase
// asserts that — zero ZWC characters and zero editorial-wrapper tags in the
// output — so "licensees get unmarked text" stays true by construction.
//
// Eligibility (rights-critical — encoded here, not convention):
//   - visible: true && pages_count > 0
//   - no RIGHTS-class hidden_reason (copyright/takedown/dmca). NOTE: ~6.3K
//     visible books carry a stale hidden_reason ("launch_curation",
//     "unprocessed", …) left by old hide/unhide sweeps that flipped `visible`
//     without unsetting the field — visible:true is the operative state, so
//     only rights-flavored reasons exclude (a bare $exists check silently
//     dropped a third of the corpus on the first full build, 2026-07-23)
//   - content_type != 'artwork' (single-image records; no text product)
//   - numeric year <= --max-year (default 1930: published-1930 works entered
//     US public domain Jan 1 2026). Books with no numeric year can't be
//     rights-screened and are excluded, counted in the manifest.
//   - optional --exclude-file: JSON array of book `id`s (copyright-locked
//     droplists live in the private ops repo; pass them in, don't inline).
//   - pages with negative page_number (soft-hidden) are skipped.
//
// Run (validation):
//   set -a; source .env.production.local; set +a; \
//   node scripts/export/build-corpus-snapshot.mjs --limit 25 \
//     --dir scripts/output/corpus-snapshot-test
//
// Run (full, on Hetzner — hours; detach it):
//   nohup node scripts/export/build-corpus-snapshot.mjs \
//     --dir /data/corpus-snapshot-v1 > snapshot.log 2>&1 & disown
//
// Needs: MONGODB_URI. Zero AI cost. Read-only against Mongo.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { once } from 'node:events';
import readline from 'node:readline';
import { getScriptClient } from '../lib/mongo.mjs';
import { stripEditorialWrappers } from '../lib/strip-editorial-wrappers.mjs';

const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : def; };
const has = (flag) => process.argv.includes(flag);

const DIR = path.resolve(arg('--dir', 'scripts/output/corpus-snapshot'));
const LIMIT = Number(arg('--limit', 0));            // 0 = all eligible books
const LANGUAGE = arg('--language', null);           // restrict to one books.language
const MAX_YEAR = Number(arg('--max-year', 1930));   // rights cutoff (see header)
const EXCLUDE_FILE = arg('--exclude-file', null);
const VERSION = arg('--version', new Date().toISOString().slice(0, 10).replace(/-/g, '.'));
const VERIFY_SAMPLE = Number(arg('--verify-sample', 200)); // pages spot-checked post-build
const SKIP_VERIFY = has('--skip-verify');
// Non-English editions to include alongside the English translation (#4095).
// `pages.translations.<iso>` — a language-keyed MAP, never a per-language
// column, so the snapshot gains a key rather than a schema. Comma-separated;
// `--editions=none` builds the English-only snapshot the earlier versions did.
const EDITION_LANGS = (arg('--editions', 'es') || '')
  .split(',').map((l) => l.trim().toLowerCase())
  .filter((l) => /^[a-z]{2,3}$/.test(l) && l !== 'en' && l !== 'none');

// Mirrors src/lib/license-info.ts CONTENT_LICENSE (scripts can't import TS —
// same twin situation as strip-editorial-wrappers). Change both together.
const CONTENT_LICENSE = {
  spdx: 'CC-BY-SA-4.0',
  url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  attribution: 'Source Library (https://sourcelibrary.org)',
  terms: 'https://sourcelibrary.org/terms',
  original_texts: 'public-domain',
  tdm_reservation: 1,
  tdm_policy: 'https://sourcelibrary.org/licensing',
  ai_training: 'reserved — standard license available, see tdm_policy',
};

// Degenerate-output detectors (issue #3273): flag, never silently drop, so a
// licensee can filter on quality while counts stay honest.
const MAX_PAGE_CHARS = 200_000;
function qualityFlags(text) {
  const flags = [];
  if (text.length > MAX_PAGE_CHARS) flags.push('oversize');
  const entities = (text.match(/&[a-z]+;/g) || []).length;
  if (entities > 50) flags.push('entity_padding');
  const words = text.replace(/&[a-z]+;/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length > 120) {
    const ttr = new Set(words).size / words.length;
    if (ttr < 0.15) flags.push('low_ttr');
  }
  return { flags, words: words.length };
}

// Editorial apparatus, exported as labeled annotation fields (issue #3327):
// the same wrapper blocks that must NEVER ship inline as source text are
// themselves licensable data when clearly labeled. Extracted from the RAW
// text before stripping. Tag content gets any nested tags flattened.
const TRANSLATION_ANNOTATION_TAGS = ['meta', 'summary', 'keywords', 'vocab'];
const OCR_ANNOTATION_TAGS = ['language', 'script', 'page-type', 'columns', 'scan-quality', 'warning'];
function extractAnnotations(raw, tags) {
  const out = {};
  for (const tag of tags) {
    // Interior bounded: an unclosed tag on a degenerate page turns a lazy
    // unbounded interior into an O(n²) scan (wedged the first full build for
    // an hour at 100% CPU — same failure family as #3195).
    const m = raw.match(new RegExp(`<${tag}>([\\s\\S]{0,20000}?)<\\/${tag}>`, 'i'));
    if (!m) continue;
    const content = m[1].replace(/<[^>]{1,60}>/g, ' ').replace(/\s+/g, ' ').trim();
    if (content) out[tag.replace(/-/g, '_')] = content;
  }
  return Object.keys(out).length ? out : null;
}

// Streaming file helpers — shards exceed Node's 2 GiB readFileSync cap (the
// Latin shard alone is 4 GB gzipped; the first full build crashed at the
// checksum step after 11 hours of clean building).
function sha256Stream(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(p).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}
async function* shardLines(p) {
  const rl = readline.createInterface({
    input: fs.createReadStream(p).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) if (line) yield line;
}

// A provenance mark is a structured RUN of zero-width chars (≥9 consecutive
// per payload byte — see src/lib/steganographia.ts). Isolated ZWNJ/ZWJ are
// legitimate letters in Persian/Indic scripts (Rumi's Masnavi false-positived
// the first full verify with 8 linguistic ZWNJs), so flag runs only.
const ZWC_RE = /[​‌‍⁠﻿]{8,}/;
const WRAPPER_TAG_RE = /<\/?(?:meta|summary|keywords|vocab|language|scan-quality|script|page-type|columns|warning|image-desc)>/i;

const RIGHTS_REASON_RE = /copyright|takedown|dmca|rights/i;

function bookFilter() {
  return {
    visible: true,
    pages_count: { $gt: 0 },
    hidden_reason: { $not: RIGHTS_REASON_RE },
    content_type: { $ne: 'artwork' },
    year: { $type: 'number', $lte: MAX_YEAR },
    ...(LANGUAGE ? { language: LANGUAGE } : {}),
  };
}

async function computeExclusions(db) {
  return {
    artwork: await db.collection('books').countDocuments({
      visible: true, pages_count: { $gt: 0 }, content_type: 'artwork',
      ...(LANGUAGE ? { language: LANGUAGE } : {}),
    }),
    no_numeric_year: await db.collection('books').countDocuments({
      visible: true, pages_count: { $gt: 0 }, content_type: { $ne: 'artwork' },
      year: { $not: { $type: 'number' } },
      ...(LANGUAGE ? { language: LANGUAGE } : {}),
    }),
    year_after_cutoff: await db.collection('books').countDocuments({
      visible: true, pages_count: { $gt: 0 }, content_type: { $ne: 'artwork' },
      year: { $type: 'number', $gt: MAX_YEAR },
      ...(LANGUAGE ? { language: LANGUAGE } : {}),
    }),
    rights_hidden_reason: await db.collection('books').countDocuments({
      visible: true, pages_count: { $gt: 0 }, hidden_reason: RIGHTS_REASON_RE,
      ...(LANGUAGE ? { language: LANGUAGE } : {}),
    }),
    exclude_file: 0, // counted during the walk
  };
}

function buildManifest({ exclusions, counts, shardEntries }) {
  return {
    dataset: 'Source Library corpus snapshot',
    version: VERSION,
    created: new Date().toISOString(),
    license: CONTENT_LICENSE,
    provenance_marks: 'none — text is delivered clean; Trithemian zero-width provenance marks exist only on public serve surfaces, never in licensed exports',
    living_corpus: 'texts are continuously improved (new models, human revision, scholarship); the corpus subscription includes refreshed snapshots and a delta manifest between versions',
    eligibility: {
      filter: 'visible books with processed pages, non-artwork, numeric publication year <= max_year',
      max_year: MAX_YEAR,
      ...(LANGUAGE ? { language: LANGUAGE } : {}),
      ...(LIMIT ? { limit: LIMIT, note: 'VALIDATION BUILD — not a licensable snapshot' } : {}),
    },
    excluded: exclusions,
    counts,
    word_count_note: 'whitespace tokens over cleaned text; undercounts space-less scripts (Chinese, Tibetan, …) — see per-shard chars',
    quality_flags: {
      oversize: `text over ${MAX_PAGE_CHARS} chars`,
      entity_padding: 'more than 50 HTML entities (degenerate OCR padding, issue #3273)',
      low_ttr: 'type/token ratio < 0.15 over 120+ words (repetition loop, issue #3273)',
    },
    shards: shardEntries.sort((a, b) => b.words - a.words),
  };
}

// Rebuild the manifest + run verify from an existing --dir of shards, without
// re-reading Mongo page data. Recovery path for a completed build that died
// in finalization (the 2 GiB readFileSync crash), and the basis for future
// resume logic. Counts are recomputed by streaming the actual shard bytes —
// the numbers describe the artifact itself, not the build's memory of it.
async function finalizeOnly() {
  const files = fs.readdirSync(DIR).filter(f => /^books-.*\.jsonl\.gz$/.test(f)).sort();
  if (!files.length) { console.error(`[finalize] no shards in ${DIR}`); process.exit(1); }
  const { client, db } = await getScriptClient({ noTimeout: true });
  const exclusions = await computeExclusions(db);

  let nBooks = 0, nPages = 0, nWords = 0, nFlagged = 0;
  const shardEntries = [];
  for (const file of files) {
    const p = path.join(DIR, file);
    const s = { file, language: file.replace(/^books-|\.jsonl\.gz$/g, ''), books: 0, pages: 0, words: 0, chars: 0 };
    for await (const line of shardLines(p)) {
      const book = JSON.parse(line);
      s.books++;
      for (const pg of book.pages) {
        s.pages++;
        if (pg.ocr_flags?.length || pg.translation_flags?.length) nFlagged++;
        for (const text of [pg.ocr, pg.translation]) {
          if (!text) continue;
          s.words += text.replace(/&[a-z]+;/g, ' ').split(/\s+/).filter(Boolean).length;
          s.chars += text.length;
        }
      }
    }
    s.sha256 = await sha256Stream(p);
    s.bytes = fs.statSync(p).size;
    nBooks += s.books; nPages += s.pages; nWords += s.words;
    shardEntries.push(s);
    console.log(`[finalize] ${file}: ${s.books} books, ${s.pages.toLocaleString()} pages, ${s.words.toLocaleString()} words`);
  }

  const manifest = buildManifest({
    exclusions,
    counts: { books: nBooks, pages: nPages, words: nWords, flagged_pages: nFlagged },
    shardEntries,
  });
  fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[finalize] done: ${nBooks.toLocaleString()} books, ${nPages.toLocaleString()} pages, ${nWords.toLocaleString()} words, ${files.length} shards`);
  if (!SKIP_VERIFY) await verify(db, manifest);
  await client.close();
}

async function build() {
  fs.mkdirSync(DIR, { recursive: true });
  const excluded = EXCLUDE_FILE
    ? new Set(JSON.parse(fs.readFileSync(EXCLUDE_FILE, 'utf8')))
    : new Set();

  const { client, db } = await getScriptClient({ noTimeout: true });

  // Excluded-with-reason accounting for the manifest — "covered everything"
  // must never be implied by silence.
  const baseCount = await db.collection('books').countDocuments({
    visible: true, pages_count: { $gt: 0 },
    ...(LANGUAGE ? { language: LANGUAGE } : {}),
  });
  const exclusions = await computeExclusions(db);

  const books = await db.collection('books')
    .find(bookFilter())
    .project({
      id: 1, slug: 1, title: 1, author: 1, author_id: 1, year: 1,
      published: 1, language: 1, text_role: 1, work_id: 1,
      is_first_translation: 1, pages_translated: 1, ia_identifier: 1,
      'image_source.provider': 1, 'image_source.source_url': 1, doi: 1,
      summary: 1, chapters: 1,
    })
    .sort({ language: 1, id: 1 })
    .toArray();
  const workList = LIMIT > 0 ? books.slice(0, LIMIT) : books;
  console.log(`[build] snapshot v${VERSION}: ${workList.length.toLocaleString()} eligible books (of ${baseCount.toLocaleString()} visible+paged) → ${DIR}`);

  // One shard per language, opened lazily. Language codes come from
  // books.language free-ish text — slugify defensively for filenames.
  const shards = new Map(); // lang → { gz, path, books, pages, words, chars }
  const shardFor = (langRaw) => {
    const lang = String(langRaw || 'unknown').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'unknown';
    let s = shards.get(lang);
    if (!s) {
      const p = path.join(DIR, `books-${lang}.jsonl.gz`);
      const gz = zlib.createGzip({ level: 6 });
      const out = fs.createWriteStream(p);
      gz.pipe(out);
      s = { gz, out, path: p, lang, books: 0, pages: 0, words: 0, chars: 0 };
      shards.set(lang, s);
    }
    return s;
  };

  const fetchPages = (bookId) => db.collection('pages')
    .find({ book_id: bookId, page_number: { $not: { $lt: 0 } } })
    .project({
      id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1,
      ...Object.fromEntries(EDITION_LANGS.map((l) => [`translations.${l}.data`, 1])),
      ...(EDITION_LANGS.includes('es') ? { 'translation_es.data': 1 } : {}),
    })
    .sort({ page_number: 1 })
    .toArray();

  let nBooks = 0, nPages = 0, nWords = 0, nFlagged = 0;
  let nextPages = workList.length ? fetchPages(workList[0].id) : null;
  const statusPath = path.join(DIR, 'current-book.txt');
  for (let b = 0; b < workList.length; b++) {
    const book = workList[b];
    // Breadcrumb for wedge diagnosis: if the process stalls, this names the book.
    fs.writeFileSync(statusPath, `${b} ${book.id} ${book.slug} lang=${book.language || '?'}\n`);
    const pages = await nextPages;
    if (b + 1 < workList.length) nextPages = fetchPages(workList[b + 1].id);
    if (excluded.has(book.id)) { exclusions.exclude_file++; continue; }

    const shard = shardFor(book.language);
    const outPages = [];
    for (const page of pages) {
      const rec = { id: page.id, n: page.page_number };
      // Length-guard BEFORE any regex work (#3195): monster junk pages are
      // flagged and skipped whole, never fed to the strip/extract pipeline.
      for (const key of ['ocr', 'translation']) {
        if ((page[key]?.data?.length ?? 0) > MAX_PAGE_CHARS) {
          rec[`${key}_flags`] = ['oversize'];
          page[key] = undefined;
          nFlagged++;
        }
      }
      if (page.translation?.data) {
        const a = extractAnnotations(page.translation.data, TRANSLATION_ANNOTATION_TAGS);
        if (a) rec.annotations = a;
      }
      if (page.ocr?.data) {
        const s = extractAnnotations(page.ocr.data, OCR_ANNOTATION_TAGS);
        if (s) rec.scan = s;
      }
      for (const [key, raw] of [['ocr', page.ocr?.data], ['translation', page.translation?.data]]) {
        if (!raw) continue;
        // keepTables: the snapshot is the distributable corpus, not a snippet —
        // flattening a GFM table preserves the cell values but loses the column
        // each belonged to, baking that loss into every downstream consumer.
        const text = stripEditorialWrappers(raw, { keepTables: true }).trim();
        if (!text) continue;
        // A page whose entire text is one bracketed marker ("[Blank page — no
        // translatable content]") is an AI annotation, not source text.
        if (/^\[[^\]]{0,160}\]$/.test(text)) continue;
        const q = qualityFlags(text);
        rec[key] = text;
        if (q.flags.length) { rec[`${key}_flags`] = q.flags; nFlagged++; }
        shard.words += q.words; nWords += q.words;
        shard.chars += text.length;
      }
      // Other editions of the same leaf, keyed by ISO code. They ride in their
      // own map rather than replacing `translation`, because the English text
      // is what the OCR is aligned to and what every existing consumer reads —
      // a Spanish page arriving under `translation` would silently change the
      // language of a corpus somebody already trained on. Words and chars are
      // NOT added to the shard totals: those count the corpus once, and
      // double-counting a passage because we hold two renderings of it would
      // inflate every figure quoted from the manifest.
      for (const l of EDITION_LANGS) {
        const raw = page.translations?.[l]?.data
          ?? (l === 'es' ? page.translation_es?.data : null);
        if (!raw || raw.length > MAX_PAGE_CHARS) continue;
        const text = stripEditorialWrappers(raw, { keepTables: true }).trim();
        if (!text || /^\[[^\]]{0,160}\]$/.test(text)) continue;
        (rec.translations ??= {})[l] = text;
        shard.edition_pages = (shard.edition_pages || {});
        shard.edition_pages[l] = (shard.edition_pages[l] || 0) + 1;
      }
      if (rec.ocr || rec.translation || rec.translations) { outPages.push(rec); shard.pages++; nPages++; }
    }
    if (!outPages.length) continue;

    const record = {
      id: book.id,
      slug: book.slug,
      url: `https://sourcelibrary.org/book/${book.slug}`,
      title: book.title,
      author: book.author ?? null,
      author_id: book.author_id ?? null,
      year: book.year,
      published: book.published ?? null,
      language: book.language ?? null,
      text_role: book.text_role ?? null,
      work_id: book.work_id ?? null,
      is_first_translation: !!(book.is_first_translation && (book.pages_translated ?? 0) > 0),
      doi: book.doi ?? null,
      provenance: {
        ia_identifier: book.ia_identifier ?? null,
        provider: book.image_source?.provider ?? null,
        source_url: book.image_source?.source_url ?? null,
      },
      license: CONTENT_LICENSE.spdx,
      // Book-level editorial apparatus (AI-generated; labeled, never inline)
      summary: typeof book.summary === 'string' ? book.summary : null,
      chapters: Array.isArray(book.chapters)
        ? book.chapters.map(c => ({ page: c.pageNumber ?? c.page ?? null, title: c.title ?? null }))
        : null,
      pages: outPages,
    };
    if (!shard.gz.write(JSON.stringify(record) + '\n')) await once(shard.gz, 'drain');
    shard.books++; nBooks++;
    if (nBooks % 250 === 0) console.log(`[build] ${nBooks}/${workList.length} books, ${nPages.toLocaleString()} pages, ${nWords.toLocaleString()} words`);
  }

  await Promise.all([...shards.values()].map(s => new Promise(resolve => {
    s.out.on('close', resolve);
    s.gz.end();
  })));

  const shardEntries = await Promise.all([...shards.values()].map(async s => ({
    file: path.basename(s.path),
    language: s.lang,
    books: s.books, pages: s.pages, words: s.words, chars: s.chars,
    // Pages carrying a non-English edition, per ISO code. Counted separately
    // from `pages` on purpose: a page with a Spanish rendering is still ONE
    // page of corpus, and folding the two together would inflate every figure
    // downstream.
    ...(s.edition_pages ? { edition_pages: s.edition_pages } : {}),
    sha256: await sha256Stream(s.path),
    bytes: fs.statSync(s.path).size,
  })));
  const manifest = buildManifest({
    exclusions,
    counts: { books: nBooks, pages: nPages, words: nWords, flagged_pages: nFlagged },
    shardEntries,
  });
  fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const editionTotals = {};
  for (const s of shards.values()) {
    for (const [l, n] of Object.entries(s.edition_pages || {})) editionTotals[l] = (editionTotals[l] || 0) + n;
  }
  const editionSummary = Object.entries(editionTotals).map(([l, n]) => `${n.toLocaleString()} ${l}`).join(', ');
  console.log(`[build] done: ${nBooks.toLocaleString()} books, ${nPages.toLocaleString()} pages, ${nWords.toLocaleString()} words, ${shards.size} shards` +
    (EDITION_LANGS.length
      ? `; other editions: ${editionSummary || `none found for ${EDITION_LANGS.join(',')}`}`
      : ''));

  if (!SKIP_VERIFY) await verify(db, manifest);
  await client.close();
}

// Independent re-check (Diagnostic Discipline): re-query Mongo for the
// eligible count, and spot-check sampled output pages for wrapper leakage and
// zero-width provenance characters. Exits non-zero on any failure.
async function verify(db, manifest) {
  const problems = [];

  const eligible = await db.collection('books').countDocuments(bookFilter());
  const expected = LIMIT > 0 ? Math.min(LIMIT, eligible) : eligible;
  // Books can legitimately drop out (all pages empty after strip, exclude file)
  // but never appear from nowhere.
  if (manifest.counts.books > expected) {
    problems.push(`book count ${manifest.counts.books} exceeds independently queried eligible count ${expected}`);
  }

  // Reservoir-sample pages across shards and re-scan the actual output bytes.
  let sampled = 0, seen = 0;
  const sample = [];
  for (const s of manifest.shards) {
    for await (const line of shardLines(path.join(DIR, s.file))) {
      const book = JSON.parse(line);
      for (const p of book.pages) {
        seen++;
        if (sample.length < VERIFY_SAMPLE) sample.push(p);
        else {
          const j = Math.floor(Math.random() * seen);
          if (j < VERIFY_SAMPLE) sample[j] = p;
        }
      }
    }
  }
  for (const p of sample) {
    sampled++;
    for (const text of [p.ocr, p.translation]) {
      if (!text) continue;
      if (ZWC_RE.test(text)) problems.push(`page ${p.id}: zero-width provenance character in export`);
      if (WRAPPER_TAG_RE.test(text)) problems.push(`page ${p.id}: editorial wrapper tag survived stripping`);
    }
  }

  if (problems.length) {
    console.error(`[verify] FAILED (${problems.length} problems, ${sampled} pages sampled):`);
    for (const p of problems.slice(0, 20)) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log(`[verify] ok: book count within eligible bound (${manifest.counts.books} <= ${expected}), ${sampled} sampled pages clean (no ZWC, no wrapper tags)`);
  }
}

(has('--finalize-only') ? finalizeOnly() : build())
  .catch(err => { console.error(err); process.exit(1); });
