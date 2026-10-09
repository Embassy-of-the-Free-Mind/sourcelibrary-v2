#!/usr/bin/env node
// PRIOR ART: scripts/eval/engine-wave2-6011/build-bench.mjs — lays the sealed images and the chart engines' outputs
// under one --root for each chart's most-pages set, minus what wave 1 read. This run needs every page of every set
// (the new arms read none of them) and no re-export, so it links images from the same trees and copies outputs only.
/**
 * build-bench.mjs — the #6293 bench (PREREGISTRATION-ocr-pareto-6293.md): every page of each chart's most-pages set,
 * with the chart engines' stored outputs beside it, so benchmark-score.mjs scores the new arms exactly as wave 2 did.
 *
 *   node scripts/eval/ocr-pareto-6293/build-bench.mjs --root=$JOB_SCRATCH/bench [--transport=$JOB_SCRATCH/bench-transport]
 *
 * <root>/<stratum>/<slug>.jpg      symlink to the sealed JPEG (the trees wave 1 and 2 read)
 * <root>/<stratum>/out/<engine>/   stored outputs + _meter.jsonl rows for these pages; first source wins per engine × page
 * <root>/<stratum>/out/script-class the by-eye class files (they decide manuscript vs print)
 * --transport: the 40 transport-check pages with only the stored lite output, for the Batch-vs-realtime check.
 * Read-only: no database, no network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dirname, '..');
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ROOT = argOf('root');
const TRANSPORT = argOf('transport');
if (!ROOT) { console.error('--root required'); process.exit(1); }
const SEL = JSON.parse(fs.readFileSync(path.join(EVAL, 'results', 'ocr-pareto-6293', 'pages.json'), 'utf8'));
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// Image trees, in the order wave 2 resolved them.
const IMG = (st) => [`/root/ocr-bench/images/${st}`, `/root/ocr-bench-5660/${st}`, '/root/engine-wave2-6011/_export'];
// Output trees: the benchmark store's, #5660's (Paddle, olmOCR, lite on EEBO), wave 2's bench (latin-period-5126 and the wave engines).
const OUT = (st) => [`/root/ocr-bench/images/${st}/out`, `/root/ocr-bench-5660/${st}/out`, `/root/olm-bench-5660/${st}/out`, `/root/engine-wave2-6011/bench/${st}/out`];
const WAVE_JSONL = ['engine-wave1-6011', 'engine-wave2-6011'].flatMap((d) => {
  const dir = path.join(EVAL, 'results', d);
  return fs.readdirSync(dir).filter((f) => /^outputs-.*\.jsonl$/.test(f)).map((f) => path.join(dir, f));
});

const byStratum = new Map();
for (const k of new Set(Object.values(SEL.charts).flatMap((c) => c.pages))) {
  const [st, slug] = k.split('|');
  if (!byStratum.has(st)) byStratum.set(st, new Set());
  byStratum.get(st).add(slug);
}

function lay(root, st, slugs, engineFilter) {
  const dir = path.join(root, st);
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  const missing = [];
  for (const s of slugs) {
    const src = IMG(st).map((d) => path.join(d, `${s}.jpg`)).find((f) => fs.existsSync(f));
    if (!src) { missing.push(s); continue; }
    const dst = path.join(dir, `${s}.jpg`);
    if (!fs.existsSync(dst)) fs.symlinkSync(src, dst);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ stratum: st, drawn_by: 'ocr-pareto-6293: each chart\'s most-pages set', pages: [...slugs].sort().map((slug) => ({ slug })) }, null, 2));
  const have = new Map(); // engine -> Set(slug)
  const meterRows = new Map(); // engine -> rows
  for (const od of OUT(st)) {
    if (!fs.existsSync(od)) continue;
    for (const e of fs.readdirSync(od)) {
      const sd = path.join(od, e);
      if (!fs.statSync(sd).isDirectory() || (engineFilter && !engineFilter(e))) continue;
      const dd = path.join(dir, 'out', e);
      fs.mkdirSync(dd, { recursive: true });
      if (!have.has(e)) have.set(e, new Set());
      for (const f of fs.readdirSync(sd)) {
        if (f === '_meter.jsonl') {
          for (const r of readJsonl(path.join(sd, f)).filter((r) => slugs.has(r.slug) && !have.get(e).has(r.slug))) (meterRows.get(e) || meterRows.set(e, []).get(e)).push(r);
          continue;
        }
        const slug = f.replace(/\.(txt|json)$/, '');
        if (!slugs.has(slug) || fs.existsSync(path.join(dd, f))) continue;
        fs.copyFileSync(path.join(sd, f), path.join(dd, f));
      }
      for (const f of fs.readdirSync(dd)) if (f.endsWith('.txt')) have.get(e).add(f.slice(0, -4));
    }
  }
  if (!engineFilter) for (const f of WAVE_JSONL) {
    for (const r of readJsonl(f)) {
      if (r.stratum !== st || !slugs.has(r.slug)) continue;
      const dd = path.join(dir, 'out', r.engine);
      fs.mkdirSync(dd, { recursive: true });
      const out = path.join(dd, `${r.slug}.txt`);
      if (!fs.existsSync(out)) fs.writeFileSync(out, r.text || '');
    }
  }
  for (const [e, rows] of meterRows) fs.writeFileSync(path.join(dir, 'out', e, '_meter.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return missing;
}

const missing = [];
for (const [st, slugs] of [...byStratum].sort()) {
  missing.push(...lay(ROOT, st, slugs).map((s) => `${st}|${s}`));
  console.log(`${st}: ${slugs.size} pages; engines ${fs.readdirSync(path.join(ROOT, st, 'out')).join(', ')}`);
}
if (TRANSPORT) {
  const t = new Map();
  for (const k of SEL.transport_check.pages) { const [st, slug] = k.split('|'); if (!t.has(st)) t.set(st, new Set()); t.get(st).add(slug); }
  for (const [st, slugs] of t) missing.push(...lay(TRANSPORT, st, slugs, (e) => e === 'gemini-3.1-flash-lite' || e === 'script-class').map((s) => `transport ${st}|${s}`));
  console.log(`transport: ${SEL.transport_check.pages.length} pages in ${t.size} strata`);
}
if (missing.length) { console.error(`missing images: ${missing.join(', ')}`); process.exit(1); }
