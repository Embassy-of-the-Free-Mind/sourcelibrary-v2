#!/usr/bin/env node
/**
 * Precision of the `self_declared_blank` rule (#4149): a seeded, stratified sample
 * of the pages the corpus walk flagged, each image downloaded and ink-measured,
 * plus a seeded sub-sample saved for reading by eye.
 *
 * PRIOR ART: scripts/audit/detect-fabricated-ocr.mjs — its own image pass measures
 * ink in encounter-shuffled order over ONE screen's output; this samples the
 * self_declared_blank walk's JSONL by stratum and saves images for eye-labelling,
 * which that pass does not do. scripts/eval/blank-page-study.mjs runs a model over
 * known-blank pages; it does not measure a detector's precision.
 *
 * Read-only. No model calls.
 *
 *   node --env-file=.env.production.local scripts/eval/self-declared-blank-precision.mjs \
 *     --in=scripts/output/self-declared-blank-2026-10-02.jsonl [--per-stratum=20] [--eye=20] [--seed=4149]
 *
 * Writes <in>.sample.jsonl and the eye-subset images under <in-dir>/sdb-eye/.
 */
import { MongoClient, ObjectId } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import sharp from 'sharp';
import { inkCoverage, DEFAULT_INK_MAX } from '../lib/blank-page-guard.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const IN = arg('in', '');
const PER = Number(arg('per-stratum', '20'));
const EYE = Number(arg('eye', '20'));
let seed = Number(arg('seed', '4149')) >>> 0;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
if (!IN) throw new Error('--in=<self-declared-blank jsonl> required');

/** Strata, most specific first. A row belongs to the first that matches. */
function stratum(signals) {
  if (signals.includes('page_type_blank')) return 'page_type_blank';
  if (signals.some((s) => s.endsWith(':blank'))) return 'tag_says_blank';
  return 'showthrough_only';
}

/** Same precedence as src/lib/page-image-url.ts getPageSource, plus the legacy crop. */
function pageSource(p) {
  const ok = (u) => typeof u === 'string' && /^https?:\/\//.test(u);
  if (ok(p.cropped_photo)) return { url: p.cropped_photo };
  if (p.split_from_spread && ok(p.photo)) return { url: p.photo };
  const crop = p.crop?.xStart !== undefined && p.crop?.xEnd !== undefined ? p.crop : null;
  for (const u of [p.archived_photo, p.photo_original, p.photo]) if (ok(u)) return { url: u, crop };
  return null;
}

async function fetchImage(src) {
  const res = await fetch(src.url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let buf = Buffer.from(await res.arrayBuffer());
  if (src.crop) {
    const meta = await sharp(buf).metadata();
    const left = Math.round(meta.width * src.crop.xStart / 1000);
    const width = Math.max(1, Math.round(meta.width * (src.crop.xEnd - src.crop.xStart) / 1000));
    buf = await sharp(buf).extract({ left, top: 0, width: Math.min(width, meta.width - left), height: meta.height }).jpeg().toBuffer();
  }
  return buf;
}

// Reservoir-sample PER rows per stratum in one pass (the file can be ~10^6 rows).
const seen = new Set();
const res = {}; const pop = {};
const rl = readline.createInterface({ input: fs.createReadStream(IN) });
for await (const line of rl) {
  if (!line) continue;
  const r = JSON.parse(line);
  if (seen.has(r.page_id)) continue; // a resumed walk can re-emit rows
  seen.add(r.page_id);
  const s = stratum(r.signals);
  pop[s] = (pop[s] || 0) + 1;
  res[s] = res[s] || [];
  if (res[s].length < PER) res[s].push(r);
  else { const j = Math.floor(rand() * pop[s]); if (j < PER) res[s][j] = r; }
}
console.log('population by stratum (deduped):', pop);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const outFile = IN.replace(/\.jsonl$/, '.sample.jsonl');
const eyeDir = path.join(path.dirname(IN), 'sdb-eye');
fs.mkdirSync(eyeDir, { recursive: true });
const rows = [];
for (const [s, list] of Object.entries(res)) {
  for (const r of list) {
    const id = /^[0-9a-f]{24}$/.test(r.page_id) ? new ObjectId(r.page_id) : r.page_id;
    const p = await db.collection('pages').findOne({ _id: id },
      { projection: { photo: 1, archived_photo: 1, photo_original: 1, cropped_photo: 1, split_from_spread: 1, crop: 1 } });
    const b = await db.collection('books').findOne({ id: r.book_id }, { projection: { title: 1, visible: 1, pages_count: 1 } });
    const src = p && pageSource(p);
    let ink = null, err = null, buf = null;
    try {
      if (src) {
        const full = await fetchImage(src);
        ink = await inkCoverage(full);
        buf = await sharp(full).resize(1400, 1400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(); // for the eye; keeps memory bounded
      } else err = 'no image url';
    } catch (e) { err = e.message; }
    rows.push({ stratum: s, ...r, title: b?.title, live: !!(b?.visible && b?.pages_count > 0), image: src?.url ?? null,
      cropped: !!src?.crop, ink_coverage: ink == null ? null : Number(ink.toFixed(5)),
      ink_verdict: ink == null ? 'unmeasured' : ink <= DEFAULT_INK_MAX ? 'white' : 'inked', error: err, _buf: buf });
  }
}
await client.close();

// Seeded eye sub-sample, spread across strata in proportion to the sample.
const measured = rows.filter((r) => r._buf);
for (let i = measured.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [measured[i], measured[j]] = [measured[j], measured[i]]; }
const strata = [...new Set(measured.map((r) => r.stratum))];
const eye = [];
for (let k = 0; eye.length < Math.min(EYE, measured.length); k++) {
  const s = strata[k % strata.length];
  const next = measured.find((r) => r.stratum === s && !eye.includes(r));
  if (next) eye.push(next);
  if (k > EYE * 10) break;
}
eye.forEach((r, i) => {
  r.eye_id = `eye${String(i + 1).padStart(2, '0')}`;
  fs.writeFileSync(path.join(eyeDir, `${r.eye_id}.jpg`), r._buf);
});
fs.writeFileSync(outFile, rows.map(({ _buf, ...r }) => JSON.stringify(r)).join('\n') + '\n');

const tab = {};
for (const r of rows) { tab[r.stratum] = tab[r.stratum] || { n: 0, white: 0, inked: 0, unmeasured: 0 }; tab[r.stratum].n++; tab[r.stratum][r.ink_verdict]++; }
console.log('ink by stratum:', tab);
console.log(`eye subset: ${eye.length} images in ${eyeDir} (${eye.map((r) => `${r.eye_id}=${r.stratum}`).join(', ')})`);
console.log(`rows -> ${outFile}`);
