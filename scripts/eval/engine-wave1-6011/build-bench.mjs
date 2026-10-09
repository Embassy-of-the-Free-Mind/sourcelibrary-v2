#!/usr/bin/env node
// PRIOR ART: scripts/eval/benchmark-seal.mjs — draws and exports a sealed stratum; it cannot take a
// seeded SUBSET of already-sealed strata, and it has no stratum for the Tibetan Kangyur redraw or the
// #5700 A5 corrected pages. bench2-export.mjs exports the pinned tier only. This lays the existing
// sealed images, the chart engines' outputs and the new strata side by side under one --root, so
// benchmark-run-api.mjs, the GPU box and benchmark-score.mjs all read identical bytes (#6011 wave 1).
/**
 * build-bench.mjs — assemble the wave-1 page set for #6011 (PREREGISTRATION-engine-wave1-6011.md).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/engine-wave1-6011/build-bench.mjs \
 *     --root=/root/engine-wave1-6011/bench [--registry]   # --registry also writes the two new registries + A5 refs
 *
 * Read-only against production (one Mongo read for the Tibetan page images). Pages are drawn with
 * Mulberry32(6011) over the sorted slug list of each pool; the pools are fixed in the preregistration.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchImage } from '../lib/runners.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dirname, '..');
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ROOT = argOf('root', '/root/engine-wave1-6011/bench');
const WRITE_REGISTRY = process.argv.includes('--registry');
const SEED = 6011;
const MAX_WIDTH = 2400;

function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function draw(pool, n, salt) {
  const xs = [...pool].sort(); const rand = mulberry32(SEED * 100 + salt);
  for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; }
  return xs.slice(0, Math.min(n, xs.length)).sort();
}
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const scored = (stratum) => { const D = path.join(EVAL, 'results', 'benchmark'); const f = fs.readdirSync(D).filter(x => x.startsWith(`${stratum}-2`) && x.endsWith('.json')).sort().at(-1); return readJson(path.join(D, f)); };
function copyDir(src, dst, keep) {
  if (!fs.existsSync(src)) return 0; fs.mkdirSync(dst, { recursive: true }); let n = 0;
  for (const f of fs.readdirSync(src)) { const slug = f.replace(/\.(txt|json)$/, ''); if (f.startsWith('_') || keep.has(slug)) { fs.copyFileSync(path.join(src, f), path.join(dst, f)); n++; } }
  return n;
}
function linkImages(srcDir, stratum, slugs) {
  const dir = path.join(ROOT, stratum); fs.mkdirSync(dir, { recursive: true });
  const missing = [];
  for (const s of slugs) { const src = path.join(srcDir, `${s}.jpg`), dst = path.join(dir, `${s}.jpg`); if (!fs.existsSync(src)) { missing.push(s); continue; } if (!fs.existsSync(dst)) fs.copyFileSync(src, dst); }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ stratum, source: srcDir, drawn_by: `engine-wave1-6011 seed ${SEED}`, pages: slugs.filter(s => !missing.includes(s)).map(slug => ({ slug })) }, null, 2));
  return missing;
}
async function saveImage(url, dest) {
  if (fs.existsSync(dest)) return;
  const sharp = (await import('sharp')).default;
  let buf = await fetchImage(url, 90000);
  const meta = await sharp(buf).metadata();
  if (meta.width > MAX_WIDTH) buf = await sharp(buf).resize({ width: MAX_WIDTH }).jpeg({ quality: 92 }).toBuffer();
  else if (meta.format !== 'jpeg') buf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
  fs.writeFileSync(dest, buf);
}

const selection = {};
const OB = '/root/ocr-bench/images';

// ── 1. strata already sealed: subset by seeded draw over the referenced pages of the chart's own file ──
const SUBSETS = [
  // [stratum, image dir, outputs dir(s), pool filter, n, salt]
  ['latin-period-5126', path.join(ROOT, '_export'), null, p => p.has_ref && !/corrected-OCR/.test(p.substratum || ''), 60, 1],
  ['eebo-tcp-5488', '/root/ocr-bench-5660/eebo-tcp-5488', ['/root/ocr-bench-5660/eebo-tcp-5488/out'], p => p.has_ref, 60, 2],
  ['greek', `${OB}/greek`, [`${OB}/greek/out`], p => p.has_ref, 60, 3],
  ['greek-ext', `${OB}/greek-ext`, [`${OB}/greek-ext/out`], p => p.has_ref, 49, 4],
  ['chinese', `${OB}/chinese`, [`${OB}/chinese/out`], p => p.has_ref, 60, 5],
  ['chinese-ext', `${OB}/chinese-ext`, [`${OB}/chinese-ext/out`], p => p.has_ref && p.script_class === 'woodblock', 60, 6],
  ['chinese-cohort-5547', `${OB}/chinese-cohort-5547`, [`${OB}/chinese-cohort-5547/out`], p => p.has_ref && p.script_class === 'manuscript-regular', 60, 7],
];
for (const [stratum, imgDir, outDirs, filter, n, salt] of SUBSETS) {
  const pool = scored(stratum).pages.filter(filter).map(p => p.slug);
  const slugs = draw(pool, n, salt);
  if (stratum === 'latin-period-5126') {
    // Not on this box: re-export the sealed images exactly as benchmark-seal.mjs does (same URL, same 2400 px rule).
    const reg = readJson(path.join(EVAL, 'benchmark', `${stratum}.json`));
    fs.mkdirSync(imgDir, { recursive: true });
    for (const s of slugs) { const p = reg.pages.find(x => x.slug === s); try { await saveImage(p.image_url, path.join(imgDir, `${s}.jpg`)); } catch (e) { console.log(`  ! ${s}: ${e.message.slice(0, 100)}`); } }
  }
  const missing = linkImages(imgDir, stratum, slugs);
  const keep = new Set(slugs);
  let copied = 0;
  for (const od of outDirs || []) for (const e of fs.readdirSync(od)) copied += copyDir(path.join(od, e), path.join(ROOT, stratum, 'out', e), keep);
  if (stratum === 'latin-period-5126') {
    const R = path.join(EVAL, 'results', stratum);
    for (const f of fs.readdirSync(R).filter(f => f.startsWith('outputs-'))) {
      const e = f.replace(/^outputs-|\.jsonl$/g, ''); const d = path.join(ROOT, stratum, 'out', e); fs.mkdirSync(d, { recursive: true });
      for (const r of readJsonl(path.join(R, f))) if (keep.has(r.slug)) { fs.writeFileSync(path.join(d, `${r.slug}.txt`), r.text || ''); copied++; }
      const m = path.join(R, `meter-${e}.jsonl`); if (fs.existsSync(m)) fs.writeFileSync(path.join(d, '_meter.jsonl'), readJsonl(m).filter(r => keep.has(r.slug)).map(r => JSON.stringify(r)).join('\n') + '\n');
    }
  }
  selection[stratum] = { pool: pool.length, drawn: slugs.length, missing_images: missing, chart_outputs_copied: copied, slugs };
  console.log(`${stratum}: pool ${pool.length}, drawn ${slugs.length}, images missing ${missing.length}, chart outputs copied ${copied}`);
}

// ── 2. ref-pinned Hebrew (the four pinned pages; passage-level tier, scored by the house aligner) ──
{
  const j = scored('ref-pinned');
  const slugs = j.pages.filter(p => p.language === 'Hebrew').map(p => p.slug).sort();
  const missing = linkImages(`${OB}/ref-pinned`, 'ref-pinned', slugs);
  let copied = 0; for (const e of fs.readdirSync(`${OB}/ref-pinned/out`)) copied += copyDir(`${OB}/ref-pinned/out/${e}`, path.join(ROOT, 'ref-pinned', 'out', e), new Set(slugs));
  selection['ref-pinned'] = { pool: slugs.length, drawn: slugs.length, missing_images: missing, chart_outputs_copied: copied, slugs };
  console.log(`ref-pinned (Hebrew): ${slugs.length}, chart outputs copied ${copied}`);
}

// ── 3. A5 (#5700): Sanskrit, Persian, Arabic, Hebrew pages with a by-eye corrected transcription ──
{
  const stratum = 'a5-nonlatin-5700';
  const tracks = readJsonl(path.join(EVAL, 'results', 'reocr-lift-2026-10', 'track-pages.jsonl'));
  const reocr = readJsonl(path.join(EVAL, 'results', 'reocr-lift-2026-10', 'reocr.jsonl')).filter(r => r.arm === 'reocr');
  const rows = tracks.filter(t => ['Sanskrit', 'Persian', 'Arabic', 'Hebrew'].includes(t.lang) && [true, 'True'].includes(t.has_corrected) && t.corrected_text);
  const dir = path.join(ROOT, stratum); fs.mkdirSync(path.join(dir, 'out', 'gemini-3-flash-preview'), { recursive: true }); fs.mkdirSync(path.join(dir, 'out', 'served-ocr'), { recursive: true });
  const pages = [];
  for (const t of rows) {
    const slug = `a5-${t.id.replace(/_0*/, '-p')}`;
    const r = reocr.find(x => x.id === t.id);
    if (!r?.image) { console.log(`  ! ${slug}: no re-OCR image record`); continue; }
    try { await saveImage(r.image, path.join(dir, `${slug}.jpg`)); } catch (e) { console.log(`  ! ${slug}: ${e.message.slice(0, 100)}`); continue; }
    fs.writeFileSync(path.join(dir, 'out', 'gemini-3-flash-preview', `${slug}.txt`), r.text || '');
    fs.appendFileSync(path.join(dir, 'out', 'gemini-3-flash-preview', '_meter.jsonl'), JSON.stringify({ slug, engine: 'gemini-3-flash-preview', finishReason: r.finishReason, prompt: 'production-v19.1', source: 'reocr-lift-2026-10/reocr.jsonl' }) + '\n');
    fs.writeFileSync(path.join(dir, 'out', 'served-ocr', `${slug}.txt`), t.ocr_text || '');
    pages.push({ slug, book_id: t.book_id, page_number: +t.page_number, substratum: t.lang, title: null, year: /^\d{4}$/.test(String(t.edition_year)) ? +t.edition_year : null, language: t.lang, image_url: r.image, spare: false,
      reference_plan: `corrected served OCR, by eye (#5695 track ${t.track}; reocr-lift-2026-10/track-pages.jsonl corrected_text)`, ref_text: t.corrected_text });
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ stratum, pages: pages.map(p => ({ slug: p.slug })) }, null, 2));
  if (WRITE_REGISTRY) {
    const reg = { stratum, issue: 6011, seed: null, sealed_at: new Date().toISOString(),
      draw_rule: 'not drawn: every #5695 track page in Sanskrit, Persian, Arabic or Hebrew whose by-eye corrected transcription exists (reocr-lift-2026-10/track-pages.jsonl has_corrected), image = the leaf the #5700 A5 re-OCR read',
      max_width: MAX_WIDTH, n: pages.length, spares: 0, spare_rule: 'none',
      substrata: ['Sanskrit', 'Persian', 'Arabic', 'Hebrew'].map(l => ({ name: l, n: pages.filter(p => p.language === l).length, reference: 'served OCR corrected by eye (#5695); favours the engine that made the served OCR' })),
      pages: pages.map(({ ref_text, ...p }) => p) };
    fs.writeFileSync(path.join(EVAL, 'benchmark', `${stratum}.json`), JSON.stringify(reg, null, 2) + '\n');
    for (const p of pages) {
      fs.writeFileSync(path.join(EVAL, 'benchmark', 'refs', `${p.slug}.txt`), p.ref_text);
      fs.writeFileSync(path.join(EVAL, 'benchmark', 'refs', `${p.slug}.json`), JSON.stringify({ slug: p.slug, substratum: p.language, source: 'by-eye corrected transcription of the served OCR (#5695, #5700 A5)', licence: 'CC0 (transcription of a public-domain page)', reference_kind: 'corrected-served-ocr' }, null, 2) + '\n');
    }
  }
  selection[stratum] = { pool: rows.length, drawn: pages.length, by_language: Object.fromEntries(['Sanskrit', 'Persian', 'Arabic', 'Hebrew'].map(l => [l, pages.filter(p => p.language === l).length])), slugs: pages.map(p => p.slug) };
  console.log(`${stratum}: ${pages.length} pages ${JSON.stringify(selection[stratum].by_language)}`);
}

// ── 4. Tibetan: 60 of the 100 Kangyur pages of the 2026-10-01 confirmatory redraw (#4523) ──
{
  const stratum = 'tibetan-kangyur-4523';
  const T = '/root/tibetan-eval/redraw-2026-10-01';
  const sample = readJsonl(path.join(T, 'tib-sample.jsonl')).filter(r => r.stratum === 'bl-kanjur');
  const slugOf = r => `tib-${r.book_id}-p${r.page_number}`;
  const slugs = draw(sample.map(slugOf), 60, 8);
  const keep = sample.filter(r => slugs.includes(slugOf(r)));
  const { MongoClient } = await import('mongodb');
  const { getPageSource } = await import('../../lib/page-image-url.mjs');
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  const dir = path.join(ROOT, stratum); fs.mkdirSync(path.join(dir, 'out', 'bdrc-yigdzin-v1'), { recursive: true });
  const pages = [];
  for (const r of keep) {
    const slug = slugOf(r);
    const pg = await db.collection('pages').findOne({ book_id: r.book_id, page_number: r.page_number }, { projection: { photo: 1, archived_photo: 1, cropped_photo: 1, photo_original: 1, enhanced_photo: 1, split_from_spread: 1 } });
    const url = pg ? getPageSource(pg) : null;
    if (!url) { console.log(`  ! ${slug}: no page image`); continue; }
    try { await saveImage(url, path.join(dir, `${slug}.jpg`)); } catch (e) { console.log(`  ! ${slug}: ${e.message.slice(0, 100)}`); continue; }
    fs.writeFileSync(path.join(dir, 'out', 'bdrc-yigdzin-v1', `${slug}.txt`), r.text || '');
    pages.push({ slug, id: r.id, book_id: r.book_id, page_number: r.page_number, substratum: 'bl-kanjur', title: r.title, language: 'Tibetan', image_url: url, spare: false, reference_plan: 'Derge Kangyur e-text (OpenPecha P000001), window located per engine by kanjur_align.py; identity = syllable Needleman–Wunsch identity' });
  }
  await client.close();
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ stratum, pages: pages.map(p => ({ slug: p.slug, id: p.id })) }, null, 2));
  if (WRITE_REGISTRY) {
    fs.writeFileSync(path.join(EVAL, 'benchmark', `${stratum}.json`), JSON.stringify({ stratum, issue: 4523, seed: SEED, sealed_at: new Date().toISOString(),
      draw_rule: '60 of the 100 bl-kanjur pages of the 2026-10-01 confirmatory redraw (results/tibetan-ocr-redraw-2026-10-01), Mulberry32(6011*100+8) over the sorted slug list; image = getPageSource(page) at build time',
      max_width: MAX_WIDTH, n: pages.length, spares: 0, spare_rule: 'none',
      substrata: [{ name: 'bl-kanjur', n: pages.length, reference: 'Derge Kangyur e-text located per engine (kanjur_align.py); scored as syllable identity, not CER' }],
      scorer: 'kanjur_align.py (Hetzner /root/tibetan-eval), not benchmark-score.mjs', pages }, null, 2) + '\n');
  }
  selection[stratum] = { pool: sample.length, drawn: pages.length, slugs: pages.map(p => p.slug) };
  console.log(`${stratum}: ${pages.length} of ${sample.length}`);
}

const total = Object.values(selection).reduce((a, s) => a + s.drawn, 0);
fs.writeFileSync(path.join(ROOT, 'selection.json'), JSON.stringify({ seed: SEED, total, strata: selection }, null, 2));
const resDir = path.join(EVAL, 'results', 'engine-wave1-6011'); fs.mkdirSync(resDir, { recursive: true });
fs.writeFileSync(path.join(resDir, 'selection.json'), JSON.stringify({ seed: SEED, total, strata: Object.fromEntries(Object.entries(selection).map(([k, v]) => [k, { ...v }])) }, null, 2) + '\n');
console.log(`TOTAL ${total} pages`);
