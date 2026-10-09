#!/usr/bin/env node
// PRIOR ART: scripts/eval/engine-wave1-6011/build-bench.mjs — lays sealed images and the chart engines' outputs
// under one --root for a SEEDED SUBSET of the strata. Wave 2 does not draw: its pages are exactly each chart's
// most-pages panel (build-ocr-pareto.mjs --dump-sets), minus the pages each engine already read in wave 1, and it
// adds the Syriac ground-truth pages, which wave 1 never touched. Same image sources, same 2400 px rule (#6011).
/**
 * build-bench.mjs — assemble the wave-2 page set for #6011 (PREREGISTRATION-engine-wave2-6011.md).
 *
 *   node scripts/eval/build-ocr-pareto.mjs --dump-sets=/root/engine-wave2-6011/sets.json
 *   node scripts/eval/engine-wave2-6011/build-bench.mjs --sets=/root/engine-wave2-6011/sets.json --root=/root/engine-wave2-6011
 *
 * Writes <root>/bench (every page any engine still needs, + the chart engines' outputs for those pages),
 * <root>/bench-gpu (only the pages the three GPU engines need; they share wave-1 coverage), <root>/todo-<engine>.txt
 * and results/engine-wave2-6011/selection.json. Read-only: no database, no network except re-exporting
 * latin-period-5126 images from their sealed image_url, as wave 1 did.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchImage } from '../lib/runners.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dirname, '..');
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ROOT = argOf('root', '/root/engine-wave2-6011');
const SETS = JSON.parse(fs.readFileSync(argOf('sets', path.join(ROOT, 'sets.json')), 'utf8'));
const MAX_WIDTH = 2400;
const ENGINES = ['deepseek-ocr', 'qwen3-vl-8b', 'chandra-ocr-2', 'mistral-ocr-4-1', 'claude-sonnet-5-5', 'claude-opus-5-5'];
const GPU = ['deepseek-ocr', 'qwen3-vl-8b', 'chandra-ocr-2'];
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

// Image + comparator-output sources per stratum (the same trees wave 1 read).
const OB = '/root/ocr-bench/images';
const SRC = {
  'latin-period-5126': { img: path.join(ROOT, '_export'), out: [] },
  'eebo-tcp-5488': { img: '/root/ocr-bench-5660/eebo-tcp-5488', out: ['/root/ocr-bench-5660/eebo-tcp-5488/out'] },
  'syriac-gt': { img: `${OB}/syriac-gt`, out: [`${OB}/syriac-gt/out`] },
};
const srcOf = st => SRC[st] || { img: `${OB}/${st}`, out: [`${OB}/${st}/out`] };

// What each engine already read in wave 1 (an output row, refused or not, counts as read).
const read1 = {};
for (const e of ENGINES) read1[e] = new Set(readJsonl(path.join(EVAL, 'results', 'engine-wave1-6011', `outputs-${e}.jsonl`)).map(r => `${r.stratum}|${r.slug}`));

// Per chart × engine: the most-pages pages it has not read.
const need = Object.fromEntries(ENGINES.map(e => [e, new Set()]));
const perChart = {};
for (const [chart, s] of Object.entries(SETS)) {
  perChart[chart] = { pages: s.pages.length, engines_now: s.engines, todo: {} };
  for (const e of ENGINES) {
    const todo = s.pages.filter(k => !read1[e].has(k));
    perChart[chart].todo[e] = todo.length;
    for (const k of todo) need[e].add(k);
  }
}
const gpuKeys = new Set(GPU.flatMap(e => [...need[e]]));
for (const e of GPU) if (need[e].size !== gpuKeys.size) throw new Error(`GPU engines differ in wave-1 coverage (${e}: ${need[e].size} vs ${gpuKeys.size}); split bench-gpu per engine`);
const allKeys = new Set(ENGINES.flatMap(e => [...need[e]]));

async function saveImage(url, dest) {
  if (fs.existsSync(dest)) return;
  const sharp = (await import('sharp')).default;
  let buf = await fetchImage(url, 90000);
  const meta = await sharp(buf).metadata();
  if (meta.width > MAX_WIDTH) buf = await sharp(buf).resize({ width: MAX_WIDTH }).jpeg({ quality: 92 }).toBuffer();
  else if (meta.format !== 'jpeg') buf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
  fs.writeFileSync(dest, buf);
}

const byStratum = new Map();
for (const k of allKeys) { const [st, slug] = k.split('|'); if (!byStratum.has(st)) byStratum.set(st, []); byStratum.get(st).push(slug); }
const missing = [];
for (const [st, slugs] of [...byStratum].sort()) {
  slugs.sort();
  const { img, out } = srcOf(st);
  if (st === 'latin-period-5126') {
    const reg = readJson(path.join(EVAL, 'benchmark', `${st}.json`));
    fs.mkdirSync(img, { recursive: true });
    for (const s of slugs) {
      const wave1 = path.join('/root/engine-wave1-6011/bench/_export', `${s}.jpg`);
      if (fs.existsSync(wave1)) { if (!fs.existsSync(path.join(img, `${s}.jpg`))) fs.copyFileSync(wave1, path.join(img, `${s}.jpg`)); continue; }
      const p = reg.pages.find(x => x.slug === s);
      try { await saveImage(p.image_url, path.join(img, `${s}.jpg`)); } catch (e) { console.log(`  ! ${s}: ${e.message.slice(0, 100)}`); }
    }
  }
  for (const [root, keep] of [['bench', slugs], ['bench-gpu', slugs.filter(s => gpuKeys.has(`${st}|${s}`))]]) {
    if (!keep.length) continue;
    const dir = path.join(ROOT, root, st); fs.mkdirSync(dir, { recursive: true });
    const have = [];
    for (const s of keep) {
      const src = path.join(img, `${s}.jpg`), dst = path.join(dir, `${s}.jpg`);
      if (!fs.existsSync(src)) { if (root === 'bench') missing.push(`${st}|${s}`); continue; }
      if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
      have.push(s);
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ stratum: st, source: img, drawn_by: 'engine-wave2-6011: most-pages panel minus wave-1 reads', pages: have.map(slug => ({ slug })) }, null, 2));
  }
  // The chart engines' outputs for these pages (the scorer's textless rule and paired stats read them).
  const keep = new Set(slugs);
  for (const od of out) {
    if (!fs.existsSync(od)) continue;
    for (const e of fs.readdirSync(od)) {
      const sd = path.join(od, e); if (!fs.statSync(sd).isDirectory()) continue;
      const dd = path.join(ROOT, 'bench', st, 'out', e); fs.mkdirSync(dd, { recursive: true });
      for (const f of fs.readdirSync(sd)) { const slug = f.replace(/\.(txt|json)$/, ''); if (f.startsWith('_') || keep.has(slug)) fs.copyFileSync(path.join(sd, f), path.join(dd, f)); }
    }
  }
  if (st === 'latin-period-5126') {
    const R = path.join(EVAL, 'results', st);
    for (const f of fs.readdirSync(R).filter(f => f.startsWith('outputs-'))) {
      const e = f.replace(/^outputs-|\.jsonl$/g, ''); const d = path.join(ROOT, 'bench', st, 'out', e); fs.mkdirSync(d, { recursive: true });
      for (const r of readJsonl(path.join(R, f))) if (keep.has(r.slug)) fs.writeFileSync(path.join(d, `${r.slug}.txt`), r.text || '');
      const m = path.join(R, `meter-${e}.jsonl`); if (fs.existsSync(m)) fs.writeFileSync(path.join(d, '_meter.jsonl'), readJsonl(m).filter(r => keep.has(r.slug)).map(r => JSON.stringify(r)).join('\n') + '\n');
    }
  }
  console.log(`${st}: ${slugs.length} pages (${slugs.filter(s => gpuKeys.has(`${st}|${s}`)).length} for the GPU engines)`);
}
for (const e of ENGINES) fs.writeFileSync(path.join(ROOT, `todo-${e}.txt`), [...need[e]].map(k => k.split('|')[1]).sort().join('\n') + '\n');
const selection = { built_from: 'build-ocr-pareto.mjs --dump-sets (most-pages panel per chart, before wave 2)', charts: perChart,
  per_engine: Object.fromEntries(ENGINES.map(e => [e, need[e].size])), union: allKeys.size, gpu_pages: gpuKeys.size, missing_images: missing,
  pages: Object.fromEntries(ENGINES.map(e => [e, [...need[e]].sort()])) };
fs.writeFileSync(path.join(ROOT, 'bench-gpu', 'selection.json'), JSON.stringify({ total: gpuKeys.size }, null, 2));
const resDir = path.join(EVAL, 'results', 'engine-wave2-6011'); fs.mkdirSync(resDir, { recursive: true });
fs.writeFileSync(path.join(resDir, 'selection.json'), JSON.stringify(selection, null, 1) + '\n');
console.log(JSON.stringify({ per_engine: selection.per_engine, union: selection.union, gpu: selection.gpu_pages, missing: missing.length }));
for (const [c, v] of Object.entries(perChart)) console.log(`${c}: ${v.pages} pages, todo ${JSON.stringify(v.todo)}`);
