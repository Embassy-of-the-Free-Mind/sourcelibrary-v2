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
    const m = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (!m) continue;
    const content = m[1].replace(/<[^>]{1,60}>/g, ' ').replace(/\s+/g, ' ').trim();
    if (content) out[tag.replace(/-/g, '_')] = content;
  }
  return Object.keys(out).length ? out : null;
}

const ZWC_RE = /[​‌‍⁠﻿]/;
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
  const exclusions = {
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
    .project({ id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 })
    .sort({ page_number: 1 })
    .toArray();

  let nBooks = 0, nPages = 0, nWords = 0, nFlagged = 0;
  let nextPages = workList.length ? fetchPages(workList[0].id) : null;
  for (let b = 0; b < workList.length; b++) {
    const book = workList[b];
    const pages = await nextPages;
    if (b + 1 < workList.length) nextPages = fetchPages(workList[b + 1].id);
    if (excluded.has(book.id)) { exclusions.exclude_file++; continue; }

    const shard = shardFor(book.language);
    const outPages = [];
    for (const page of pages) {
      const rec = { id: page.id, n: page.page_number };
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
        const text = stripEditorialWrappers(raw).trim();
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
      if (rec.ocr || rec.translation) { outPages.push(rec); shard.pages++; nPages++; }
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

  const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const manifest = {
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
    counts: { books: nBooks, pages: nPages, words: nWords, flagged_pages: nFlagged },
    word_count_note: 'whitespace tokens over cleaned text; undercounts space-less scripts (Chinese, Tibetan, …) — see per-shard chars',
    quality_flags: {
      oversize: `text over ${MAX_PAGE_CHARS} chars`,
      entity_padding: 'more than 50 HTML entities (degenerate OCR padding, issue #3273)',
      low_ttr: 'type/token ratio < 0.15 over 120+ words (repetition loop, issue #3273)',
    },
    shards: [...shards.values()].map(s => ({
      file: path.basename(s.path),
      language: s.lang,
      books: s.books, pages: s.pages, words: s.words, chars: s.chars,
      sha256: sha256(s.path),
      bytes: fs.statSync(s.path).size,
    })).sort((a, b) => b.words - a.words),
  };
  fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[build] done: ${nBooks.toLocaleString()} books, ${nPages.toLocaleString()} pages, ${nWords.toLocaleString()} words, ${shards.size} shards`);

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
    const lines = zlib.gunzipSync(fs.readFileSync(path.join(DIR, s.file))).toString('utf8').split('\n').filter(Boolean);
    for (const line of lines) {
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

build().catch(err => { console.error(err); process.exit(1); });
