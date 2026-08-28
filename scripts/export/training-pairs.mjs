#!/usr/bin/env node
// Export page-aligned original→English training pairs (issue #4320).
//
// One JSONL record per PAGE PAIR (source text + English translation), for
// fine-tuning a house translation/gloss model. Sibling of
// build-corpus-snapshot.mjs (one record per book, for licensees) — same
// eligibility screen, same strip pipeline, different grain and consumer.
//
// Selection (all four gates are load-bearing):
//   - book: visible && pages_count > 0, text_role 'original', no RIGHTS-class
//     hidden_reason, content_type != 'artwork', numeric year <= --max-year
//     (default 1930 — same PD screen as the corpus snapshot; the training set
//     inherits the licensing posture of the distributable corpus).
//   - book language matches the --lang family (greek | latin).
//   - PAGE: the per-page <language> tag inside ocr.data matches the family.
//     Never the book field — page 1 of a Greek book is routinely tagged
//     English (cover). See .claude/docs/invariants/language-fields.md rule 5.
//   - both sides present and non-trivial after stripping.
//
// Pairs are FLAGGED, never silently dropped (short, ratio outliers, near
// duplicates) — the manifest counts every exclusion, and downstream training
// prep filters on `flags`/`near_dup_of`. Whole-book holdout: `split` is
// derived from a hash of book id (~3% 'val'), so a book never straddles the
// train/val boundary.
//
// Near-dup detection: we hold multiple copies of the same editions
// (independently OCR'd, so exact hashing misses them). MinHash-16 over 5-gram
// character shingles, banded 4×4 for candidates, flagged at >=12/16 matching
// positions. In-memory; ~60MB at Greek-corpus scale.
//
// Run (validation):
//   set -a; source .env.production.local; set +a; \
//   node scripts/export/training-pairs.mjs --lang greek --limit 15 \
//     --dir scripts/output/training-pairs-test
//
// Run (full Greek, ~1h; detach or background it):
//   node scripts/export/training-pairs.mjs --lang greek \
//     --dir scripts/output/training-pairs-v1
//
// Needs: MONGODB_URI. Zero AI cost. Read-only against Mongo.
// Output stays PRIVATE (local/Hetzner) — never the public R2 bucket.

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

const LANG = (arg('--lang', 'greek') || '').toLowerCase();
const DIR = path.resolve(arg('--dir', `scripts/output/training-pairs-${LANG}`));
const LIMIT = Number(arg('--limit', 0));           // 0 = all eligible books
const MAX_YEAR = Number(arg('--max-year', 1930));  // rights cutoff, as snapshot
const VAL_PCT = Number(arg('--val-pct', 3));       // whole-book holdout share
const CHAT = has('--chat');                        // also emit SFT chat format
const SKIP_VERIFY = has('--skip-verify');

// Family definitions: book-level filter (books.language, free-ish text) and
// page-level filter (the OCR <language> tag, which has NO controlled
// vocabulary — "Greek", "Ancient Greek", "greek", "grc" all occur).
const FAMILIES = {
  greek: { book: /greek/i, page: /^(ancient |modern |koine )?greek$|^grc$|^el$/i },
  latin: { book: /^latin$/i, page: /^latin$|^lat?$/i },
};
const FAMILY = FAMILIES[LANG];
if (!FAMILY) { console.error(`--lang must be one of: ${Object.keys(FAMILIES).join(', ')}`); process.exit(1); }

const MAX_PAGE_CHARS = 200_000; // monster-page guard, as snapshot (#3195)
const MIN_SRC_CHARS = 40;       // below this a "pair" is a stamp or a shelfmark
const RATIO_LO = 0.3, RATIO_HI = 5; // translation/source char ratio sanity window

const RIGHTS_REASON_RE = /copyright|takedown|dmca|rights/i;
// Structured ZWC runs only — isolated ZWNJ/ZWJ are real letters in some
// scripts (see build-corpus-snapshot.mjs verify).
const ZWC_RE = /[​‌‍⁠﻿]{8,}/;
const WRAPPER_TAG_RE = /<\/?(?:meta|summary|keywords|vocab|language|scan-quality|script|page-type|columns|warning|image-desc|page-num|header|sig|folio)>/i;

// Interior bounded, as extractAnnotations in the snapshot builder: an
// unclosed tag on a degenerate page turns a lazy unbounded interior into an
// O(n²) scan.
const pageLanguageTag = (raw) => raw.match(/<language>([\s\S]{0,200}?)<\/language>/i)?.[1]?.trim() ?? null;

// Page scaffold (page numbers, running heads, printer's signatures, folio
// marks) survives stripEditorialWrappers ON PURPOSE — the corpus snapshot
// ships it. A translation model must not learn to emit print-shop apparatus,
// so this surface removes it locally (opt-in here, never a changed default in
// the shared helper — text-helpers-and-exports.md). Interiors bounded.
const stripPageScaffold = (text) => text
  .replace(/<(page-num|header|sig|folio)>[\s\S]{0,2000}?<\/\1>/gi, '')
  .replace(/\n{3,}/g, '\n\n').trim();
const pageTypeTag = (raw) => raw.match(/<page-type>([\s\S]{0,200}?)<\/page-type>/i)?.[1]?.trim().toLowerCase() ?? null;

// --- MinHash-16 over 5-gram char shingles, banded 4×4 ------------------------
const SIG_N = 16, BAND = 4, NEAR_DUP_MIN = 12;
function minhashSig(text) {
  const norm = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (norm.length < 5) return null;
  const sig = new Array(SIG_N).fill(Infinity);
  for (let i = 0; i <= norm.length - 5; i++) {
    const h = crypto.createHash('md5').update(norm.slice(i, i + 5)).digest();
    for (let k = 0; k < SIG_N; k++) {
      const v = h.readUInt32LE((k % 4) * 4) ^ (0x9e3779b9 * (k + 1) >>> 0);
      if (v < sig[k]) sig[k] = v;
    }
  }
  return sig;
}
function makeDupIndex() {
  const bands = Array.from({ length: SIG_N / BAND }, () => new Map());
  const sigs = new Map(); // page_id → sig
  return {
    check(pageId, sig) {
      const candidates = new Set();
      for (let b = 0; b < bands.length; b++) {
        const key = sig.slice(b * BAND, (b + 1) * BAND).join(',');
        const hit = bands[b].get(key);
        if (hit) hit.forEach((id) => candidates.add(id));
        else bands[b].set(key, []);
        bands[b].get(key).push(pageId);
      }
      for (const cand of candidates) {
        const other = sigs.get(cand);
        let same = 0;
        for (let k = 0; k < SIG_N; k++) if (sig[k] === other[k]) same++;
        if (same >= NEAR_DUP_MIN) { sigs.set(pageId, sig); return cand; }
      }
      sigs.set(pageId, sig);
      return null;
    },
  };
}

// Whole-book split: deterministic on book id, so a re-run never migrates a
// book across the boundary and no book straddles it.
const splitFor = (bookId) =>
  parseInt(crypto.createHash('md5').update(String(bookId)).digest('hex').slice(0, 8), 16) % 100 < VAL_PCT ? 'val' : 'train';

function bookFilter() {
  return {
    visible: true,
    pages_count: { $gt: 0 },
    text_role: 'original',
    language: FAMILY.book,
    hidden_reason: { $not: RIGHTS_REASON_RE },
    content_type: { $ne: 'artwork' },
    year: { $type: 'number', $lte: MAX_YEAR },
  };
}

function gzWriter(p) {
  const gz = zlib.createGzip({ level: 6 });
  const out = fs.createWriteStream(p);
  gz.pipe(out);
  return {
    async write(line) { if (!gz.write(line)) await once(gz, 'drain'); },
    close: () => new Promise((resolve) => { out.on('close', resolve); gz.end(); }),
  };
}

async function* gzLines(p) {
  const rl = readline.createInterface({
    input: fs.createReadStream(p).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) if (line) yield line;
}

async function build() {
  fs.mkdirSync(DIR, { recursive: true });
  const { client, db } = await getScriptClient({ noTimeout: true });

  const books = await db.collection('books')
    .find(bookFilter())
    .project({
      id: 1, slug: 1, title: 1, author: 1, author_id: 1, year: 1,
      language: 1, work_id: 1, edition_key: 1,
    })
    .sort({ id: 1 })
    .toArray();
  const workList = LIMIT > 0 ? books.slice(0, LIMIT) : books;
  console.log(`[build] training pairs (${LANG}): ${workList.length.toLocaleString()} eligible books → ${DIR}`);

  const pairsPath = path.join(DIR, `pairs-${LANG}.jsonl.gz`);
  const pairs = gzWriter(pairsPath);
  const chat = CHAT ? gzWriter(path.join(DIR, `chat-${LANG}.jsonl.gz`)) : null;
  const dupIndex = makeDupIndex();

  // Excluded-with-reason accounting: silence must never imply coverage.
  const skipped = {
    page_lang_other: 0, page_lang_mixed: 0, page_lang_missing: 0, blank_or_marker: 0,
    no_translation: 0, no_ocr: 0, oversize: 0, too_short: 0,
  };
  const flagCounts = { ratio_outlier: 0, near_duplicate: 0 };
  let nPairs = 0, nSrcChars = 0, nTrChars = 0;
  const perSplit = { train: 0, val: 0 };

  const fetchPages = (bookId) => db.collection('pages')
    .find({ book_id: bookId, page_number: { $not: { $lt: 0 } } })
    .project({ id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 })
    .sort({ page_number: 1 })
    .toArray();

  const statusPath = path.join(DIR, 'current-book.txt');
  let nextPages = workList.length ? fetchPages(workList[0].id) : null;
  for (let b = 0; b < workList.length; b++) {
    const book = workList[b];
    fs.writeFileSync(statusPath, `${b} ${book.id} ${book.slug} \n`);
    const pages = await nextPages;
    if (b + 1 < workList.length) nextPages = fetchPages(workList[b + 1].id);
    const split = splitFor(book.id);

    for (const page of pages) {
      const rawOcr = page.ocr?.data, rawTr = page.translation?.data;
      if (!rawOcr) { skipped.no_ocr++; continue; }
      if (!rawTr) { skipped.no_translation++; continue; }
      if (rawOcr.length > MAX_PAGE_CHARS || rawTr.length > MAX_PAGE_CHARS) { skipped.oversize++; continue; }

      // Per-page language gate — the book-level field never decides a page.
      // The tag is often a LIST ("Ancient Greek, Latin" on a facing-page
      // edition); parse it as one before comparing — split on , ; and "and",
      // never "/" (language-fields.md). Mixed pages are excluded from v1
      // (the pair would be Greek+Latin → English, noise for a translation
      // model) but counted in their own bucket, not folded into "other".
      const tag = pageLanguageTag(rawOcr);
      if (!tag || /^(none|n\/a)$/i.test(tag)) { skipped.page_lang_missing++; continue; }
      const tagParts = tag.split(/[,;]|\band\b/i).map((t) => t.trim()).filter(Boolean);
      const inFamily = tagParts.filter((t) => FAMILY.page.test(t));
      if (!inFamily.length) { skipped.page_lang_other++; continue; }
      if (inFamily.length < tagParts.length) { skipped.page_lang_mixed++; continue; }
      const ptype = pageTypeTag(rawOcr);
      if (ptype === 'blank' || ptype === 'cover' || ptype === 'illustration') { skipped.blank_or_marker++; continue; }

      const src = stripPageScaffold(stripEditorialWrappers(rawOcr, { keepTables: true }));
      const tr = stripPageScaffold(stripEditorialWrappers(rawTr, { keepTables: true }));
      // "[Blank page — no translatable content]"-style AI markers are
      // annotations, not text (same predicate as the corpus snapshot).
      if (!src || !tr || /^\[[^\]]{0,160}\]$/.test(src) || /^\[[^\]]{0,160}\]$/.test(tr)) { skipped.blank_or_marker++; continue; }
      if (src.length < MIN_SRC_CHARS) { skipped.too_short++; continue; }

      const flags = [];
      const ratio = tr.length / src.length;
      if (ratio < RATIO_LO || ratio > RATIO_HI) { flags.push('ratio_outlier'); flagCounts.ratio_outlier++; }

      const sig = minhashSig(src);
      const dupOf = sig ? dupIndex.check(page.id, sig) : null;
      if (dupOf) { flags.push('near_duplicate'); flagCounts.near_duplicate++; }

      const rec = {
        book_id: book.id,
        book_slug: book.slug,
        page_id: page.id,
        page_number: page.page_number,
        url: `https://sourcelibrary.org/book/${book.slug}?page=${page.page_number}`,
        title: book.title,
        author: book.author ?? null,
        year: book.year,
        work_id: book.work_id ?? null,
        edition_key: book.edition_key ?? null,
        language_tag: tag,
        split,
        source_text: src,
        translation_en: tr,
        ratio: Math.round(ratio * 100) / 100,
        ...(flags.length ? { flags } : {}),
        ...(dupOf ? { near_dup_of: dupOf } : {}),
      };
      await pairs.write(JSON.stringify(rec) + '\n');
      if (chat && !flags.length) {
        await chat.write(JSON.stringify({
          messages: [
            { role: 'user', content: `Translate this ${tag} text into English:\n\n${src}` },
            { role: 'assistant', content: tr },
          ],
        }) + '\n');
      }
      nPairs++; nSrcChars += src.length; nTrChars += tr.length; perSplit[split]++;
    }
    if ((b + 1) % 100 === 0) console.log(`[build] ${b + 1}/${workList.length} books, ${nPairs.toLocaleString()} pairs`);
  }

  await pairs.close();
  if (chat) await chat.close();

  const manifest = {
    dataset: `Source Library training pairs (${LANG} → English)`,
    issue: 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4320',
    created: new Date().toISOString(),
    generator_note: 'Both sides of every pair are Gemini outputs (pipeline OCR and translation). Do NOT start a training run before the terms-of-service decision on #4320 is resolved.',
    distribution: 'PRIVATE — local/Hetzner only, never the public R2 bucket',
    eligibility: {
      lang: LANG, text_role: 'original', max_year: MAX_YEAR,
      page_gate: 'per-page <language> tag, never books.language',
      ...(LIMIT ? { limit: LIMIT, note: 'VALIDATION BUILD' } : {}),
    },
    counts: {
      books: workList.length, pairs: nPairs, split: perSplit,
      source_chars: nSrcChars, translation_chars: nTrChars,
    },
    skipped, flagged: flagCounts,
    flag_semantics: {
      ratio_outlier: `translation/source char ratio outside [${RATIO_LO}, ${RATIO_HI}]`,
      near_duplicate: `MinHash-${SIG_N} 5-gram signature matches an earlier page at >=${NEAR_DUP_MIN}/${SIG_N} (multiple copies of one edition); near_dup_of names the kept page`,
    },
    split_rule: `md5(book_id) % 100 < ${VAL_PCT} → val (whole books, deterministic)`,
    files: [path.basename(pairsPath), ...(CHAT ? [`chat-${LANG}.jsonl.gz`] : [])].map((f) => {
      const p = path.join(DIR, f);
      return { file: f, bytes: fs.statSync(p).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') };
    }),
  };
  fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[build] done: ${nPairs.toLocaleString()} pairs from ${workList.length.toLocaleString()} books ` +
    `(train ${perSplit.train.toLocaleString()} / val ${perSplit.val.toLocaleString()}); ` +
    `skipped ${Object.entries(skipped).map(([k, v]) => `${k}=${v}`).join(' ')}; ` +
    `flagged ${Object.entries(flagCounts).map(([k, v]) => `${k}=${v}`).join(' ')}`);

  if (!SKIP_VERIFY) await verify(db, manifest, pairsPath);
  await client.close();
}

// Independent re-check (Diagnostic Discipline): pair count bounded by an
// independent query; sampled output re-scanned for wrapper leakage, ZWC runs,
// and wrong-family language tags. Exits non-zero on any failure.
async function verify(db, manifest, pairsPath) {
  const problems = [];
  const eligible = await db.collection('books').countDocuments(bookFilter());
  const expectedBooks = LIMIT > 0 ? Math.min(LIMIT, eligible) : eligible;
  if (manifest.counts.books > expectedBooks) {
    problems.push(`book count ${manifest.counts.books} exceeds independently queried ${expectedBooks}`);
  }

  let sampled = 0, seen = 0;
  const sample = [];
  for await (const line of gzLines(pairsPath)) {
    const rec = JSON.parse(line);
    seen++;
    if (sample.length < 200) sample.push(rec);
    else { const j = Math.floor(Math.random() * seen); if (j < 200) sample[j] = rec; }
  }
  if (seen !== manifest.counts.pairs) problems.push(`manifest says ${manifest.counts.pairs} pairs, file holds ${seen}`);
  for (const rec of sample) {
    sampled++;
    for (const text of [rec.source_text, rec.translation_en]) {
      if (ZWC_RE.test(text)) problems.push(`pair ${rec.page_id}: zero-width provenance run in export`);
      if (WRAPPER_TAG_RE.test(text)) problems.push(`pair ${rec.page_id}: editorial wrapper tag survived stripping`);
    }
    const parts = rec.language_tag.split(/[,;]|\band\b/i).map((t) => t.trim()).filter(Boolean);
    if (!parts.every((t) => FAMILY.page.test(t))) problems.push(`pair ${rec.page_id}: language_tag "${rec.language_tag}" outside ${LANG} family`);
  }

  if (problems.length) {
    console.error(`[verify] FAILED (${problems.length} problems, ${sampled} pairs sampled):`);
    for (const p of problems.slice(0, 20)) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log(`[verify] ok: ${manifest.counts.pairs.toLocaleString()} pairs match file, ${sampled} sampled pairs clean (no ZWC, no wrapper tags, tags in family)`);
  }
}

build().catch((err) => { console.error(err); process.exit(1); });
