#!/usr/bin/env node
// PRIOR ART: scripts/lib/ia-djvu-leaves.mjs (the Archive's per-leaf text, used as-is here);
// benchmark-run-api.mjs (writes <engine>/<slug>.txt + _meter.jsonl for API arms — the meter shape the
// gemini arm below copies, without calling the API).
/**
 * prep.mjs — lay out the bench root for `refused-en-4686` and write the two arms that need no engine run.
 *
 *   node --env-file=.env.production.local scripts/eval/kraken-refused-4686/prep.mjs --root=/root/kraken-refused-4686/bench
 *
 *   <root>/refused-en-4686/<slug>.jpg          the archived master image of the sealed leaf
 *   out/gemini-3.1-flash-lite/<slug>.txt      empty + _meter.jsonl finishReason RECITATION — the pipeline's
 *                                             recorded outcome (`ocr.recitation_blocked`), NOT a new call
 *   out/ia-abbyy/<slug>.txt                   the Archive's ABBYY text of the same leaf (`/page/n<k>` = OBJECT[k])
 * Reads Mongo and archive.org; writes only under --root.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { iaLeaves } from '../../lib/ia-djvu-leaves.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ROOT = argOf('root');
if (!ROOT) { console.error('--root required'); process.exit(1); }
const STRATUM = 'refused-en-4686';
const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'benchmark', `${STRATUM}.json`), 'utf8'));
const dir = path.join(ROOT, STRATUM);
const sealed = reg.pages.filter(p => !p.retired && (!p.spare || p.promoted));
fs.mkdirSync(path.join(dir, 'out', 'gemini-3.1-flash-lite'), { recursive: true });
fs.mkdirSync(path.join(dir, 'out', 'ia-abbyy'), { recursive: true });

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const pagesCol = client.db('bookstore').collection('pages');
const meter = [];
const leavesByItem = new Map();
for (const p of sealed) {
  const img = path.join(dir, `${p.slug}.jpg`);
  if (!fs.existsSync(img)) {
    const res = await fetch(p.image_url);
    if (!res.ok) throw new Error(`${p.slug}: HTTP ${res.status} for ${p.image_url}`);
    fs.writeFileSync(img, Buffer.from(await res.arrayBuffer()));
  }
  fs.writeFileSync(path.join(dir, 'out', 'gemini-3.1-flash-lite', `${p.slug}.txt`), '');
  meter.push({ slug: p.slug, finishReason: 'RECITATION', source: 'pipeline stamp ocr.recitation_blocked (not re-run)', recitation_count: p.gemini?.recitation_count ?? null });

  const doc = await pagesCol.findOne({ id: p.page_id }, { projection: { photo: 1 } });
  const m = String(doc?.photo || '').match(/\/page\/n(\d+)\//);
  if (!m) { console.warn(`${p.slug}: no /page/n<k>/ in photo (${doc?.photo}); no ia-abbyy output`); continue; }
  if (!leavesByItem.has(p.ia_identifier)) leavesByItem.set(p.ia_identifier, await iaLeaves(p.ia_identifier, [], { cacheDir: path.join(ROOT, '_ia-cache') }));
  const { leaves, reason } = leavesByItem.get(p.ia_identifier);
  if (!leaves) { console.warn(`${p.slug}: ${reason}`); continue; }
  fs.writeFileSync(path.join(dir, 'out', 'ia-abbyy', `${p.slug}.txt`), leaves[Number(m[1])] ?? '');
  console.log(`${p.slug}: leaf n${m[1]} of ${leaves.length}, ${(leaves[Number(m[1])] || '').length} chars`);
}
fs.writeFileSync(path.join(dir, 'out', 'gemini-3.1-flash-lite', '_meter.jsonl'), meter.map(r => JSON.stringify(r)).join('\n') + '\n');
await client.close();
console.log(`${sealed.length} sealed pages laid out under ${dir}`);
