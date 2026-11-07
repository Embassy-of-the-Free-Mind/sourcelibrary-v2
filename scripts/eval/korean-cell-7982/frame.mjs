#!/usr/bin/env node
// PRIOR ART: scripts/eval/confidence-7866/frame.mjs (the per-book page census and the page pick: eligiblePage, imageUrl,
// routeOf; imported from its lib.mjs, unchanged) and scripts/eval/results/agy-reread-4850/draw.mjs (a seeded one-page-
// a-book draw). Neither frames a LANGUAGE (live and hidden) with a script-mix stratum, which #7982 needs: Korean books
// are hanja-only, mixed hanja-hangul or hangul, and the #6553 cell drew live books only. Searched scripts/eval/INDEX.md,
// `gh issue list --search korean`: no Korean frame existed.
/**
 * #7982 Korean OCR cell test: census and draw (scripts/eval/experiments/2026-11-03-korean-ocr-cell-7982.md).
 * Read-only on Mongo. Bulky output in $JOB_SCRATCH/kc-7982 (OUT).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/korean-cell-7982/frame.mjs census
 *   ... frame.mjs draw        30 pages, one per book, PPS on pages, stratified (seed 79821)
 *   ... frame.mjs texts       the stored read of every drawn page → OUT/arms/stored/<page>.txt, images → OUT/img/
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { eligiblePage, imageUrl, routeOf, makeRng } from '../confidence-7866/lib.mjs';
import { OUT, RESULTS, W, J, SEED, ALLOC, N_PAGES, mixOf, formOf, stratumOf, scriptCounts } from './lib.mjs';

const client = new MongoClient(process.env.MONGODB_URI);
const db = () => client.db('bookstore');
const KOREAN = { language: /^Korean/i, pages_count: { $gt: 0 } };
const PROJ = { id: 1, title: 1, language: 1, languages: 1, visible: 1, hidden_reason: 1, pages_count: 1, pages_ocr: 1, year: 1, published: 1, 'image_source.provider': 1, 'image_source.contributing_library': 1, 'pipeline_auto.held': 1 };

async function census() {
  const books = await db().collection('books').find(KOREAN, { projection: PROJ }).toArray();
  const rows = [];
  for (const b of books) {
    const pages = await db().collection('pages').find({ book_id: b.id }, { projection: { id: 1, page_number: 1, page_type: 1, script_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.pipeline': 1, 'ocr.source': 1, hidden: 1, split_into: 1, archived_photo: 1, display_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1 } }).toArray();
    const sc = { hang: 0, han: 0 }, st = {}, prov = {};
    let ocr = 0;
    for (const p of pages) {
      if (typeof p.ocr?.data !== 'string') continue;
      ocr++;
      const c = scriptCounts(p.ocr.data); sc.hang += c.hang; sc.han += c.han;
      st[p.script_type ?? 'none'] = (st[p.script_type ?? 'none'] ?? 0) + 1;
      const r = routeOf({ model: p.ocr.model, pipeline: p.ocr.pipeline, source: p.ocr.source }, b.language).route;
      prov[r] = (prov[r] ?? 0) + 1;
    }
    rows.push({ id: b.id, title: b.title, visible: !!b.visible, hidden_reason: b.hidden_reason ?? null, held: b.pipeline_auto?.held ?? null, year: b.year ?? b.published ?? null,
      provider: b.image_source?.provider ?? null, library: b.image_source?.contributing_library ?? null,
      pages: pages.length, pages_ocr: ocr, eligible: pages.filter(eligiblePage).length,
      hang: sc.hang, han: sc.han, mix: mixOf(sc), script_type: st, form: formOf(st), routes: prov });
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  W('census.json', rows);
  const sum = {};
  for (const r of rows) {
    const k = `${r.visible ? 'live' : 'hidden'}|${stratumOf(r)}`;
    sum[k] ??= { books: 0, pages: 0, pages_ocr: 0, eligible: 0 };
    sum[k].books++; sum[k].pages += r.pages; sum[k].pages_ocr += r.pages_ocr; sum[k].eligible += r.eligible;
  }
  const routes = {}; for (const r of rows) for (const [k, v] of Object.entries(r.routes)) routes[k] = (routes[k] ?? 0) + v;
  const out = { at: new Date().toISOString(), books: rows.length, pages: rows.reduce((s, r) => s + r.pages, 0), pages_ocr: rows.reduce((s, r) => s + r.pages_ocr, 0), by_stratum: sum, stored_routes: routes };
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'census.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

/**
 * The draw (prereg §Draw). Frame: books with at least one eligible page (a stored read, not a skip type, an image).
 * Strata = script mix × form. Allocation: ALLOC (prereg), PPS on eligible pages inside each stratum by sequential
 * Poisson sampling (one uniform a book from makeRng(SEED.draw) in id order, key = U / eligible), the rest of the stratum
 * its reserves in key order. The page: uniform among the book's eligible interior pages (the middle 90% by number),
 * from makeRng(SEED.page + book index).
 */
async function draw() {
  const rows = J('census.json');
  const rng = makeRng(SEED.draw);
  const keyed = rows.map((r) => ({ r, u: rng() })).filter((x) => x.r.eligible > 0).map((x) => ({ ...x, key: x.u / x.r.eligible, stratum: stratumOf(x.r) }));
  const drawn = [], reserves = {};
  for (const [s, n] of Object.entries(ALLOC)) {
    const xs = keyed.filter((x) => x.stratum === s).sort((a, b) => a.key - b.key);
    const M = xs.reduce((t, x) => t + x.r.eligible, 0);
    xs.forEach((x, i) => { x.pi = Math.min(1, n * x.r.eligible / Math.max(M, 1)); x.w = x.r.eligible / x.pi; x.rank = i; });
    drawn.push(...xs.slice(0, n)); reserves[s] = xs.slice(n).map((x) => x.r.id);
  }
  const picks = [];
  for (const x of drawn) {
    const pages = await db().collection('pages').find({ book_id: x.r.id }, { projection: { id: 1, page_number: 1, page_type: 1, script_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.pipeline': 1, 'ocr.source': 1, hidden: 1, split_into: 1, archived_photo: 1, display_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, split_from_spread: 1 } }).sort({ page_number: 1 }).toArray();
    const max = Math.max(...pages.map((p) => p.page_number || 0));
    const el = pages.filter(eligiblePage).filter((p) => p.page_number > 0.05 * max && p.page_number <= 0.95 * max && p.ocr.data.trim().length >= 20);
    const pool = el.length ? el : pages.filter(eligiblePage);
    const pr = makeRng(SEED.page + rows.findIndex((r) => r.id === x.r.id));
    const p = pool[Math.floor(pr() * pool.length)];
    const route = routeOf({ model: p.ocr.model, pipeline: p.ocr.pipeline, source: p.ocr.source }, 'Korean');
    picks.push({ book: x.r.id, title: x.r.title, visible: x.r.visible, year: x.r.year, library: x.r.library, stratum: x.stratum, mix: x.r.mix, form: x.r.form,
      eligible: x.r.eligible, pi: +x.pi.toFixed(4), w: +x.w.toFixed(1), page_id: p.id, page_number: p.page_number, script_type: p.script_type ?? null,
      image: imageUrl(p), stored: { model: p.ocr.model ?? null, pipeline: p.ocr.pipeline ?? null, source: p.ocr.source ?? null, route: route.route, len: p.ocr.data.length } });
  }
  W('draw.json', { seed: SEED.draw, alloc: ALLOC, n: N_PAGES, drawn: picks, reserves });
  fs.writeFileSync(path.join(RESULTS, 'draw.json'), JSON.stringify({ seed: SEED.draw, alloc: ALLOC, drawn: picks, reserves }, null, 1));
  for (const p of picks) console.log(`${p.stratum.padEnd(16)} ${p.visible ? 'live  ' : 'hidden'} ${p.book} p${p.page_number} ${p.stored.route} ${String(p.title).slice(0, 50)}`);
}

async function texts() {
  const { drawn } = J('draw.json');
  for (const d of drawn) {
    const doc = await db().collection('pages').findOne({ id: d.page_id }, { projection: { 'ocr.data': 1 } });
    const f = path.join(OUT, 'arms', 'stored', `${d.page_id}.txt`);
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, doc.ocr.data);
    const img = path.join(OUT, 'img', `${d.page_id}.jpg`);
    if (!fs.existsSync(img)) {
      const r = await fetch(d.image, { headers: { 'User-Agent': 'SourceLibrary-eval/7982 (https://sourcelibrary.org)' }, signal: AbortSignal.timeout(60e3) });
      if (!r.ok) { console.log(`image HTTP ${r.status} ${d.page_id}`); continue; }
      let buf = Buffer.from(await r.arrayBuffer());
      fs.mkdirSync(path.dirname(img), { recursive: true });
      // the same bytes for every arm and the judge: over 4 MB → long edge 3000, JPEG q90 (the #7866 judge's rule, applied once, first)
      const { default: sharp } = await import('sharp');
      if (buf.length > 4e6) buf = await sharp(buf).resize(3000, 3000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
      else buf = await sharp(buf).jpeg({ quality: 95 }).toBuffer();
      fs.writeFileSync(img, buf);
    }
  }
  console.log(`${drawn.length} stored texts and images in ${OUT}`);
}

await client.connect();
try {
  const cmd = process.argv[2];
  if (cmd === 'census') await census();
  else if (cmd === 'draw') await draw();
  else if (cmd === 'texts') await texts();
  else console.log('usage: frame.mjs census|draw|texts');
} finally { await client.close(); }
