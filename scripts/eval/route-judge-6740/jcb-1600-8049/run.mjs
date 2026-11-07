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
 *   node run.mjs pooled   --out=DIR,DIR2                        a first and second draw scored together → DIR/pooled.json
 *   node --env-file=… run.mjs apply   --out=DIR [--apply]       write each test page's ACCEPTED read (first reads only,
 *                                                               holds kept); a rejected page stays unread
 *   --study=euro-manifest-6871: draw [--dry] [--relay=root@host] materializes the sampled manifest-only books only
 *                                                               (drawManifest); probe --library=X fetches, writes nothing
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
  // --study=euro-manifest-6871: the same route over French 1800-1929 books held manifest-only-lazy-pages (e-rara, NB
  // Norway, IA, BSB), drawn by drawManifest, which materializes ONLY the sampled books (trigger below).
  'euro-manifest-6871': { salt: 'm6871', lane: 'gpu-agy-first-read-euro-manifest-6871', job: 'euro-manifest-sample-6871', reason: '#6871 French 1800-1929 manifest-only sample', trigger: 'eval-euro-manifest-6871', evidence: 'euro-manifest-sample-6871' },
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
if (STUDY === 'euro-manifest-6871') { for (const k of Object.keys(CELLS)) delete CELLS[k]; CELLS.frm19 = { ...EURO_CELLS.fr19 }; }
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

/**
 * #6871 manifest-only frame (drawManifest, --study=euro-manifest-6871): drawEuro's book filters, but over books whose
 * pages_state is manifest_only and whose ONLY hold is manifest-only-lazy-pages (no other hold, no pipeline_auto.held).
 * Pages are allotted to libraries (image_source.provider) by their share of the frame's pages (largest remainder), and a
 * library's books are walked in seeded order. For each book, BEFORE any state change: fetch its manifest, pick a body
 * page (canvas between 5% and 95%, seeded), fetch that page's image and refuse a multi-leaf frame (wider than 1.15x its
 * height). Only then materializePages() (trigger ST.trigger, fed the manifest already fetched, so it makes no second GET),
 * with the book's state recorded before and after. A book whose manifest or image cannot be fetched stays manifest-only
 * and is counted for its library. --relay=root@host: a GET this box is refused is retried over ssh curl from that host
 * (e-rara answers 403 to clawdbot). A host whose final fetch fails twice with the same error is dropped, and its pages
 * are drawn from the other libraries. --dry: everything but materializePages().
 */
const MANIFEST_HOLD = 'manifest-only-lazy-pages';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';
async function getBytes(url, relay) {
  let direct;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
    if (r.ok) return { buf: Buffer.from(await r.arrayBuffer()), via: 'direct' };
    direct = `HTTP ${r.status}`;
  } catch (e) { direct = String(e?.cause?.code || e?.message || e).slice(0, 120); }
  if (!relay) return { error: direct, direct_error: direct };
  if (/['\s]/.test(url)) throw new Error(`relay: unsafe url ${url}`);
  const r = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', relay, `curl -sS -f -A '${UA}' --max-time 90 '${url}'`], { maxBuffer: 256 << 20, timeout: 120_000 });
  if (r.status === 0 && r.stdout?.length) return { buf: r.stdout, via: 'relay', direct_error: direct };
  return { error: `relay: ${String(r.stderr || r.error || r.status).trim().replace(/^curl: \(\d+\) /, '').slice(0, 120)}`, direct_error: direct };
}
const snapshot = async (db, id) => {
  const b = await db.collection('books').findOne({ id }, { projection: { _id: 0, pages_state: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold.reason': 1, 'pipeline_auto.held': 1, pages_count: 1, pages_ocr: 1, pages_archived: 1, pages_translated: 1, visible: 1, hidden: 1, archive_status: 1, 'archive_metadata.blocked': 1, 'archive_metadata.blocked_reason': 1 } });
  return { ...b, page_docs: await db.collection('pages').countDocuments({ book_id: id }) };
};
async function drawManifest() {
  const { getCanvases } = await import('../../../iiif-discovery/lib/manifest-store.mjs');
  const { buildPageDocs, materializePages } = await import('../../../lib/lazy-pages.mjs');
  const { getPageSource } = await import('../../../lib/page-image-url.mjs');
  const { isHeld, isUnsplitSpread } = await import('../../../lib/pipeline-hold.mjs');
  const { manuscriptReason, firstReadLanguage } = await import('../../../batch/cli-ocr-lane.mjs');
  const sharp = (await import('sharp')).default;
  const DRY = process.argv.includes('--dry'), RELAY = arg('relay') || null;
  const [cell, C] = Object.entries(CELLS)[0];
  const c = await mongo(), db = c.db('bookstore');
  for (const d of ['img', 'manifests']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
  const EX = arg('exclude-from') ? new Set(Object.values(JSON.parse(fs.readFileSync(arg('exclude-from'), 'utf8')).cells).flatMap((x) => x.pages.map((p) => p.book_id))) : new Set();
  const all = await db.collection('books').find({ language: { $regex: `^${C.lang}` }, year: { $gte: C.years[0], $lte: C.years[1] }, pages_count: { $gt: 0 }, 'pages_state.state': 'manifest_only' },
    { projection: { id: 1, title: 1, published: 1, language: 1, year: 1, pages_count: 1, pages_state: 1, image_source: 1, pipeline_auto: 1, needs_splitting: 1, split_completed: 1, visible: 1 } }).toArray();
  const t = { books: all.length, other_language_first: 0, unsplit_spread: 0, manuscript: 0, other_hold: {}, failed_before: 0, sampled_before: 0, in_frame: 0, pages_in_frame: 0 };
  const byLib = new Map();
  for (const b of all) {
    if (firstReadLanguage(b) !== C.code) { t.other_language_first++; continue; }
    if (isUnsplitSpread(b)) { t.unsplit_spread++; continue; }
    if (manuscriptReason(b)) { t.manuscript++; continue; }
    const hold = isHeld(b) ? b.pipeline_auto.hold.reason : null;
    if (hold !== MANIFEST_HOLD || b.pipeline_auto?.held === true) { const k = b.pipeline_auto?.held === true ? 'held-flag' : (hold ?? 'not held'); t.other_hold[k] = (t.other_hold[k] ?? 0) + 1; continue; }
    if (b.pages_state?.failed_at) { t.failed_before++; continue; }   // an earlier materialize failed: its cooldown and its error are another run's
    if (EX.has(b.id)) { t.sampled_before++; continue; }
    t.in_frame++; t.pages_in_frame += b.pages_count;
    const lib = b.image_source?.provider ?? 'unknown';
    if (!byLib.has(lib)) byLib.set(lib, []);
    byLib.get(lib).push(b);
  }
  // largest-remainder allotment by pages
  const libs = [...byLib].map(([lib, bs]) => ({ lib, books: bs.sort((a, b) => h(`${ST.salt}-${cell}-${a.id}`).localeCompare(h(`${ST.salt}-${cell}-${b.id}`))), pages: bs.reduce((s, b) => s + b.pages_count, 0) })).sort((a, b) => b.pages - a.pages);
  for (const L of libs) { L.exact = (N * L.pages) / t.pages_in_frame; L.quota = Math.floor(L.exact); }
  for (const L of [...libs].sort((a, b) => (b.exact - b.quota) - (a.exact - a.quota)).slice(0, N - libs.reduce((s, L) => s + L.quota, 0))) L.quota++;
  const S = Object.fromEntries(libs.map((L) => [L.lib, { books: L.books.length, pages: L.pages, page_share: +(L.pages / t.pages_in_frame).toFixed(4), allotted: L.quota, walked: 0, manifest_failed: 0, no_body_page: 0, image_failed: 0, multi_leaf: 0, materialize_failed: 0, drawn: 0, via: {}, errors: [], host_dropped: null, bytes: 0, fetch_secs: 0 }]));
  const errSeen = new Map();   // host|error -> count
  const dead = new Set();
  const picks = [];
  const tryBook = async (L, b) => {
    const s = S[L.lib]; s.walked++;
    const host = (() => { try { return new URL(b.image_source.iiif_manifest).hostname; } catch { return 'none'; } })();
    const fail = (kind, err) => {
      s[kind]++; s.errors.push({ book_id: b.id, kind, error: err });
      const k = `${host}|${err}`; errSeen.set(k, (errSeen.get(k) ?? 0) + 1);
      if (errSeen.get(k) >= 2 && !dead.has(L.lib)) { dead.add(L.lib); s.host_dropped = `${host}: "${err}" twice`; console.log(`  ${L.lib}: host ${host} dropped (${err} twice)`); }
      return false;
    };
    const mf = path.join(OUT, 'manifests', `${b.id}.json`);
    let manifest;
    if (fs.existsSync(mf)) manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
    else {
      const t0 = Date.now(), r = await getBytes(b.image_source.iiif_manifest, RELAY);
      s.fetch_secs += (Date.now() - t0) / 1000;
      if (r.error) return fail('manifest_failed', r.error);
      try { manifest = JSON.parse(r.buf.toString('utf8')); } catch { return fail('manifest_failed', 'manifest not JSON'); }
      s.via[`manifest:${r.via}`] = (s.via[`manifest:${r.via}`] ?? 0) + 1;
      if (r.direct_error) s.via[`direct_refused:${r.direct_error}`] = (s.via[`direct_refused:${r.direct_error}`] ?? 0) + 1;
      fs.writeFileSync(mf, JSON.stringify(manifest));
      await new Promise((res) => setTimeout(res, 1000));
    }
    const n = getCanvases(manifest).length;
    const docs = buildPageDocs(b.id, manifest).filter((d) => d.page_number > 0.05 * n && d.page_number <= 0.95 * n && getPageSource(d));
    if (!docs.length) { s.no_body_page++; s.errors.push({ book_id: b.id, kind: 'no_body_page', error: `${n} canvases` }); return false; }
    const rng = makeRng(parseInt(h(`${ST.salt}-${cell}-${b.id}-page`).slice(0, 8), 16));
    const d = docs[Math.floor(rng() * docs.length)];
    const img = path.join(OUT, 'img', `${d.id}.jpg`);
    if (!fs.existsSync(img)) {
      const t0 = Date.now(), r = await getBytes(getPageSource(d), RELAY);
      s.fetch_secs += (Date.now() - t0) / 1000;
      if (r.error) return fail('image_failed', r.error);
      s.via[`image:${r.via}`] = (s.via[`image:${r.via}`] ?? 0) + 1; s.bytes += r.buf.length;
      fs.writeFileSync(img, r.buf);
      await new Promise((res) => setTimeout(res, 1000));
    }
    const meta = await sharp(img).metadata().catch(() => null);
    if (!meta?.width) { fs.rmSync(img); return fail('image_failed', 'not an image'); }
    if (meta.width > 1.15 * meta.height) { s.multi_leaf++; s.errors.push({ book_id: b.id, kind: 'multi_leaf', error: `${meta.width}x${meta.height}` }); fs.renameSync(img, `${img}.multileaf`); return false; }
    const before = await snapshot(db, b.id);
    let res = { status: 'dry_run' }, after = null;
    if (!DRY) {
      res = await materializePages(db, b.id, { trigger: ST.trigger, fetchManifest: async () => manifest });
      after = await snapshot(db, b.id);
      const pd = await db.collection('pages').findOne({ id: d.id, book_id: b.id }, { projection: { photo: 1, page_number: 1 } });
      if (res.status !== 'materialized' || !pd || pd.photo !== d.photo || pd.page_number !== d.page_number) {
        s.materialize_failed++; s.errors.push({ book_id: b.id, kind: 'materialize_failed', error: `${res.status} ${res.error ?? ''} page ${pd ? 'present' : 'absent'}` });
        return false;
      }
    }
    s.drawn++;
    picks.push({ page_id: d.id, book_id: b.id, page_number: d.page_number, canvases: n, pages_count: b.pages_count, year: b.year, hold: MANIFEST_HOLD, visible: !!b.visible, provider: L.lib, library: L.lib, title: String(b.title || '').slice(0, 80), width: meta.width, height: meta.height, bytes: fs.statSync(img).size, materialize: res.status, before, after });
    console.log(`  ${L.lib} ${b.id} p${d.page_number}/${n} ${meta.width}x${meta.height} → ${res.status}`);
    return true;
  };
  for (const L of libs) {
    let got = 0;
    for (const b of L.books) { if (got >= L.quota || dead.has(L.lib)) break; L.cursor = (L.cursor ?? 0) + 1; if (await tryBook(L, b)) got++; }
  }
  // a library that was dropped or ran out: its pages come from the rest, in allotment order, one book at a time
  for (let guard = 0; picks.length < N && guard < 10 * N; guard++) {
    const open = libs.filter((L) => !dead.has(L.lib) && (L.cursor ?? 0) < L.books.length);
    if (!open.length) break;
    const L = open[guard % open.length];
    const b = L.books[L.cursor ?? 0]; L.cursor = (L.cursor ?? 0) + 1;
    if (await tryBook(L, b)) S[L.lib].refilled = (S[L.lib].refilled ?? 0) + 1;
  }
  await c.close();
  const sample = { drawn_at: new Date().toISOString(), study: STUDY, trigger: ST.trigger, dry: DRY, relay: RELAY, frame: { [cell]: t }, libraries: S,
    cells: { [cell]: { lang: C.lang, years: C.years, engine: C.engine, route: routeOf(cell), books: picks.length, pages: picks } } };
  const st = path.join(OUT, 'stage', C.engine); fs.mkdirSync(st, { recursive: true });
  for (const x of picks) { try { fs.linkSync(path.join(OUT, 'img', `${x.page_id}.jpg`), path.join(st, `${x.page_id}.jpg`)); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
  W(DRY ? 'sample-dry.json' : 'sample.json', sample);
  console.log(`${cell}: ${picks.length} drawn${DRY ? ' (dry)' : ''} from ${t.in_frame} books / ${t.pages_in_frame} pages in frame`, JSON.stringify(t));
  for (const [lib, s] of Object.entries(S)) console.log(`  ${lib}: share ${s.page_share} allotted ${s.allotted} walked ${s.walked} drawn ${s.drawn} manifest_failed ${s.manifest_failed} image_failed ${s.image_failed} multi_leaf ${s.multi_leaf} ${JSON.stringify(s.via)}${s.host_dropped ? ` DROPPED ${s.host_dropped}` : ''}`);
}

/**
 * probe --out=DIR --library=bsb [--n=3] [--relay=..]: can this library be read at all? For n seeded frame books of the
 * library, one manifest GET and one body-page image GET each, timed. Nothing is written to Mongo and nothing is
 * materialized: for a library the proportional draw allots no page.
 */
async function probe() {
  const { buildPageDocs } = await import('../../../lib/lazy-pages.mjs');
  const { getCanvases } = await import('../../../iiif-discovery/lib/manifest-store.mjs');
  const { getPageSource } = await import('../../../lib/page-image-url.mjs');
  const lib = arg('library'), n = Number(arg('n') || 3), RELAY = arg('relay') || null;
  const [cell, C] = Object.entries(CELLS)[0];
  const c = await mongo();
  const bs = (await c.db('bookstore').collection('books').find({ language: { $regex: `^${C.lang}` }, year: { $gte: C.years[0], $lte: C.years[1] }, 'pages_state.state': 'manifest_only', 'image_source.provider': lib, 'pipeline_auto.hold.reason': MANIFEST_HOLD }, { projection: { id: 1, image_source: 1 } }).toArray())
    .sort((a, b) => h(`${ST.salt}-probe-${a.id}`).localeCompare(h(`${ST.salt}-probe-${b.id}`))).slice(0, n);
  await c.close();
  const rows = [];
  for (const b of bs) {
    const t0 = Date.now(), m = await getBytes(b.image_source.iiif_manifest, RELAY);
    const row = { book_id: b.id, manifest: m.error ? m.error : `ok ${m.via}`, manifest_secs: (Date.now() - t0) / 1000 };
    if (!m.error) {
      const man = JSON.parse(m.buf.toString('utf8')), k = getCanvases(man).length;
      const d = buildPageDocs(b.id, man)[Math.floor(k / 2)];
      const t1 = Date.now(), im = d ? await getBytes(getPageSource(d), RELAY) : { error: 'no canvas' };
      Object.assign(row, { canvases: k, image: im.error ? im.error : `ok ${im.via} ${im.buf.length} bytes`, image_secs: (Date.now() - t1) / 1000 });
    }
    rows.push(row); console.log(JSON.stringify(row));
    await new Promise((res) => setTimeout(res, 1000));
  }
  fs.mkdirSync(OUT, { recursive: true });
  W(`probe-${lib}.json`, { probed_at: new Date().toISOString(), library: lib, relay: RELAY, rows });
}

/** draw: tiers A/B only (what will be read); A: an interior page, B: a page the screen hit. Unread pages only. */
async function draw() {
  if (STUDY === 'euro-6871') return drawEuro();
  if (STUDY === 'euro-manifest-6871') return drawManifest();
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
    // A manifest-only library may refuse this box (e-rara: 403), so the judge opens the image drawn, by file.
    const image_file = STUDY === 'euro-manifest-6871' ? path.join(OUT, 'img', `${sp.page_id}.jpg`) : undefined;
    if (!items.has(id)) items.set(id, { id, task: 'ocr', lang: CELLS[cell].lang, image_url: getPageSource(pages.get(sp.page_id)), ...(image_file && { image_file }), text });
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
        pk.items.push({ id, task: 'ocr', lang: CELLS[cell].lang, image_url: it.image_url, ...(it.image_file && { image_file: it.image_file }), text: p.text });
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

/**
 * pooled --out=DIR,DIR2: the rule over a first draw and its second draw together (new books only, so one page a book
 * still holds), per cell. `marker_guard` scores the same pages with every read whose written text carries a
 * <<<BEGIN>>>/<<<END>>> marker counted as unwritten — what unwrapRead refuses since #8296 — reported beside the rule's
 * own figure, never in place of it. Writes pooled.json into the first DIR.
 */
function pooled() {
  const dirs = String(arg('out')).split(',').map((d) => path.resolve(d));
  const rd = (d, f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
  const marker = /<<<\s*(?:BEGIN|END)\s*>>>/;
  const out = { scored_at: new Date().toISOString(), dirs, cells: {} };
  const cells = [...new Set(dirs.flatMap((d) => Object.keys(rd(d, 'sample.json').cells)))];
  for (const cell of cells) {
    const per = dirs.filter((d) => rd(d, 'sample.json').cells[cell]).map((d) => {
      const V = new Map(jsonl(path.join(d, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
      const items = new Map(rd(d, 'packet.json').items.map((i) => [i.id, i]));
      return { V, items, rows: rd(d, 'key.json').filter((k) => k.cell === cell), drawn: rd(d, 'sample.json').cells[cell].pages.length };
    });
    const measure = (guard) => {
      let n = 0, acc = 0, wrong = 0, wpN = 0, wpRej = 0, wpBad = 0, plN = 0, plC = 0, drawn = 0, cut = 0;
      for (const { V, items, rows, drawn: dn } of per) {
        drawn += dn;
        for (const k of rows) {
          const v = V.get(k.judged_as); if (!v) continue;
          if (k.kind === 'item') { if (guard && marker.test(items.get(k.judged_as)?.text || '')) { cut++; continue; } n++; if (v.accept) acc++; if (wt(v)) wrong++; }
          if (k.kind === 'wrong_page') { wpN++; if (!v.accept) wpRej++; if (v.accept || (v.fidelity ?? 0) > 2) wpBad++; }
          if (k.kind === 'planted') { plN++; if (!v.accept || (v.defects || []).length) plC++; }
        }
      }
      const P = betaP(acc, n, 0.8, parseInt(h(`s-${cell}`).slice(0, 8), 16));
      const ok = n >= 10 && wrong / n <= 0.04 && P >= 0.9 && wpN > 0 && !wpBad && !(plN >= 2 && plC === 0);
      return { drawn, judged: n, accepted: acc, wrong_text: wrong, p_acc_ge_08: P, wrong_page_controls: `${wpRej}/${wpN}`, planted_caught: `${plC}/${plN}`, ...(guard && { marker_reads_refused: cut }), decision: ok ? 'PASS' : 'HOLD',
        why: ok ? null : [n < 10 && 'under 10 judged', n && wrong / n > 0.04 && `wrong text ${wrong}/${n}`, P < 0.9 && `P(acc>=0.8) ${P}`, (!wpN || wpBad) && 'wrong-page control', plN >= 2 && !plC && 'plants missed'].filter(Boolean).join('; ') };
    };
    out.cells[cell] = { draws: per.length, rule: measure(false), marker_guard: measure(true) };
    const r = out.cells[cell].rule, g = out.cells[cell].marker_guard;
    console.log(`${cell} (${per.length} draw${per.length > 1 ? 's' : ''}): ${r.accepted}/${r.judged} accepted, wrong ${r.wrong_text}, P ${r.p_acc_ge_08} → ${r.decision}${r.why ? ` (${r.why})` : ''} | marker guard: ${g.accepted}/${g.judged}, wrong ${g.wrong_text}, P ${g.p_acc_ge_08} → ${g.decision}${g.why ? ` (${g.why})` : ''}`);
  }
  fs.writeFileSync(path.join(dirs[0], 'pooled.json'), JSON.stringify(out, null, 1));
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
  if (!['euro-6871', 'euro-manifest-6871'].includes(STUDY)) throw new Error('record is for --study=euro-6871 or euro-manifest-6871 (its method file)');
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
      // recordPageVerdicts' kinds (book-checks.mjs), from the judge's page-error-taxonomy class; the severity rides along
      const kindOf = (cls) => (cls === 'O5' ? 'omission' : /^O(6|7|8)$/.test(cls) ? 'misread' : 'other');
      const errors = serious ? (bad.length ? bad.map((d) => ({ stage: 'ocr', class: d.class, kind: kindOf(d.class), severity: d.severity, problem: `${d.what ?? ''}: "${String(d.quote ?? '').slice(0, 200)}"` }))
        : [{ stage: 'ocr', kind: 'other', severity: 'not_accepted', problem: String(v.reader_note || 'the judge did not accept the page').slice(0, 600) }]) : [];
      verdicts.push({ page_id: k.page_id, outcome: serious ? 'serious' : (v.defects || []).length ? 'minor' : 'clean', page_verdict: serious ? 'fix' : (v.defects || []).length ? 'caveat' : 'show',
        verdict: `${k.cell} accept=${v.accept} fidelity=${v.fidelity}`, note: v.reader_note, defects: v.defects || [], errors, judged: { ocr: items.get(k.judged_as)?.text ?? '', translation: '' } });
    }
  }
  const c = await mongo();
  try {
    const res = await recordPageVerdicts(c.db('bookstore'), {
      method_id: METHOD, method_version: readMethod(METHOD).version, run_id: `${ST.job}-${new Date().toISOString().slice(0, 10)}`, checked_at: new Date(),
      selection: 'random', stages: ['ocr'], reader: { kind: 'model', model: model ?? 'claude -p --model opus', image_opened: true },
      evidence_path: `scripts/eval/route-judge-6740/results/${ST.evidence ?? 'euro-gpu-agy-cells-6871'}/`, reader_warning: false, exposure: 'unrecorded',
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

const STAGES = { draw, probe, collect, read, written, packet, plant, score, pooled, apply, fallback, record };
if (!STAGES[STAGE]) { console.error(`stage must be one of ${Object.keys(STAGES).join(', ')}`); process.exit(2); }
await STAGES[STAGE]();
