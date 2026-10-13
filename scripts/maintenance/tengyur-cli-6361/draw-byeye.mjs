#!/usr/bin/env node
// PRIOR ART: scripts/eval/spot-check/draw.mjs draws 3 consecutive TRANSLATED pages of random BOOKS from the public
// frame; this gate draws from the 37 volumes of one run and needs the STAGED English beside the stored one, from files
// that are not in Mongo yet, plus the two volumes with the most extreme length ratio. Same unit (3 consecutive pages).
//
// #6361 stage 2, step 3: draw the by-eye read and build one packet per page (image, OCR, stored English, staged
// English as the door would store it). Read-only on Mongo; images from the archived R2 copy.
//   node scripts/maintenance/tengyur-cli-6361/draw-byeye.mjs --gates=$JOB_SCRATCH/gates --stored=$JOB_SCRATCH/stored-before.jsonl.gz \
//     --out=$JOB_SCRATCH/byeye [--seed=6361]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { sanitizeTranslationTags, guardTranslationText } from '../../lib/translate-core.mjs';
import { unwrapHiddenTranslation } from '../../lib/hidden-translation.mjs';
import { strayScriptVerdict } from '../../lib/stray-script.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const W = arg('run', '/root/tengyur-cli-6361');
const G = arg('gates'), OUT = arg('out'), SEED = Number(arg('seed', '6361'));
const MIN_SRC = 300;
// mulberry32: a recorded seed reproduces the draw.
let a = SEED >>> 0;
const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const gates = JSON.parse(fs.readFileSync(path.join(G, 'gates.json'), 'utf8'));
const skip = new Set(fs.readFileSync(path.join(G, 'skip.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).page_id));
const stored = new Map(zlib.gunzipSync(fs.readFileSync(arg('stored'))).toString('utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.page_id, r]; }));
const manifest = fs.readFileSync(path.join(W, 'manifest.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// The two extremes: staged median ratio relative to the stored median ratio, highest and lowest.
const rel = gates.table.map((t) => ({ vol: t.vol, rel: t.staged_ratio_median / t.stored_ratio_median })).sort((x, y) => x.rel - y.rel);
const extremes = [rel[rel.length - 1], rel[0]].map((r) => ({ ...r, why: 'extreme length ratio' }));
const pool = gates.table.map((t) => t.vol).filter((v) => !extremes.some((e) => e.vol === v));
const random = [];
while (random.length < 5) { const v = pool.splice(Math.floor(rnd() * pool.length), 1)[0]; random.push({ vol: v, why: `random (seed ${SEED})` }); }

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const draw = [];
for (const pick of [...random, ...extremes]) {
  const rows = manifest.filter((m) => m.vol === pick.vol).sort((x, y) => x.page_number - y.page_number);
  const ok = (m) => m && m.status === 'staged' && !skip.has(m.page_id) && (stored.get(m.page_id)?.ocr || '').length >= MIN_SRC;
  const starts = rows.map((m, i) => i).filter((i) => ok(rows[i]) && ok(rows[i + 1]) && ok(rows[i + 2]) && rows[i + 2].page_number === rows[i].page_number + 2);
  const i0 = starts[Math.floor(rnd() * starts.length)];
  const run = rows.slice(i0, i0 + 3);
  const dir = path.join(OUT, `vol${pick.vol}`);
  fs.mkdirSync(dir, { recursive: true });
  const docs = await db.collection('pages').find({ id: { $in: run.map((m) => m.page_id) } }, { projection: { _id: 0, id: 1, page_label: 1, archived_photo: 1, photo: 1 } }).toArray();
  const pages = [];
  for (const m of run) {
    const s = stored.get(m.page_id), d = docs.find((x) => x.id === m.page_id);
    const raw = (JSON.parse(fs.readFileSync(path.join(W, 'out', `${m.page_id}.json`), 'utf8')).agy.response || '').trim();
    const staged = strayScriptVerdict(unwrapHiddenTranslation({ ocr: s.ocr, tr: guardTranslationText(sanitizeTranslationTags(raw)), type: s.page_type }).text, { ocr: s.ocr, language: 'Tibetan' }).text;
    const url = d.archived_photo || d.photo;
    const img = await fetch(url);
    if (!img.ok) throw new Error(`image ${url}: ${img.status}`);
    const base = `p${m.page_number}`;
    fs.writeFileSync(path.join(dir, `${base}.jpg`), Buffer.from(await img.arrayBuffer()));
    fs.writeFileSync(path.join(dir, `${base}.ocr.txt`), s.ocr);
    fs.writeFileSync(path.join(dir, `${base}.stored.txt`), s.translation?.data || '');
    fs.writeFileSync(path.join(dir, `${base}.staged.txt`), staged);
    pages.push({ page_id: m.page_id, page_number: m.page_number, page_label: d.page_label ?? null, image_url: url, stored_model: s.translation?.model ?? null, staged_model: m.model, files: base });
  }
  draw.push({ vol: pick.vol, book_id: run[0].book_id, section: run[0].section, why: pick.why, ...(pick.rel ? { rel_ratio: Math.round(pick.rel * 1000) / 1000 } : {}), pages });
}
await client.close();
fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify({ seed: SEED, at: new Date().toISOString(), min_src_chars: MIN_SRC, draw }, null, 1));
console.log(JSON.stringify(draw.map((d) => ({ vol: d.vol, why: d.why, pages: d.pages.map((p) => p.page_number) }))));
