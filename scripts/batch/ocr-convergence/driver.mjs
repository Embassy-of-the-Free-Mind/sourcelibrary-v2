#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-ocr.mjs (the CLI second read and the guarded OCR writer; this driver calls it and does
// not write OCR itself), scripts/eval/second-reader/run-readers.sh (sealed `claude -p --restricted` readers; the
// adjudicate step follows its seal), scripts/eval/ocr-prereg-6388 (an OCR adjudication eval with no write path),
// scripts/lib/book-checks.mjs (the check row), scripts/maintenance/withhold-stale-translations.mjs --by-eye-pages and
// scripts/lib/pipeline-hold.mjs (containment). None of them ranks the corpus by readers, compares a second read with
// the served one, or turns an adjudication into a write, a check or a containment. This is that loop (#6420 lane B).
/**
 * OCR convergence, #6420 lane B. Two reads from different families (the stored production read and a Gemini Flash
 * read through the subscription CLI), agreement as acceptance, Opus reading the image on disagreement, and a
 * containment when nobody can settle the page.
 *
 *   node --env-file=.env.production.local scripts/batch/ocr-convergence/driver.mjs <step> --run=DIR [...]
 *
 *   frame      rank visible non-English books with OCR by readers (distinct ip-days in analytics_pageviews, 60 days;
 *              the store is human-filtered at write time) → DIR/frame.json
 *   select     --set=NAME --books=RANKS|--plan=gate|calib [--pages=10] [--seed=6420]
 *              pages per book: the ones readers open most, filled to N with a seeded spread → DIR/NAME/pages.json
 *              (the id list for cli-ocr.mjs read) + manifest.jsonl
 *   read       (cli-ocr.mjs) node … scripts/batch/cli-ocr.mjs read --page-ids-file=DIR/NAME/pages.json
 *              --out=DIR/NAME/reads --model=gemini-3.7-flash-low --concurrency=3 --job=convergent-ocr-6420
 *   compare    --set=NAME   stored text vs CLI read: normalised CER, chatter flags → DIR/NAME/compare.jsonl
 *   packets    --set=NAME [--threshold=T | --all] [--per-chunk=25]   disagreements (or all pages, for calibration)
 *              → DIR/NAME/adj/chunks/*.json + images
 *   adjudicate --set=NAME [--parallel=8] [--model=opus]   sealed `claude -p` per chunk → DIR/NAME/adj/reviews/*.json
 *   decide     --set=NAME --threshold=T   one action per page → DIR/NAME/decisions.jsonl + summary.json
 *   apply      --set=NAME [--apply]   writes (cli-ocr.mjs apply --only), book_checks rows, containment. Dry by default.
 *
 * Actions (decide): `agree` (CER < T, both reads sound: a check, no write); `keep` (Opus: the stored read is right or
 * both are; no write); `write` (Opus picked the CLI read with high confidence, no chatter flag, and the book is not in
 * a translation lane that would re-translate the page at once); `defer` (a `write` held back because of that lane);
 * `contain` (Opus cannot tell, or both reads are wrong); `residual` (a merge or a low-confidence pick: no write,
 * listed for the next pass); `no-second-read` (the CLI failed twice: the stored read stands, nothing is claimed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { ocrReadProblem } from '../../lib/cli-chatter.mjs';
import { GROUPS, groupOf, translationLaneReason, pairCer, diffSpans, sideOf } from './lib.mjs';

const STEP = process.argv[2];
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const flag = (n) => process.argv.includes(`--${n}`);
const RUN = arg('run') && path.resolve(arg('run'));
if (!RUN) { console.error('--run=DIR is required (see the header)'); process.exit(2); }
const SET = arg('set');
const SETDIR = SET ? path.join(RUN, SET) : null;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '../../..');
const LANE = 'convergent-ocr-6420';

// mulberry32: the seeded spread is reproducible from the seed alone.
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));

async function connect() {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  return { client, db: client.db('bookstore') };
}

// ── frame ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function frame() {
  const { client, db } = await connect();
  const days = Number(arg('days', 60));
  const since = new Date(Date.now() - days * 86400e3);
  // analytics_pageviews drops non-human requests before the insert (measurement-instruments.md), so every row is a
  // classified-human view. Distinct (ip, day) per book damps one actor reloading a page.
  const views = await db.collection('analytics_pageviews').aggregate([
    { $match: { timestamp: { $gte: since }, path: /^\/book\// } },
    { $project: { slug: { $arrayElemAt: [{ $split: ['$path', '/'] }, 2] }, ip: 1, d: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } } } },
    { $group: { _id: { s: '$slug', ip: '$ip', d: '$d' } } },
    { $group: { _id: '$_id.s', v: { $sum: 1 } } },
    { $sort: { v: -1 } }, { $limit: 20000 },
  ], { allowDiskUse: true }).toArray();
  const bySlug = new Map(views.map((r) => [r._id, r.v]));
  const books = await db.collection('books').find(
    { visible: true, pages_count: { $gt: 0 }, pages_ocr: { $gt: 0 }, $or: [{ slug: { $in: [...bySlug.keys()] } }, { id: { $in: [...bySlug.keys()] } }] },
    { projection: { id: 1, slug: 1, title: 1, language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1 } },
  ).toArray();
  const rows = books.map((b) => ({ book_id: b.id, slug: b.slug, title: (b.title || '').slice(0, 120), language: b.language, group: groupOf(b.language), views: (bySlug.get(b.slug) || 0) + (bySlug.get(b.id) || 0), pages_ocr: b.pages_ocr, status: b.pipeline_auto?.status ?? null, held: !!b.pipeline_auto?.hold, lane_block: translationLaneReason(b) }))
    .filter((r) => r.group && !r.held)
    .sort((a, b) => b.views - a.views)
    .map((r, i) => ({ rank: i + 1, ...r }));
  fs.mkdirSync(RUN, { recursive: true });
  fs.writeFileSync(path.join(RUN, 'frame.json'), JSON.stringify({ built_at: new Date().toISOString(), window_days: days, instrument: 'analytics_pageviews, distinct (ip, day) per book, human-filtered at write', groups: GROUPS.map(([g]) => g), books: rows }, null, 1));
  const per = {}; for (const r of rows) per[r.group] = (per[r.group] || 0) + 1;
  console.log(`${rows.length} ranked books in the six groups (${JSON.stringify(per)}); top: ${rows.slice(0, 5).map((r) => `${r.slug} ${r.views}`).join(', ')}`);
  await client.close();
}

// ── select ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Plans: the gate is the top books of each group in proportion to the first 200 of the frame (Latin-heavy); the
// calibration batch is the next books down in each group, 3 pages each.
const PLANS = {
  gate: { latin: 15, greek: 5, german: 4, chinese: 3, arabic: 2, hebrew: 1, pages: 10 },
  calib: { latin: 8, greek: 4, german: 3, chinese: 2, arabic: 2, hebrew: 1, pages: 3 },
};

async function select() {
  if (!SET) throw new Error('--set=NAME is required');
  const fr = JSON.parse(fs.readFileSync(path.join(RUN, 'frame.json'), 'utf8'));
  const taken = new Set();
  for (const d of fs.readdirSync(RUN)) { const m = path.join(RUN, d, 'manifest.jsonl'); if (d !== SET && fs.existsSync(m)) for (const r of readJsonl(m)) taken.add(r.book_id); }
  let picks, perBook;
  const plan = arg('plan');
  if (plan) {
    const P = PLANS[plan]; if (!P) throw new Error(`unknown plan ${plan}`);
    perBook = Number(arg('pages', P.pages));
    picks = GROUPS.flatMap(([g]) => fr.books.filter((b) => b.group === g && !taken.has(b.book_id)).slice(0, P[g] || 0));
  } else {
    // --books=1-200: ranks in the frame, minus books another set already holds; processed in group order.
    const [lo, hi] = String(arg('books', '1-200')).split('-').map(Number);
    perBook = Number(arg('pages', 10));
    const inRange = fr.books.filter((b) => b.rank >= lo && b.rank <= hi && !taken.has(b.book_id));
    picks = GROUPS.flatMap(([g]) => inRange.filter((b) => b.group === g));
  }
  const { client, db } = await connect();
  const since = new Date(Date.now() - Number(arg('days', 60)) * 86400e3);
  const seed = Number(arg('seed', 6420));
  const manifest = [];
  for (const b of picks) {
    const pages = await db.collection('pages').find(
      { book_id: b.book_id, page_number: { $gt: 0 }, 'ocr.data': { $type: 'string' }, archived_photo: { $type: 'string' }, page_type: { $nin: ['blank', 'cover', 'illustration', 'image-only'] } },
      { projection: { _id: 1, id: 1, page_number: 1, 'ocr.edited_by': 1, 'ocr.source': 1, 'ocr.model': 1, len: { $strLenCP: '$ocr.data' } } },
    ).toArray();
    // A human-edited page is never re-read for a write; a page with under 200 chars has too little to compare.
    const ok = pages.filter((p) => !p.ocr?.edited_by && p.ocr?.source !== 'manual' && p.len >= 200);
    if (!ok.length) continue;
    const byPath = new Map(ok.flatMap((p) => [[`/book/${b.slug}/page/${String(p._id)}`, p], [`/book/${b.slug}/page/${p.id}`, p], [`/book/${b.slug}/page/${p.page_number}`, p]]));
    const pv = await db.collection('analytics_pageviews').aggregate([
      { $match: { path: { $in: [...byPath.keys()] }, timestamp: { $gte: since } } },
      { $group: { _id: { p: '$path', ip: '$ip', d: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } } } } },
      { $group: { _id: '$_id.p', v: { $sum: 1 } } },
    ]).toArray();
    const pageViews = new Map();
    for (const r of pv) { const p = byPath.get(r._id); pageViews.set(p.id, (pageViews.get(p.id) || 0) + r.v); }
    const viewed = ok.filter((p) => (pageViews.get(p.id) || 0) >= 2).sort((x, y) => pageViews.get(y.id) - pageViews.get(x.id)).slice(0, perBook);
    const chosen = new Map(viewed.map((p) => [p.id, 'viewed']));
    // Seeded spread to fill: one page from each of the remaining equal slices of the book, in page order.
    const rest = ok.filter((p) => !chosen.has(p.id)).sort((x, y) => x.page_number - y.page_number);
    const need = Math.min(perBook - chosen.size, rest.length);
    const r = rng(seed ^ parseInt(createHash('sha1').update(b.book_id).digest('hex').slice(0, 8), 16));
    for (let i = 0; i < need; i++) { const lo = Math.floor(i * rest.length / need), hi = Math.floor((i + 1) * rest.length / need); chosen.set(rest[lo + Math.floor(r() * (hi - lo))].id, 'spread'); }
    for (const p of ok) if (chosen.has(p.id)) manifest.push({ page_id: p.id, book_id: b.book_id, slug: b.slug, page_number: p.page_number, group: b.group, language: b.language, book_rank: b.rank, book_views: b.views, page_views: pageViews.get(p.id) || 0, why: chosen.get(p.id), stored_model: p.ocr?.model ?? null });
  }
  fs.mkdirSync(SETDIR, { recursive: true });
  writeJsonl(path.join(SETDIR, 'manifest.jsonl'), manifest);
  fs.writeFileSync(path.join(SETDIR, 'pages.json'), JSON.stringify(manifest.map((m) => m.page_id)));
  const books = new Set(manifest.map((m) => m.book_id));
  console.log(`${SET}: ${manifest.length} pages from ${books.size} books (${manifest.filter((m) => m.why === 'viewed').length} by page views, the rest a seeded spread)`);
  await client.close();
}

// ── compare ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function compare() {
  const manifest = readJsonl(path.join(SETDIR, 'manifest.jsonl'));
  const reads = path.join(SETDIR, 'reads');
  const { client, db } = await connect();
  const stored = new Map((await db.collection('pages').find({ id: { $in: manifest.map((m) => m.page_id) } }, { projection: { id: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.updated_at': 1 } }).toArray()).map((p) => [p.id, p]));
  fs.mkdirSync(path.join(SETDIR, 'stored'), { recursive: true });
  const rows = [];
  for (const m of manifest) {
    const s = stored.get(m.page_id);
    const metaF = path.join(reads, `${m.page_id}.meta.json`);
    if (!fs.existsSync(metaF)) { rows.push({ ...m, status: 'not-read' }); continue; }
    const meta = JSON.parse(fs.readFileSync(metaF, 'utf8'));
    const cli = fs.readFileSync(path.join(reads, `${m.page_id}.txt`), 'utf8');
    // The stored text as it was compared, so adjudication and audit see exactly this text even if the page changes.
    fs.writeFileSync(path.join(SETDIR, 'stored', `${m.page_id}.txt`), s?.ocr?.data || '');
    const chatter = meta.error_class ? `cli ${meta.error_class}` : ocrReadProblem(cli);
    const c = chatter ? { cer: null } : pairCer(s?.ocr?.data, cli);
    rows.push({ ...m, status: chatter ? 'cli-failed' : 'compared', chatter, ...c, cer: c.cer == null ? null : Math.round(c.cer * 10000) / 10000, stored_model: s?.ocr?.model ?? null, stored_updated_at: s?.ocr?.updated_at ?? null, cli_model: meta.model, nudged: !!meta.nudged, rereads: meta.rereads || 0 });
  }
  writeJsonl(path.join(SETDIR, 'compare.jsonl'), rows);
  const cs = rows.filter((r) => r.cer != null).map((r) => r.cer).sort((a, b) => a - b);
  const q = (p) => cs[Math.min(cs.length - 1, Math.floor(p * cs.length))];
  console.log(`${SET}: ${rows.length} pages; compared ${cs.length}, cli-failed ${rows.filter((r) => r.status === 'cli-failed').length}, not read ${rows.filter((r) => r.status === 'not-read').length}; CER p10 ${q(0.1)} p25 ${q(0.25)} p50 ${q(0.5)} p75 ${q(0.75)} p90 ${q(0.9)}`);
  await client.close();
}

// ── packets ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function packets() {
  const rows = readJsonl(path.join(SETDIR, 'compare.jsonl'));
  const T = Number(arg('threshold', NaN));
  const all = flag('all');
  if (!all && !Number.isFinite(T) && !Number.isFinite(Number(arg('below', NaN)))) throw new Error('--threshold=T (from the preregistration), --below=T --sample=N, or --all');
  const per = Number(arg('per-chunk', 25));
  const seed = Number(arg('seed', 6420));
  // --below=T --sample=N: the preregistered check on T, N random pages that AGREED, adjudicated into adj-agree/.
  const below = Number(arg('below', NaN));
  const r0 = rng(seed);
  let todo = rows.filter((r) => r.status === 'compared' && (Number.isFinite(below) ? r.cer < below : (all || r.cer >= T)));
  if (Number.isFinite(below)) todo = todo.map((r) => [r0(), r]).sort((a, b) => a[0] - b[0]).slice(0, Number(arg('sample', 30))).map(([, r]) => r);
  const ADJ = path.join(SETDIR, Number.isFinite(below) ? 'adj-agree' : 'adj');
  fs.mkdirSync(path.join(ADJ, 'chunks'), { recursive: true });
  fs.mkdirSync(path.join(ADJ, 'images'), { recursive: true });
  const key = [];
  const items = [];
  for (const r of todo) {
    const stored = fs.readFileSync(path.join(SETDIR, 'stored', `${r.page_id}.txt`), 'utf8');
    const cli = fs.readFileSync(path.join(SETDIR, 'reads', `${r.page_id}.txt`), 'utf8');
    const img = path.join(SETDIR, 'reads', `ws-${r.page_id}`, `${r.page_id}.jpg`);
    const imgName = `images/${r.page_id}.jpg`;
    fs.copyFileSync(img, path.join(ADJ, imgName));
    const side = sideOf(r.page_id, seed);
    const [ta, tb] = side === 'stored-is-A' ? [stored, cli] : [cli, stored];
    const d = diffSpans(ta, tb);
    items.push({ item_id: r.page_id, language: r.language, image_file: imgName, diff: d.spans, diff_spans_total: d.total, text_a: ta, text_b: tb });
    key.push({ page_id: r.page_id, side });
  }
  for (const f of fs.readdirSync(path.join(ADJ, 'chunks'))) fs.unlinkSync(path.join(ADJ, 'chunks', f));
  for (let i = 0; i * per < items.length; i++) fs.writeFileSync(path.join(ADJ, 'chunks', `c${String(i).padStart(3, '0')}.json`), JSON.stringify(items.slice(i * per, (i + 1) * per), null, 1));
  // The key stays outside the sealed folders: an adjudicator never sees which text is served.
  writeJsonl(path.join(ADJ, 'key.jsonl'), key);
  console.log(`${SET}: ${items.length} pages to adjudicate${all ? ' (all compared pages: calibration)' : ` (CER ≥ ${T})`} in ${Math.ceil(items.length / per)} chunks`);
}

// ── adjudicate ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Sealed like scripts/eval/second-reader/run-readers.sh: one folder per chunk holding only the brief, the items and
// their images; `--restricted --tools Read Write` removes Bash and confines reads to the folder.
function runSealed(chunkFile, outFile, metaDir, model, brief = 'ADJUDICATOR.md') {
  const name = path.basename(chunkFile, '.json');
  const sealed = path.join(process.env.TMPDIR || '/tmp', 'ocr-convergence-sealed', path.basename(path.dirname(path.dirname(chunkFile))) + '-' + (SET || 'x') + '-' + brief.replace(/\.md$/, ''), name);
  fs.rmSync(sealed, { recursive: true, force: true });
  fs.mkdirSync(path.join(sealed, 'images'), { recursive: true });
  fs.copyFileSync(path.join(HERE, brief), path.join(sealed, brief));
  const items = JSON.parse(fs.readFileSync(chunkFile, 'utf8'));
  fs.writeFileSync(path.join(sealed, 'items.json'), JSON.stringify(items, null, 1));
  for (const it of items) fs.copyFileSync(path.join(path.dirname(path.dirname(chunkFile)), it.image_file), path.join(sealed, it.image_file));
  const prompt = `Your instructions are the full text of \`${brief}\` in this folder (skip the leading \`<!-- … -->\` comment); follow them exactly. Work only inside this folder.\nITEMS_FILE: \`items.json\`\nOUTPUT_FILE: \`review.json\``;
  return new Promise((resolve) => {
    const t0 = Date.now();
    const out = fs.openSync(path.join(metaDir, `${name}.jsonl`), 'w');
    const child = spawn('claude', ['-p', prompt, '--model', model, '--restricted', '--tools', 'Read', 'Write', '--allowedTools', 'Read', 'Write', '--strict-mcp-config', '--output-format', 'stream-json', '--verbose'], { cwd: sealed, stdio: ['ignore', out, out] });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer); fs.closeSync(out);
      const rv = path.join(sealed, 'review.json');
      let ok = false;
      if (fs.existsSync(rv)) { try { const j = JSON.parse(fs.readFileSync(rv, 'utf8')); if (Array.isArray(j) && j.length) { fs.writeFileSync(outFile, JSON.stringify(j, null, 1)); ok = true; } } catch { /* malformed: retried */ } }
      resolve({ name, ok, code, secs: Math.round((Date.now() - t0) / 1000) });
    });
  });
}

async function adjudicate() {
  const ADJ = path.join(SETDIR, arg('dir', 'adj'));
  const model = arg('model', 'opus');
  const par = Math.min(8, Number(arg('parallel', 8)));
  fs.mkdirSync(path.join(ADJ, 'reviews'), { recursive: true });
  fs.mkdirSync(path.join(ADJ, 'meta'), { recursive: true });
  const version = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(ADJ, 'meta', 'run.json'), JSON.stringify({ model, cli_version: version, brief: 'ADJUDICATOR.md v1', brief_sha256: createHash('sha256').update(fs.readFileSync(path.join(HERE, 'ADJUDICATOR.md'))).digest('hex'), started: new Date().toISOString() }));
  const queue = fs.readdirSync(path.join(ADJ, 'chunks')).filter((f) => f.endsWith('.json') && !fs.existsSync(path.join(ADJ, 'reviews', f)));
  console.log(`${SET}: ${queue.length} chunks to adjudicate with ${model}, ${par} at a time`);
  await Promise.all(Array.from({ length: par }, async () => {
    while (queue.length) {
      const f = queue.shift();
      let r = await runSealed(path.join(ADJ, 'chunks', f), path.join(ADJ, 'reviews', f), path.join(ADJ, 'meta'), model);
      if (!r.ok) r = await runSealed(path.join(ADJ, 'chunks', f), path.join(ADJ, 'reviews', f), path.join(ADJ, 'meta'), model);
      console.log(`  ${r.name} ${r.ok ? 'ok' : `FAILED (exit ${r.code})`} ${r.secs}s`);
    }
  }));
}

// ── decide ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function decide() {
  const T = Number(arg('threshold', NaN));
  if (!Number.isFinite(T)) throw new Error('--threshold=T (from the preregistration) is required');
  const rows = readJsonl(path.join(SETDIR, 'compare.jsonl'));
  const ADJ = path.join(SETDIR, 'adj');
  const key = new Map([...readJsonl(path.join(ADJ, 'key.jsonl')), ...readJsonl(path.join(SETDIR, 'adj-agree', 'key.jsonl'))].map((k) => [k.page_id, k.side]));
  const verdicts = new Map();
  // A verdict counts only if the transcript shows the adjudicator opened that page's image (Read of images/<id>.jpg);
  // one that judged from the texts alone is dropped and the page stays pending.
  const unread = [];
  for (const dir of ['adj', 'adj-agree']) {
    const D = path.join(SETDIR, dir);
    if (!fs.existsSync(path.join(D, 'reviews'))) continue;
    for (const f of fs.readdirSync(path.join(D, 'reviews'))) {
      const tr = fs.existsSync(path.join(D, 'meta', f.replace(/\.json$/, '.jsonl'))) ? fs.readFileSync(path.join(D, 'meta', f.replace(/\.json$/, '.jsonl')), 'utf8') : '';
      for (const v of JSON.parse(fs.readFileSync(path.join(D, 'reviews', f), 'utf8'))) {
        if (!new RegExp(`"name":"Read","input":\\{"file_path":"[^"]*images/${v.item_id}\\.jpg`).test(tr)) { unread.push(v.item_id); continue; }
        if (!key.has(v.item_id)) continue;
        verdicts.set(v.item_id, v);
      }
    }
  }
  if (unread.length) console.log(`  ${unread.length} verdicts dropped: image not opened (${unread.join(', ')})`);
  const { client, db } = await connect();
  const books = new Map((await db.collection('books').find({ id: { $in: [...new Set(rows.map((r) => r.book_id))] } }, { projection: { id: 1, pages_ocr: 1, pages_blank: 1, pages_translated: 1, pipeline_auto: 1 } }).toArray()).map((b) => [b.id, b]));
  await client.close();
  // contain-extra.json: [{ page_id, why }] — pages a reader of the image found carrying ANOTHER leaf's text (the
  // containment bar), named by hand from the adjudication notes; they are contained whatever the pick.
  const extraF = path.join(SETDIR, 'contain-extra.json');
  const extra = new Map(fs.existsSync(extraF) ? JSON.parse(fs.readFileSync(extraF, 'utf8')).map((e) => [e.page_id, e.why]) : []);
  const out = [];
  for (const r of rows) {
    const base = { page_id: r.page_id, book_id: r.book_id, slug: r.slug, page_number: r.page_number, group: r.group, language: r.language, cer: r.cer, chatter: r.chatter, stored_model: r.stored_model };
    if (r.status !== 'compared') { out.push({ ...base, action: 'no-second-read', why: r.chatter || r.status }); continue; }
    const v = verdicts.get(r.page_id);
    const side = key.get(r.page_id);
    let adj = null;
    if (v && side) {
      const map = (x) => (x === 'A' ? (side === 'stored-is-A' ? 'stored' : 'cli') : x === 'B' ? (side === 'stored-is-A' ? 'cli' : 'stored') : x);
      const [sSer, cSer] = side === 'stored-is-A' ? [v.a_serious, v.b_serious] : [v.b_serious, v.a_serious];
      const [sErr, cErr] = side === 'stored-is-A' ? [v.a_errors, v.b_errors] : [v.b_errors, v.a_errors];
      adj = { pick: map(v.pick), confidence: v.confidence, stored_serious: !!sSer, cli_serious: !!cSer, replace: !!v.replace, stored_errors: sErr || [], cli_errors: cErr || [], note: v.note };
    }
    if (r.cer < T) {
      // Below the threshold the two families agree: acceptance, unless an adjudication (calibration) says otherwise.
      if (!adj || ['both', 'stored'].includes(adj.pick) || (!adj.stored_serious && !adj.replace)) { out.push({ ...base, action: 'agree', adj }); continue; }
    }
    if (!adj) { out.push({ ...base, action: 'pending-adjudication' }); continue; }
    let action, why;
    if (extra.has(r.page_id)) { out.push({ ...base, action: 'contain', why: extra.get(r.page_id), adj }); continue; }
    // Containment is for a page neither family can give a reader (containment-on-finding.md: the bar is "not this
    // leaf's text", not a judgment of quality): the adjudicator says neither read is usable, or cannot settle it, at
    // medium or high confidence. A MERGE (each read right where the other is wrong) or a low-confidence "cannot tell"
    // is residual: no write, a page finding on the book's check, and a third read later.
    if ((adj.pick === 'cannot_tell' || adj.pick === 'neither') && adj.confidence !== 'low') { action = 'contain'; why = adj.pick === 'cannot_tell' ? 'cannot tell from the image' : 'neither read is usable'; }
    else if (adj.pick === 'cli' && adj.confidence === 'high' && adj.replace && !adj.cli_serious && !r.chatter) {
      const lane = translationLaneReason(books.get(r.book_id));
      if (lane) { action = 'defer'; why = lane; } else action = 'write';
    } else if (adj.pick === 'stored' || adj.pick === 'both' || (adj.pick === 'cli' && !adj.stored_serious && !adj.replace)) action = 'keep';
    else { action = 'residual'; why = `${adj.pick}, ${adj.confidence} confidence`; }
    out.push({ ...base, action, ...(why ? { why } : {}), adj });
  }
  writeJsonl(path.join(SETDIR, 'decisions.jsonl'), out);
  const tally = {}; for (const o of out) tally[o.action] = (tally[o.action] || 0) + 1;
  const byGroup = {}; for (const o of out) { (byGroup[o.group] ??= {})[o.action] = (byGroup[o.group][o.action] || 0) + 1; }
  fs.writeFileSync(path.join(SETDIR, 'summary.json'), JSON.stringify({ set: SET, threshold: T, pages: out.length, books: new Set(out.map((o) => o.book_id)).size, actions: tally, by_group: byGroup, decided_at: new Date().toISOString() }, null, 1));
  console.log(`${SET}: ${JSON.stringify(tally)}`);
}

// ── apply ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const METHOD = { id: 'ocr-convergence', version: '1' };
async function apply() {
  const APPLY = flag('apply');
  const dec = readJsonl(path.join(SETDIR, 'decisions.jsonl'));
  const runId = `${LANE}-${SET}-${path.basename(RUN)}`;
  const reason = `#6420 lane B: second read (gemini-3.7-flash-low, CLI) disagreed with the stored read; Opus picked this read from the image (run ${runId})`;
  // 1. Writes, through cli-ocr.mjs apply and its guards. Each written page is stamped translation_stale with this
  //    lane, so lane C finds exactly these pages; no automatic lane re-translates a book outside TRANSLATING (decide).
  // --no-writes: a failed gate (or any stop) applies checks and containments only; `write` pages are reported as
  // staged repairs (a serious stored misreading the check row names), never written.
  const NO_WRITES = flag('no-writes');
  const writes = NO_WRITES ? [] : dec.filter((d) => d.action === 'write').map((d) => d.page_id);
  const onlyFile = path.join(SETDIR, 'write-ids.json');
  fs.writeFileSync(onlyFile, JSON.stringify(writes));
  if (writes.length) {
    const r = spawnSync('node', [path.join(REPO, 'scripts/batch/cli-ocr.mjs'), 'apply', `--out=${path.join(SETDIR, 'reads')}`, `--only=${onlyFile}`, `--reason=${reason}`, `--mark-stale=${LANE}`, ...(APPLY ? ['--apply'] : [])], { encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(path.join(SETDIR, `apply-writes${APPLY ? '' : '.dry'}.log`), r.stdout + r.stderr);
    console.log((r.stdout || '').split('\n').filter((l) => /written|would write|skip/.test(l)).slice(-3).join('\n'));
  }
  const { client, db } = await connect();
  const { recordBookCheck, pageProvenance, ensureBookCheckIndexes } = await import('../../lib/book-checks.mjs');
  if (APPLY) await ensureBookCheckIndexes(db);
  // 2. Containment (containment-on-finding.md): hold the book first, then withhold the named pages' English.
  const contain = {};
  for (const d of dec.filter((x) => x.action === 'contain')) (contain[d.book_id] ??= []).push(d);
  const { holdBook } = await import('../../lib/pipeline-hold.mjs');
  for (const [bookId, ds] of Object.entries(contain)) {
    const pages = ds.map((d) => d.page_number).sort((a, b) => a - b);
    const evidence = `#6420 lane B (${runId}): two OCR reads of different families disagree and an Opus reader of the image could not settle the page or found both reads wrong: ${ds.map((d) => `p.${d.page_number} ${d.why}${d.adj?.note ? ` (${d.adj.note.slice(0, 120)})` : ''}`).join('; ').slice(0, 1500)}`;
    const h = await holdBook(db, bookId, { reason: 'ocr-unsettled-6420', issue: 6420, release: 'the contained pages are re-read and settled (a third read or a person), or a person releases them', source: 'scripts/batch/ocr-convergence/driver.mjs', detail: { pages, run: runId } }, { dryRun: !APPLY });
    const w = spawnSync('node', [path.join(REPO, 'scripts/maintenance/withhold-stale-translations.mjs'), `--book=${bookId}`, `--by-eye-pages=${pages.join(',')}`, `--evidence=${evidence}`, '--issue=6420', ...(APPLY ? ['--apply'] : [])], { encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
    fs.appendFileSync(path.join(SETDIR, `apply-contain${APPLY ? '' : '.dry'}.log`), `\n== ${bookId} hold:${h.outcome} pages ${pages.join(',')}\n${w.stdout}${w.stderr}`);
    console.log(`  contain ${bookId} p.${pages.join(',')}: hold ${h.outcome}; withhold exit ${w.status}`);
  }
  // 3. One check row per book: what was read, by whom, and the per-page serious findings left standing.
  const byBook = {};
  for (const d of dec.filter((x) => x.action !== 'no-second-read' && x.action !== 'pending-adjudication')) (byBook[d.book_id] ??= []).push(d);
  let rows = 0;
  for (const [bookId, ds] of Object.entries(byBook)) {
    const pagesRead = ds.map((d) => d.page_number).sort((a, b) => a - b);
    const findings = ds.filter((d) => d.action === 'contain' || d.action === 'residual' || (NO_WRITES && d.action === 'write') || (d.action === 'defer' && d.adj?.stored_serious) || (d.action === 'keep' && d.adj?.stored_serious))
      .map((d) => ({ page_number: d.page_number, ...(d.action === 'contain' && /another leaf/.test(d.why || '') ? { wrong_page: true } : {}), errors: [{ stage: 'ocr', class: d.action === 'contain' ? (/another leaf/.test(d.why || '') ? 'ocr-wrong-leaf' : 'ocr-unsettled') : 'ocr-misread', problem: (d.adj?.stored_errors?.[0] || d.why || d.action).slice(0, 200) }] }));
    const verdict = ds.some((d) => d.action === 'contain') ? 'fix' : findings.length ? 'caveat' : 'show';
    const input = {
      book_id: bookId, checked_at: new Date(), method_id: METHOD.id, method_version: METHOD.version, run_id: runId,
      frame: `#6420 lane B: top books by readers (analytics_pageviews), ${SET}`, pages_read: pagesRead,
      reader: { kind: 'model', model: 'gemini-3.7-flash-low', role: 'ocr-convergence: CLI second read vs stored; Opus (subscription) reads the image on disagreement', image_opened: true },
      verdict, classes: [...new Set(ds.map((d) => d.action))], page_findings: findings,
      note: `${ds.filter((d) => d.action === 'agree').length} agree, ${ds.filter((d) => d.action === 'keep').length} kept, ${ds.filter((d) => d.action === 'write').length} ${NO_WRITES ? 'staged, not written (gate)' : 'written'}, ${ds.filter((d) => d.action === 'defer').length} deferred, ${ds.filter((d) => d.action === 'residual').length} residual, ${ds.filter((d) => d.action === 'contain').length} contained`,
      evidence_path: `scripts/batch/ocr-convergence/results/${path.basename(RUN)}/${SET}/decisions.jsonl.gz`,
      text_provenance: await pageProvenance(db, bookId, pagesRead),
      api_usd: 0,
    };
    if (APPLY) { await recordBookCheck(db, input); rows++; } else { (await import('../../lib/book-checks.mjs')).buildBookCheck(input); rows++; }
  }
  console.log(`${APPLY ? 'applied' : 'DRY RUN'}: writes ${writes.length}, contained ${Object.values(contain).flat().length} pages in ${Object.keys(contain).length} books, check rows ${rows}`);
  await client.close();
}

// ── audit: the gate (#6420): a blind by-eye check of 40 staged decisions by a fresh Opus and Gemini 3.8 ───────────
// Items: every `write` up to 40, then `contain`, then `keep`, seeded. X/Y order drawn with another seed than the
// adjudication's, and no diff hint: the auditor answers "which is the more faithful transcription of this leaf".
async function auditPackets() {
  const dec = readJsonl(path.join(SETDIR, 'decisions.jsonl'));
  const n = Number(arg('n', 40));
  const r = rng(64200);
  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = [];
  for (const act of ['write', 'contain', 'keep', 'residual', 'defer']) for (const d of shuffle(dec.filter((x) => x.action === act))) if (pick.length < n) pick.push(d);
  const AUD = path.join(SETDIR, 'audit');
  fs.mkdirSync(path.join(AUD, 'chunks'), { recursive: true }); fs.mkdirSync(path.join(AUD, 'images'), { recursive: true });
  const items = [], key = [];
  for (const d of pick) {
    const stored = fs.readFileSync(path.join(SETDIR, 'stored', `${d.page_id}.txt`), 'utf8');
    const cli = fs.readFileSync(path.join(SETDIR, 'reads', `${d.page_id}.txt`), 'utf8');
    fs.copyFileSync(path.join(SETDIR, 'reads', `ws-${d.page_id}`, `${d.page_id}.jpg`), path.join(AUD, 'images', `${d.page_id}.jpg`));
    const side = sideOf(d.page_id, 'audit-6420');
    const [tx, ty] = side === 'stored-is-A' ? [stored, cli] : [cli, stored];
    items.push({ item_id: d.page_id, language: d.language, image_file: `images/${d.page_id}.jpg`, text_x: tx, text_y: ty });
    key.push({ page_id: d.page_id, action: d.action, stored_is: side === 'stored-is-A' ? 'X' : 'Y' });
  }
  const per = Number(arg('per-chunk', 10));
  for (let i = 0; i * per < items.length; i++) fs.writeFileSync(path.join(AUD, 'chunks', `a${String(i).padStart(3, '0')}.json`), JSON.stringify(items.slice(i * per, (i + 1) * per), null, 1));
  writeJsonl(path.join(AUD, 'key.jsonl'), key);
  // The Gemini auditor: one page per call through scripts/eval/run-cli-arm.py (plan mode, the nudge), brief inline.
  const brief = fs.readFileSync(path.join(HERE, 'AUDITOR.md'), 'utf8').replace(/^\s*<!--[\s\S]*?-->\s*/, '');
  const wrapper = '## How this request is run (not part of the brief)\n\nYou cannot open files, run commands or write files here; do not try. ITEMS_FILE is given inline below and holds ONE item; its image is the file attached at the end of this message. OUTPUT_FILE is your reply: reply with ONLY one JSON object (`item_id`, `better`, `worse_serious`, `confidence`, `note`), with no prose and no markdown fence.';
  writeJsonl(path.join(AUD, 'gemini-requests.jsonl'), items.map((it) => ({ uid: it.item_id, image: path.join(AUD, it.image_file), prompt: `${brief}\n\n${wrapper}\n\nITEMS_FILE:\n${JSON.stringify([{ ...it, image_file: `${it.item_id}.jpg` }], null, 1)}` })));
  const tally = {}; for (const k of key) tally[k.action] = (tally[k.action] || 0) + 1;
  console.log(`${SET}: audit of ${items.length} decisions ${JSON.stringify(tally)}\nnext: driver.mjs audit-opus, and python3 scripts/eval/run-cli-arm.py --requests ${path.join(AUD, 'gemini-requests.jsonl')} --out ${path.join(AUD, 'gemini-out.jsonl')} --arm audit6420-g38 --model gemini-3.8-flash-high --job convergent-ocr-6420 --kind audit --parallel 2 --attempts 4`);
}

async function auditOpus() {
  const AUD = path.join(SETDIR, 'audit');
  fs.mkdirSync(path.join(AUD, 'opus'), { recursive: true }); fs.mkdirSync(path.join(AUD, 'meta'), { recursive: true });
  const queue = fs.readdirSync(path.join(AUD, 'chunks')).filter((f) => !fs.existsSync(path.join(AUD, 'opus', f)));
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const f = queue.shift();
      let r = await runSealed(path.join(AUD, 'chunks', f), path.join(AUD, 'opus', f), path.join(AUD, 'meta'), arg('model', 'opus'), 'AUDITOR.md');
      if (!r.ok) r = await runSealed(path.join(AUD, 'chunks', f), path.join(AUD, 'opus', f), path.join(AUD, 'meta'), arg('model', 'opus'), 'AUDITOR.md');
      console.log(`  ${r.name} ${r.ok ? 'ok' : 'FAILED'} ${r.secs}s`);
    }
  }));
}

async function auditScore() {
  const AUD = path.join(SETDIR, 'audit');
  const key = readJsonl(path.join(AUD, 'key.jsonl'));
  const opus = new Map();
  for (const f of fs.readdirSync(path.join(AUD, 'opus'))) for (const v of JSON.parse(fs.readFileSync(path.join(AUD, 'opus', f), 'utf8'))) opus.set(v.item_id, v);
  const gem = new Map();
  for (const l of fs.existsSync(path.join(AUD, 'gemini-out.jsonl')) ? fs.readFileSync(path.join(AUD, 'gemini-out.jsonl'), 'utf8').split('\n') : []) {
    try { const o = JSON.parse(l); if (!o.text) continue; const m = o.text.match(/\{[\s\S]*\}/); if (m) gem.set(o.uid, { ...JSON.parse(m[0]), item_id: o.uid }); } catch { /* unparsable: missing */ }
  }
  const rows = key.map((k) => {
    const verdict = (v) => (!v ? null : v.better === 'same' ? 'same' : v.better === k.stored_is ? 'stored' : 'cli');
    return { ...k, opus: verdict(opus.get(k.page_id)), opus_serious: opus.get(k.page_id)?.worse_serious ?? null, gemini: verdict(gem.get(k.page_id)), gemini_serious: gem.get(k.page_id)?.worse_serious ?? null, opus_note: opus.get(k.page_id)?.note, gemini_note: gem.get(k.page_id)?.note };
  });
  // A write "made the page worse" when the auditor prefers the stored text over the CLI read that replaced it.
  const writes = rows.filter((r) => r.action === 'write');
  const worse = (who) => writes.filter((r) => r[who] === 'stored').length;
  const res = { set: SET, audited: rows.length, writes: writes.length, read: { opus: rows.filter((r) => r.opus).length, gemini: rows.filter((r) => r.gemini).length },
    writes_worse: { opus: worse('opus'), gemini: worse('gemini') }, writes_better: { opus: writes.filter((r) => r.opus === 'cli').length, gemini: writes.filter((r) => r.gemini === 'cli').length },
    writes_same: { opus: writes.filter((r) => r.opus === 'same').length, gemini: writes.filter((r) => r.gemini === 'same').length },
    gate: worse('opus') <= 2 && worse('gemini') <= 2 ? 'GO' : 'STOP', rows };
  fs.writeFileSync(path.join(AUD, 'result.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ ...res, rows: undefined }, null, 1));
  for (const r of rows.filter((x) => x.action === 'write' && (x.opus === 'stored' || x.gemini === 'stored'))) console.log(`  worse? ${r.page_id} opus=${r.opus} gemini=${r.gemini} | ${r.opus_note} | ${r.gemini_note}`);
}

const steps = { frame, select, compare, packets, adjudicate, decide, apply, 'audit-packets': auditPackets, 'audit-opus': auditOpus, 'audit-score': auditScore };
if (!steps[STEP]) { console.error(`unknown step ${STEP}; one of ${Object.keys(steps).join(', ')}`); process.exit(2); }
await steps[STEP]();
