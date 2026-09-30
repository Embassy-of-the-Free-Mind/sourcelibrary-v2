#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/ia-ocr-leaf-drift.mjs and ia-ocr-page-plausibility.mjs look only at
 * `ocr.source: 'ia_djvu'` text (what the free lane WROTE), so they cannot see a model page at all.
 * scripts/import/ia-ocr-ingest.mjs votes a book-level offset from model pages at ±3, only on books
 * with untranscribed pages, and logs it (REF_SHIFTED) without recording which pages.
 * hetzner:/root/sl-ia-cache/_runs/pipeline-safe/model-text-alignment.hetzner.mjs (#4790, never
 * committed) did this per OCR run for the 197 held books at offsets −2…+1 with a bag-of-words score.
 * This is that probe made corpus-wide, per page, at ±8, resumable, with the image side attached.
 *
 * ia-model-ocr-off-leaf — READ-ONLY, zero-model-call detector (#5309): on Internet Archive books,
 * which pages carry MODEL (Gemini) OCR text that is a reading of a NEIGHBOURING leaf, not of the
 * leaf `pages.photo` names?
 *
 * HOW. The Archive's `_djvu.xml` holds its own reading of every leaf, and OBJECT[k] IS IIIF leaf
 * `/page/n<k>` (#4790; scripts/lib/ia-djvu-leaves.mjs). Each model page's text is scored against
 * leaves k−W … k+W (token-bigram Dice, scripts/lib/leaf-offset-match.mjs) and the best offset is
 * kept when it clears a floor and beats the runner-up by a margin; otherwise the page ABSTAINS and
 * is counted as such (junk Archive OCR, plates, non-Latin script the engine cannot read). Offset 0
 * is aligned; ≠ 0 inside the window is `shifted`; a match only elsewhere in the item is `far`.
 *
 * WHAT IT CANNOT SEE. It compares TEXT with the leaf the RECORD names. Whether the reader sees the
 * mismatch depends on the image shown (`display_photo`): `--stage=images` dHashes it against IIIF
 * at leaf k and at leaf k+offset for books with a shifted run — shown = k means the text is wrong
 * on screen; shown = k+offset means text and image agree on screen and both are off the record.
 * Measured on the controls (2026-09-30): the six #5309 books all read `text_wrong_on_screen`; six
 * of the eight negative-control books that carry a run read `consistent_on_screen` (the #3368
 * image shift, where the page is right on screen). So a run is not by itself a reader-visible
 * defect; always quote the image verdict with it. The image stage looks at MODEL-lane runs only.
 *
 * NON-LATIN SCRIPTS. Where the Archive's engine cannot read the script (Chinese, most Sanskrit),
 * no leaf clears the floor and the pages abstain as `low`: the book is undecidable, never aligned.
 *
 * SAMPLING. Books are walked in a fixed pseudo-random order (sha1 of seed + book id), so any
 * prefix of the walk is a simple random sample of the frame and a resumed run continues the same
 * order. Every page of a walked book is compared (one XML fetch buys them all), so pages are
 * CLUSTERED by book: the summary's page-rate interval is a book-level bootstrap, never a binomial
 * over pages.
 *
 * Writes NOTHING to Mongo. One JSONL row per book (`--out`), one per shifted/far page
 * (`<out>.pages.jsonl`). Checkpoint = the book file itself: a book with a row is skipped on resume.
 * archive.org: ≤ 2 req/s, aborts after 4 consecutive refusals (scripts/lib/ia-ocr-meta.mjs) — just
 * run it again. Run on Hetzner, detached; never in-session.
 *
 *   node --env-file=.env.production.local scripts/audit/ia-model-ocr-off-leaf.mjs \
 *     [--limit N] [--max-minutes M] [--book <id>] [--ids <file>] [--cache /root/sl-ia-cache] \
 *     [--out scripts/output/ia-model-ocr-off-leaf.jsonl] [--window 8] [--seed 5309] [--verbose]
 *   … --stage=images     # image side for books with a shifted run (3 small fetches per sampled page)
 *   … --stage=summary    # rates, intervals and the repair estimate from the accumulated rows
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { withMongo } from '../lib/mongo.mjs';
import { iaFetch, iaOcrMeta } from '../lib/ia-ocr-meta.mjs';
import { iaLeaves } from '../lib/ia-djvu-leaves.mjs';
import { dehyphenateLineBreaks } from '../lib/dehyphenate.mjs';
import { tokens, tokensBody } from '../lib/ia-ocr-agreement.mjs';
import { bigramCounts, pageOffset, shiftRuns, DEFAULTS } from '../lib/leaf-offset-match.mjs';
import { normalizeLanguageToken } from '../lib/language-normalize.mjs';

const arg = (k, d) => { const eq = process.argv.find((a) => a.startsWith(`${k}=`)); if (eq) return eq.slice(k.length + 1); const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const STAGE = arg('--stage', 'offsets');
const OUT = arg('--out', 'scripts/output/ia-model-ocr-off-leaf.jsonl');
const PAGES_OUT = OUT.replace(/\.jsonl$/, '') + '.pages.jsonl';
const IMG_OUT = OUT.replace(/\.jsonl$/, '') + '.images.jsonl';
const META_OUT = OUT.replace(/\.jsonl$/, '') + '.meta.json';
const LIMIT = +arg('--limit', 0), MAX_MINUTES = +arg('--max-minutes', 0);
const BOOK = arg('--book', null), IDS = arg('--ids', null), CACHE = arg('--cache', null);
const SEED = arg('--seed', '5309'), VERBOSE = process.argv.includes('--verbose');
const OPTS = { ...DEFAULTS, window: +arg('--window', DEFAULTS.window), minScore: +arg('--min-score', DEFAULTS.minScore), minMargin: +arg('--min-margin', DEFAULTS.minMargin) };
const IA_TEXT = 'ia_djvu'; // the Archive's own text: it IS the leaf, never a model reading of it

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const isPlatePage = (t) => /<image-desc\b|\[Image:|<page-type>\s*(plate|illustration|image|photograph|figure|map)\b/i.test(t);
const leafOf = (p) => { const m = String(p.photo || '').match(/archive\.org\/.*\/page\/n(\d+)\//); return m ? +m[1] : null; };
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '?');
const IA_FRAME = { pages_ocr: { $gt: 0 }, $or: [{ ia_identifier: { $type: 'string', $ne: '' } }, { 'image_source.provider': 'internet_archive' }] };

// ---------- single writer (a second copy on one checkpoint silently rolls it back) ----------
function takeLock() {
  const lock = `${OUT}.lock`;
  if (fs.existsSync(lock)) {
    const pid = +fs.readFileSync(lock, 'utf8');
    let alive = false; try { process.kill(pid, 0); alive = true; } catch { /* stale */ }
    if (alive) { console.error(`another run (pid ${pid}) holds ${lock}`); process.exit(2); }
  }
  fs.writeFileSync(lock, String(process.pid));
  const release = () => { try { if (+fs.readFileSync(lock, 'utf8') === process.pid) fs.unlinkSync(lock); } catch { /* gone */ } };
  process.on('exit', release); for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(130));
}

/** One book → its row and its off-leaf page rows. Never throws on a missing source: that is a status. */
async function auditBook(db, b) {
  const bid = b.id || String(b._id);
  const iaId = b.ia_identifier || b.image_source?.identifier || null;
  const row = { book_id: bid, ia_id: iaId, title: (b.title || '').slice(0, 70), language: (normalizeLanguageToken(b.language) || '?').toLowerCase(),
    live: b.visible === true && (b.pages_count || 0) > 0, pages_count: b.pages_count || 0, pipeline_status: b.pipeline_auto?.status || null, hold: b.pipeline_auto?.hold?.reason || null };
  if (!iaId) return { row: { ...row, status: 'no_ia_id' }, pageRows: [] };
  const all = await db.collection('pages').aggregate([
    { $match: { book_id: bid, page_number: { $gt: 0 }, hidden: { $ne: true }, 'ocr.data': { $type: 'string', $ne: '' } } },
    { $sort: { page_number: 1 } },
    { $project: { id: 1, page_number: 1, photo: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.model': 1, 'ocr.updated_at': 1, archive_source: '$archive_metadata.source', split: { $ifNull: ['$split_from_spread', false] },
      translated: { $and: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, { $ne: ['$translation.data', ''] }] } } },
  ]).toArray();
  // Two lanes, never mixed in one run: MODEL text (the #5309 question) and the Archive's own text
  // written by the free lane (`ia_djvu`). An ia_djvu page IS some leaf's text, so its best leaf is
  // exact; a non-zero offset there is #4790's residue (the 2026-09-12/13 offset-compensation window;
  // 7 of 82 served pages in the #5361 cohort check).
  const pages = all.filter((p) => p.ocr.source !== IA_TEXT), iaPages = all.filter((p) => p.ocr.source === IA_TEXT);
  row.model_pages = pages.length; row.ia_text_pages = iaPages.length;
  if (!all.length) return { row: { ...row, status: 'no_model_pages' }, pageRows: [] };
  const meta = await iaOcrMeta(iaId);
  const { leaves: raw, reason, cached } = await iaLeaves(iaId, meta.djvu_xml_files || [], { cacheDir: CACHE, writeCache: false });
  if (!raw) return { row: { ...row, status: 'no_xml', reason }, pageRows: [] };
  // Same preparation as the ingester: the model reads a line-broken word whole, the Archive does not.
  const leafGrams = raw.map((l) => { const t = tokens(dehyphenateLineBreaks(l)); return t.length >= OPTS.minTokens / 2 ? bigramCounts(t) : null; });
  row.leaves = raw.length; row.leaves_with_text = leafGrams.filter(Boolean).length; row.leaves_cached = !!cached;

  const model = compareLane(pages, leafGrams, bid, 'model');
  const ia = compareLane(iaPages, leafGrams, bid, IA_TEXT);
  Object.assign(row, { status: 'ok', ...model.stats, bulk_jp2_pages: pages.filter((p) => p.archive_source === 'bulk_jp2').length });
  row.ia_text = iaPages.length ? ia.stats : null;
  return { row, pageRows: [...model.pageRows, ...ia.pageRows] };
}

/** One lane's pages of one book → the lane's stats and its off-leaf page rows. */
function compareLane(pages, leafGrams, bid, lane) {
  const compared = []; const verdicts = {}; const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const p of pages) {
    const base = { page_number: p.page_number, page_id: p.id || String(p._id), ocr_run: `${p.ocr.source || 'model'}|${p.ocr.model || '?'}|${day(p.ocr.updated_at)}`, archive_source: p.archive_source || null, translated: !!p.translated };
    const k = leafOf(p);
    let r;
    if (k === null) r = { verdict: 'no_leaf_url' };
    else if (p.split) r = { verdict: 'split_page' };          // half a leaf: its own comparison, not this one
    else if (isPlatePage(p.ocr.data)) r = { verdict: 'plate' }; // the model DESCRIBES a picture; nothing to match
    else {
      const t = tokensBody(lane === IA_TEXT ? dehyphenateLineBreaks(p.ocr.data) : p.ocr.data);
      r = t.length < OPTS.minTokens ? { verdict: 'short' } : pageOffset(bigramCounts(t), leafGrams, k, OPTS);
    }
    bump(verdicts, r.verdict);
    compared.push({ ...base, leaf: k, ...r });
    if (VERBOSE) console.log(`    ${lane} p.${p.page_number} n${k} ${r.verdict} ${r.offset ?? ''} best ${r.score?.toFixed(2) ?? '-'} @0 ${r.score0?.toFixed(2) ?? '-'} 2nd ${r.second?.toFixed(2) ?? '-'} ${base.ocr_run} ${base.archive_source || ''}`);
  }
  const runs = shiftRuns(compared);
  // Pages inside a run that abstained are shifted too (they sit between two pages shifted the same
  // way); they are listed with decided:false so a repair covers the whole run.
  const inRun = (pn) => runs.find((x) => pn >= x.from && pn <= x.to);
  const pageRows = [];
  for (const c of compared) {
    const run = inRun(c.page_number);
    if (c.verdict !== 'shifted' && c.verdict !== 'far' && !run) continue;
    pageRows.push({ book_id: bid, lane, page_id: c.page_id, page_number: c.page_number, leaf: c.leaf, verdict: c.verdict, decided: c.verdict === 'shifted' || c.verdict === 'far',
      offset: c.offset ?? run?.offset ?? null, score: c.score != null ? +c.score.toFixed(3) : null, score0: c.score0 != null ? +c.score0.toFixed(3) : null,
      ocr_run: c.ocr_run, archive_source: c.archive_source, translated: c.translated });
  }
  const offsets = {}; const byRun = {};
  for (const c of compared) {
    if (c.offset != null && c.verdict !== 'far') bump(offsets, c.offset);
    const [src, mdl] = c.ocr_run.split('|'); const key = `${src}|${mdl}`;
    byRun[key] = byRun[key] || { pages: 0, aligned: 0, shifted: 0 }; byRun[key].pages++;
    if (c.verdict === 'aligned') byRun[key].aligned++; if (c.verdict === 'shifted') byRun[key].shifted++;
  }
  const span = pageRows.filter((r) => r.verdict !== 'far');
  const stats = { verdicts, offsets, decided: (verdicts.aligned || 0) + (verdicts.shifted || 0), aligned: verdicts.aligned || 0, shifted: verdicts.shifted || 0, far: verdicts.far || 0,
    shifted_span: span.length, shifted_span_translated: span.filter((r) => r.translated).length,
    runs, n_runs: runs.length, contiguous: runs.length === 1 && runs[0].decided === (verdicts.shifted || 0), longest_run: runs.reduce((m, x) => Math.max(m, x.decided), 0),
    ocr_runs: byRun, shifted_bulk_jp2: span.filter((r) => r.archive_source === 'bulk_jp2').length };
  return { stats, pageRows };
}

// ---------- stage: offsets ----------
async function stageOffsets() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  if (!BOOK) takeLock();
  await withMongo(async (db) => {
    const B = db.collection('books');
    const projection = { id: 1, title: 1, language: 1, ia_identifier: 1, image_source: 1, visible: 1, pages_count: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold.reason': 1 };
    let books;
    if (BOOK || IDS) {
      const ids = BOOK ? [BOOK] : fs.readFileSync(IDS, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      books = await B.find({ id: { $in: ids } }, { projection }).toArray();
    } else {
      // The id list is read whole, up front: a cursor held across slow per-book work dies (CursorNotFound).
      books = await B.find(IA_FRAME, { projection }).toArray();
      const key = (b) => crypto.createHash('sha1').update(`${SEED}:${b.id || b._id}`).digest('hex');
      books = books.map((b) => [key(b), b]).sort((x, y) => (x[0] < y[0] ? -1 : 1)).map((x) => x[1]);
      fs.writeFileSync(META_OUT, JSON.stringify({ frame: 'IA books with pages_ocr > 0', frame_books: books.length, seed: SEED, opts: OPTS, updated_at: new Date().toISOString() }, null, 2));
    }
    const done = new Set(BOOK ? [] : readJsonl(OUT).map((r) => r.book_id));
    console.log(`${books.length} books in the frame | ${done.size} already walked | window ±${OPTS.window}, floor ${OPTS.minScore}, margin ${OPTS.minMargin}`);
    const out = BOOK ? null : fs.createWriteStream(OUT, { flags: 'a' }), pout = BOOK ? null : fs.createWriteStream(PAGES_OUT, { flags: 'a' });
    const t0 = Date.now(); let n = 0, hits = 0, lastBeat = Date.now(), lastN = 0;
    for (const b of books) {
      const bid = b.id || String(b._id);
      if (done.has(bid)) continue;
      if (LIMIT && n >= LIMIT) break;
      if (MAX_MINUTES && Date.now() - t0 > MAX_MINUTES * 60000) { console.log(`stopping at --max-minutes ${MAX_MINUTES}`); break; }
      let res;
      try { res = await auditBook(db, b); }
      catch (e) { res = { row: { book_id: bid, status: 'error', reason: String(e?.message || e).slice(0, 200) }, pageRows: [] }; }
      n++; if (res.row.shifted) hits++;
      if (BOOK) { console.log(JSON.stringify(res.row, null, 1)); for (const r of res.pageRows) console.log(JSON.stringify(r)); continue; }
      // Pages first, then the book row: the book row is the checkpoint, so a crash between the two
      // re-walks the book (duplicate page rows are dropped by the summary) instead of losing its pages.
      for (const r of res.pageRows) pout.write(JSON.stringify(r) + '\n');
      out.write(JSON.stringify(res.row) + '\n');
      // Heartbeat with a WINDOWED rate: a cumulative average cannot show a stall.
      if (Date.now() - lastBeat > 60000) { console.log(`  ${new Date().toISOString().slice(11, 19)} walked ${done.size + n}/${books.length} | this run ${n} (${hits} with shifted pages) | last minute ${n - lastN} books`); lastBeat = Date.now(); lastN = n; }
    }
    if (out) { await new Promise((r) => out.end(r)); await new Promise((r) => pout.end(r)); }
    console.log(`this run: ${n} books, ${hits} with shifted pages | accumulated: ${done.size + n} of ${books.length} — totals come from --stage=summary, not from this line`);
  }, { noTimeout: true });
}

// ---------- stage: images ----------
/**
 * For each book with a shifted run: is the image the READER is shown the leaf the record names
 * (k), or the leaf the text was read from (k+offset)? dHash at IIIF pct:12, as scripts/audit/
 * ia-ocr-leaf-drift.mjs --stage=images does for the free lane.
 */
async function stageImages() {
  const { hashBuffer, hammingHex, HASH_MATCH } = await import('../lib/page-alignment.mjs');
  const rows = readJsonl(OUT).filter((r) => r.status === 'ok' && r.longest_run >= 2);
  const done = new Set(readJsonl(IMG_OUT).map((r) => r.book_id));
  const out = fs.createWriteStream(IMG_OUT, { flags: 'a' });
  const thumb = (u) => String(u).replace(/\/full\/(full|max|pct:\d+)\//, '/full/pct:12/');
  const hashUrl = async (u) => {
    const r = /archive\.org/.test(u) ? await iaFetch(u) : await fetch(u, { signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw new Error(`http ${r.status}`);
    return hashBuffer(Buffer.from(await r.arrayBuffer()));
  };
  console.log(`${rows.length} books with a shifted run of ≥ 2 pages | ${done.size} already imaged`);
  await withMongo(async (db) => {
    let n = 0;
    for (const r of rows) {
      if (done.has(r.book_id)) continue;
      if (LIMIT && n >= LIMIT) break;
      const run = [...r.runs].sort((a, b) => b.decided - a.decided)[0];
      const pns = [...new Set([run.from, Math.round((run.from + run.to) / 2), run.to])];
      const pages = await db.collection('pages').find({ book_id: r.book_id, page_number: { $in: pns } }, { projection: { page_number: 1, photo: 1, display_photo: 1, cropped_photo: 1, archived_photo: 1 } }).toArray();
      const votes = { record_leaf: 0, text_leaf: 0, neither: 0 }; const detail = [];
      for (const p of pages) {
        const m = String(p.photo || '').match(/\/page\/n(\d+)\//); const shown = p.display_photo || p.cropped_photo || p.photo;
        if (!m || !/^https?:/.test(shown || '') || shown === p.photo) { detail.push({ page: p.page_number, skip: shown === p.photo ? 'shown is the source leaf itself' : 'no usable image' }); if (shown === p.photo) votes.record_leaf++; continue; }
        const k = +m[1];
        try {
          const h = await hashUrl(shown);
          const dK = hammingHex(h, await hashUrl(thumb(p.photo)));
          const dT = hammingHex(h, await hashUrl(thumb(p.photo.replace(/\/page\/n\d+\//, `/page/n${k + run.offset}/`))));
          detail.push({ page: p.page_number, leaf: k, d_record_leaf: dK, d_text_leaf: dT });
          if (dK <= HASH_MATCH && dK < dT) votes.record_leaf++; else if (dT <= HASH_MATCH && dT < dK) votes.text_leaf++; else votes.neither++;
        } catch (e) { detail.push({ page: p.page_number, err: String(e.message).slice(0, 60) }); }
      }
      const checked = votes.record_leaf + votes.text_leaf + votes.neither;
      // text_wrong_on_screen: the reader sees leaf k beside the text of leaf k+offset.
      // consistent_on_screen: image and text are the same (wrong) leaf; only the record's pointer disagrees.
      const verdict = !checked ? 'unknown' : votes.record_leaf === checked ? 'text_wrong_on_screen' : votes.text_leaf === checked ? 'consistent_on_screen' : 'ambiguous';
      out.write(JSON.stringify({ book_id: r.book_id, offset: run.offset, run: [run.from, run.to], verdict, votes, detail }) + '\n'); n++;
      if (n % 10 === 0) console.log(`  ${n} books imaged`);
    }
  }, { noTimeout: true });
  await new Promise((r) => out.end(r));
  const img = readJsonl(IMG_OUT); const by = {}; for (const r of img) by[r.verdict] = (by[r.verdict] || 0) + 1;
  console.log(`image side, ${img.length} books: ${JSON.stringify(by)}`);
}

// ---------- stage: summary ----------
const wilson = (k, n, z = 1.96) => { if (!n) return [null, null]; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)]; };
const pct = (x, d = 1) => (x == null ? '–' : `${(100 * x).toFixed(d)}%`);
function summarise() {
  const seen = new Set(); const rows = readJsonl(OUT).filter((r) => (seen.has(r.book_id) ? false : seen.add(r.book_id)));
  const meta = fs.existsSync(META_OUT) ? JSON.parse(fs.readFileSync(META_OUT, 'utf8')) : {};
  const img = new Map(readJsonl(IMG_OUT).map((r) => [r.book_id, r.verdict]));
  const ok = rows.filter((r) => r.status === 'ok');
  const sum = (xs, f) => xs.reduce((s, r) => s + (f(r) || 0), 0);
  // A book "has a shift" on a RUN of ≥ 2 decided pages at one offset; a lone page is reported apart.
  const hasRun = (r) => r.longest_run >= 2;
  const decidable = ok.filter((r) => r.decided >= 5);
  // Page rate with a book-level bootstrap: pages of one book are one observation of its alignment.
  const pageRate = (xs) => { const d = sum(xs, (r) => r.decided); return d ? sum(xs, (r) => r.shifted) / d : null; };
  const boot = (xs, f, B = 2000) => { if (!xs.length) return [null, null]; let s = 0x5309; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); const v = []; for (let i = 0; i < B; i++) { const re = []; for (let j = 0; j < xs.length; j++) re.push(xs[Math.floor(rnd() * xs.length)]); v.push(f(re)); } v.sort((a, b) => a - b); return [v[Math.floor(0.025 * B)], v[Math.floor(0.975 * B)]]; };
  const block = (label, xs) => {
    const dec = xs.filter((r) => r.decided >= 5), withRun = dec.filter(hasRun);
    const [bl, bh] = wilson(withRun.length, dec.length), [pl, ph] = boot(dec, pageRate);
    return { label, books: xs.length, books_decidable: dec.length, books_with_run: withRun.length, book_rate: dec.length ? withRun.length / dec.length : null, book_ci: [bl, bh],
      model_pages: sum(xs, (r) => r.model_pages), decided: sum(dec, (r) => r.decided), shifted: sum(dec, (r) => r.shifted), page_rate: pageRate(dec), page_ci: [pl, ph],
      shifted_span: sum(xs, (r) => r.shifted_span), shifted_span_translated: sum(xs, (r) => r.shifted_span_translated), far: sum(xs, (r) => r.far) };
  };
  const line = (b) => `${b.label.padEnd(28)} | ${String(b.books).padStart(5)} | ${String(b.books_decidable).padStart(5)} | ${String(b.books_with_run).padStart(4)} ${pct(b.book_rate)} (${pct(b.book_ci[0])}–${pct(b.book_ci[1])}) | ${String(b.decided).padStart(7)} | ${String(b.shifted).padStart(6)} ${pct(b.page_rate, 2)} (${pct(b.page_ci[0], 2)}–${pct(b.page_ci[1], 2)}) | ${b.shifted_span} / ${b.shifted_span_translated}`;
  const status = {}; for (const r of rows) status[r.status] = (status[r.status] || 0) + 1;
  console.log(`walked ${rows.length} of ${meta.frame_books ?? '?'} frame books (seed ${meta.seed ?? '?'}) | status ${JSON.stringify(status)}`);
  const verdicts = {}; for (const r of ok) for (const [k, v] of Object.entries(r.verdicts)) verdicts[k] = (verdicts[k] || 0) + v;
  console.log(`model pages by verdict: ${JSON.stringify(verdicts)}`);
  const offsets = {}; for (const r of ok) for (const [k, v] of Object.entries(r.offsets)) offsets[k] = (offsets[k] || 0) + v;
  console.log(`decided pages by offset: ${JSON.stringify(Object.fromEntries(Object.entries(offsets).sort((a, b) => a[0] - b[0])))}`);
  const booksByOffset = {}; for (const r of ok.filter(hasRun)) { const o = [...r.runs].sort((a, b) => b.decided - a.decided)[0].offset; booksByOffset[o] = (booksByOffset[o] || 0) + 1; }
  console.log(`books with a run, by the offset of their longest run: ${JSON.stringify(Object.fromEntries(Object.entries(booksByOffset).sort((a, b) => a[0] - b[0])))}`);
  console.log('\nstratum                      | books | decid | with a run ≥2: n rate (95% Wilson) | decided | shifted: n rate (95% book bootstrap) | pages in runs / of them translated');
  const blocks = [block('ALL', ok), block('live (visible, pages > 0)', ok.filter((r) => r.live)), block('not live', ok.filter((r) => !r.live)),
    block('has bulk_jp2 pages', ok.filter((r) => r.bulk_jp2_pages > 0)), block('no bulk_jp2 pages', ok.filter((r) => !r.bulk_jp2_pages)),
    block('held ia-wrong-leaf-4790', ok.filter((r) => r.hold === 'ia-wrong-leaf-4790')), block('not held', ok.filter((r) => r.hold !== 'ia-wrong-leaf-4790'))];
  const langs = [...new Set(ok.map((r) => r.language))].map((l) => [l, ok.filter((r) => r.language === l)]).sort((a, b) => b[1].length - a[1].length).slice(0, 12);
  for (const [l, xs] of langs) blocks.push(block(`lang ${l}`, xs));
  for (const b of blocks) console.log(line(b));
  // Per OCR run (source|model): pages, not books — a book can hold several runs.
  const runs = {}; for (const r of ok) for (const [k, v] of Object.entries(r.ocr_runs)) { runs[k] = runs[k] || { pages: 0, aligned: 0, shifted: 0 }; runs[k].pages += v.pages; runs[k].aligned += v.aligned; runs[k].shifted += v.shifted; }
  console.log('\nOCR run (source|model)                        | pages | decided | shifted | share of decided');
  for (const [k, v] of Object.entries(runs).sort((a, b) => b[1].pages - a[1].pages).slice(0, 14)) console.log(`${k.padEnd(45)} | ${v.pages} | ${v.aligned + v.shifted} | ${v.shifted} | ${pct(v.aligned + v.shifted ? v.shifted / (v.aligned + v.shifted) : null, 2)}`);
  // The Archive-text lane (ia_djvu pages written by the free lane): #4790 residue, not #5309.
  const iaRows = ok.filter((r) => r.ia_text).map((r) => ({ ...r.ia_text, book_id: r.book_id, title: r.title, live: r.live }));
  if (iaRows.length) {
    const b = block('ia_djvu text (free lane)', iaRows);
    console.log(`\nARCHIVE-TEXT LANE (ia_djvu pages, #4790 residue):\n${line(b)}`);
    for (const r of iaRows.filter(hasRun).sort((x, y) => y.shifted_span - x.shifted_span).slice(0, 10)) console.log(`  ${r.book_id} ${r.title.slice(0, 42).padEnd(42)} | in runs ${r.shifted_span} | runs ${r.runs.slice(0, 4).map((x) => `${x.from}–${x.to}@${x.offset}`).join(' ')}`);
    blocks.push(b);
  }
  const contiguous = ok.filter(hasRun).filter((r) => r.contiguous).length;
  console.log(`\nbooks with a run: ${ok.filter(hasRun).length} | one contiguous run: ${contiguous} | several runs: ${ok.filter(hasRun).length - contiguous} | books whose only off-leaf pages are lone pages: ${ok.filter((r) => r.shifted > 0 && !hasRun(r)).length} (${sum(ok.filter((r) => r.shifted > 0 && !hasRun(r)), (r) => r.shifted)} pages)`);
  if (img.size) { const by = {}; for (const r of ok.filter(hasRun)) { const v = img.get(r.book_id) || 'not_imaged'; by[v] = by[v] || { books: 0, span: 0 }; by[v].books++; by[v].span += r.shifted_span; } console.log(`image side (books / pages in runs): ${JSON.stringify(by)}`); }
  // Projection to the frame: mean pages-in-runs per walked book × frame size (walk order is random).
  const all = block('ALL', ok);
  let projection = null;
  if (meta.frame_books && rows.length) {
    const perBook = (xs) => sum(xs, (r) => (r.status === 'ok' && hasRun(r) ? r.shifted_span : 0)) / xs.length;
    const [lo, hi] = boot(rows, perBook); const trShare = all.shifted_span ? all.shifted_span_translated / all.shifted_span : 0;
    projection = { frame_books: meta.frame_books, walked: rows.length, pages_in_runs_per_book: perBook(rows), projected_pages: Math.round(perBook(rows) * meta.frame_books), projected_ci: [Math.round(lo * meta.frame_books), Math.round(hi * meta.frame_books)], translated_share: trShare };
    console.log(`\nprojection to the ${meta.frame_books}-book frame: ${projection.projected_pages} pages in shifted runs (95% book bootstrap ${projection.projected_ci[0]}–${projection.projected_ci[1]}); ${pct(trShare)} of them carry a translation`);
    // What READERS see is the text-wrong-on-screen subset: a run whose shown image is the record's
    // leaf. A run whose image is ALSO the neighbouring leaf reads correctly on screen (#3368 class C).
    if (img.size) {
      projection.by_image = {};
      for (const v of ['text_wrong_on_screen', 'consistent_on_screen', 'ambiguous', 'unknown', 'not_imaged']) {
        const f = (xs) => sum(xs, (r) => (r.status === 'ok' && hasRun(r) && (img.get(r.book_id) || 'not_imaged') === v ? r.shifted_span : 0)) / xs.length;
        const books = ok.filter((r) => hasRun(r) && (img.get(r.book_id) || 'not_imaged') === v);
        const [l, h] = boot(rows, f); const dec = ok.filter((r) => r.decided >= 5).length;
        projection.by_image[v] = { books: books.length, book_rate: dec ? books.length / dec : null, book_ci: wilson(books.length, dec), pages_walked: sum(books, (r) => r.shifted_span), translated_walked: sum(books, (r) => r.shifted_span_translated),
          projected_pages: Math.round(f(rows) * meta.frame_books), projected_ci: [Math.round(l * meta.frame_books), Math.round(h * meta.frame_books)] };
        const x = projection.by_image[v];
        if (x.books) console.log(`  ${v.padEnd(22)} books ${x.books} (${pct(x.book_rate)} of decidable, CI ${pct(x.book_ci[0])}–${pct(x.book_ci[1])}) | pages walked ${x.pages_walked} (${x.translated_walked} translated) | projected ${x.projected_pages} (${x.projected_ci[0]}–${x.projected_ci[1]})`);
      }
    }
  }
  console.log('\nlargest shifted books:');
  for (const r of [...ok].filter(hasRun).sort((a, b) => b.shifted_span - a.shifted_span).slice(0, 15)) console.log(`  ${r.book_id} ${r.language.padEnd(8)} ${r.title.slice(0, 42).padEnd(42)} | in runs ${r.shifted_span}/${r.model_pages} | runs ${r.runs.slice(0, 4).map((x) => `${x.from}–${x.to}@${x.offset}`).join(' ')}${r.runs.length > 4 ? ' …' : ''} | bulk ${r.bulk_jp2_pages} | ${img.get(r.book_id) || ''}`);
  const summaryOut = OUT.replace(/\.jsonl$/, '') + '.summary.json';
  fs.writeFileSync(summaryOut, JSON.stringify({ generated_at: new Date().toISOString(), meta, walked: rows.length, status, verdicts, offsets, books_by_offset: booksByOffset, blocks, ocr_runs: runs, projection }, null, 2));
  console.log(`\n→ ${summaryOut}`);
}

if (STAGE === 'summary') summarise();
else if (STAGE === 'images') await stageImages();
else await stageOffsets();
