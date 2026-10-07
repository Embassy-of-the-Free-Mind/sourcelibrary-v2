#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/benchmark-seal.mjs — seals one page per book per stratum from a Mongo
 * FILTER (uniform over books, screened by stored OCR ≥ 120 letters); this cohort is a fixed ID LIST
 * (the books held out of #4719), the census needs a PAGE-weighted draw with no text screen (an
 * illustration page is a census answer, not a reject), and the stored preview OCR is wanted as an
 * arm. It writes the same registry + image-directory shape so benchmark-run-api / -refs / -score /
 * -cost-lane run on it unchanged. scripts/eval/cursive-census-draw.mjs — same manifest.jsonl shape
 * for cursive-census-classify.mjs, but three pages per book over a catalogue filter.
 *
 * #5547 — Chinese OCR before the cutover: the DRAW for steps 1 (class census) and 2 (lite on the cohort).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-cohort-5547-draw.mjs \
 *     --out=/root/ocr-bench/images [--held=<ids>] [--ids=<ids>] [--n=300] [--dry]
 *
 * Cohort: the 7,894 books in ids-chinese-held-5481.txt + the Chinese books still in the #4719 ids.txt
 * (the 247 in flight). Read-only against Mongo; writes nothing there.
 *
 * Sub-strata (stratum `chinese-cohort-5547`, seed 5547):
 *   census    — n books drawn WITHOUT replacement with probability ∝ pages_count (Efraimidis–Spirakis
 *               keys u^(1/w), Mulberry32 over the id-sorted list), then one page uniform over the book's
 *               interior 10–90 %. Page-weighted, so the share of drawn pages per class estimates the
 *               share of the cohort's PAGES per class (what the OCR bill and the reader see).
 *   inflight  — every in-flight Chinese book NOT already drawn into `census`, one interior page each
 *               (step 2's natural sample: those books' production lite OCR is landing now).
 * A page with no usable image is redrawn in the same book (≤ 6 tries) and the redraw recorded.
 * The registry file is the seal (the cohort list does not change, but pages can be re-imaged).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connect, disconnect } from './lib/sampling.mjs';
import { fetchImage } from './lib/runners.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const DRY = process.argv.includes('--dry');
const HELD = argOf('held', '/root/preview-stubs-4719/ids-chinese-held-5481.txt');
const IDS = argOf('ids', '/root/preview-stubs-4719/ids.txt');
const OUT = argOf('out');
const N = parseInt(argOf('n', '300'), 10);
const SEED = 5547, STRATUM = 'chinese-cohort-5547', MAX_WIDTH = 2400;
const REG = path.join(__dirname, 'benchmark', `${STRATUM}.json`);

function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const readIds = f => fs.readFileSync(f, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
const isZh = b => /chin/i.test(b.language || '');

async function main() {
  if (fs.existsSync(REG) && !process.argv.includes('--reseal')) { console.log(`${REG} exists — sealed; exporting images only`); return exportImages(JSON.parse(fs.readFileSync(REG, 'utf8'))); }
  const { db } = await connect();
  const held = readIds(HELD), inIds = readIds(IDS);
  const P = { id: 1, title: 1, language: 1, year: 1, published: 1, pages_count: 1, pages_ocr: 1, ia_identifier: 1, work_id: 1, contributing_library: 1, 'pipeline_auto.status': 1 };
  const heldBooks = await db.collection('books').find({ id: { $in: held } }, { projection: P }).toArray();
  const inflight = (await db.collection('books').find({ id: { $in: inIds } }, { projection: P }).toArray()).filter(isZh);
  const cohort = [...heldBooks.map(b => ({ ...b, cohort: 'held' })), ...inflight.map(b => ({ ...b, cohort: 'inflight' }))]
    .filter(b => (b.pages_count || 0) > 0).sort((a, b) => a.id.localeCompare(b.id));
  console.log(`cohort: held ${heldBooks.length}, in-flight Chinese ${inflight.length}, with pages ${cohort.length}, pages ${cohort.reduce((s, b) => s + b.pages_count, 0)}`);

  // census: PPS without replacement (Efraimidis–Spirakis)
  const rnd = mulberry32(SEED);
  const keyed = cohort.map(b => ({ b, k: Math.log(rnd()) / b.pages_count })).sort((x, y) => y.k - x.k);
  const census = keyed.slice(0, N).map(x => x.b);
  const inCensus = new Set(census.map(b => b.id));
  const inflightRest = cohort.filter(b => b.cohort === 'inflight' && !inCensus.has(b.id));

  const PROJ = { page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.updated_at': 1 };
  const pages = [];
  for (const [sub, books] of [['census', census], ['inflight', inflightRest]]) {
    for (const b of books) {
      const prng = mulberry32(SEED ^ parseInt(b.id.slice(-8), 16));
      const lo = Math.max(1, Math.ceil(b.pages_count * 0.1)), hi = Math.max(lo, Math.floor(b.pages_count * 0.9));
      let picked = null; const tries = [];
      for (let t = 0; t < 6 && !picked; t++) {
        const pn = lo + Math.floor(prng() * (hi - lo + 1));
        const pg = await db.collection('pages').findOne({ book_id: b.id, page_number: pn }, { projection: PROJ, maxTimeMS: 30000 });
        const url = pg && getPageSource(pg);
        if (url) picked = { pg, url, pn }; else tries.push({ page_number: pn, reason: pg ? 'no usable image' : 'no page row' });
      }
      if (!picked) { pages.push({ slug: `${STRATUM}-${b.id.slice(-6)}-none`, book_id: b.id, substratum: sub, retired: 'image_unavailable', tries }); continue; }
      pages.push({
        slug: `${STRATUM}-${b.id.slice(-6)}-p${picked.pn}`, book_id: b.id, page_number: picked.pn, substratum: sub, cohort: b.cohort,
        title: b.title, year: b.year ?? null, published: b.published ?? null, language: b.language, pages_count: b.pages_count, pages_ocr_at_seal: b.pages_ocr || 0,
        ia_identifier: b.ia_identifier || null, work_id: b.work_id || null, skqs_shape: !b.contributing_library && /\(vol \d+\)|Siku Quanshu|四庫/.test(b.title || ''),
        image_url: picked.url, stored_ocr_model: picked.pg.ocr?.data ? picked.pg.ocr.model : null, ...(tries.length ? { redraws: tries } : {}),
      });
      if (picked.pg.ocr?.data && OUT && !DRY) {   // the stored (preview-era) reading, as an exploratory arm
        const d = path.join(OUT, STRATUM, 'out', `stored-${picked.pg.ocr.model}`); fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, `${STRATUM}-${b.id.slice(-6)}-p${picked.pn}.txt`), picked.pg.ocr.data);
      }
    }
    console.log(`  ${sub}: ${books.length} books`);
  }
  const reg = {
    stratum: STRATUM, issue: 5547, seed: SEED, sealed_at: new Date().toISOString(), max_width: MAX_WIDTH,
    draw_rule: `census: ${N} books drawn without replacement with probability ∝ pages_count (Efraimidis–Spirakis keys log(u)/pages_count, Mulberry32(${SEED}) over the id-sorted cohort), one page uniform over the interior 10–90 % (per-book Mulberry32(seed ^ last 8 hex of id)); inflight: every in-flight Chinese book of the #4719 ids.txt not in census, same page rule. No text screen. Redraw (≤ 6) only when the page has no usable image.`,
    cohort_files: { held: HELD, ids: IDS }, cohort_counts: { held: heldBooks.length, inflight: inflight.length, books_with_pages: cohort.length, pages: cohort.reduce((s, b) => s + b.pages_count, 0) },
    n: pages.filter(p => !p.retired).length, substrata: [{ name: 'census', n: census.length, reference: 'Kanripo (title + juan, --wide) / CBETA' }, { name: 'inflight', n: inflightRest.length, reference: 'same' }],
    pages,
  };
  if (DRY) { console.log(JSON.stringify(reg.pages.slice(0, 5), null, 1)); await disconnect(); return; }
  fs.writeFileSync(REG, JSON.stringify(reg, null, 2));
  console.log(`sealed ${reg.n} pages → ${REG}`);
  await disconnect();
  if (OUT) await exportImages(reg);
}

async function exportImages(reg) {
  if (!OUT) return;
  const sharp = (await import('sharp')).default;
  const dir = path.join(OUT, STRATUM); fs.mkdirSync(dir, { recursive: true });
  const manifest = []; const census = [];
  let failed = 0;
  const todo = reg.pages.filter(p => !p.retired);
  const worker = async () => {
    while (todo.length) {
      const p = todo.shift(); const dest = path.join(dir, `${p.slug}.jpg`);
      try {
        if (!fs.existsSync(dest)) {
          let buf = await fetchImage(p.image_url, 90000);
          const meta = await sharp(buf).metadata();
          if (meta.width > MAX_WIDTH) buf = await sharp(buf).resize({ width: MAX_WIDTH }).jpeg({ quality: 92 }).toBuffer();
          else if (meta.format !== 'jpeg') buf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
          fs.writeFileSync(dest, buf);
        }
        manifest.push({ slug: p.slug, bytes: fs.statSync(dest).size });
        census.push({ slug: p.slug, book_id: p.book_id, page_number: p.page_number, local_file: dest, title: p.title, substratum: p.substratum });
      } catch (e) { failed++; manifest.push({ slug: p.slug, error: String(e.message).slice(0, 100) }); console.log(`  ! ${p.slug}: ${String(e.message).slice(0, 100)}`); }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ stratum: reg.stratum, exported_at: new Date().toISOString(), pages: manifest }, null, 2));
  fs.writeFileSync(path.join(dir, 'classify-manifest.jsonl'), census.sort((a, b) => a.slug.localeCompare(b.slug)).map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`exported ${manifest.length - failed} images to ${dir} (${failed} failed)`);
}
main().catch(e => { console.error(e); process.exit(1); });
