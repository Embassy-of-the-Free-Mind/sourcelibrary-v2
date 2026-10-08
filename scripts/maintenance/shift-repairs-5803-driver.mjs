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
function clefMap(bookId, pages, tag, { full }) {
  if (!pages.length) return new Map();
  const left = SPEND_CAP - spentSoFar();
  if (left <= 0.05) throw new Error(`SPEND: job meter at $${spentSoFar().toFixed(2)} ≥ cap $${SPEND_CAP}`);
  const r = run(bookId, 'scripts/eval/jev/clef-book-offset-map.mjs',
    ['--book', bookId, '--pages', pages.join(','), '--out', MAPS, '--tag', tag, '--cap', String(Math.min(1.5, left).toFixed(2))],
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
    if (isNum(r.offset) && r.offset !== 0 && r.own != null && r.own >= 0.7 && Math.max(r.prev ?? 0, r.next ?? 0) - r.own < TIE) { r.offset = 0; r.tie = true; }
  }
  return new Map(rows.map((x) => [x.page, x]));
}
const stride = (nums, target) => { const k = Math.max(1, Math.ceil(nums.length / target)); return nums.filter((_, i) => i % k === Math.floor(k / 2) || i === 0 || i === nums.length - 1); };
const isNum = (o) => typeof o === 'number';
const matchPct = (rows) => { const s = [...rows.values()].filter((r) => r.offset !== 'no-image' && r.own_text !== 'short'); return s.length ? +(100 * s.filter((r) => r.offset === 0).length / s.length).toFixed(1) : null; };

/** Adaptive map, then FULL on every row that is not a clear own-match: the adaptive pass reads 0.75–0.9
 *  on a NEIGHBOUR's prose as offset 0 (measured 2026-10-08 on 69b630cd: 9 such rows in a 19-page run). */
function settledMap(bookId, pages, tag) {
  const a = clefMap(bookId, pages, tag + '-a', { full: false });
  const unsure = [...a.values()].filter((r) => r.offset !== 'no-image' && r.own_text !== 'short' && !(r.offset === 0 && r.own >= 0.9)).map((r) => r.page);
  const f = clefMap(bookId, unsure, tag + '-f', { full: true });
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
    if (book.pipeline_auto?.hold || book.pipeline_auto?.status === 'held') { finish(`skip: pipeline hold ${book.pipeline_auto?.hold?.reason}`); continue; }
    rec.status = book.pipeline_auto?.status;

    if (CLASS === 'ia-5309') {
      const r = run(bookId, 'scripts/audit/stranded-image-repair-text.mjs', ['--book', bookId], { timeout: 600_000 });
      finish('no-write: #5309 stranded (owned there)', { audit_tail: r.out.trim().split('\n').slice(-6).join(' | ').slice(0, 600) });
      continue;
    }

    const pages = await db.collection('pages').find({ book_id: bookId, page_number: { $gte: 1 } }, {
      projection: { page_number: 1, page_type: 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'ocr.edited_by': 1, 'ocr.data': 1, 'translation.edited_by': 1, archive_metadata: 1, split_side: 1 },
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
      const post = settledMap(bookId, textPages.length <= 120 ? textPages : stride(textPages, 100), 'after');
      rec.clef_after = matchPct(post);
      rec.after_misses = [...post.values()].filter((r) => r.offset !== 0 && r.offset !== 'no-image' && r.own_text !== 'short').map((r) => `${r.page}:${r.offset}`).slice(0, 40);
      rec.purge = await purge(bookId, IMAGE_PAGES ? pages.map((p) => p.page_number) : [], db);
      finish(rec.clef_after >= MATCH_OK ? 'repaired' : 'stop: post-repair match below 95%');
      continue;
    }

    // ── 2. arbitration (free) ──
    const src = scr.provider === 'e-rara' ? 'erara_pdf' : 'bulk_jp2';
    const dh = parseDhash(run(bookId, 'scripts/maintenance/repair-bulk-jp2-offset.mjs', ['--source', src, '--book', bookId, '--samples', '8'], { timeout: 900_000 }).out);
    rec.dhash = { verdict: dh.verdict, detail: dh.detail, pre: dh.pre_archival, post: dh.post_archival, refuse: dh.refuse?.slice(0, 80) };

    // ── Clef before (reader images, as readers see them now) ──
    const before = clefMap(bookId, stride(textPages, 30), 'before', { full: true });
    rec.clef_before = matchPct(before);

    let imageDone = false;
    const imageSide = dh.shift_ok; // ≥2 shift votes, 0 aligned, and the pre-archival witness exists
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
    const sample = imageDone ? clefMap(bookId, stride(textPages, 40), 'run-sample', { full: true }) : before;
    const nonzero = [...sample.values()].filter((r) => isNum(r.offset) && r.offset !== 0);
    const textRows = new Map(sample);
    let runSpec = null;
    // A text-step refusal after the image step is not a no-write: the images were re-archived.
    // On e-rara the batch text the re-archive stranded is waiting on this shift, so stop the class.
    const textFail = (why, extra = {}) => {
      if (!imageDone) { finish('no-write: ' + why, extra); return; }
      rec.text_verdict = why; Object.assign(rec, extra);
      if (src === 'erara_pdf') { stopClass = `image re-archived but text step: ${why}`; finish('stop: image re-archived, text step ' + why); }
      else finish('repaired-image; text ' + why);
    };
    if (nonzero.length) {
      const d = nonzero.filter((r) => r.offset === 1).length >= nonzero.filter((r) => r.offset === -1).length ? 1 : -1;
      const sNums = [...sample.keys()].sort((a, b) => a - b);
      const dPages = sNums.filter((n) => sample.get(n).offset === d);
      let first = dPages[0], last = dPages[dPages.length - 1];
      const inside = sNums.filter((n) => n > first && n < last && isNum(sample.get(n).offset) && sample.get(n).offset !== d);
      if (inside.length) { textFail('needs-eye (sample is not one constant run)', { d, inside: inside.slice(0, 20), sample_runs: dPages.length }); if (stopClass) break; continue; }
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
      if (extra.length > 400) { textFail('needs-eye (too many pages to refine)', { extra: extra.length }); if (stopClass) break; continue; }
      for (const [k, v] of clefMap(bookId, extra, 'refine', { full: true })) textRows.set(k, v);
      const allNums = [...textRows.keys()].sort((a, b) => a - b);
      // The shift is one OCR pass's defect: an edge page from another pass that scores d is a boundary
      // duplicate (the batch's first page repeats the preview's last leaf), not part of the run.
      const passOf = new Map(pages.map((p) => [p.page_number, p.ocr?.data ? pass(p) : null]));
      const dAll = allNums.filter((n) => textRows.get(n).offset === d);
      while (dAll.length && passOf.get(dAll[0]) !== major) { rec.trimmed = [...(rec.trimmed || []), dAll[0]]; textRows.get(dAll[0]).offset = 0; textRows.get(dAll[0]).trimmed = true; dAll.shift(); }
      while (dAll.length && passOf.get(dAll[dAll.length - 1]) !== major) { rec.trimmed = [...(rec.trimmed || []), dAll[dAll.length - 1]]; textRows.get(dAll[dAll.length - 1]).offset = 0; textRows.get(dAll[dAll.length - 1]).trimmed = true; dAll.pop(); }
      if (!dAll.length) { textFail('needs-eye (no run left after trimming other-pass edges)'); if (stopClass) break; continue; }
      first = dAll[0]; last = dAll[dAll.length - 1];
      const bad = allNums.filter((n) => n >= first && n <= last && isNum(textRows.get(n).offset) && textRows.get(n).offset !== d);
      if (bad.length) { textFail('needs-eye (zero/other offsets inside the run)', { d, first, last, bad: bad.slice(0, 30), odd_pass: odd.length }); if (stopClass) break; continue; }
      const maxPage = pages[pages.length - 1].page_number, minPage = pages[0].page_number;
      runSpec = d === 1 ? { from: first, to: Math.min(last + 1, maxPage), dir: 'left' } : { from: Math.max(first - 1, minPage), to: last, dir: 'right' };
      rec.run = { ...runSpec, d, scored_in_run: allNums.filter((n) => n >= runSpec.from && n <= runSpec.to && isNum(textRows.get(n).offset)).length, odd_pass: odd.length, gap_scanned: gap.length };
      // the batch range the shift should have covered: pages of the run's majority pass
      const batchNums = pages.filter((p) => p.ocr?.data && pass(p) === major && textPages.includes(p.page_number)).map((p) => p.page_number);
      rec.batch_range = batchNums.length ? `${batchNums[0]}-${batchNums[batchNums.length - 1]}` : null;
      rec.run_covers_batch = batchNums.length ? (runSpec.from <= batchNums[0] + (d === -1 ? 0 : 0) && runSpec.to >= batchNums[batchNums.length - 1] - 1) : null;
    }

    if (!runSpec) {
      if (!imageDone) { finish('no-write: no text shift found and images aligned', {}); continue; }
    } else {
      const mapFile = path.join(MAPS, `${bookId}-textmap.jsonl`);
      fs.writeFileSync(mapFile, [...textRows.values()].sort((a, b) => a.page - b.page).map((r) => JSON.stringify(r)).join('\n') + '\n');
      const dry = run(bookId, 'scripts/maintenance/repair-text-shift-run.mjs', ['--book', bookId, '--from', String(runSpec.from), '--to', String(runSpec.to), '--dir', runSpec.dir, '--map', mapFile, '--issue', String(ISSUE)]);
      if (!/\[DRY RUN\]/.test(dry.out)) { textFail('needs-eye (text-shift tool refused)', { tool: dry.out.trim().split('\n').slice(-3).join(' | ').slice(0, 300) }); if (stopClass) break; continue; }
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
        if (after !== 'held') { textFail('hold failed, not applying', { hold_out: h.out.slice(-300) }); if (stopClass) break; continue; }
        rec.held = { from: curStatus, reason: 'shift-repair-5803-cleared-leaves' };
      }
      const ap = run(bookId, 'scripts/maintenance/repair-text-shift-run.mjs', ['--book', bookId, '--from', String(runSpec.from), '--to', String(runSpec.to), '--dir', runSpec.dir, '--map', mapFile, '--issue', String(ISSUE), '--backup-dir', BACKUPS, '--apply']);
      const w = ap.out.match(/pages written: (\d+)\/(\d+); revisions (\d+)/);
      rec.text_written = w ? { pages: +w[1], of: +w[2], revisions: +w[3] } : null;
      rec.embeddings = (ap.out.match(/page_translations embeddings: ([^\n]*)/) || [])[1] ?? null;
      if (!/\[OK\] applied/.test(ap.out) || /\[WARN\]/.test(ap.out)) { stopClass = 'text shift did not apply cleanly'; finish('stop: text shift did not apply cleanly', { tool: ap.out.slice(-400) }); break; }
      // Group C: the image step flagged the batch pages needs_reocr; those now hold their own text.
      if (imageDone && src === 'erara_pdf') {
        const moved = [];
        for (let n = runSpec.from; n <= runSpec.to; n++) if (!(rec.cleared?.pages || '').split(',').map(Number).includes(n)) moved.push(n);
        const u = await db.collection('pages').updateMany({ book_id: bookId, page_number: { $in: moved }, needs_reocr: true, needs_reocr_reason: 'erara-cover-sheet-repair-#5803', 'ocr.data': { $exists: true, $ne: '' } },
          { $unset: { needs_reocr: '', needs_reocr_reason: '' } });
        await db.collection('book_events').insertOne({ book_id: bookId, type: 'needs_reocr_cleared', at: new Date(), source: 'shift-repairs-5803-driver', details: { issue: ISSUE, pages: u.modifiedCount, why: 'the text shift put each page\'s own text back beside its re-archived image' } });
        rec.needs_reocr_cleared = u.modifiedCount;
      }
    }

    // ── 6. post map ──
    const post = settledMap(bookId, textPages.length <= 120 ? textPages : stride(textPages, 100), 'after');
    rec.clef_after = matchPct(post);
    rec.after_misses = [...post.values()].filter((r) => r.offset !== 0 && r.offset !== 'no-image' && r.own_text !== 'short').map((r) => `${r.page}:${r.offset}`).slice(0, 40);
    rec.purge = await purge(bookId, imageDone ? pages.map((p) => p.page_number) : [], db);
    if (rec.clef_after == null || rec.clef_after < MATCH_OK) { stopClass = `post-repair match ${rec.clef_after}% < ${MATCH_OK}%`; finish('stop: post-repair match below 95%'); break; }
    finish('repaired');
  } catch (e) {
    if (String(e.message).startsWith('SPEND')) { stopClass = e.message; finish('stop: spend cap', { error: e.message }); break; }
    finish('error', { error: String(e.stack || e.message).slice(0, 400) });
  }
}
await client.close();
console.log(stopClass ? `STOPPED: ${stopClass}` : 'class pass finished', `| job Clef meter $${spentSoFar().toFixed(3)}`);
process.exit(stopClass ? 3 : 0);
