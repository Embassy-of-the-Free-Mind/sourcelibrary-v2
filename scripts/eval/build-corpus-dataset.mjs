#!/usr/bin/env node
/**
 * Corpus dataset builder — flat tables for data science over the double-OCR
 * corpus (#3235 workstream).
 *
 * WHY THIS EXISTS. `revision-agreement-corpus.mjs` already emits a rich
 * PAIR-level table (one row per rewrite transition, with the agreement metrics).
 * What it does not emit is the three things every analysis of that corpus needs
 * around it:
 *
 *   1. BOOK metadata — title and author are absent from the pair export (only
 *      `slug`), and there is no way to ask "which authors / providers / scan
 *      classes are over-represented among re-OCR'd books".
 *   2. A CONTROL GROUP — the pair table contains only pages that were OCR'd
 *      twice. Any claim of the form "re-OCR'd pages are harder / longer /
 *      later in the book" is unfalsifiable without the pages of the same books
 *      that were OCR'd once. This builder emits every page of every scoped
 *      book, flagged `n_revisions`, so the comparison is within-book.
 *   3. RE-OCR PROVENANCE — why a page was re-read. This is the selection
 *      variable, and it is the single most important column here. See below.
 *
 * THE SELECTION PROBLEM (read before analysing anything).
 * `page_revisions` is NOT a sample of "the same page read twice". It is a log of
 * every time stored text was overwritten, and the two largest contributors are
 * data-repair sweeps in which the image under the text CHANGED:
 *
 *   source='shift-repair-erara-2026-07'   56,413 revisions (29.5%)
 *       #3186/#3357. `repair-erara-text-shift.mjs` MOVED text from p(N+1) to
 *       p(N) across confirmed books. The "prior" side of such a pair is the
 *       NEIGHBOURING PAGE's transcription, not an earlier reading of this page.
 *       These are not double-OCR pairs at all and must be excluded from any
 *       agreement statistic.
 *   created_at in Mar–Apr 2026           84,307 revisions in April alone
 *       The #3362 window, when `archive-bulk.mjs` wrote every book's pages to a
 *       shared `archived/undefined/<n>.jpg` key and OCR transcribed other
 *       books' pages. Flagged as `in_undefined_key_window` — a HYPOTHESIS
 *       column, not a verdict: the window is necessary, not sufficient.
 *
 * This is the measured cause of CLAUDE.md's warning that ~40% of pairs report a
 * different printed page number. `printed_page_shift` reproduces that test per
 * row rather than on a sample, so it can be used as a filter instead of a
 * caveat. A shift says the image changed; it does NOT say which side is right.
 *
 * OUTPUTS (CSV, one header row, RFC4180-quoted — pandas/R read them directly):
 *   books.csv          one row per book, with re-OCR rollups
 *   pages.csv          one row per page, with text features + n_revisions
 *   revisions.csv      one row per stored revision, with provenance
 *   book_terms.csv     top-K TF-IDF terms per book (long format)
 *   tfidf_vocab.csv    per-corpus document frequencies
 *   manifest.json      row counts, scope, timings, column dictionary
 *
 * TEXT FEATURES are the house definitions, copied from
 * `revision-agreement-corpus.mjs` so the two tables join on comparable numbers:
 * entity de-padding before tokenizing (`&nbsp;` runs count as letters and once
 * inflated a page to 4,025 phantom "words"), annotation content dropped for
 * `body_words`, type/token ratio for the repetition-loop degenerate class.
 *
 * TF-IDF is computed with the ngram viewer's language-aware tokenizer
 * (`scripts/lib/ngram-normalize.mjs` — Latin u/v + i/j folding, Greek polytonic
 * folding), and IDF is computed WITHIN a language corpus. A single global IDF
 * would make language the dominant axis of every book vector, which is a fact
 * about the corpus mix and not about any book.
 *
 * Cost: free. Mongo reads + local compute, no model API calls.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/build-corpus-dataset.mjs --phase=books
 *   node scripts/eval/build-corpus-dataset.mjs                    # all phases, revised scope
 *
 * Long run — the pages + tfidf phases read page text and take a while:
 *   nohup node scripts/eval/build-corpus-dataset.mjs \
 *     > scripts/output/corpus-dataset.log 2>&1 & disown
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { tokenize, ORIGINAL_LANGUAGE_CORPUS } from '../lib/ngram-normalize.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));

// revised = the 2,139 books holding at least one OCR revision (the double-OCR
// corpus plus its within-book controls). all = every book in the collection —
// the books phase is cheap either way; pages/tfidf over `all` reads ~6.2M pages
// of text and should be treated as an overnight job.
const SCOPE = args.scope || 'revised';
const PHASES = (args.phase || 'books,pages,revisions,tfidf').split(',');
const OUT_DIR = args['out-dir'] || path.join(__dirname, '..', 'output', 'corpus-dataset');
const BOOK_CHUNK = parseInt(args['book-chunk'] || '25');    // books per pages query
const TFIDF_PAGES = parseInt(args['tfidf-pages'] || '60');  // pages sampled per book
const TFIDF_TOP = parseInt(args['tfidf-top'] || '40');      // terms kept per book
const TFIDF_MIN_DF = parseInt(args['tfidf-min-df'] || '2'); // drop hapax vocabulary
// Drop terms appearing in more than this FRACTION of a corpus's books.
// MEASURED NOT TO WORK on this corpus — left in place for other datasets, but do
// not reach for it here. Early-modern orthography splits one function word into
// many types, and it is the ARCHAIC ones that top the rankings while sitting
// well below any usable cut: German `vnd` 0.268, `vnnd` 0.221, `nit` 0.237
// against `und` 0.910 and `der` 0.967. A cut at 0.5 therefore removes the modern
// spellings (harmless) and keeps every archaic one (the actual problem), while
// destroying real content — Latin `aqua` is 0.586 and `ignis` 0.491.
// The principled fix is orthographic folding in tokenize(), as already done for
// Latin u/v + i/j and Greek polytonic. See .claude/docs/corpus-dataset.md.
const TFIDF_MAX_DF = parseFloat(args['tfidf-max-df'] || '1');
// Minimum term length. Single letters are noise for a topical keyword vector —
// but NOT always: Trithemius's `Polygraphy` is a cipher manual whose ten highest
// TF-IDF terms are all single letters, which is the correct description of that
// book. Pass --tfidf-min-len=1 to keep them.
const TFIDF_MIN_LEN = parseInt(args['tfidf-min-len'] || '2');
const LIMIT = parseInt(args.limit || '0');                  // books, for smoke runs

// The #3362 shared-key window. A page OCR'd here MAY have been read from another
// book's image. Necessary, not sufficient — never report this as the verdict.
const UNDEFINED_KEY_WINDOW = [new Date('2026-03-01T00:00:00Z'), new Date('2026-05-01T00:00:00Z')];
// Sources that moved existing text between pages rather than re-reading an image.
const TEXT_MOVE_RE = /^shift-repair-|^repair-erara/i;

// ── CSV writer ───────────────────────────────────────────────────
const csvEsc = v => {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) v = v.join('|');
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? '1' : '0';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
class Csv {
  constructor(file, cols, append = false) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.file = file; this.cols = cols; this.n = 0;
    const resuming = append && fs.existsSync(file);
    this.out = fs.createWriteStream(file, { flags: resuming ? 'a' : 'w' });
    if (resuming) {
      // Count what is already there so the manifest reports the true total, and
      // drop a trailing partial line if the process died mid-write.
      const buf = fs.readFileSync(file, 'utf8');
      const complete = buf.endsWith('\n');
      this.n = buf.trim().split('\n').length - 1;    // minus header
      if (!complete) {
        const keep = buf.slice(0, buf.lastIndexOf('\n') + 1);
        fs.writeFileSync(file, keep);
        this.n = keep.trim().split('\n').length - 1;
        this.out = fs.createWriteStream(file, { flags: 'a' });
      }
    } else {
      this.out.write(cols.join(',') + '\n');
    }
  }
  async row(o) {
    this.n++;
    // Backpressure matters: pages.csv can run to millions of rows and an
    // unawaited write() grows the buffer without bound.
    if (!this.out.write(this.cols.map(c => csvEsc(o[c])).join(',') + '\n')) await once(this.out, 'drain');
  }
  async close() { await new Promise(r => this.out.end(r)); return this.n; }
}

// ── text features (parity with revision-agreement-corpus.mjs) ────
// HTML entities are not text. `nbsp` is a letter run, so a page padded with
// 24,692 chars of `&nbsp;` counted as 4,025 body words before this.
const deEntity = s => (s || '').replace(/&[a-z]{2,8};/gi, ' ').replace(/&#\d+;/g, ' ');

// Editorial wrappers describe the page and are never verbatim source; inline
// marks sit ON real body text so their CONTENT is kept for `words` and dropped
// only for `body_words`.
const WRAPPERS = 'meta|summary|keywords|vocab|language|scan-quality|script|page-type|columns|warning';
const INLINE_MARKS = 'note|term|margin|gloss|unclear|insert|header|catchword|sig|page-num';
const dropTags = (t, names) => {
  for (const w of names.split('|')) t = t.replace(new RegExp(`<${w}[^>]*>[\\s\\S]*?</${w}>`, 'gi'), '');
  return t;
};
const wordsOf = s => deEntity(dropTags(s || '', WRAPPERS))
  .replace(/<[^>]+>/g, ' ').replace(/[^\p{L}\s]/gu, ' ')
  .split(/\s+/).filter(w => w.length > 1);
const bodyWordsOf = s => deEntity(dropTags(s || '', `image-desc|${WRAPPERS}|${INLINE_MARKS}`))
  .replace(/^#{1,6}\s.*$/gm, '').replace(/<[^>]+>/g, ' ').replace(/[^\p{L}\s]/gu, ' ')
  .split(/\s+/).filter(w => w.length > 1);

const DEGENERATE = 0.15;   // type/token ratio below this on a long text = loop
const REFUSAL_RE = /\b(i (?:cannot|can't|am unable to|'m unable to)\b|i (?:apologize|'m sorry|am sorry)\b|as an ai\b|unable to (?:fulfill|process|transcribe)\b)/i;
const META_RE = /(\bi(?:'ll| will| am going to| shall)\s+(?:provide|transcribe|include|give|now\b)|\bhere is the (?:transcription|text)\b|\bthe image shows\b|\bnote:\s*the (?:text|image)\b|->\s*wait\b|\bwait,\s*["'`]|^\s*(?:okay|alright|ah),\s|\bline \d+:\s*[`"']|\blet me (?:transcribe|provide|check|re-?read)\b)/im;
const SPACELESS_RE = /[\p{Script=Han}\p{Script=Tibetan}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}]/u;

const tagOf = (s, name) => {
  const m = (s || '').match(new RegExp(`<${name}>\\s*([^<]{0,40}?)\\s*</${name}>`, 'i'));
  return m ? (m[1].trim().toLowerCase() || null) : null;
};
// The printed page number the model read OFF the page. It identifies which leaf
// was photographed, independently of how well the text was read — which is what
// makes it the instrument for detecting an image shift.
const printedPageNum = t => {
  const m = (t || '').match(/<page-num>\s*([0-9]{1,4})\s*<\/page-num>/i);
  return m ? parseInt(m[1], 10) : null;
};
const countTag = (s, name) => ((s || '').match(new RegExp(`<${name}[^>]*>`, 'gi')) || []).length;

function textFeatures(text) {
  const w = wordsOf(text);
  const b = bodyWordsOf(text);
  const uniq = new Set(w.map(x => x.toLowerCase())).size;
  const ttr = w.length >= 120 ? uniq / w.length : null;
  const letters = (text || '').replace(/[^\p{L}]/gu, '').slice(0, 2000);
  let spaceless = 0;
  for (const ch of letters) if (SPACELESS_RE.test(ch)) spaceless++;
  return {
    chars: (text || '').length,
    words: w.length,
    body_words: b.length,
    unique_words: uniq,
    type_token_ratio: ttr === null ? null : +ttr.toFixed(4),
    degenerate: ttr !== null && ttr < DEGENERATE,
    entity_padded: /&[a-z]{2,8};|&#\d+;/i.test(text || '') && (text || '').length > 2000,
    script_class: !letters.length ? 'unknown' : (spaceless / letters.length > 0.3 ? 'spaceless' : 'spaced'),
    marginalia: countTag(text, 'margin') + countTag(text, 'note'),
    image_desc: countTag(text, 'image-desc') > 0,
    page_type_tag: tagOf(text, 'page-type'),
    columns_tag: tagOf(text, 'columns'),
    lang_tag: tagOf(text, 'lang') || tagOf(text, 'language'),
    printed_page_num: printedPageNum(text),
    refusal: REFUSAL_RE.test((text || '').slice(0, 400)),
    meta_prose: META_RE.test((text || '').slice(0, 1200)) || REFUSAL_RE.test((text || '').slice(0, 400)),
  };
}

const yearBucket = y => {
  if (typeof y !== 'number' || !Number.isFinite(y)) return 'unknown';
  if (y < 1500) return 'pre-1500';
  if (y < 1600) return '1500-1599';
  if (y < 1700) return '1600-1699';
  if (y < 1800) return '1700-1799';
  if (y < 1900) return '1800-1899';
  return '1900+';
};

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// ── checkpoints ──────────────────────────────────────────────────
// A dropped connection must cost the last chunk, not the whole phase. Each
// resumable phase records how far it got; a re-run picks up from there and
// APPENDS to the existing CSV. Delete the .checkpoint-*.json (or the CSV) to
// force a clean rebuild.
const ckptPath = phase => path.join(OUT_DIR, `.checkpoint-${phase}.json`);
const readCkpt = (phase) => {
  try {
    const c = JSON.parse(fs.readFileSync(ckptPath(phase), 'utf8'));
    return c.scope === SCOPE ? c : null;   // a scope change invalidates it
  } catch { return null; }
};
const writeCkpt = (phase, data) => {
  try {
    fs.writeFileSync(ckptPath(phase), JSON.stringify({ scope: SCOPE, at: new Date().toISOString(), ...data }));
  } catch { /* a lost checkpoint costs time, never correctness */ }
};
const clearCkpt = phase => { try { fs.unlinkSync(ckptPath(phase)); } catch { /* already gone */ } };

// ── stall watchdog ───────────────────────────────────────────────
// Belt and braces alongside the finite socket timeout. Any driver-level hang
// that does not surface as an error still stops progress, and a job stuck at 0%
// CPU is indistinguishable from a slow one until hours have passed. Exiting
// non-zero hands control back to the retry loop, which resumes from the
// checkpoint — so a stall costs minutes, never a night.
const STALL_MS = parseInt(args['stall-timeout'] || String(20 * 60 * 1000));
let lastProgress = Date.now();
const beat = () => { lastProgress = Date.now(); };
const watchdog = setInterval(() => {
  const idle = Date.now() - lastProgress;
  if (idle > STALL_MS) {
    console.error(`[watchdog] no progress for ${Math.round(idle / 60000)} min — exiting so the retry loop can resume from the checkpoint`);
    process.exit(1);
  }
}, 60000);
watchdog.unref();

// ── main ─────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Tuned for a flaky link. The first full attempt died on
  // PoolClearedOnNetworkError ("server monitor timeout") after 64K rows: the
  // default 10s monitor heartbeat treats a slow link as a dead server, clears
  // the pool, and kills every open cursor. Longer windows + retryReads let the
  // job ride out a blip instead of losing the phase.
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 120000,
    heartbeatFrequencyMS: 30000,
    // FINITE, deliberately. socketTimeoutMS: 0 means "never time out", so a
    // silently dropped socket does not error — it hangs forever, the retry loop
    // never fires, and the job sits at 0% CPU indefinitely. That cost 17 hours
    // on the tfidf run. A retry that cannot be triggered is not a retry.
    socketTimeoutMS: 600000,
    connectTimeoutMS: 60000,
    retryReads: true,
    maxPoolSize: 8,
  });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const BOOKS = db.collection('books');
  const PAGES = db.collection('pages');
  const REVS = db.collection('page_revisions');
  const manifest = { date: new Date().toISOString(), scope: SCOPE, phases: PHASES, rows: {}, timings: {} };
  const t00 = Date.now();

  // ── revision rollups (needed by every phase; cheap enough to always run) ──
  log('rolling up page_revisions (field: ocr) …');
  const revRollup = await REVS.aggregate([
    { $match: { field: 'ocr' } },
    {
      $group: {
        _id: '$book_id',
        n_revisions: { $sum: 1 },
        pages: { $addToSet: '$page_id' },
        sources: { $addToSet: '$source' },
        models: { $addToSet: '$model' },
        first: { $min: '$created_at' },
        last: { $max: '$created_at' },
      },
    },
    { $project: { n_revisions: 1, sources: 1, models: 1, first: 1, last: 1, n_revised_pages: { $size: '$pages' } } },
  ], { allowDiskUse: true, maxTimeMS: 900000 }).toArray();
  const revByBook = new Map(revRollup.map(r => [String(r._id), r]));
  log(`  ${revRollup.length.toLocaleString()} books hold at least one OCR revision`);

  // page_id -> revision count, for the pages phase's control flag.
  const revsPerPage = new Map();
  if (PHASES.includes('pages')) {
    log('counting revisions per page …');
    const cur = REVS.find({ field: 'ocr' }, { projection: { page_id: 1 } }).batchSize(5000);
    for await (const r of cur) revsPerPage.set(r.page_id, (revsPerPage.get(r.page_id) || 0) + 1);
    log(`  ${revsPerPage.size.toLocaleString()} distinct pages have been re-OCR'd`);
  }

  // ── scope: which books ───────────────────────────────────────────
  const bookFilter = SCOPE === 'all' ? {} : { $or: [
    { _id: { $in: revRollup.map(r => r._id).filter(x => x && x.length === 24) } },
    { id: { $in: revRollup.map(r => String(r._id)) } },
  ] };

  const BOOK_PROJ = {
    id: 1, slug: 1, title: 1, display_title: 1, normalized_title: 1, author: 1, normalized_author: 1,
    year: 1, language: 1, text_role: 1, work_id: 1, work_slug: 1, work_title: 1,
    pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1, pages_archived: 1,
    translation_pct: 1, quality_score: 1, scan_quality: 1, visible: 1, hidden: 1,
    collections: 1, subject_keywords: 1, categories: 1, image_source: 1,
    is_first_translation: 1, needs_splitting: 1, split_completed: 1, pipeline_status: 1,
    created_at: 1, tenantId: 1,
  };

  // Both keys are in play: page_revisions.book_id / pages.book_id hold either
  // books.id or String(books._id) depending on the writer's vintage.
  const scoped = [];        // { keys:[...], doc }
  {
    const t0 = Date.now();
    // Sorted: the pages/tfidf phases resume by INDEX into this array, so the
    // order must be identical across runs. An unsorted find() is not.
    const cur = BOOKS.find(bookFilter, { projection: BOOK_PROJ }).sort({ _id: 1 }).batchSize(500);
    let n = 0;
    for await (const b of cur) {
      scoped.push(b);
      if (++n % 20000 === 0) log(`  ${n.toLocaleString()} books read`);
      if (LIMIT && n >= LIMIT) break;
    }
    log(`scope='${SCOPE}' → ${scoped.length.toLocaleString()} books (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }

  const keysOf = b => [...new Set([b.id, String(b._id)].filter(Boolean))];
  const revFor = b => keysOf(b).map(k => revByBook.get(k)).find(Boolean) || null;

  // ── phase: books ─────────────────────────────────────────────────
  if (PHASES.includes('books')) {
    const t0 = Date.now();
    const csv = new Csv(path.join(OUT_DIR, 'books.csv'), [
      'book_id', 'mongo_id', 'slug', 'title', 'author', 'normalized_author', 'year', 'year_bucket',
      'language', 'script_hint', 'text_role', 'work_id', 'work_slug', 'work_title',
      'provider', 'source_url', 'pages_count', 'pages_ocr', 'pages_translated', 'pages_blank',
      'ocr_pct', 'translation_pct', 'quality_score', 'scan_score', 'scan_median', 'dominant_scan_class',
      'has_microfilm_pages', 'has_blank_pages', 'visible', 'hidden', 'is_first_translation',
      'needs_splitting', 'split_completed', 'pipeline_status', 'n_collections', 'collections',
      'subject_keywords', 'categories', 'tenant_id', 'created_at',
      // re-OCR rollups — the selection variables
      'n_ocr_revisions', 'n_revised_pages', 'revised_page_pct', 'revision_sources', 'revision_models',
      'revision_first', 'revision_last', 'has_text_move_repair', 'has_undefined_key_window',
    ]);
    for (const b of scoped) {
      const rv = revFor(b);
      const sources = (rv?.sources || []).filter(Boolean);
      const inWindow = rv && rv.first && rv.last &&
        new Date(rv.last) >= UNDEFINED_KEY_WINDOW[0] && new Date(rv.first) < UNDEFINED_KEY_WINDOW[1];
      await csv.row({
        book_id: b.id || String(b._id),
        mongo_id: String(b._id),
        slug: b.slug, title: b.display_title || b.title, author: b.author,
        normalized_author: b.normalized_author,
        year: typeof b.year === 'number' ? b.year : null, year_bucket: yearBucket(b.year),
        language: b.language, script_hint: b.language, text_role: b.text_role,
        work_id: b.work_id, work_slug: b.work_slug, work_title: b.work_title,
        provider: b.image_source?.provider, source_url: b.image_source?.source_url,
        pages_count: b.pages_count, pages_ocr: b.pages_ocr, pages_translated: b.pages_translated,
        pages_blank: b.pages_blank,
        ocr_pct: b.pages_count ? +(100 * (b.pages_ocr || 0) / b.pages_count).toFixed(2) : null,
        translation_pct: b.translation_pct, quality_score: b.quality_score,
        scan_score: b.scan_quality?.score, scan_median: b.scan_quality?.median_score,
        dominant_scan_class: b.scan_quality?.dominant_scan_class,
        has_microfilm_pages: b.scan_quality?.has_microfilm_pages,
        has_blank_pages: b.scan_quality?.has_blank_pages,
        visible: b.visible, hidden: b.hidden, is_first_translation: b.is_first_translation,
        needs_splitting: b.needs_splitting, split_completed: b.split_completed,
        pipeline_status: b.pipeline_status,
        n_collections: (b.collections || []).length, collections: b.collections,
        subject_keywords: b.subject_keywords, categories: b.categories,
        tenant_id: b.tenantId, created_at: b.created_at,
        n_ocr_revisions: rv?.n_revisions || 0,
        n_revised_pages: rv?.n_revised_pages || 0,
        revised_page_pct: rv && b.pages_count ? +(100 * rv.n_revised_pages / b.pages_count).toFixed(2) : null,
        revision_sources: sources, revision_models: (rv?.models || []).filter(Boolean),
        revision_first: rv?.first, revision_last: rv?.last,
        has_text_move_repair: sources.some(s => TEXT_MOVE_RE.test(s)),
        has_undefined_key_window: !!inWindow,
      });
    }
    manifest.rows.books = await csv.close();
    manifest.timings.books = +((Date.now() - t0) / 1000).toFixed(1);
    log(`books.csv → ${manifest.rows.books.toLocaleString()} rows (${manifest.timings.books}s)`);
  }

  // ── phase: pages ─────────────────────────────────────────────────
  // Every page of every scoped book — re-OCR'd pages AND their within-book
  // controls. Without the controls nothing about the re-OCR'd population is
  // testable.
  if (PHASES.includes('pages')) {
    const t0 = Date.now();
    const ck = readCkpt('pages');
    const startAt = ck?.next_book_index || 0;
    if (startAt) log(`  resuming pages from book ${startAt.toLocaleString()}/${scoped.length.toLocaleString()} (appending)`);
    const csv = new Csv(path.join(OUT_DIR, 'pages.csv'), [
      'page_id', 'book_id', 'page_number', 'abs_page_number', 'soft_hidden', 'position_frac', 'position_bucket',
      'has_ocr', 'ocr_model', 'ocr_prompt_version', 'ocr_language', 'ocr_source', 'ocr_updated_at',
      'chars', 'words', 'body_words', 'unique_words', 'type_token_ratio', 'degenerate', 'entity_padded',
      'script_class', 'marginalia', 'image_desc', 'page_type_tag', 'columns_tag', 'lang_tag',
      'printed_page_num', 'printed_vs_index_delta', 'refusal', 'meta_prose',
      'has_translation', 'translation_chars', 'read_count',
      'n_revisions', 'is_double_ocr',
    ], startAt > 0);
    let done = startAt, pagesOut = 0;
    for (let i = startAt; i < scoped.length; i += BOOK_CHUNK) {
      const chunk = scoped.slice(i, i + BOOK_CHUNK);
      const keys = chunk.flatMap(keysOf);
      const pcByKey = new Map();
      for (const b of chunk) for (const k of keysOf(b)) pcByKey.set(k, b.pages_count);
      // `translation.data` is roughly as large as `ocr.data`, and this phase only
      // wants its SIZE — transferring it doubled the payload and dropped
      // throughput from ~130 to 20 pages/s over a multi-hour read of production
      // Atlas. $strLenCP computes the length server-side so the text never moves.
      const cur = PAGES.aggregate([
        { $match: { book_id: { $in: keys } } },
        {
          $project: {
            id: 1, book_id: 1, page_number: 1, read_count: 1,
            'ocr.data': 1, 'ocr.model': 1, 'ocr.prompt_version': 1, 'ocr.language': 1,
            'ocr.source': 1, 'ocr.updated_at': 1,
            translation_chars: { $strLenCP: { $ifNull: ['$translation.data', ''] } },
          },
        },
      ], { allowDiskUse: true }).batchSize(200);
      for await (const p of cur) {
        const text = p.ocr?.data || null;
        const f = textFeatures(text);
        const pagesCount = pcByKey.get(p.book_id) || null;
        const pn = typeof p.page_number === 'number' ? Math.abs(p.page_number) : null;
        const frac = pagesCount && pn && pn <= pagesCount ? pn / pagesCount : null;
        const nrev = revsPerPage.get(p.id) || 0;
        await csv.row({
          page_id: p.id, book_id: p.book_id, page_number: p.page_number, abs_page_number: pn,
          soft_hidden: typeof p.page_number === 'number' && p.page_number < 0,
          position_frac: frac === null ? null : +frac.toFixed(4),
          position_bucket: frac === null ? 'unknown'
            : frac <= 0.05 ? '1 front' : frac <= 0.25 ? '2 early'
            : frac <= 0.75 ? '3 middle' : frac <= 0.95 ? '4 late' : '5 back',
          has_ocr: !!text,
          ocr_model: p.ocr?.model, ocr_prompt_version: p.ocr?.prompt_version,
          ocr_language: p.ocr?.language, ocr_source: p.ocr?.source, ocr_updated_at: p.ocr?.updated_at,
          ...f,
          // A printed number that drifts from the index is normal (front matter
          // is unnumbered); a CHANGE in that delta between passes is the shift
          // signal. Stored here so the per-page delta is available directly.
          printed_vs_index_delta: f.printed_page_num !== null && pn !== null ? f.printed_page_num - pn : null,
          // Characters, not words: the length is computed server-side (see the
          // aggregation above) so the translation text is never transferred.
          has_translation: (p.translation_chars || 0) > 0,
          translation_chars: p.translation_chars || 0,
          read_count: p.read_count,
          n_revisions: nrev, is_double_ocr: nrev > 0,
        });
        pagesOut++;
      }
      done += chunk.length;
      // Checkpoint AFTER the chunk's rows are written, never before — a
      // checkpoint ahead of the data would silently skip those books on resume.
      writeCkpt('pages', { next_book_index: i + BOOK_CHUNK });
      beat();
      if (done % 200 < BOOK_CHUNK) {
        const rate = pagesOut / ((Date.now() - t0) / 1000);
        log(`  pages: ${done.toLocaleString()}/${scoped.length.toLocaleString()} books · ${pagesOut.toLocaleString()} pages · ${rate.toFixed(0)}/s`);
      }
    }
    clearCkpt('pages');
    manifest.rows.pages = await csv.close();
    manifest.timings.pages = +((Date.now() - t0) / 1000).toFixed(1);
    log(`pages.csv → ${manifest.rows.pages.toLocaleString()} rows (${manifest.timings.pages}s)`);
  }

  // ── phase: revisions ─────────────────────────────────────────────
  // One row per stored prior text, carrying the provenance columns that decide
  // whether a pair is a genuine re-read of the same image.
  if (PHASES.includes('revisions')) {
    const t0 = Date.now();
    const ckR = readCkpt('revisions');
    const afterPageId = ckR?.last_page_id || null;
    if (afterPageId) log(`  resuming revisions after page_id ${afterPageId} (appending)`);
    const csv = new Csv(path.join(OUT_DIR, 'revisions.csv'), [
      'revision_id', 'page_id', 'book_id', 'created_at', 'original_date', 'reason', 'source', 'model',
      'prompt_version', 'job_id', 'language', 'edited_by',
      'chars', 'words', 'body_words', 'unique_words', 'type_token_ratio', 'degenerate', 'entity_padded',
      'script_class', 'marginalia', 'image_desc', 'page_type_tag', 'columns_tag', 'lang_tag',
      'printed_page_num', 'refusal', 'meta_prose',
      // joined against the live page
      'live_printed_page_num', 'printed_page_shift', 'shift_offset',
      'live_model', 'live_prompt_version', 'live_words', 'live_body_words', 'words_delta',
      // provenance verdicts
      'provenance_class', 'in_undefined_key_window', 'rev_index_on_page', 'revs_on_page',
    ], !!afterPageId);

    // Sorted by page_id so a page's revisions arrive contiguously (served by the
    // {page_id:1, field:1, created_at:-1} index — no in-memory sort of 191K docs).
    // That ordering is also what makes the phase resumable: `page_id > last`
    // picks up exactly where a dropped connection left off. The checkpoint
    // records the last page whose revisions were FULLY written, so a page is
    // never split across two runs.
    const cur = REVS.find(
      { field: 'ocr', data: { $type: 'string', $ne: '' }, ...(afterPageId ? { page_id: { $gt: afterPageId } } : {}) },
      { projection: { id: 1, page_id: 1, book_id: 1, data: 1, model: 1, prompt_version: 1, source: 1, reason: 1, job_id: 1, language: 1, edited_by: 1, created_at: 1, original_date: 1 } },
    ).sort({ page_id: 1, created_at: -1 }).batchSize(400);

    let batch = [], cur1 = null, read = 0, out = 0, missing = 0;
    const flush = async () => {
      if (!batch.length) return;
      const ids = batch.map(b => b.page_id);
      const live = new Map();
      for (const p of await PAGES.find({ id: { $in: ids } }, {
        projection: { id: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.prompt_version': 1 },
      }).toArray()) live.set(p.id, p);

      for (const entry of batch) {
        const lp = live.get(entry.page_id) || null;
        if (!lp) missing++;
        const liveText = lp?.ocr?.data || null;
        const liveNum = printedPageNum(liveText);
        const liveWords = liveText ? wordsOf(liveText).length : null;
        const liveBody = liveText ? bodyWordsOf(liveText).length : null;
        const chain = [...entry.revs].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
        for (let i = 0; i < chain.length; i++) {
          const r = chain[i];
          const f = textFeatures(r.data);
          const created = r.created_at ? new Date(r.created_at) : null;
          const inWindow = !!created && created >= UNDEFINED_KEY_WINDOW[0] && created < UNDEFINED_KEY_WINDOW[1];
          const src = r.source || '';
          // Conservative: `text_move_repair` is asserted only from an explicit
          // source label. Everything else is `reocr`, qualified by the shift and
          // window columns — which are evidence, not verdicts.
          const cls = TEXT_MOVE_RE.test(src) ? 'text_move_repair'
            : src === 'manual' || r.edited_by ? 'human_edit'
            : 'reocr';
          const shift = f.printed_page_num !== null && liveNum !== null ? f.printed_page_num !== liveNum : null;
          await csv.row({
            revision_id: r.id, page_id: entry.page_id, book_id: r.book_id,
            created_at: r.created_at, original_date: r.original_date,
            reason: r.reason, source: r.source, model: r.model, prompt_version: r.prompt_version,
            job_id: r.job_id, language: r.language, edited_by: r.edited_by,
            ...f,
            live_printed_page_num: liveNum,
            printed_page_shift: shift,
            shift_offset: shift ? liveNum - f.printed_page_num : null,
            live_model: lp?.ocr?.model, live_prompt_version: lp?.ocr?.prompt_version,
            live_words: liveWords, live_body_words: liveBody,
            words_delta: liveWords === null ? null : liveWords - f.words,
            provenance_class: cls, in_undefined_key_window: inWindow,
            rev_index_on_page: i, revs_on_page: chain.length,
          });
          out++;
        }
      }
      // Every page in this batch is now fully written, so the highest page_id
      // is a safe resume point. Batches arrive in page_id order.
      const lastId = batch[batch.length - 1]?.page_id;
      batch = [];
      if (lastId) { writeCkpt('revisions', { last_page_id: lastId }); beat(); }
    };

    for await (const rv of cur) {
      read++;
      if (!cur1 || cur1.page_id !== rv.page_id) {
        if (cur1) batch.push(cur1);
        cur1 = { page_id: rv.page_id, revs: [] };
        if (batch.length >= 400) await flush();
      }
      cur1.revs.push(rv);
      if (read % 20000 === 0) log(`  revisions: ${read.toLocaleString()} read · ${out.toLocaleString()} written`);
    }
    if (cur1) batch.push(cur1);
    await flush();
    clearCkpt('revisions');
    manifest.rows.revisions = await csv.close();
    manifest.rows.revisions_orphan_pages = missing;
    manifest.timings.revisions = +((Date.now() - t0) / 1000).toFixed(1);
    log(`revisions.csv → ${manifest.rows.revisions.toLocaleString()} rows, ${missing.toLocaleString()} pages gone (${manifest.timings.revisions}s)`);
  }

  // ── phase: tfidf ─────────────────────────────────────────────────
  // Two passes over sampled page text: pass 1 builds per-book term counts and
  // per-corpus document frequencies; pass 2 scores. IDF is per language corpus
  // — a global IDF would just rediscover the corpus's language mix.
  if (PHASES.includes('tfidf')) {
    const t0 = Date.now();
    // EMIT → SCORE, the same split build-ngrams.mjs uses, and for the same
    // reason: holding every book's term map in RAM and writing only at the end
    // means one dropped connection loses the whole phase. All 8 retries of the
    // first attempt died that way (querySrv ECONNREFUSED — the SRV lookup for
    // the Atlas string, i.e. DNS, not Mongo). Per-book counts are appended to
    // JSONL as they are computed, so a resume costs the last chunk. Scoring then
    // runs offline over that file: two cheap passes, no network.
    const COUNTS = path.join(OUT_DIR, 'tfidf-counts.jsonl');
    const ckT = readCkpt('tfidf');
    const tStart = ckT?.next_book_index || 0;
    if (tStart) log(`  resuming tfidf from book ${tStart.toLocaleString()}/${scoped.length.toLocaleString()} (appending counts)`);
    else if (fs.existsSync(COUNTS)) fs.unlinkSync(COUNTS);
    const countsOut = fs.createWriteStream(COUNTS, { flags: tStart ? 'a' : 'w' });

    let done = tStart;
    for (let i = tStart; i < scoped.length; i += BOOK_CHUNK) {
      const chunk = scoped.slice(i, i + BOOK_CHUNK);
      const keys = chunk.flatMap(keysOf);
      // Two-step read. Only ~60 of a book's ~390 OCR'd pages are sampled, so
      // pulling `ocr.data` for all of them moves ~6x more text off Atlas than
      // this phase can use. Step 1 fetches the page INDEX (no text) to choose
      // the sample; step 2 fetches text for the chosen ids only.
      const byBook = new Map();
      const idx = PAGES.find(
        { book_id: { $in: keys }, 'ocr.data': { $type: 'string' } },
        { projection: { id: 1, book_id: 1, page_number: 1 } },
      ).batchSize(1000);
      for await (const p of idx) {
        if (!byBook.has(p.book_id)) byBook.set(p.book_id, []);
        byBook.get(p.book_id).push(p);
      }
      const sampleIds = new Map();   // book doc -> [page id]
      const wantIds = [];
      for (const b of chunk) {
        const pages = keysOf(b).flatMap(k => byBook.get(k) || []);
        if (!pages.length) continue;
        // Sample EVENLY through the book. Taking the first N would sample front
        // matter — title pages, dedications, tables of contents — whose
        // vocabulary is nothing like the body block.
        pages.sort((x, y) => (Math.abs(x.page_number ?? 0)) - (Math.abs(y.page_number ?? 0)));
        const step = Math.max(1, Math.floor(pages.length / TFIDF_PAGES));
        const ids = pages.filter((_, k) => k % step === 0).slice(0, TFIDF_PAGES).map(p => p.id);
        sampleIds.set(b, ids);
        wantIds.push(...ids);
      }
      const textById = new Map();
      for (let j = 0; j < wantIds.length; j += 500) {
        for (const p of await PAGES.find(
          { id: { $in: wantIds.slice(j, j + 500) } },
          { projection: { id: 1, 'ocr.data': 1 } },
        ).toArray()) textById.set(p.id, p.ocr?.data || '');
      }

      for (const b of chunk) {
        const sample = (sampleIds.get(b) || []).map(id => ({ ocr: { data: textById.get(id) || '' } }));
        if (!sample.length) continue;
        // ORIGINAL_LANGUAGE_CORPUS is keyed on LOWERCASED language; books.language
        // is capitalized ("German"), so an unlowered lookup silently misses every
        // book and pools all languages into one IDF — which makes the top terms
        // of every book its own language's function words. Languages the ngram
        // viewer does not model (Chinese, Tibetan, Arabic, Sanskrit…) keep their
        // own name as the corpus key rather than sharing an `other` bucket, so
        // IDF always stays within one language.
        const lang = (b.language || '').trim().toLowerCase();
        const corpus = ORIGINAL_LANGUAGE_CORPUS[lang] || lang || 'unknown';
        const tf = new Map();
        let tokens = 0;
        for (const p of sample) {
          // Editorial wrappers are AI prose about the page and routinely name
          // content from ADJACENT pages — counting them fabricates term
          // frequencies the same way quoting them fabricates citations.
          // deEntity BEFORE tokenizing: `&amp;` otherwise tokenizes as the word
          // "amp", which ranked 2nd by TF-IDF in a Latin alchemical volume.
          const clean = deEntity(dropTags(p.ocr.data, `image-desc|${WRAPPERS}`)).replace(/<[^>]+>/g, ' ');
          for (const t of tokenize(clean, corpus)) {
            if (t.length < TFIDF_MIN_LEN) continue;
            tf.set(t, (tf.get(t) || 0) + 1); tokens++;
          }
        }
        if (!tokens) continue;
        const id = b.id || String(b._id);
        if (!countsOut.write(JSON.stringify({
          book_id: id, corpus, tokens, pages_sampled: sample.length,
          title: b.display_title || b.title, author: b.author,
          tf: Object.fromEntries(tf),
        }) + '\n')) await once(countsOut, 'drain');
      }
      done += chunk.length;
      writeCkpt('tfidf', { next_book_index: i + BOOK_CHUNK });
      beat();
      if (done % 200 < BOOK_CHUNK) log(`  tfidf: ${done.toLocaleString()}/${scoped.length.toLocaleString()} books emitted`);
    }

    await new Promise(r => countsOut.end(r));
    clearCkpt('tfidf');

    // ── score (offline, two passes over the JSONL) ────────────────
    // Pass 1: document frequency per corpus. Pass 2: score each book against it.
    // Only the df maps live in RAM, never every book's full term map.
    const dfByCorpus = new Map(), docsByCorpus = new Map();
    const streamCounts = async (fn) => {
      const rl = readline.createInterface({ input: fs.createReadStream(COUNTS), crlfDelay: Infinity });
      for await (const line of rl) { if (line.trim()) await fn(JSON.parse(line)); }
    };
    await streamCounts(rec => {
      if (!dfByCorpus.has(rec.corpus)) { dfByCorpus.set(rec.corpus, new Map()); docsByCorpus.set(rec.corpus, 0); }
      const df = dfByCorpus.get(rec.corpus);
      docsByCorpus.set(rec.corpus, docsByCorpus.get(rec.corpus) + 1);
      for (const t of Object.keys(rec.tf)) df.set(t, (df.get(t) || 0) + 1);
    });
    log(`  tfidf: df built over ${[...docsByCorpus.values()].reduce((a, b) => a + b, 0).toLocaleString()} books, ${dfByCorpus.size} corpora`);

    const vocab = new Csv(path.join(OUT_DIR, 'tfidf_vocab.csv'), ['corpus', 'term', 'doc_freq', 'n_docs', 'idf']);
    for (const [corpus, df] of dfByCorpus) {
      const N = docsByCorpus.get(corpus);
      for (const [term, d] of df) {
        if (d < TFIDF_MIN_DF) continue;
        await vocab.row({ corpus, term, doc_freq: d, n_docs: N, idf: +Math.log(N / d).toFixed(5) });
      }
    }
    manifest.rows.tfidf_vocab = await vocab.close();

    const terms = new Csv(path.join(OUT_DIR, 'book_terms.csv'), [
      'book_id', 'title', 'author', 'corpus', 'rank', 'term', 'tf', 'tf_rel', 'doc_freq', 'idf', 'tfidf', 'tokens_sampled', 'pages_sampled',
    ]);
    let scoredBooks = 0;
    await streamCounts(async (rec) => {
      const df = dfByCorpus.get(rec.corpus);
      const N = docsByCorpus.get(rec.corpus);
      const scored = [];
      for (const [term, tf] of Object.entries(rec.tf)) {
        const d = df.get(term) || 1;
        if (d < TFIDF_MIN_DF) continue;
        if (TFIDF_MAX_DF < 1 && d / N > TFIDF_MAX_DF) continue;
        scored.push({ term, tf, idf: Math.log(N / d), d, tfidf: (tf / rec.tokens) * Math.log(N / d) });
      }
      scored.sort((a, b) => b.tfidf - a.tfidf);
      let rank = 0;
      for (const s of scored.slice(0, TFIDF_TOP)) {
        await terms.row({
          book_id: rec.book_id, title: rec.title, author: rec.author, corpus: rec.corpus, rank: ++rank,
          term: s.term, tf: s.tf, tf_rel: +(s.tf / rec.tokens).toFixed(6), doc_freq: s.d,
          idf: +s.idf.toFixed(5), tfidf: +s.tfidf.toFixed(8),
          tokens_sampled: rec.tokens, pages_sampled: rec.pages_sampled,
        });
      }
      scoredBooks++;
    });
    manifest.rows.book_terms = await terms.close();
    manifest.rows.tfidf_books = scoredBooks;
    manifest.corpora = Object.fromEntries([...docsByCorpus].map(([c, n]) => [c, n]));
    manifest.timings.tfidf = +((Date.now() - t0) / 1000).toFixed(1);
    log(`book_terms.csv → ${manifest.rows.book_terms.toLocaleString()} rows over ${scoredBooks.toLocaleString()} books (${manifest.timings.tfidf}s)`);
  }

  manifest.timings.total = +((Date.now() - t00) / 1000).toFixed(1);
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  log(`\n  → ${path.relative(process.cwd(), OUT_DIR)}/`);
  log(`  ${JSON.stringify(manifest.rows)}`);
  log(`\n  Before analysing: filter revisions.csv on provenance_class='reocr'`);
  log(`  AND printed_page_shift != 1. ~30% of stored revisions are a text MOVE,`);
  log(`  not a second reading of the same image.`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
