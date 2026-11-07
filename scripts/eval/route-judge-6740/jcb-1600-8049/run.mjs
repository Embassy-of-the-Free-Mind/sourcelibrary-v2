// PRIOR ART: scripts/eval/route-judge-6740/cheap-routes-7701/run.mjs (#7701's cell tests: one unread page per book, the
// written set from cli-ocr.mjs apply's own GPU-draft guards in a dry run, blind packet with wrong-page and planted
// controls, Beta(1+k,1+n-k) rule; its dryApply / packet / plant / score code is followed here) and judge.mjs (its
// `judge` stage, called unchanged); en-pre1800-gpu-6871/run.mjs (a GPU cell on pre-1800 print). They do not fit as is:
// their frames are visible scans-only books drawn by judge.mjs draw, and their Latin cell is the only GPU-draft route.
// This draws from the #8049 JCB pre-1600 campaign (hidden, held books, tiers A/B of the content screen), eight languages,
// one GPU draft engine a language (la PERO-OCR as the armc lane; every other language LightOnOCR-3-1B as euro-draft-task
// reads Italian), and every route is the same shape: GPU draft > agy Flash-low with the image, one page a call.
/**
 * #8049 cell test: first reads of pre-1600 print (the JCB scans) by GPU draft > agy Flash-low, per language, before the
 * language's pages are queued. RULE.md beside the results fixes the decision.
 *
 *   node --env-file=… run.mjs draw    --out=DIR [--tiers=FILE] [--cells=la,..] [--exclude-from=<DIR0>/sample.json]  30 pages a language (one a book; a language with fewer
 *                                                               books takes a second page of a book), images to DIR/img,
 *                                                               engine stage dirs DIR/stage/{pero,lo} (hard links)
 *   (gex45) DIR/gpu-task.sh through /root/gpu-queue: PERO on stage/pero, LightOnOCR on stage/lo
 *   node run.mjs collect  --out=DIR                             engine outputs → DIR/drafts-<cell>.json (gpu-draft format)
 *   node --env-file=… run.mjs read    --out=DIR [--cell=X]      cli-ocr.mjs read --correct-prompt --gpu-draft (agy)
 *   node --env-file=… run.mjs written --out=DIR                 dry apply: what the lane would WRITE (--diff-guard=gpu-draft)
 *   node --env-file=… run.mjs packet  --out=DIR                 blind items + 2 wrong-page controls a cell
 *   ROUTE_JUDGE_WEEKLY_MAX=999 node judge.mjs judge --out=DIR   (judge.mjs, unchanged; Opus through claude -p)
 *   node run.mjs plant    --out=DIR ; judge again               2 planted items a cell
 *   node run.mjs score    --out=DIR                             RULE.md's measures → DIR/score.json
 *   node --env-file=… run.mjs apply   --out=DIR [--apply]       write each test page's ACCEPTED read (first reads only,
 *                                                               holds kept); a rejected page stays unread
 * Read-only except `apply --apply`.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../../lib/paired-stats.mjs';
import { plantError, langCode } from '../../lib/plant-ocr-errors.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const STAGE = process.argv[2];
const OUT = path.resolve(arg('out') || '.');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const CLI_OCR = path.join(ROOT, 'scripts/batch/cli-ocr.mjs');
// --study=euro-6871 (#6871): the same route and stages over French, Spanish and Italian print of 1600-1799 and
// 1800-1929 drawn from Mongo (drawEuro), not the JCB tiers file. Everything else (read, written, packet, plant, score,
// apply) is shared; the salts, lane id, job name and apply reason come from the study.
const STUDY = arg('study') || 'jcb-8049';
const STUDIES = {
  'jcb-8049': { salt: '8049', lane: 'gpu-agy-first-read-jcb-8049', job: 'jcb-1600-8049-cell', reason: '#8049 JCB pre-1600 cell test' },
  'euro-6871': { salt: '6871', lane: 'gpu-agy-first-read-euro-6871', job: 'euro-1800-cells-6871', reason: '#6871 French/Spanish/Italian 1600-1929 cell test' },
};
const ST = STUDIES[STUDY]; if (!ST) throw new Error(`--study must be one of ${Object.keys(STUDIES).join(', ')}`);
const LANE = ST.lane;
const MODEL = 'gemini-3.8-flash-low';   // cli-ocr-lane.mjs CORRECT_MODEL
const TEMPLATE = { file: 'scripts/eval/euro-gpu-correct-7567/prompts/agy-0601ef30e816f7a7.txt', hash: '0601ef30e816f7a7' };   // GPU_TEMPLATE
const N = Number(arg('n') || 30);

// One route a cell: <engine> > agy-flash-low, one page a call. la = PERO (the armc / first-read lane's engine, #7701
// 18/18); every other language = LightOnOCR-3-1B (the armc Italian engine; the router's next test for German fraktur,
// lighton>agy-flash-low@4-written). Czech (2 books), Nahuatl (1) and Greek have no cell: too few books to test.
export const CELLS = {
  la: { lang: 'Latin', engine: 'pero' }, es: { lang: 'Spanish', engine: 'lo' }, it: { lang: 'Italian', engine: 'lo' },
  fr: { lang: 'French', engine: 'lo' }, de: { lang: 'German', engine: 'lo' }, en: { lang: 'English', engine: 'lo' },
  nl: { lang: 'Dutch', engine: 'lo' }, pt: { lang: 'Portuguese', engine: 'lo' },
  // The fallback cell (stage `fallback`): the Latin pages the GPU-draft route left UNWRITTEN, read with no draft by the
  // router's Latin print alternative, agy-flash-low four consecutive pages a call (the drawn page and the next three of
  // its book; only the drawn page is judged).
  la4: { lang: 'Latin', engine: 'none', perCall: 4 },
};
// #6871 cells: language (the book's first language, ISO 639-3) and the parsed `year` range, both ends included.
const EURO_CELLS = {
  fr19: { lang: 'French', code: 'fra', years: [1800, 1929], engine: 'lo' }, fr17: { lang: 'French', code: 'fra', years: [1600, 1799], engine: 'lo' },
  es19: { lang: 'Spanish', code: 'spa', years: [1800, 1929], engine: 'lo' }, es17: { lang: 'Spanish', code: 'spa', years: [1600, 1799], engine: 'lo' },
  it19: { lang: 'Italian', code: 'ita', years: [1800, 1929], engine: 'lo' }, it17: { lang: 'Italian', code: 'ita', years: [1600, 1799], engine: 'lo' },
};
if (STUDY === 'euro-6871') { for (const k of Object.keys(CELLS)) delete CELLS[k]; Object.assign(CELLS, EURO_CELLS); }
const routeOf = (cell) => (CELLS[cell].engine === 'none' ? `agy-flash-low@${CELLS[cell].perCall}` : `${CELLS[cell].engine === 'pero' ? 'pero' : 'lighton'}>agy-flash-low`);
const corrDir = (cell) => path.join(OUT, 'corr', cell);

/** cli-ocr-lane.mjs armcDraftText, copied (importing the lane module would run its CLI): the GPU read as the lane sends it. */
function armcDraftText(t) {
  t = String(t || '').replace(/^\s*```[a-zA-Z]*\s*$/gm, '');
  if (/<HistoricalDocument|<Metadata>/.test(t)) {
    t = t.replace(/<Metadata>[\s\S]*?<\/Metadata>/g, '').replace(/<\/(Line|Paragraph|Heading|PageNumber|Header|Footer)>/g, '\n')
      .replace(/<[^>\n]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n\s*\n\s*\n+/g, '\n\n')
      .split('\n').map((l) => l.trim()).join('\n');
  }
  return t.trim();
}

async function mongo() { const { MongoClient } = await import('mongodb'); const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); return c; }

/**
 * #6871 frame (drawEuro): a printed book whose first language is the cell's, with a parsed `year` in the cell's range
 * (no year, no book), whose page records exist (pages_state not manifest_only: a lazy book has no page docs, and making
 * them is a state change this test does not make), not an unsplit spread (needs_splitting and not split_completed), not
 * a manuscript (cli-ocr-lane manuscriptReason), and not held, or held only scans-only-publish-7270 (a publishing hold
 * with no lane of its own). Other holds belong to a lane, a campaign, a containment or a person, and are counted, not
 * drawn. One page a book: a page with no text and no human edit, between 5% and 95% of the book, seeded.
 */
const EURO_HOLDS_DRAWN = new Set(['scans-only-publish-7270']);
async function drawEuro() {
  const { getPageSource } = await import('../../../lib/page-image-url.mjs');
  const { isHeld, isUnsplitSpread } = await import('../../../lib/pipeline-hold.mjs');
  const { manuscriptReason, firstReadLanguage, UNREAD } = await import('../../../batch/cli-ocr-lane.mjs');
  const { hasNoText, isHumanEdited } = await import('../../../lib/gpu-print-lane.mjs');
  const c = await mongo(), db = c.db('bookstore');
  const sample = { drawn_at: new Date().toISOString(), study: STUDY, cells: {}, frame: {} };
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  const EX = arg('exclude-from') ? new Set(Object.values(JSON.parse(fs.readFileSync(arg('exclude-from'), 'utf8')).cells).flatMap((x) => x.pages.map((p) => p.book_id))) : new Set();
  for (const [cell, C] of Object.entries(CELLS).filter(([k]) => !arg('cells') || arg('cells').split(',').includes(k))) {
    const all = await db.collection('books').find({ language: { $regex: `^${C.lang}` }, year: { $gte: C.years[0], $lte: C.years[1] }, pages_count: { $gt: 0 }, 'pages_state.state': { $nin: ['manifest_only', 'materializing'] } },
      { projection: { id: 1, title: 1, published: 1, language: 1, year: 1, pages_count: 1, pages_ocr: 1, image_source: 1, pipeline_auto: 1, needs_splitting: 1, split_completed: 1, visible: 1 } }).toArray();
    const t = { books: all.length, other_language_first: 0, unsplit_spread: 0, manuscript: 0, other_hold: {}, sampled_before: 0, in_frame: 0, owed_by_counter: 0, walked: 0, no_interior_unread: 0, no_image: 0 };
    const frame = [];
    for (const b of all) {
      if (firstReadLanguage(b) !== C.code) { t.other_language_first++; continue; }
      if (isUnsplitSpread(b)) { t.unsplit_spread++; continue; }
      if (manuscriptReason(b)) { t.manuscript++; continue; }
      const hold = isHeld(b) ? b.pipeline_auto.hold.reason : (b.pipeline_auto?.held === true ? 'held-flag' : null);
      if (hold && !EURO_HOLDS_DRAWN.has(hold)) { t.other_hold[hold] = (t.other_hold[hold] ?? 0) + 1; continue; }
      if (EX.has(b.id)) { t.sampled_before++; continue; }
      t.in_frame++; t.owed_by_counter += Math.max(0, b.pages_count - (b.pages_ocr || 0));
      frame.push({ ...b, hold });
    }
    frame.sort((a, b) => h(`${ST.salt}-${cell}-${a.id}`).localeCompare(h(`${ST.salt}-${cell}-${b.id}`)));
    const picks = [];
    for (const b of frame) {
      if (picks.length >= N) break;
      t.walked++;
      const unread = (await db.collection('pages').find({ book_id: b.id, ...UNREAD }, { projection: { _id: 0, id: 1, page_number: 1, ocr: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1 } }).sort({ page_number: 1 }).toArray())
        .filter((p) => hasNoText(p.ocr) && !isHumanEdited(p.ocr) && p.page_number > 0.05 * b.pages_count && p.page_number <= 0.95 * b.pages_count);
      if (!unread.length) { t.no_interior_unread++; continue; }
      const rng = makeRng(parseInt(h(`${ST.salt}-${cell}-${b.id}-page`).slice(0, 8), 16));
      const p = unread[Math.floor(rng() * unread.length)];
      const img = path.join(OUT, 'img', `${p.id}.jpg`);
      if (!fs.existsSync(img)) {
        const r = await fetch(getPageSource(p)).catch(() => null);
        if (!r?.ok) { t.no_image++; console.log(`  ${cell} ${p.id}: no image (${r?.status})`); continue; }
        fs.writeFileSync(img, Buffer.from(await r.arrayBuffer()));
        await new Promise((res) => setTimeout(res, 500));
      }
      picks.push({ page_id: p.id, book_id: b.id, page_number: p.page_number, year: b.year, hold: b.hold, visible: !!b.visible, provider: b.image_source?.provider ?? null, title: String(b.title || '').slice(0, 80) });
    }
    sample.cells[cell] = { lang: C.lang, years: C.years, engine: C.engine, route: routeOf(cell), books: picks.length, pages: picks };
    sample.frame[cell] = t;
    const st = path.join(OUT, 'stage', C.engine); fs.mkdirSync(st, { recursive: true });
    for (const x of picks) { try { fs.linkSync(path.join(OUT, 'img', `${x.page_id}.jpg`), path.join(st, `${x.page_id}.jpg`)); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    console.log(`${cell} ${C.lang} ${C.years.join('-')}: ${picks.length} pages from ${t.in_frame} books in frame (${t.owed_by_counter} pages owed by counter)`, JSON.stringify(t));
  }
  await c.close();
  W('sample.json', sample);
}

/** draw: tiers A/B only (what will be read); A: an interior page, B: a page the screen hit. Unread pages only. */
async function draw() {
  if (STUDY === 'euro-6871') return drawEuro();
  const { getPageSource } = await import('../../../lib/page-image-url.mjs');
  const tiers = jsonl(arg('tiers') || path.join(process.env.JOB_SCRATCH || '.', 's5/tiers/tiers-abc.jsonl')).filter((t) => t.tier === 'A' || t.tier === 'B');
  const c = await mongo(), db = c.db('bookstore');
  const sample = { drawn_at: new Date().toISOString(), cells: {} };
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  // --exclude-from=<an earlier sample.json>: a second draw for a cell whose written n was too small, from NEW books
  const EX = arg('exclude-from') ? new Set(Object.values(JSON.parse(fs.readFileSync(arg('exclude-from'), 'utf8')).cells).flatMap((c) => c.pages.map((p) => p.book_id))) : new Set();
  for (const [cell, C] of Object.entries(CELLS).filter(([c]) => !arg('cells') || arg('cells').split(',').includes(c))) {
    const books = tiers.filter((t) => t.language === C.lang && !EX.has(t.book_id)).sort((a, b) => h(`${ST.salt}-${a.book_id}`).localeCompare(h(`${ST.salt}-${b.book_id}`)));
    const picks = [];
    for (let round = 0; picks.length < N && round < 3; round++) {
      for (const t of books) {
        if (picks.length >= N) break;
        const pages = await db.collection('pages').find({ book_id: t.book_id }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1 } }).sort({ page_number: 1 }).toArray();
        const n = pages.length; if (n < 8) continue;
        let idx = t.tier === 'B' && t.ocr_idx?.length ? t.ocr_idx.filter((i) => i >= 2 && i < n - 2) : [];
        if (!idx.length) idx = Array.from({ length: n }, (_, i) => i).filter((i) => i >= Math.floor(0.2 * n) && i <= Math.floor(0.8 * n));
        const rng = makeRng(parseInt(h(`${ST.salt}-${t.book_id}-${round}`).slice(0, 8), 16));
        const p = pages[idx[Math.floor(rng() * idx.length)]];
        if (!p || p.ocr?.data || picks.some((x) => x.page_id === p.id)) continue;
        const img = path.join(OUT, 'img', `${p.id}.jpg`);
        if (!fs.existsSync(img)) {
          const r = await fetch(getPageSource(p)).catch(() => null);
          if (!r?.ok) { console.log(`  ${cell} ${p.id}: no image (${r?.status})`); continue; }
          fs.writeFileSync(img, Buffer.from(await r.arrayBuffer()));
          await new Promise((res) => setTimeout(res, 500));   // polite to archive.org
        }
        picks.push({ page_id: p.id, book_id: t.book_id, page_number: p.page_number, tier: t.tier, round, ia: t.ia });
      }
    }
    sample.cells[cell] = { lang: C.lang, engine: C.engine, route: routeOf(cell), books: new Set(picks.map((x) => x.book_id)).size, pages: picks };
    const st = path.join(OUT, 'stage', C.engine); fs.mkdirSync(st, { recursive: true });
    for (const x of picks) { try { fs.linkSync(path.join(OUT, 'img', `${x.page_id}.jpg`), path.join(st, `${x.page_id}.jpg`)); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    console.log(`${cell} ${C.lang}: ${picks.length} pages from ${sample.cells[cell].books} books (${books.length} A/B books)`);
  }
  await c.close();
  W('sample.json', sample);
}

/** collect: PERO's JSON and LightOnOCR's JSONL → one gpu-draft file a cell ({_engine, <page_id>: {text, image_sha256}}). */
async function collect() {
  const s = J('sample.json');
  const sha = (id) => crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, 'img', `${id}.jpg`))).digest('hex');   // the raw bytes: h() would String() them
  const pero = fs.existsSync(path.join(OUT, 'gpu/pero.json')) ? J('gpu/pero.json') : null;
  const lo = jsonl(path.join(OUT, 'gpu/out/LO.jsonl'));
  const loEngine = { name: 'lightonocr', model: 'lightonai/LightOnOCR-3-1B', ...(fs.existsSync(path.join(OUT, 'gpu/out-LO.engine.json')) ? J('gpu/out-LO.engine.json') : {}) };
  for (const [cell, C] of Object.entries(s.cells)) {
    const d = { _engine: C.engine === 'pero' ? pero?._engine : loEngine };
    const src = C.engine === 'pero' ? new Map(Object.entries(pero || {}).filter(([k]) => k !== '_engine').map(([k, v]) => [k, v.text])) : new Map(lo.filter((r) => !r.error).map((r) => [r.page_id, r.text]));
    for (const p of C.pages) if (src.has(p.page_id)) d[p.page_id] = { text: armcDraftText(src.get(p.page_id)), image_sha256: C.engine === 'pero' ? pero[p.page_id].image_sha256 : sha(p.page_id) };
    W(`drafts-${cell}.json`, d);
    console.log(`${cell}: ${Object.keys(d).length - 1}/${C.pages.length} drafts, ${Object.entries(d).filter(([k, v]) => k !== '_engine' && v.text.replace(/\W/g, '').length < 30).length} under 30 word characters`);
  }
}

function read() {
  const s = J('sample.json');
  const tpl = path.join(OUT, `gpu-correct-prompt-${TEMPLATE.hash}.txt`);
  const text = fs.readFileSync(path.join(ROOT, TEMPLATE.file), 'utf8');
  if (h(text).slice(0, 16) !== TEMPLATE.hash) throw new Error('template hash mismatch');
  fs.writeFileSync(tpl, text);
  for (const cell of Object.keys(s.cells).filter((c) => !arg('cell') || arg('cell') === c)) {
    if (CELLS[cell].engine === 'none') {
      const dir = corrDir(cell); fs.mkdirSync(dir, { recursive: true });
      const idf = path.join(dir, 'page-ids.json'); fs.writeFileSync(idf, JSON.stringify(s.cells[cell].read_ids));
      console.log(`${cell}: reading ${s.cells[cell].read_ids.length} pages, ${CELLS[cell].perCall} a call`);
      const r = spawnSync(process.execPath, ['--no-warnings', CLI_OCR, 'read', `--page-ids-file=${idf}`, `--out=${dir}`, `--model=${MODEL}`, `--per-call=${CELLS[cell].perCall}`, `--job=${ST.job}`, '--stop-on-quota', `--concurrency=${arg('concurrency') || 2}`], { cwd: ROOT, env: process.env, stdio: 'inherit' });
      if (r.status !== 0) console.log(`${cell}: read exit ${r.status}`);
      continue;
    }
    const d = J(`drafts-${cell}.json`);
    const ids = s.cells[cell].pages.map((p) => p.page_id).filter((id) => d[id] && d[id].text.replace(/\W/g, '').length >= 30);
    const dir = corrDir(cell); fs.mkdirSync(dir, { recursive: true });
    const idf = path.join(dir, 'page-ids.json'); fs.writeFileSync(idf, JSON.stringify(ids));
    console.log(`${cell}: reading ${ids.length} pages`);
    const r = spawnSync(process.execPath, ['--no-warnings', CLI_OCR, 'read', `--page-ids-file=${idf}`, `--out=${dir}`, `--model=${MODEL}`, `--correct-prompt=${tpl}`, `--lane=${LANE}`, `--gpu-draft=${path.join(OUT, `drafts-${cell}.json`)}`, `--image-dir=${path.join(OUT, 'img')}`, `--job=${ST.job}`, '--stop-on-quota', `--concurrency=${arg('concurrency') || 2}`], { cwd: ROOT, env: process.env, stdio: 'inherit' });
    if (r.status !== 0) console.log(`${cell}: read exit ${r.status}`);
  }
}

function dryApply(cell, ids) {
  const guard = CELLS[cell].engine === 'none' ? [] : ['--diff-guard=gpu-draft'];
  const dir = corrDir(cell), emit = path.join(dir, 'written-dry.jsonl'), only = path.join(dir, 'only-drawn.json');
  fs.rmSync(emit, { force: true }); fs.writeFileSync(only, JSON.stringify(ids));
  const r = spawnSync(process.execPath, ['--no-warnings', CLI_OCR, 'apply', `--out=${dir}`, `--only=${only}`, `--reason=${ST.reason} (dry run)`, `--emit-written=${emit}`, ...guard, '--print-only'], { cwd: ROOT, env: process.env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`apply ${cell}: exit ${r.status}\n${r.stderr?.slice(-2000)}`);
  const sum = JSON.parse(fs.readFileSync(path.join(dir, 'apply-summary-dry.json'), 'utf8'));
  return { rows: new Map(jsonl(emit).map((x) => [x.page_id, x.text])), skipped: sum.skipped_pages || {}, diff_guard: sum.diff_guard ?? null };
}

function written() {
  const s = J('sample.json'), out = {};
  for (const cell of Object.keys(s.cells)) {
    if (!fs.existsSync(corrDir(cell))) continue;
    const ids = s.cells[cell].pages.map((p) => p.page_id);
    const d = dryApply(cell, ids);
    out[cell] = Object.fromEntries(ids.map((id) => [id, d.rows.has(id) ? { text: d.rows.get(id) } : { why: d.skipped[id] ?? 'not read (no draft, or the read failed)' }]));
    if (d.diff_guard) out[`${cell}#diff_guard`] = d.diff_guard;
    console.log(`${cell}: written ${d.rows.size}/${ids.length}`);
  }
  W('written.json', out);
}

function shuffled(xs, salt) { return [...xs].sort((a, b) => h(salt + JSON.stringify(a.id ?? a)).localeCompare(h(salt + JSON.stringify(b.id ?? b)))); }

async function packet() {
  const { getPageSource } = await import('../../../lib/page-image-url.mjs');
  const s = J('sample.json'), wr = J('written.json');
  if (fs.existsSync(path.join(OUT, 'key.json')) && J('key.json').some((k) => k.kind === 'planted')) throw new Error('packet: planted items exist; rebuilding would drop them');
  const all = Object.values(s.cells).flatMap((c) => c.pages.map((p) => p.page_id));
  const c = await mongo();
  const pages = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: all } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1 } }).toArray()).map((p) => [p.id, p]));
  await c.close();
  const items = new Map(), key = [];
  const add = (cell, sp, kind, text, extra = {}) => {
    const tag = kind === 'item' ? `${cell}:${sp.page_id}:${h(text.trim())}` : `${kind}:${cell}:${sp.page_id}:${extra.other ?? ''}`;
    const id = `j${h(tag).slice(0, 10)}`;
    if (!items.has(id)) items.set(id, { id, task: 'ocr', lang: CELLS[cell].lang, image_url: getPageSource(pages.get(sp.page_id)), text });
    key.push({ id: `k${h(`${kind}:${cell}:${sp.page_id}:${extra.other ?? ''}`).slice(0, 10)}`, judged_as: id, cell, route: routeOf(cell), kind, page_id: sp.page_id, book_id: sp.book_id, page_number: sp.page_number, ...extra });
  };
  for (const cell of Object.keys(s.cells).filter((c) => wr[c])) {
    const ok = s.cells[cell].pages.filter((sp) => wr[cell][sp.page_id]?.text);
    for (const sp of ok) add(cell, sp, 'item', wr[cell][sp.page_id].text);
    const rng = makeRng(parseInt(h(`wp-${ST.salt}-${cell}`).slice(0, 8), 16));
    for (let i = 0; i < 2 && new Set(ok.map((x) => x.book_id)).size > 2; i++) {
      const a = ok[Math.floor(rng() * ok.length)]; let b = a;
      while (b.book_id === a.book_id) b = ok[Math.floor(rng() * ok.length)];
      add(cell, a, 'wrong_page', wr[cell][b.page_id].text, { other: b.page_id });
    }
  }
  W('packet.json', { built_at: new Date().toISOString(), items: shuffled([...items.values()], `pk-${ST.salt}`) });
  W('key.json', key);
  console.log(`${items.size} items to judge (${key.filter((k) => k.kind === 'wrong_page').length} wrong-page controls)`);
}

const verdicts = () => new Map(jsonl(path.join(OUT, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));

function plant() {
  const key = J('key.json'), pk = J('packet.json'), V = verdicts();
  if (key.some((k) => k.kind === 'planted')) { console.log('planted items already in the packet'); return; }
  const kinds = ['B', 'C', 'D', 'E']; let slot = 0;
  for (const cell of Object.keys(CELLS)) {
    // the planter knows Latin, German and French only: the other cells carry no plants (the judge's sensitivity is measured on those three)
    if (!langCode(CELLS[cell].lang)) { console.log(`${cell}: no planter for ${CELLS[cell].lang}, none planted`); continue; }
    const acc = shuffled(key.filter((k) => k.cell === cell && k.kind === 'item' && V.get(k.judged_as)?.accept), `plant-${ST.salt}-${cell}`);
    let got = 0;
    for (const k of acc) {
      if (got >= 2) break;
      const it = pk.items.find((x) => x.id === k.judged_as);
      for (let tries = 0; tries < 4; tries++) {
        const kind = kinds[(slot + tries) % 4];
        const p = plantError(it.text, { kind, lang: CELLS[cell].lang, seed: parseInt(h(`${k.judged_as}${kind}`).slice(0, 8), 16) });
        if (!p) continue;
        const id = `j${h(`planted:${k.judged_as}:${kind}`).slice(0, 10)}`;
        pk.items.push({ id, task: 'ocr', lang: CELLS[cell].lang, image_url: it.image_url, text: p.text });
        key.push({ id: `k${h(`planted:${cell}:${k.page_id}:${kind}`).slice(0, 10)}`, judged_as: id, cell, route: k.route, kind: 'planted', page_id: k.page_id, book_id: k.book_id, source_item: k.judged_as, plant: p.plant });
        got++; slot++; break;
      }
    }
    console.log(`${cell}: ${got} planted`);
  }
  pk.items = shuffled(pk.items, `pk-${ST.salt}-planted`);
  W('packet.json', pk); W('key.json', key);
}

function betaP(k, n, thr, seed) {
  const rnd = makeRng(seed);
  const normal = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const gamma = (a) => { if (a < 1) return gamma(a + 1) * rnd() ** (1 / a); const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { x = normal(); v = 1 + c * x; } while (v <= 0); v = v ** 3; const u = rnd(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; } };
  let hit = 0; const M = 40000; for (let i = 0; i < M; i++) { const a = gamma(1 + k), b = gamma(1 + n - k); if (a / (a + b) >= thr) hit++; }
  return +(hit / M).toFixed(3);
}
const wt = (v) => (v?.defects || []).some((d) => d.severity === 'wrong_text');

/** score: RULE.md. (a) every drawn page; (b) the written pages. Eligible on (b): wrong text <= 4%, P(acc >= 0.8) >= 0.9, controls. */
function score() {
  const s = J('sample.json'), wr = J('written.json'), key = J('key.json'), V = verdicts(), out = { scored_at: new Date().toISOString(), cells: {} };
  for (const [cell, C] of Object.entries(s.cells)) {
    const rows = key.filter((k) => k.cell === cell);
    const items = rows.filter((k) => k.kind === 'item');
    const judged = items.filter((k) => V.has(k.judged_as));
    const acc = judged.filter((k) => V.get(k.judged_as).accept).length, wrong = judged.filter((k) => wt(V.get(k.judged_as))).length;
    const wp = rows.filter((k) => k.kind === 'wrong_page'), wpOk = wp.length > 0 && wp.every((k) => V.has(k.judged_as) && !V.get(k.judged_as).accept && (V.get(k.judged_as).fidelity ?? 0) <= 2);
    const pl = rows.filter((k) => k.kind === 'planted'), plCaught = pl.filter((k) => V.has(k.judged_as) && (!V.get(k.judged_as).accept || (V.get(k.judged_as).defects || []).length)).length;
    const n = judged.length, P = betaP(acc, n, 0.8, parseInt(h(`s-${cell}`).slice(0, 8), 16));
    const writtenN = Object.values(wr[cell] || {}).filter((x) => x.text).length;
    const eligible = n >= 10 && wrong / n <= 0.04 && P >= 0.9 && wpOk && !(pl.length === 2 && plCaught === 0);
    out.cells[cell] = { lang: C.lang, route: C.route, drawn: C.pages.length, books: C.books, written: writtenN, judged: n, accepted: acc, wrong_text: wrong, p_acc_ge_08: P, all_drawn_accepted: `${acc}/${C.pages.length}`, wrong_page_controls: `${wp.filter((k) => V.has(k.judged_as) && !V.get(k.judged_as).accept).length}/${wp.length}`, planted_caught: `${plCaught}/${pl.length}`, decision: eligible ? 'PASS: schedule' : 'HOLD', why: eligible ? null : [n < 10 && 'under 10 judged', n && wrong / n > 0.04 && `wrong text ${wrong}/${n}`, P < 0.9 && `P(acc>=0.8) ${P}`, !wpOk && 'wrong-page control', pl.length === 2 && !plCaught && 'both plants missed'].filter(Boolean).join('; ') };
    console.log(`${cell} ${C.lang} ${C.route}: written ${writtenN}/${C.pages.length}, accepted ${acc}/${n} judged, wrong text ${wrong}, P ${P}, wp ${out.cells[cell].wrong_page_controls}, plants ${plCaught}/${pl.length} → ${out.cells[cell].decision}${out.cells[cell].why ? ` (${out.cells[cell].why})` : ''}`);
  }
  W('score.json', out);
}

/** apply: each test page's read the judge ACCEPTED, through the lane's GPU-draft guards (first reads only; holds kept). */
function apply() {
  const key = J('key.json'), V = verdicts(), s = J('sample.json');
  for (const cell of Object.keys(s.cells)) {
    const ids = key.filter((k) => k.cell === cell && k.kind === 'item' && V.get(k.judged_as)?.accept).map((k) => k.page_id);
    if (!ids.length) continue;
    const only = path.join(corrDir(cell), 'accepted.json'); fs.writeFileSync(only, JSON.stringify(ids));
    const r = spawnSync(process.execPath, ['--no-warnings', CLI_OCR, 'apply', `--out=${corrDir(cell)}`, `--only=${only}`, `--reason=${ST.reason}: judge-accepted reads`, ...(CELLS[cell].engine === 'none' ? [] : ['--diff-guard=gpu-draft']), '--print-only', ...(process.argv.includes('--apply') ? ['--apply'] : [])], { cwd: ROOT, env: process.env, encoding: 'utf8' });
    console.log(`${cell}: ${ids.length} accepted → apply exit ${r.status}${r.status ? `\n${r.stderr?.slice(-800)}` : ''}`);
  }
}

/**
 * record --out=DIR[,DIR2] [--apply]: every judged ITEM (not a control or a plant) as a recordPageVerdicts() page, method
 * euro-gpu-agy-cell-6871 (scripts/eval/methods/). Dry run unless --apply. Serious: not accepted, or a wrong_text / misleads
 * defect; minor: accepted with cosmetic defects only.
 */
async function record() {
  const METHOD = 'euro-gpu-agy-cell-6871';
  if (STUDY !== 'euro-6871') throw new Error('record is for --study=euro-6871 (its method file)');
  const { recordPageVerdicts, readMethod } = await import('../../../lib/book-checks.mjs');
  const dirs = String(arg('out')).split(',').map((d) => path.resolve(d));
  const verdicts = [];
  let model = null;
  for (const dir of dirs) {
    const key = JSON.parse(fs.readFileSync(path.join(dir, 'key.json'), 'utf8'));
    const items = new Map(JSON.parse(fs.readFileSync(path.join(dir, 'packet.json'), 'utf8')).items.map((i) => [i.id, i]));
    const V = new Map(jsonl(path.join(dir, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r]));
    for (const k of key.filter((x) => x.kind === 'item' && V.has(x.judged_as))) {
      const r = V.get(k.judged_as), v = r.verdict; model ??= r.model;
      const bad = (v.defects || []).filter((d) => d.severity === 'wrong_text' || d.severity === 'misleads');
      const serious = !v.accept || bad.length > 0;
      const errors = serious ? (bad.length ? bad.map((d) => ({ stage: 'ocr', class: d.class, kind: d.severity, problem: `${d.what ?? ''}: "${String(d.quote ?? '').slice(0, 200)}"` }))
        : [{ stage: 'ocr', kind: 'not_accepted', problem: String(v.reader_note || 'the judge did not accept the page').slice(0, 600) }]) : [];
      verdicts.push({ page_id: k.page_id, outcome: serious ? 'serious' : (v.defects || []).length ? 'minor' : 'clean', page_verdict: serious ? 'fix' : (v.defects || []).length ? 'caveat' : 'show',
        verdict: `${k.cell} accept=${v.accept} fidelity=${v.fidelity}`, note: v.reader_note, defects: v.defects || [], errors, judged: { ocr: items.get(k.judged_as)?.text ?? '', translation: '' } });
    }
  }
  const c = await mongo();
  try {
    const res = await recordPageVerdicts(c.db('bookstore'), {
      method_id: METHOD, method_version: readMethod(METHOD).version, run_id: `${ST.job}-${new Date().toISOString().slice(0, 10)}`, checked_at: new Date(),
      selection: 'random', stages: ['ocr'], reader: { kind: 'model', model: model ?? 'claude -p --model opus', image_opened: true },
      evidence_path: 'scripts/eval/route-judge-6740/results/euro-gpu-agy-cells-6871/', reader_warning: false, exposure: 'unrecorded',
      note: 'One unread page of the book read by LightOnOCR-3-1B > agy Gemini 3.8 Flash-low with the image (#6871 cell test), judged blind by Opus against the image.',
      frame: { route: 'lighton>agy-flash-low', study: STUDY, pages: verdicts.length },
      verdicts,
    }, { apply: process.argv.includes('--apply') });
    console.log(`record: ${verdicts.length} pages → rows ${res.rows.length}, inserted ${res.inserted}, already ${res.already}, failed ${res.failed.length}${res.failed.length ? ` ${JSON.stringify(res.failed.slice(0, 5))}` : ''}`);
  } finally { await c.close(); }
}

/** fallback --out=DIR --from=D1,D2: the la pages D1..Dn's GPU-draft route did not WRITE, as cell la4; each with the next
 *  three pages of its book that still have no OCR, so a 4-a-call read sees the page among its neighbours. */
async function fallback() {
  const from = String(arg('from') || '').split(',').filter(Boolean).map((d) => path.resolve(d));
  const pages = from.flatMap((d) => { const s = JSON.parse(fs.readFileSync(path.join(d, 'sample.json'), 'utf8')), w = JSON.parse(fs.readFileSync(path.join(d, 'written.json'), 'utf8')).la || {};
    return s.cells.la.pages.filter((p) => !w[p.page_id]?.text).map((p) => ({ ...p, gpu_route_why: w[p.page_id]?.why ?? null, from: path.basename(d) })); });
  const c = await mongo(), col = c.db('bookstore').collection('pages'), read_ids = [];
  for (const p of pages) {
    const next = await col.find({ book_id: p.book_id, page_number: { $gt: p.page_number, $lte: p.page_number + 3 } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
    read_ids.push(p.page_id);
    for (const q of next) { if (q.ocr?.data?.trim()) break; read_ids.push(q.id); }
  }
  await c.close();
  fs.mkdirSync(OUT, { recursive: true });
  W('sample.json', { drawn_at: new Date().toISOString(), from, cells: { la4: { lang: 'Latin', engine: 'none', route: routeOf('la4'), books: new Set(pages.map((p) => p.book_id)).size, pages, read_ids } } });
  console.log(`la4: ${pages.length} drawn pages, ${read_ids.length} to read`);
}

const STAGES = { draw, collect, read, written, packet, plant, score, apply, fallback, record };
if (!STAGES[STAGE]) { console.error(`stage must be one of ${Object.keys(STAGES).join(', ')}`); process.exit(2); }
await STAGES[STAGE]();
