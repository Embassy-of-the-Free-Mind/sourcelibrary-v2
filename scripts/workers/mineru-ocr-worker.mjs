#!/usr/bin/env node
/**
 * mineru-ocr-worker.mjs — OCR English public-domain, modern-print books with
 * MinerU (CPU, pipeline backend) at zero Gemini cost. Runs on the Hetzner box
 * where MinerU is installed (~/mineru-eval/venv).
 *
 * Why: clean modern English print OCRs as well with MinerU as with Gemini (eval
 * 2026-06-18: 0.96–0.99 char agreement), so the English pre-copyright backlog can
 * be cleared while the Gemini pipeline is paused for cost.
 *
 * Safe-write rules:
 *   - Fill ONLY pages whose ocr.data is missing/empty — never overwrite Gemini OCR, and
 *     never a page a person edited (`ocr.edited_by` / `source: 'manual'`, in the FILTER).
 *   - Provenance (#4613, the specialist-engine standard of 2026-09-25): `ocr.source='mineru'`,
 *     `ocr.model='mineru-pipeline'`, `ocr.content_hash`, and an `ocr.engine` block —
 *     `specialist-engine/1`: MinerU version and licence read from the binary, backend and
 *     method, run id + code_version + host, the image url read, and the Gemini refusal
 *     stamps this fill follows (`engine.ladder`, since MinerU is tier 3 of the RECITATION
 *     ladder, #3389). `missingProvenance()` checks it under `source: 'mineru'`. The revision
 *     snapshot is taken first (no-op on a fill, doctrine); every book gets a `sweep_log`
 *     and a `book_events` row. Until 2026-09-30 this worker stamped a bare string under
 *     `engine` — those 2,586 rows are a known gap (data-provenance.md §8), not backfilled.
 *   - Footnotes: MinerU's markdown drops them (it files them as `page_footnote` in
 *     `discarded_blocks`); `readPageFootnotes` appends them below the body. Measured
 *     2026-09-30 (#5182 MinerU arm): every catastrophic page was a dropped footnote.
 *   - Empty MinerU output (<MIN_CHARS) → flag the page for a Gemini fallback,
 *     do NOT store blank text as confident OCR.
 *   - Gate the lane: language English, year 1820–1928, non-artwork, has imaged
 *     pages. Skip books whose OCR'd text is mostly CJK (mislabeled-language data).
 *
 * Usage:
 *   node scripts/workers/mineru-ocr-worker.mjs --limit 3            # process 3 books
 *   node scripts/workers/mineru-ocr-worker.mjs --book <id>          # one book
 *   node scripts/workers/mineru-ocr-worker.mjs --limit 200          # scale
 *   add --dry-run to OCR + report without writing to Mongo
 */
import { MongoClient } from 'mongodb';
import { loopVerdict } from '../lib/ocr-loop-guard.mjs';
import { contentHash, codeVersion, host, notRecorded } from '../lib/write-provenance.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const MINERU = process.env.MINERU_BIN || '/root/mineru-eval/venv/bin/mineru';
const WORKDIR = process.env.MINERU_WORKDIR || '/root/mineru-eval/worker-tmp';
const MODEL_TAG = 'mineru-pipeline';
const LANE = 'mineru-ocr-worker';
const LANE_ISSUE = '#3389';
// The licence string `pip show mineru` prints for 3.4.0 (checked 2026-09-30). Recorded so a
// reader of the page knows the terms the engine was used under; not a claim about the text.
const MINERU_LICENCE = 'LicenseRef-MinerU-Open-Source-License';

/** `mineru --version` → '3.4.0'; a marker when the binary cannot say (never a guess). */
function mineruVersion() {
  try {
    const out = String(execFileSync(MINERU, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })).trim();
    const m = out.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : notRecorded(`unparsed --version output: ${out.slice(0, 60)}`);
  } catch (e) {
    return notRecorded(`--version failed: ${String(e.message || e).slice(0, 60)}`);
  }
}
const MINERU_VERSION = mineruVersion();

/** One run id per process, so two passes of the lane are distinguishable on the page. */
const RUN = {
  id: `${LANE}/${new Date().toISOString().slice(0, 19)}/${host()}`,
  code_version: await codeVersion(),
  host: host(),
  started_at: new Date(),
};

/**
 * The `ocr.engine` block for a page this lane writes. Shape after the Kraken lane
 * (scripts/lib/syriac-kraken-lane.mjs): what ran, under which terms, in which run, on
 * which image — plus `ladder`, the Gemini refusal stamps already on the page, because a
 * MinerU fill normally follows two Gemini refusals and the page should say so.
 */
function engineBlock({ imageUrl, secs, pagesInRun, priorOcr, footnotes = 0 }) {
  const ladder = {};
  for (const k of ['recitation_count', 'recitation_blocked', 'fail_count', 'fail_reason', 'fail_blocked', 'fail_blocked_model']) {
    if (priorOcr && priorOcr[k] !== undefined) ladder[k] = priorOcr[k];
  }
  return {
    schema: 'specialist-engine/1',
    name: 'mineru',
    version: MINERU_VERSION,
    model: MODEL_TAG,
    model_label: 'MinerU pipeline backend: PP-OCR detection + recognition, PDF-Extract-Kit layout',
    licence: MINERU_LICENCE,
    backend: 'pipeline',
    method: 'ocr',
    device: 'cpu',
    post: 'sanitize(markdown→text); footnotes from middle.json discarded_blocks (page_footnote) appended below the body; loop guard #4850; MIN_CHARS and low-quality gates',
    footnotes_appended: footnotes,
    run: { ...RUN, secs_book: Math.round(secs), pages_in_run: pagesInRun },
    issue: LANE_ISSUE,
    ladder: Object.keys(ladder).length ? ladder : null,
    input: imageUrl ? { image_url: imageUrl } : notRecorded('page had no image url'),
  };
}

/** A page this lane may fill: no text yet, and no person's hand on it. */
const fillFilter = (pageId) => ({
  _id: pageId,
  $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': '' }, { 'ocr.data': null }],
  'ocr.edited_by': { $exists: false },
  'ocr.source': { $ne: 'manual' },
});

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const DRY = flag('--dry-run');
const LIMIT = parseInt(opt('--limit', '3'), 10);
const ONE_BOOK = opt('--book', null);
const MIN_CHARS = parseInt(opt('--min-chars', '40'), 10);

const CJK_RE = /[㐀-鿿぀-ヿ가-힯]/g;
const LATIN_RE = /[A-Za-zÀ-ÿ]/g;
const TITLE_SKIP = /萬|葯|guo yao|chinese/i;

function cjkRatio(text) {
  const cjk = (text.match(CJK_RE) || []).length;
  const lat = (text.match(LATIN_RE) || []).length;
  const tot = cjk + lat;
  return tot ? cjk / tot : 0;
}

// Turn MinerU markdown into clean reading text: drop image-reference markdown
// (local hashes that don't resolve), keep table/inline text, strip md scaffolding.
function sanitize(md) {
  let t = md.replace(/!\[[^\]]*\]\([^)]*\)/g, '');   // markdown images out entirely
  t = t.replace(/<[^>]+>/g, ' ');                      // html tags -> keep inner cell text
  t = t.replace(/^#{1,6}\s+/gm, '');                   // heading hashes
  t = t.replace(/^\s*>\s?/gm, '');                     // blockquotes
  t = t.replace(/`{1,3}/g, '');
  t = t.replace(/[ \t]+/g, ' ').replace(/ *\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}
// real textual content length (ignores any residual markup) — used to gate empties
const realLen = (s) => (s.match(/[A-Za-zÀ-ÿ0-9]/g) || []).length;

// Detect run-together / mangled OCR (MinerU loses word spacing on decorative or
// fine-press typography, e.g. ornamental poetry editions). Clean prose sits at
// mean-word-length ~4-5 and space-ratio ~0.16-0.18; flag clear outliers for a
// Gemini fallback rather than storing a mangled "quote".
function lowQuality(text) {
  const real = realLen(text);
  if (real < 80) return false; // too short to judge; MIN_CHARS gate handles it
  const toks = text.split(/\s+/).filter(Boolean).length || 1;
  const meanWordLen = real / toks;
  const spaceRatio = (text.match(/ /g) || []).length / Math.max(1, text.length);
  return meanWordLen > 8 || spaceRatio < 0.10;
}

const imgUrl = (p) => p.display_photo || p.archived_photo || p.photo || null;
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });

async function downloadImage(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function readPageMd(outDir, base) {
  const hits = [
    path.join(outDir, base, 'ocr', `${base}.md`),
    path.join(outDir, base, 'auto', `${base}.md`),
  ].filter((p) => fs.existsSync(p));
  return hits.length ? fs.readFileSync(hits[0], 'utf8').trim() : '';
}

/**
 * The footnotes MinerU read but left out of its markdown (#5182 MinerU arm, 2026-09-30).
 *
 * The pipeline backend classifies footnotes as `page_footnote` and files them in
 * `<base>_middle.json` → `pdf_info[0].discarded_blocks`, beside the running head and the
 * page number, so `<base>.md` has none. Measured on the 114-book English reference set:
 * every one of MinerU's catastrophic pages (3 of 114, plus 7 more under 80% of the
 * reference's words) was a page whose footnotes were dropped this way — the body read
 * word for word, the notes gone. Read from image: Hyndluljoth p.225 lost three notes,
 * over half the page's words. So the notes are appended below the body, in reading
 * order (top to bottom by bbox), as plain text. Header and page number stay out: the
 * reader's text is the page's words, not its furniture.
 */
function readPageFootnotes(outDir, base) {
  const hits = [
    path.join(outDir, base, 'ocr', `${base}_middle.json`),
    path.join(outDir, base, 'auto', `${base}_middle.json`),
  ].filter((p) => fs.existsSync(p));
  if (!hits.length) return [];
  try {
    const d = JSON.parse(fs.readFileSync(hits[0], 'utf8'));
    const blocks = (d?.pdf_info?.[0]?.discarded_blocks || []).filter((b) => b?.type === 'page_footnote');
    blocks.sort((a, b) => (a.bbox?.[1] ?? 0) - (b.bbox?.[1] ?? 0));
    return blocks
      .map((b) => (b.lines || []).map((l) => (l.spans || []).map((s) => s.content || '').join(' ')).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  } catch (e) {
    console.warn(`  footnotes: could not read ${hits[0]}: ${String(e.message || e).slice(0, 80)}`);
    return [];
  }
}

async function processBook(db, book) {
  const id = String(book._id);
  const pagesCol = db.collection('pages');
  if (TITLE_SKIP.test(book.title || '')) {
    return { id, title: book.title, skipped: 'title-language-gate' };
  }

  // pages with an image and no usable OCR yet — excluding pages MinerU has already
  // tried and flagged (empty/low-quality), so repeated runs converge instead of
  // re-OCRing the same illustration plates forever.
  const pages = await pagesCol.find({
    book_id: id,
    page_number: { $gt: 0 },
    ocr_mineru_status: { $nin: ['empty', 'low-quality'] },
    'ocr.edited_by': { $exists: false },
    'ocr.source': { $ne: 'manual' },
    $and: [
      { $or: [{ display_photo: { $exists: true, $ne: null } }, { archived_photo: { $exists: true, $ne: null } }, { photo: { $exists: true, $ne: null } }] },
      // `null` matches a missing field too, but an explicit `ocr.data: null` (a Gemini
      // refusal stamp on an otherwise empty page) must be fillable as well.
      { $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': '' }, { 'ocr.data': null }] },
    ],
  }).project({ _id: 1, id: 1, page_number: 1, display_photo: 1, archived_photo: 1, photo: 1, ocr: 1 }).sort({ page_number: 1 }).toArray();

  if (!pages.length) return { id, title: book.title, skipped: 'no-empty-imaged-pages' };

  const bookDir = path.join(WORKDIR, id);
  const imgDir = path.join(bookDir, 'img');
  const outDir = path.join(bookDir, 'out');
  fs.rmSync(bookDir, { recursive: true, force: true });
  fs.mkdirSync(imgDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  // map base filename -> page doc
  const byBase = new Map();
  let dlOk = 0;
  for (const p of pages) {
    const url = imgUrl(p);
    const base = `page-${String(p.page_number).padStart(4, '0')}`;
    try {
      await downloadImage(url, path.join(imgDir, `${base}.jpg`));
      byBase.set(base, p);
      dlOk++;
    } catch (e) { /* skip unreachable image */ }
  }
  if (!dlOk) { fs.rmSync(bookDir, { recursive: true, force: true }); return { id, title: book.title, skipped: 'all-image-dl-failed' }; }

  // run MinerU once over the whole image dir
  const t0 = Date.now();
  sh(MINERU, ['-p', imgDir, '-o', outDir, '-b', 'pipeline', '-m', 'ocr']);
  const secs = (Date.now() - t0) / 1000;

  // collect outputs
  let written = 0, flaggedEmpty = 0, sampledCjk = 0, sampleN = 0, sampleText = '';
  const pageOps = [];
  for (const [base, p] of byBase) {
    const body = sanitize(readPageMd(outDir, base));
    const footnotes = readPageFootnotes(outDir, base).map(sanitize).filter(Boolean);
    const text = footnotes.length ? `${body}\n\n${footnotes.join('\n')}` : body;
    if (sampleN < 8) { sampleText += ' ' + text; sampleN++; }
    if (realLen(text) >= MIN_CHARS && !lowQuality(text)) {
      pageOps.push({ page: p, text, footnotes: footnotes.length });
    } else {
      const status = realLen(text) < MIN_CHARS ? 'empty' : 'low-quality';
      flaggedEmpty++;
      if (!DRY) {
        await pagesCol.updateOne(
          fillFilter(p._id),
          { $set: { ocr_mineru_status: status, ocr_needs_fallback: true, ocr_mineru_at: new Date() } },
        );
      }
    }
  }

  // language safety: if the OCR'd sample is mostly CJK, this "English" book is mislabeled — abort writes
  const ratio = cjkRatio(sampleText);
  if (ratio > 0.10) {
    fs.rmSync(bookDir, { recursive: true, force: true });
    return { id, title: book.title, skipped: `mislabeled-cjk (ratio ${ratio.toFixed(2)})`, pagesSeen: byBase.size };
  }

  // write the good pages
  let loopRefused = 0;
  if (!DRY) {
    const now = new Date();
    // Doctrine: snapshot before overwrite. A fill has nothing to snapshot, so this is a
    // no-op that costs one read — and stays here so the rule is visible at the write site.
    await saveRevisionsBeforeOverwrite(db, pageOps.map((o) => o.page.id).filter(Boolean), 'ocr', { reason: 'mineru_fill', keepMeta: true });
    // A dotted `$set` cannot create fields inside `ocr: null`; make it an object first.
    await pagesCol.updateMany({ book_id: id, ocr: null }, { $set: { ocr: {} } });
    for (const { page, text, footnotes } of pageOps) {
      // Degeneration-loop guard (#4850). MinerU is not an LLM, but a stuck OCR pass
      // writes the same shape into the same field, read by the same reader.
      if (loopVerdict(text || '').refuse) { console.warn(`  LOOP GUARD: refusing page ${page._id} (#4850)`); loopRefused++; continue; }
      const engine = engineBlock({ imageUrl: imgUrl(page), secs, pagesInRun: byBase.size, priorOcr: page.ocr, footnotes });
      const r = await pagesCol.updateOne(
        fillFilter(page._id),
        { $set: {
            'ocr.data': text,
            'ocr.content_hash': contentHash(text),
            'ocr.language': 'English',
            'ocr.model': MODEL_TAG,
            'ocr.source': 'mineru',
            'ocr.pipeline': LANE,
            'ocr.engine': engine,
            'ocr.updated_at': now,
            updated_at: now,
            ocr_mineru_status: 'ok',
            ocr_mineru_at: now,
          } },
      );
      if (r.modifiedCount) written++;
    }
    // recompute book.pages_ocr
    const ocrCount = await pagesCol.countDocuments({ book_id: id, 'ocr.data': { $exists: true, $nin: [null, ''] } });
    await db.collection('books').updateOne({ _id: book._id }, { $set: { pages_ocr: ocrCount, mineru_ocr_at: now } });
    // The lane's own record of having touched this book: one sweep_log row and one
    // book_events row per run, whatever it wrote (a run that filled nothing is still a run).
    const detail = { run: RUN.id, version: MINERU_VERSION, written, flagged_empty: flaggedEmpty, loop_refused: loopRefused, pages_seen: byBase.size, secs: Math.round(secs), pages_ocr_after: ocrCount };
    await recordSweepAction(db, { sweep: LANE, book_id: id, action: written ? 'filled' : 'nothing-filled', detail });
    await db.collection('book_events').insertOne({ book_id: id, type: 'mineru_ocr_fill', at: now, source: LANE, details: { ...detail, issue: LANE_ISSUE } });
  } else {
    written = pageOps.length;
  }

  fs.rmSync(bookDir, { recursive: true, force: true });
  return { id, title: book.title, year: book.year, pages: byBase.size, written, flaggedEmpty, secs: Math.round(secs), cjk: ratio.toFixed(2) };
}

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = db.collection('books');

  let candidates;
  if (ONE_BOOK) {
    // id-space-agnostic lookup: this corpus mixes ObjectId `_id`s, string `_id`s,
    // and a separate string `id` field. Match all so --book works on any book.
    const or = [{ _id: ONE_BOOK }, { id: ONE_BOOK }];
    try { or.push({ _id: (await import('mongodb')).ObjectId.createFromHexString(ONE_BOOK) }); } catch { /* not a valid ObjectId hex */ }
    candidates = await books.find({ $or: or }).toArray();
  } else {
    candidates = await books.find({
      language: /english/i,
      content_type: { $ne: 'artwork' },
      year: { $gte: 1820, $lt: 1929 },
      pages_count: { $gt: 0 },
      $expr: { $lt: ['$pages_ocr', { $multiply: [0.9, '$pages_count'] }] },
    }).project({ _id: 1, title: 1, year: 1, pages_count: 1, pages_ocr: 1 }).sort({ pages_count: 1 }).limit(LIMIT * 3).toArray();
  }

  console.log(`[mineru-worker] ${DRY ? 'DRY-RUN ' : ''}candidates fetched: ${candidates.length}, processing up to ${LIMIT}`);
  let done = 0;
  for (const book of candidates) {
    if (done >= LIMIT) break;
    try {
      const r = await processBook(db, book);
      console.log(JSON.stringify(r));
      if (!r.skipped) done++;
    } catch (e) {
      console.log(JSON.stringify({ id: String(book._id), title: book.title, error: e.message }));
    }
  }
  console.log(`[mineru-worker] processed ${done} book(s)${DRY ? ' (dry-run, no writes)' : ''}`);
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
