#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-correct-6561/rebuild.mjs (fetches images and Paddle text for a committed draw, but
// from its own sets with its own prompt check) and scripts/eval/paddle-table-6388/align.mjs (the Kanripo leaf per
// page: same rule here, own qa_screen pb at dice ≥ 0.6, via zh-skqs-5568-kanripo.mjs pbPages).
/**
 * prep.mjs — images (stored R2 copy and the Archive's full-size file), stored Paddle text, Kanripo leaf, GPU manifests.
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-ditto-restore-5274/prep.mjs
 * READ-ONLY on Mongo. Everything goes to $JOB_SCRATCH/w; the committed draw is results/draw.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { workInfo, pbPages } from '../zh-skqs-5568-kanripo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = path.join(process.env.JOB_SCRATCH, 'w');
for (const d of ['img/r2', 'img/ia', 'p0', 'p1']) fs.mkdirSync(path.join(W, d), { recursive: true });
const draw = JSON.parse(fs.readFileSync(path.join(HERE, '../results/zh-ditto-restore-5274/draw.json'), 'utf8')).pages;
const c = await MongoClient.connect(process.env.MONGODB_URI, { compressors: ['zlib'] });
const docs = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: draw.map((d) => d.pid) } }, { projection: { _id: 0, id: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.qa_screen': 1 } }).toArray()).map((d) => [d.id, d]));
await c.close();
const dl = async (url, f) => {
  if (fs.existsSync(f) && fs.statSync(f).size > 5000) return;
  for (let t = 0; t < 4; t++) {
    try { const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) }); if (!r.ok) throw new Error(`${r.status}`); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); return; } catch (e) { if (t === 3) throw e; await new Promise((s) => setTimeout(s, 3000 * (t + 1))); }
  }
};
const leaves = new Map();
const pages = [];
for (const d of draw) {
  const doc = docs.get(d.pid);
  if (doc?.ocr?.source !== 'paddle') throw new Error(`${d.slug}: served read is no longer Paddle`);
  fs.writeFileSync(path.join(W, 'p0', `${d.slug}.txt`), doc.ocr.data);
  await dl(d.r2, path.join(W, 'img/r2', `${d.slug}.jpg`));
  await dl(d.ia, path.join(W, 'img/ia', `${d.slug}.jpg`));
  const q = doc.ocr.qa_screen;
  let kanripo = null;
  if (q?.status === 'screened' && q.dice >= 0.6 && q.pb) {
    const krId = String(q.repo).replace(/^kanripo\//, ''); const juan = Number(q.pb.match(/_(\d{3})-\d+[ab]$/)?.[1]);
    const key = `${krId}_${juan}`;
    if (!leaves.has(key)) leaves.set(key, await pbPages(krId, 'WYG', ((await workInfo(krId)).juan_files || []).filter((x) => Math.abs(x - juan) <= 1)));
    const leaf = leaves.get(key).find((x) => x.pb === q.pb);
    if (leaf) kanripo = { pb: q.pb, repo: q.repo, sha: q.sha, dice: q.dice, raw: leaf.raw, text: leaf.text };
  }
  pages.push({ ...d, kanripo });
  console.log(d.slug, q?.dice, kanripo ? `${[...kanripo.text].length} chars, ${(kanripo.text.match(/丨/g) || []).length} marks` : 'NO LEAF');
}
fs.writeFileSync(path.join(W, 'pages.json'), JSON.stringify(pages, null, 1));
const lines = (dir) => pages.map((p) => `${p.bid}\t${p.pn}\t${path.join(W, dir, `${p.slug}.jpg`)}`).join('\n') + '\n';
for (const [arm, dir] of [['r2', 'img/r2'], ['ia', 'img/ia'], ['ia-nolayout', 'img/ia'], ['up3', 'img/up3']]) {
  fs.mkdirSync(path.join(W, 'p1', arm), { recursive: true });
  fs.writeFileSync(path.join(W, 'p1', arm, 'manifest.tsv'), lines(dir));
}
