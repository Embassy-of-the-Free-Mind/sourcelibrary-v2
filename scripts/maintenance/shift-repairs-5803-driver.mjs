#!/usr/bin/env node
/**
 * Driver for the #5803 clean-shift repairs: the 151 books the Clef corpus screen
 * (scripts/eval/results/clef-corpus-screen-2026-10-04.json, class "clean") found showing a
 * page image beside the text of the neighbouring page. One book at a time, resumable.
 *
 * PRIOR ART: scripts/maintenance/repair-bulk-jp2-offset.mjs (image side), scripts/maintenance/
 *   repair-text-shift-run.mjs (text side), scripts/eval/jev/clef-book-offset-map.mjs (the map) —
 *   all from PR #5832 and used here UNCHANGED, as child processes. They each do one step for one
 *   book; nothing sequenced them over 151 books with arbitration, holds, spend and a checkpoint.
 *   scripts/batch/stranded-text-repair-5309.mjs is the same driver shape for a paid lane; this one
 *   never queues paid work.
 *
 * Per book:
 *   1. preflight: visible, no hidden_reason, no hold, no human-edited text → else skip (recorded).
 *   2. arbitration, free: the dHash pre-check of repair-bulk-jp2-offset.mjs (dry run) compares the
 *      R2 copy with photo_original (the source leaf: e-rara IIIF canvas / IA BookReader leaf).
 *      shift → the image is the wrong side; aligned → the images are right, any shift is the text.
 *   3. image side: e-rara → re-archive (Group C; the batch text it strands is shifted in step 4).
 *      IA → re-archive only if it strands no more pages than it fixes (ia_djvu text is keyed to the
 *      IA leaf and is not stranded, #5803 Group A); otherwise no write, counts recorded.
 *   4. text map on the reader images (now the source leaves): a strided FULL Clef sample, the run
 *      boundaries scanned page by page, and every page in the run whose OCR came from a different
 *      pass scored too. Exactly one constant ±1 run → repair-text-shift-run.mjs (its own gate
 *      re-checks the map). Anything else → no write, verdict needs-eye.
 *   5. a cleared page (its leaf's text was never produced) in a book whose status an OCR lane selects
 *      would be OCR'd: the book is held first (scripts/lib/pipeline-hold.mjs via hold-pipeline-books).
 *   6. post map (strided adaptive, then FULL on every page not clearly matching), purge, one jsonl row.
 *
 * Usage:
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/shift-repairs-5803-driver.mjs \
 *     --class erara-text|erara-image|ia-image|ia-undetermined|ia-5309 --out <results.jsonl> \
 *     [--book <id>] [--limit N] [--apply] [--work <dir>] [--spend-cap 17.5]
 *   Without --apply it stops before the first write and records the plan.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const CLASS = flag('class');
const OUT = flag('out');
const ONLY_BOOK = flag('book');
const LIMIT = Number(flag('limit', 'Infinity'));
const APPLY = args.includes('--apply');
const WORK = flag('work', process.env.JOB_SCRATCH || 'scripts/output/shift-repairs-5803');
const SPEND_CAP = Number(flag('spend-cap', '17.5'));
// --post-only: a book repaired by hand (the first five per class): post map, purge and its row only.
// --note "<what was done by hand>" is recorded on the row; --image-pages purges every page image too.
// --adjudicate 485 --adjudicate-why "<eye evidence>": pages checked by eye (one --book run) that leave the run checks and
// go to repair-text-shift-run's own --adjudicated gate, recorded on the book_event.
const ADJ_EYE = flag('adjudicate') ? flag('adjudicate').split(',').map(Number) : [];
const ADJ_EYE_WHY = flag('adjudicate-why', '');
if (ADJ_EYE.length && (!ONLY_BOOK || !ADJ_EYE_WHY)) { console.error('--adjudicate needs --book and --adjudicate-why'); process.exit(1); }
const SOURCE_IMG = args.includes('--source-img'); // post-only after an image repair: map pages.photo, not the edge-cached reader URL
const POST_ONLY = args.includes('--post-only'), NOTE = flag('note', null), IMAGE_PAGES = args.includes('--image-pages');
const SPEND_FILE = path.join(WORK, 'clef-spend.jsonl'); // one row per map call, all classes: the job's meter
const ENV = '/root/sourcelibrary/.env.production.local';
const ISSUE = 5803;
const MATCH_OK = 95;
const TIE = 0.03;
// Statuses whose lanes OCR a page with no ocr.data (pipeline-orchestrator Phase 2 / pool) or re-dispatch it.
const OCR_LANE_STATUSES = new Set(['archive_complete', 'ocr_partial', 'ocr_submitted', 'ocr_in_progress', 'needs_attention', 'preview_ocr', 'archived']);
const CLASSES = {
  'erara-image': (r) => r.side.startsWith('image-side (e-rara'),
  'erara-text': (r) => r.side.startsWith('text-side (e-rara'),
  'ia-image': (r) => r.side.startsWith('image-side (#3368'),
  'ia-undetermined': (r) => r.side.startsWith('undetermined'),
  'ia-5309': (r) => r.side.startsWith('5309-stranded'),
};
if (!CLASSES[CLASS] || !OUT) { console.error('--class <' + Object.keys(CLASSES) + '> --out <jsonl> required'); process.exit(1); }
const MAPS = path.join(WORK, 'maps'), BACKUPS = path.join(WORK, 'backups'), LOGS = path.join(WORK, 'logs');
for (const d of [MAPS, BACKUPS, LOGS]) fs.mkdirSync(d, { recursive: true });

const spentSoFar = () => (fs.existsSync(SPEND_FILE) ? fs.readFileSync(SPEND_FILE, 'utf8').trim().split('\n').filter(Boolean).reduce((s, l) => s + (JSON.parse(l).cost || 0), 0) : 0);
const log = (bookId, s) => { fs.appendFileSync(path.join(LOGS, `${bookId}.log`), s + '\n'); };

function run(bookId, script, scriptArgs, { env = {}, timeout = 1_800_000 } = {}) {
  const r = spawnSync(process.execPath, [`--env-file=${ENV}`, script, ...scriptArgs], { encoding: 'utf8', timeout, env: { ...process.env, ...env }, maxBuffer: 64 << 20 });
  const out = (r.stdout || '') + (r.stderr || '');
  log(bookId, `$ ${script} ${scriptArgs.join(' ')} ${Object.keys(env).length ? JSON.stringify(env) : ''}\n${out}\n[exit ${r.status}]`);
  return { code: r.status, out };
}

/** Clef map over the given pages (FULL = score own, prev and next). Returns rows keyed by page. */
function clefMap(bookId, pages, tag, { full, img = 'reader' }) {
  if (!pages.length) return new Map();
  const left = SPEND_CAP - spentSoFar();
  if (left <= 0.05) throw new Error(`SPEND: job meter at $${spentSoFar().toFixed(2)} ≥ cap $${SPEND_CAP}`);
  const r = run(bookId, 'scripts/eval/jev/clef-book-offset-map.mjs',
    ['--book', bookId, '--pages', pages.join(','), '--out', MAPS, '--tag', tag, '--img', img, '--cap', String(Math.min(1.5, left).toFixed(2))],
    { env: full ? { FULL: '1' } : {} });
  const sumLine = r.out.trim().split('\n').reverse().find((l) => l.startsWith('{"book_id"'));
  const sum = sumLine ? JSON.parse(sumLine) : { cost_usd: 0, calls: 0 };
  fs.appendFileSync(SPEND_FILE, JSON.stringify({ at: new Date().toISOString(), book: bookId, tag, calls: sum.calls, cost: sum.cost_usd }) + '\n');
  if (!sumLine) throw new Error(`clef map failed (${tag}): ${r.out.slice(-300)}`);
  const rows = fs.readFileSync(path.join(MAPS, `${bookId}-${tag}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  // Tie rule: a neighbour wins only by ≥ TIE over the page's own text. At a pass boundary the first
  // batch page duplicates the last preview leaf, so image N scores ~0.97 against text N AND N+1 and
  // the map's argmax flips with Clef's run-to-run noise (69b63105 p.25: 0.971/0.971, then +1).
  for (const r of rows) {
    // A row that does not discriminate is unknown, not a match: on glossed decretals the formulas repeat
    // leaf to leaf and own/prev/next all read ~0.9 within 0.03 (69b63147 pp. 75, 108; 69b631d8 p. 173).
    const sc = [r.own, r.prev, r.next].filter((x) => x != null);
    if (isNum(r.offset) && sc.length >= 2 && Math.max(...sc) - Math.min(...sc) < 0.05) { r.offset = '?'; r.ambiguous = true; continue; }
    if (isNum(r.offset) && r.offset !== 0 && r.own != null && r.own >= 0.7 && Math.max(r.prev ?? 0, r.next ?? 0) - r.own < TIE) { r.offset = 0; r.tie = true; }
  }
  return new Map(rows.map((x) => [x.page, x]));
}
const stride = (nums, target) => { const k = Math.max(1, Math.ceil(nums.length / target)); return nums.filter((_, i) => i % k === Math.floor(k / 2) || i === 0 || i === nums.length - 1); };
const isNum = (o) => typeof o === 'number';
const matchPct = (rows) => { const s = [...rows.values()].filter((r) => r.offset !== 'no-image' && r.own_text !== 'short'); return s.length ? +(100 * s.filter((r) => r.offset === 0).length / s.length).toFixed(1) : null; };

/** Adaptive map, then FULL on every row that is not a clear own-match: the adaptive pass reads 0.75–0.9
 *  on a NEIGHBOUR's prose as offset 0 (measured 2026-10-08 on 69b630cd: 9 such rows in a 19-page run). */
function settledMap(bookId, pages, tag, img = 'reader') {
  const a = clefMap(bookId, pages, tag + '-a', { full: false, img });
  const unsure = [...a.values()].filter((r) => r.offset !== 'no-image' && r.own_text !== 'short' && !(r.offset === 0 && r.own >= 0.9)).map((r) => r.page);
  const f = clefMap(bookId, unsure, tag + '-f', { full: true, img });
  for (const [k, v] of f) a.set(k, v);
  return a;
}

function parseDhash(out) {
  const pre = out.match(/pre-check: (\S+) \(([^)]*)\)/);
  const votes = out.match(/aligned=(\d+) shift=(\d+) of (\d+)/);
  const split = out.match(/pages: (\d+) pre-archival.*?, (\d+) post-archival/);
  return {
    not_book: /\[SKIP\] not a/.test(out),
    verdict: pre?.[1] ?? null, detail: pre?.[2] ?? null,
    refuse: (out.match(/\[REFUSE\] ([^\n]*)/) || [])[1] ?? null,
    pre_archival: split ? +split[1] : null, post_archival: split ? +split[2] : null,
    shift_ok: /would re-archive/.test(out),
    aligned: pre?.[1] === 'aligned' || (votes && +votes[2] === 0 && +votes[1] >= 2),
  };
}

async function purge(bookId, imagePages, db) {
  const res = { revalidate: null, cf: [] };
  try {
    const r = await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${bookId}`, { method: 'POST', headers: { 'x-revalidate-secret': process.env.CRON_SECRET } });
    res.revalidate = r.status;
  } catch (e) { res.revalidate = 'error ' + e.message; }
  const urls = [`https://sourcelibrary.org/book/${bookId}`];
  if (imagePages.length) {
    const ps = await db.collection('pages').find({ book_id: bookId, page_number: { $in: imagePages } }, { projection: { display_photo: 1, archived_photo: 1 } }).toArray();
    for (const p of ps) for (const u of [p.display_photo, p.archived_photo]) if (u && u.includes('images.sourcelibrary.org')) urls.push(u);
  }
  // Hetzner's env has no CLOUDFLARE_ZONE_ID / CLOUDFLARE_API_TOKEN (checked 2026-10-08): revalidate-book
  // re-renders the book and purges its landing URLs; per-file purges are recorded as not done.
  if (!process.env.CLOUDFLARE_ZONE_ID || !process.env.CLOUDFLARE_API_TOKEN) { res.cf = ['skipped: no Cloudflare purge credentials on this box']; res.urls = urls.length; return res; }
  for (let i = 0; i < urls.length; i += 30) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID}/purge_cache`, {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ files: urls.slice(i, i + 30) }),
      });
      const j = await r.json().catch(() => ({}));
      res.cf.push(j.success === true ? 'ok' : `fail ${JSON.stringify(j.errors || r.status).slice(0, 120)}`);
    } catch (e) { res.cf.push('error ' + e.message); }
  }
  res.urls = urls.length;
  return res;
}

// ── the work list ──
const screen = JSON.parse(fs.readFileSync('scripts/eval/results/clef-corpus-screen-2026-10-04.json', 'utf8'));
let list = screen.flagged.filter((r) => r.class === 'clean' && CLASSES[CLASS](r));
if (ONLY_BOOK) list = list.filter((r) => r.book_id === ONLY_BOOK);
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.final).map((r) => r.book_id) : []);
list = list.filter((r) => !done.has(r.book_id)).slice(0, LIMIT);
console.log(`${CLASS}: ${list.length} books to do (${done.size} already in ${OUT}) ${APPLY ? 'APPLY' : 'PLAN ONLY'} | job Clef meter $${spentSoFar().toFixed(3)}`);

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
let stopClass = null;
for (const scr of list) {
  const bookId = scr.book_id;
  const rec = { book_id: bookId, class: CLASS, flag_page: scr.page, at: new Date().toISOString(), apply: APPLY };
  const spend0 = spentSoFar();
  const finish = (verdict, extra = {}) => {
    Object.assign(rec, extra, { verdict, final: APPLY || verdict.startsWith('skip'), spend: +(spentSoFar() - spend0).toFixed(4) });
    fs.appendFileSync(OUT, JSON.stringify(rec) + '\n');
    console.log(`[${verdict}] ${bookId} ${rec.title || ''} | ${JSON.stringify({ ...extra, spend: rec.spend }).slice(0, 400)}`);
  };
  try {
    const book = await db.collection('books').findOne({ id: bookId }, { projection: { title: 1, visible: 1, hidden_reason: 1, pages_count: 1, pipeline_auto: 1, archive_metadata: 1 } });
    rec.title = book?.title?.slice(0, 70);
    if (!book) { finish('skip: book not found'); continue; }
    if (book.visible !== true) { finish('skip: visible is not true'); continue; }
    if (book.hidden_reason) { finish(`skip: hidden_reason ${book.hidden_reason}`); continue; }
    const ownHold = book.pipeline_auto?.hold?.reason === 'shift-repair-5803-cleared-leaves'; // this job's own hold (a re-run of a held book)
    if (!ownHold && (book.pipeline_auto?.hold || book.pipeline_auto?.status === 'held')) { finish(`skip: pipeline hold ${book.pipeline_auto?.hold?.reason}`); continue; }
    rec.status = book.pipeline_auto?.status;

    if (CLASS === 'ia-5309') {
      const r = run(bookId, 'scripts/audit/stranded-image-repair-text.mjs', ['--book', bookId], { timeout: 600_000 });
      finish('no-write: #5309 stranded (owned there)', { audit_tail: r.out.trim().split('\n').slice(-6).join(' | ').slice(0, 600) });
      continue;
    }

    const pages = await db.collection('pages').find({ book_id: bookId, page_number: { $gte: 1 } }, {
      projection: { page_number: 1, page_type: 1, photo: 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'ocr.edited_by': 1, 'ocr.data': 1, 'translation.edited_by': 1, archive_metadata: 1, split_side: 1 },
    }).sort({ page_number: 1 }).toArray();
    const human = pages.filter((p) => p.ocr?.source === 'manual' || p.ocr?.edited_by || p.translation?.edited_by).length;
    if (human) { finish(`skip: ${human} human-edited pages`); continue; }
    // Blank leaves are left out of every map: their stored "text" is a watermark description that
    // Clef matches to ANY blank leaf (69b63105 pp. 42-44, by eye 2026-10-08; Group D "blank leaves").
    // They still move with the run; they just cannot decide it.
    const isBlank = (p) => p.page_type === 'blank' || /<page-type>\s*blank/i.test(String(p.ocr?.data || ''));
    const textPages = pages.filter((p) => !isBlank(p) && String(p.ocr?.data || '').replace(/<[^>]+>/g, '').trim().length >= 60).map((p) => p.page_number);
    rec.blank_pages = pages.filter(isBlank).length;
    rec.pages = pages.length; rec.text_pages = textPages.length;
    if (POST_ONLY) {
      if (NOTE) rec.by_hand = NOTE;
      const post = settledMap(bookId, textPages.length <= 120 ? textPages : stride(textPages, 100), 'after', SOURCE_IMG ? 'source' : 'reader');
      rec.map_img = SOURCE_IMG ? 'source' : 'reader';
      rec.clef_after = matchPct(post);
      rec.after_misses = [...post.values()].filter((r) => r.offset !== 0 && r.offset !== 'no-image' && r.own_text !== 'short').map((r) => `${r.page}:${r.offset}`).slice(0, 40);
      rec.purge = await purge(bookId, IMAGE_PAGES ? pages.map((p) => p.page_number) : [], db);
      if (IMAGE_PAGES) fs.appendFileSync(path.join(WORK, 'purge-needed.txt'), [`https://sourcelibrary.org/book/${bookId}`, ...pages.flatMap((p) => [`https://images.sourcelibrary.org/pages/${bookId}/${String(p.page_number).padStart(4, '0')}.jpg`, `https://images.sourcelibrary.org/archived/${bookId}/${p.page_number}.jpg`])].join('\n') + '\n');
      finish(rec.clef_after >= MATCH_OK ? 'repaired' : 'stop: post-repair match below 95%');
      continue;
    }

    // ── 2. arbitration (free) ──
    const src = scr.provider === 'e-rara' ? 'erara_pdf' : 'bulk_jp2';
    const dh = parseDhash(run(bookId, 'scripts/maintenance/repair-bulk-jp2-offset.mjs', ['--source', src, '--book', bookId, '--samples', '8'], { timeout: 900_000 }).out);
    rec.dhash = { verdict: dh.verdict, detail: dh.detail, pre: dh.pre_archival, post: dh.post_archival, refuse: dh.refuse?.slice(0, 80) };

    // ── Clef before (reader images, as readers see them now) ──
    // --source-img on a re-run of a book whose images this job already re-archived: the reader URLs are
    // edge-cached stale (see below), so every map reads pages.photo.
    const before = clefMap(bookId, stride(textPages, 30), 'before', { full: true, img: SOURCE_IMG ? 'source' : 'reader' });
    rec.clef_before = matchPct(before);

    let imageDone = false;
    const imageSide = dh.shift_ok; // ≥2 shift votes, 0 aligned, and the pre-archival witness exists
    // After a re-archive, Cloudflare keeps serving the OLD bytes of the reader URLs (s-maxage 7 days;
    // a plain GET of 69b6315b pages/0005.jpg was a HIT on the 2026-08-18 object after the repair), and
    // this box has no purge credentials. So every map after an image repair reads pages.photo (the
    // source leaf, which the re-archive copied), and a book whose photo IS the R2 copy is refused.
    const photoOnR2 = pages.some((p) => String(p.photo || '').includes('images.sourcelibrary.org'));
    if (imageSide && photoOnR2) { finish('no-write: image repair needed but pages.photo is the R2 copy, so it cannot be verified through the 7-day edge cache without a Cloudflare purge'); continue; }
    if (imageSide) {
      if (src === 'bulk_jp2') {
        // Stranded = post-archival text that is not ia_djvu (ia_djvu is keyed to the IA leaf; Group A).
        const bulk = pages.filter((p) => p.archive_metadata?.source === 'bulk_jp2' && p.ocr?.data);
        const post = bulk.filter((p) => p.ocr.updated_at && p.archive_metadata.archived_at && new Date(p.ocr.updated_at) >= new Date(p.archive_metadata.archived_at));
        const stranded = post.filter((p) => p.ocr.source !== 'ia_djvu').length;
        const fixed = bulk.length - stranded;
        rec.ia_counts = { text_pages: bulk.length, would_fix: fixed, would_strand: stranded };
        if (stranded > fixed) { finish('no-write: image repair would strand more pages than it fixes (#5309 class)'); continue; }
      }
      if (!APPLY) { finish('plan: image re-archive', {}); continue; }
      const r = run(bookId, 'scripts/maintenance/repair-bulk-jp2-offset.mjs', ['--source', src, '--book', bookId, '--samples', '8', '--apply', '--reocr-issue', src === 'erara_pdf' ? '5803' : '5309'], { timeout: 3_600_000 });
      const reArch = r.out.match(/re-archived (\d+), failed (\d+)/);
      rec.rearchived = reArch ? +reArch[1] : 0; rec.rearchive_failed = reArch ? +reArch[2] : null;
      rec.post_dhash = (r.out.match(/post-check: ([^\n]*)/) || [])[1] ?? null;
      rec.flagged_needs_reocr = +((r.out.match(/flagged (\d+) pages needs_reocr/) || [])[1] ?? 0);
      if (!/\[OK\] repaired and verified/.test(r.out)) { stopClass = 'image re-archive did not verify'; finish('stop: image re-archive did not verify'); break; }
      imageDone = true;
    } else if (!dh.aligned) {
      finish('no-write: side not arbitrated (dHash neither shift with witness nor aligned)'); continue;
    }

    // ── 4. text map on the (now correct) reader images ──
    const mapImg = imageDone || SOURCE_IMG ? 'source' : 'reader';
    rec.map_img = mapImg;
    const sample = imageDone ? clefMap(bookId, stride(textPages, 40), 'run-sample', { full: true, img: 'source' }) : before;
    const nonzero = [...sample.values()].filter((r) => isNum(r.offset) && r.offset !== 0);
    const textRows = new Map(sample);
    let runSpec = null, skipText = false;
    // A text-step refusal after the image step is not a no-write: the images were re-archived.
    // On e-rara the batch text the re-archive stranded is waiting on this shift, so stop the class.
    const textFail = (why, extra = {}) => {
      if (!imageDone) { finish('no-write: ' + why, extra); return; }
      rec.text_verdict = why; Object.assign(rec, extra);
      if (src === 'erara_pdf') { stopClass = `image re-archived but text step: ${why}`; finish('stop: image re-archived, text step ' + why); }
      else { skipText = true; runSpec = null; } // IA: images done; fall through to the post map and purge
    };
    textStep: {
    if (nonzero.length) {
      const d = nonzero.filter((r) => r.offset === 1).length >= nonzero.filter((r) => r.offset === -1).length ? 1 : -1;
      const sNums = [...sample.keys()].sort((a, b) => a - b);
      const dPages = sNums.filter((n) => sample.get(n).offset === d);
      let first = dPages[0], last = dPages[dPages.length - 1];
      const inside = sNums.filter((n) => n > first && n < last && isNum(sample.get(n).offset) && sample.get(n).offset !== d && !ADJ_EYE.includes(n));
      if (inside.length) { textFail('needs-eye (sample is not one constant run)', { d, inside: inside.slice(0, 20), sample_runs: dPages.length }); if (stopClass) break; if (skipText) break textStep; continue; }
      // scan the gaps to the neighbouring samples, page by page
      const prevS = sNums.filter((n) => n < first).pop() ?? 0, nextS = sNums.find((n) => n > last) ?? Infinity;
      const gap = textPages.filter((n) => (n > prevS && n < first) || (n > last && n < nextS));
      // and every run page whose OCR came from a different pass than the run's majority
      const pass = (p) => `${p.ocr?.source}|${String(p.ocr?.updated_at?.toISOString?.() ?? p.ocr?.updated_at ?? '').slice(0, 10)}`;
      const runPages = pages.filter((p) => p.page_number >= first && p.page_number <= last);
      const tally = {}; for (const p of runPages) if (p.ocr?.data) tally[pass(p)] = (tally[pass(p)] || 0) + 1;
      const major = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0];
      const odd = runPages.filter((p) => p.ocr?.data && pass(p) !== major).map((p) => p.page_number).filter((n) => textPages.includes(n));
      const extra = [...new Set([...gap, ...odd])].filter((n) => !textRows.has(n));
      if (extra.length > 400) { textFail('needs-eye (too many pages to refine)', { extra: extra.length }); if (stopClass) break; if (skipText) break textStep; continue; }
      for (const [k, v] of clefMap(bookId, extra, 'refine', { full: true, img: mapImg })) textRows.set(k, v);
      let allNums = [...textRows.keys()].sort((a, b) => a - b);
      // The shift is one OCR pass's defect: an edge page from another pass that scores d is a boundary
      // duplicate (the batch's first page repeats the preview's last leaf), not part of the run.
      const passOf = new Map(pages.map((p) => [p.page_number, p.ocr?.data ? pass(p) : null]));
      const strong = (n) => Math.max(textRows.get(n).own ?? 0, textRows.get(n).prev ?? 0, textRows.get(n).next ?? 0) >= 0.9;
      // Settle the edges, then scan every unscored text page between each edge and the nearest scored row,
      // and repeat: a weak sample dropped as an anchor leaves unscanned pages past the edge (69b63179
      // 609-612 behind a 0.83 sample at 613), and a run ended there clears a page and strands the rest.
      let dAll = [], edgeFail = null;
      for (let iter = 0; iter < 4; iter++) {
        allNums = [...textRows.keys()].sort((a, b) => a - b);
        dAll = allNums.filter((n) => textRows.get(n).offset === d);
        // At most ONE page per edge (the boundary duplicate is one page): a while-loop trimmed 12 genuinely
        // shifted pages of 69b631ce (56-67), whose run crossed three OCR passes; fixed by hand 2026-10-08.
        if (dAll.length && passOf.get(dAll[0]) !== major && !textRows.get(dAll[0]).trimmed) { rec.trimmed = [...(rec.trimmed || []), dAll[0]]; textRows.get(dAll[0]).offset = 0; textRows.get(dAll[0]).trimmed = true; dAll.shift(); }
        if (dAll.length && passOf.get(dAll[dAll.length - 1]) !== major && !textRows.get(dAll[dAll.length - 1]).trimmed) { rec.trimmed = [...(rec.trimmed || []), dAll[dAll.length - 1]]; textRows.get(dAll[dAll.length - 1]).offset = 0; textRows.get(dAll[dAll.length - 1]).trimmed = true; dAll.pop(); }
        // Only a STRONG row anchors an edge: 69b6318d's run was carried to p.319 by one +1 at 0.81 after
        // 67 pages of '?' (text matching neither its image nor a neighbour), and the shift broke the
        // aligned pages inside that stretch (undone 2026-10-08). '?' is unknown, not agreement.
        while (dAll.length && !strong(dAll[dAll.length - 1])) dAll.pop();
        while (dAll.length && !strong(dAll[0])) dAll.shift();
        if (!dAll.length) { edgeFail = 'needs-eye (no strong rows anchor the run)'; break; }
        const f = dAll[0], l = dAll[dAll.length - 1];
        const before = allNums.filter((n) => n < f && !(textRows.get(n).offset === d)).pop() ?? 0;
        const after = allNums.find((n) => n > l && !(textRows.get(n).offset === d && strong(n))) ?? Infinity;
        const unscanned = textPages.filter((n) => ((n > before && n < f) || (n > l && n < after)) && !textRows.has(n));
        if (!unscanned.length) break;
        if (iter === 3 || unscanned.length > 200) { edgeFail = 'needs-eye (edges did not settle)'; break; }
        for (const [k, v] of clefMap(bookId, unscanned, `edge${iter}`, { full: true, img: mapImg })) textRows.set(k, v);
        rec.edge_scanned = (rec.edge_scanned || 0) + unscanned.length;
      }
      if (edgeFail) { textFail(edgeFail); if (stopClass) break; if (skipText) break textStep; continue; }
      first = dAll[0]; last = dAll[dAll.length - 1];
      const inRunRows = allNums.filter((n) => n >= first && n <= last);
      // Two kinds of '?': LOW (the text matches nothing near: 69b6318d, all ~0.05, the dangerous kind, cap
      // 10%) and AMBIGUOUS (look-alike neighbours, all ~0.9; 69b63147 pp. 206 and 281 read by eye as +1, cap 25%).
      const unknown = inRunRows.filter((n) => textRows.get(n).offset === '?' && !textRows.get(n).ambiguous);
      const ambiguous = inRunRows.filter((n) => textRows.get(n).ambiguous);
      if (ambiguous.length > Math.max(2, 0.25 * inRunRows.length)) { textFail("needs-eye (too many ambiguous rows inside the run)", { ambiguous: ambiguous.slice(0, 30), rows: inRunRows.length }); if (stopClass) break; if (skipText) break textStep; continue; }
      if (ambiguous.length) rec.ambiguous_in_run = ambiguous;
      if (unknown.length > Math.max(2, 0.1 * inRunRows.length)) { textFail("needs-eye (too many '?' rows inside the run)", { unknown: unknown.slice(0, 30), rows: inRunRows.length }); if (stopClass) break; if (skipText) break textStep; continue; }
      const bad = allNums.filter((n) => n >= first && n <= last && isNum(textRows.get(n).offset) && textRows.get(n).offset !== d && !ADJ_EYE.includes(n));
      if (bad.length) { textFail('needs-eye (zero/other offsets inside the run)', { d, first, last, bad: bad.slice(0, 30), odd_pass: odd.length }); if (stopClass) break; if (skipText) break textStep; continue; }
      const maxPage = pages[pages.length - 1].page_number, minPage = pages[0].page_number;
      runSpec = d === 1 ? { from: first, to: Math.min(last + 1, maxPage), dir: 'left' } : { from: Math.max(first - 1, minPage), to: last, dir: 'right' };
      // The text a shift DISCARDS (left: old text at `from`; right: old text at `to`) must be a duplicate:
      // the outside neighbour's image matches it AND that neighbour keeps its own text. Otherwise it is the
      // only copy of a leaf (69b63147: a run from 27 would have dropped leaf 26's text; row 26 own 0.72,
      // next 0.93). Extend the edge while the neighbour points into the run; refuse if it cannot be shown.
      {
        const outside = () => (runSpec.dir === 'left' ? runSpec.from - 1 : runSpec.to + 1);
        let ok = false;
        for (let k = 0; k < 4; k++) {
          const o = outside();
          if (o < minPage || o > maxPage || !pages.some((p) => p.page_number === o)) { ok = true; break; }
          if (!textRows.has(o) && textPages.includes(o)) for (const [kk, v] of clefMap(bookId, [o], `discard${k}`, { full: true, img: mapImg })) textRows.set(kk, v);
          const r = textRows.get(o);
          const discardedHasText = !!pages.find((p) => p.page_number === (runSpec.dir === 'left' ? runSpec.from : runSpec.to))?.ocr?.data;
          if (!discardedHasText) { ok = true; break; }
          if (!r) { const po = pages.find((p) => p.page_number === o); if (!po?.ocr?.data || isBlank(po)) { ok = true; break; } break; }
          const toward = runSpec.dir === 'left' ? r.next : r.prev;
          if ((toward ?? 0) >= 0.9 && (r.own ?? 0) >= 0.9) { ok = true; break; }       // duplicate: safe to discard
          if ((toward ?? 0) >= 0.9) {
            // Extending onto a row the other-pass trim zeroed: the evidence (toward ≥ 0.9, own < 0.9) says it is
            // in the run after all (69af0f70 p.501: own 0.10, next 0.98, its text a duplicate of leaf 500).
            if (r.trimmed && (r.own ?? 0) < 0.9) { r.offset = d; r.untrimmed = true; rec.trimmed = (rec.trimmed || []).filter((n) => n !== o); }
            if (runSpec.dir === 'left') runSpec.from--; else runSpec.to++; rec.edge_extended = (rec.edge_extended || 0) + 1; continue;
          }
          break;
        }
        if (!ok) { textFail('needs-eye (the text the shift would discard is not shown to be a duplicate)', { discard_edge: outside() }); if (stopClass) break; if (skipText) break textStep; continue; }
      }
      rec.run = { ...runSpec, d, scored_in_run: allNums.filter((n) => n >= runSpec.from && n <= runSpec.to && isNum(textRows.get(n).offset)).length, odd_pass: odd.length, gap_scanned: gap.length };
      // the batch range the shift should have covered: pages of the run's majority pass
      const batchNums = pages.filter((p) => p.ocr?.data && pass(p) === major && textPages.includes(p.page_number)).map((p) => p.page_number);
      rec.batch_range = batchNums.length ? `${batchNums[0]}-${batchNums[batchNums.length - 1]}` : null;
      rec.run_covers_batch = batchNums.length ? (runSpec.from <= batchNums[0] + (d === -1 ? 0 : 0) && runSpec.to >= batchNums[batchNums.length - 1] - 1) : null;
    }

    if (!runSpec) {
      if (!imageDone) { finish('no-write: no text shift found and images aligned', {}); continue; }
    } else {
      // The page a run clears often reads a weak 0: a blank verso showing the previous leaf through
      // the paper (69b62fd4 p.490 own 0.78, Calendarium p.72; by eye 2026-10-08). When its neighbour
      // inside the run matches its text at ≥ 0.95, that text belongs to the neighbour's leaf, so the
      // page is adjudicated (recorded on the book_event), never silently dropped from the gate.
      const adj = [];
      const edge = runSpec.dir === 'left' ? runSpec.to : runSpec.from, inner = runSpec.dir === 'left' ? runSpec.to - 1 : runSpec.from + 1;
      const eRow = textRows.get(edge), iRow = textRows.get(inner);
      if (eRow?.offset === 0 && (eRow.own ?? 0) < 0.9 && ((runSpec.dir === 'left' ? iRow?.next : iRow?.prev) ?? 0) >= 0.95) adj.push(edge);
      const why = [adj.length ? `shift-repairs-5803-driver: run-edge page ${edge} scores own ${eRow.own} (< 0.9) while page ${inner}'s image matches its text at ≥ 0.95, so that text is ${inner}'s leaf (blank show-through verso / board pattern, by eye 2026-10-08 on 69b62fd4 p.490 and 69b630ac p.72)` : null,
        ADJ_EYE.length ? `by eye: ${ADJ_EYE_WHY}` : null].filter(Boolean).join('; ');
      for (const n of ADJ_EYE) if (!adj.includes(n)) adj.push(n);
      const adjArgs = adj.length ? ['--adjudicated', adj.join(','), '--adjudicated-why', why] : [];
      rec.adjudicated = adj.length ? adj : undefined;
      const mapFile = path.join(MAPS, `${bookId}-textmap.jsonl`);
      fs.writeFileSync(mapFile, [...textRows.values()].sort((a, b) => a.page - b.page).map((r) => JSON.stringify(r)).join('\n') + '\n');
      const dry = run(bookId, 'scripts/maintenance/repair-text-shift-run.mjs', ['--book', bookId, '--from', String(runSpec.from), '--to', String(runSpec.to), '--dir', runSpec.dir, '--map', mapFile, '--issue', String(ISSUE), ...adjArgs]);
      if (!/\[DRY RUN\]/.test(dry.out)) { textFail('needs-eye (text-shift tool refused)', { tool: dry.out.trim().split('\n').slice(-3).join(' | ').slice(0, 300) }); if (stopClass) break; if (skipText) break textStep; continue; }
      const cl = dry.out.match(/cleared: ([\d,]*) \(had text: (\d+), translation: (\d+)\)/);
      rec.cleared = cl ? { pages: cl[1], had_text: +cl[2], had_translation: +cl[3] } : null;
      const curStatus = (await db.collection('books').findOne({ id: bookId }, { projection: { 'pipeline_auto.status': 1 } }))?.pipeline_auto?.status;
      const needHold = OCR_LANE_STATUSES.has(curStatus) && cl && cl[1].length > 0;
      rec.hold_needed = needHold;
      if (!APPLY) { finish('plan: text shift', {}); continue; }
      if (needHold) {
        const idsFile = path.join(WORK, `hold-${bookId}.txt`); fs.writeFileSync(idsFile, bookId + '\n');
        const h = run(bookId, 'scripts/maintenance/hold-pipeline-books.mjs', ['--ids', idsFile, '--reason', 'shift-repair-5803-cleared-leaves', '--issue', '5803',
          '--release', `Derek decides whether the leaves the #5803 text shift cleared (pages ${cl[1]}; their own text was never produced) are OCR'd, or releases the book as-is`, '--apply']);
        const after = (await db.collection('books').findOne({ id: bookId }, { projection: { 'pipeline_auto.status': 1 } }))?.pipeline_auto?.status;
        if (after !== 'held') { textFail('hold failed, not applying', { hold_out: h.out.slice(-300) }); if (stopClass) break; if (skipText) break textStep; continue; }
        rec.held = { from: curStatus, reason: 'shift-repair-5803-cleared-leaves' };
      }
      const ap = run(bookId, 'scripts/maintenance/repair-text-shift-run.mjs', ['--book', bookId, '--from', String(runSpec.from), '--to', String(runSpec.to), '--dir', runSpec.dir, '--map', mapFile, '--issue', String(ISSUE), ...adjArgs, '--backup-dir', BACKUPS, '--apply']);
      const w = ap.out.match(/pages written: (\d+)\/(\d+); revisions (\d+)/);
      rec.text_written = w ? { pages: +w[1], of: +w[2], revisions: +w[3] } : null;
      rec.embeddings = (ap.out.match(/page_translations embeddings: ([^\n]*)/) || [])[1] ?? null;
      if (!/\[OK\] applied/.test(ap.out) || /\[WARN\]/.test(ap.out)) { stopClass = 'text shift did not apply cleanly'; finish('stop: text shift did not apply cleanly', { tool: ap.out.slice(-400) }); break; }
      // Group C: the image step flagged the batch pages needs_reocr; those now hold their own text.
      if (imageDone || SOURCE_IMG) {
        const moved = [];
        for (let n = runSpec.from; n <= runSpec.to; n++) if (!(rec.cleared?.pages || '').split(',').map(Number).includes(n)) moved.push(n);
        const u = await db.collection('pages').updateMany({ book_id: bookId, page_number: { $in: moved }, needs_reocr: true, needs_reocr_reason: src === 'erara_pdf' ? 'erara-cover-sheet-repair-#5803' : 'jp2-offset-repair-#3368', 'ocr.data': { $exists: true, $ne: '' } },
          { $unset: { needs_reocr: '', needs_reocr_reason: '' } });
        await db.collection('book_events').insertOne({ book_id: bookId, type: 'needs_reocr_cleared', at: new Date(), source: 'shift-repairs-5803-driver', details: { issue: ISSUE, pages: u.modifiedCount, why: 'the text shift put each page\'s own text back beside its re-archived image' } });
        rec.needs_reocr_cleared = u.modifiedCount;
      }
    }
    } // textStep

    // ── 6. post map ──
    const post = settledMap(bookId, textPages.length <= 120 ? textPages : stride(textPages, 100), 'after', mapImg);
    rec.clef_after = matchPct(post);
    rec.after_misses = [...post.values()].filter((r) => r.offset !== 0 && r.offset !== 'no-image' && r.own_text !== 'short').map((r) => `${r.page}:${r.offset}`).slice(0, 40);
    rec.purge = await purge(bookId, imageDone ? pages.map((p) => p.page_number) : [], db);
    if (imageDone) fs.appendFileSync(path.join(WORK, 'purge-needed.txt'), [`https://sourcelibrary.org/book/${bookId}`, ...pages.flatMap((p) => [`https://images.sourcelibrary.org/pages/${bookId}/${String(p.page_number).padStart(4, '0')}.jpg`, `https://images.sourcelibrary.org/archived/${bookId}/${p.page_number}.jpg`])].join('\n') + '\n');
    // IA image repairs strand the post-archival pages by design (they join the #5309 residual, flagged
    // needs_reocr), so the gate there is measured on the pages the repair did not strand.
    let gate = rec.clef_after;
    if (imageDone && src === 'bulk_jp2') {
      const stranded = new Set((await db.collection('pages').find({ book_id: bookId, needs_reocr: true }, { projection: { page_number: 1 } }).toArray()).map((p) => p.page_number));
      rec.stranded_now = stranded.size;
      gate = rec.clef_after_unstranded = matchPct(new Map([...post].filter(([k]) => !stranded.has(k))));
    }
    if (gate == null || gate < MATCH_OK) { stopClass = `post-repair match ${gate}% < ${MATCH_OK}%`; finish('stop: post-repair match below 95%'); break; }
    finish(rec.text_verdict ? 'repaired-image; text ' + rec.text_verdict : 'repaired');
  } catch (e) {
    if (String(e.message).startsWith('SPEND')) { stopClass = e.message; finish('stop: spend cap', { error: e.message }); break; }
    finish('error', { error: String(e.stack || e.message).slice(0, 400) });
  }
}
await client.close();
console.log(stopClass ? `STOPPED: ${stopClass}` : 'class pass finished', `| job Clef meter $${spentSoFar().toFixed(3)}`);
process.exit(stopClass ? 3 : 0);
