#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-correct-6561/mkreq.mjs (builds sets.json, anchors.json and the request files; it does
// not fit because it needs the #6561 job's scratch directory and the pilot's, which no longer exist) and
// batch/prep.mjs (rebuilds the correct prompt from the live OCR prompt and checks it against results/prompt-ref.json;
// reused here through batch/prompt.mjs). This rebuilds mkreq.mjs's outputs from what #6561 COMMITTED, so a later arm
// (#6667: Sonnet and Haiku) gets the same pages, drafts, planted errors and prompt as the committed Opus rows.
//
// Usage (cwd = scratch; READ-ONLY on Mongo):
//   node --env-file=/root/sourcelibrary/.env.production.local <repo>/scripts/eval/paddle-correct-6561/rebuild.mjs --dir=<kanripo cache dir>
// Reads: results/draw.json (the 100 pages), results/anchors.json (the 30 plants), results/prompt-ref.json,
//        ../paddle-table-pilot-6388/results/pilot-sample.json (set A's Paddle text), Mongo pages (set B's Paddle
//        text), Kanripo on GitHub (the leaf named by draw.json's kanripo_pb).
// Writes: sets.json, anchors.json (with the planted drafts), req-correct.jsonl, img/<pid>.jpg.
// Check the rebuild before using it: score.mjs over the committed out-opus-correct rows must reproduce
// results/score.json page for page (the Paddle and Opus-correct CER); `rebuild.mjs` prints nothing about that itself.
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { workInfo, pbPages } from '../zh-skqs-5568-kanripo.mjs';
import { ADDENDUM_HEAD, FMT, OPUS_SUFFIX, LANGUAGE_INSTRUCTION, sha, draftBlock, correctPrompt } from './batch/prompt.mjs';

const RES = new URL('./results/', import.meta.url);
const J = (u) => JSON.parse(fs.readFileSync(u, 'utf8'));
const draw = J(new URL('draw.json', RES)), anchorKey = J(new URL('anchors.json', RES)), REF = J(new URL('prompt-ref.json', RES));
const pilot = new Map(J(new URL('../paddle-table-pilot-6388/results/pilot-sample.json', import.meta.url)).map((s) => [s.uid, s]));

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');

// ── the prompt: live default OCR prompt + the pilot addendum; must hash to the experiment's ──
const p = await db.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
const head = `${p.content.replace('{language_instruction}', LANGUAGE_INSTRUCTION).replace('{language}', '')}\n${ADDENDUM_HEAD}`;
if (sha(head) !== REF.head_sha || sha(head + FMT + OPUS_SUFFIX) !== REF.redo_opus_sha || sha(draftBlock('')) !== REF.draft_block_template_sha) {
  console.error(`PROMPT DRIFT: head ${sha(head)} (want ${REF.head_sha}); default OCR prompt is ${p.name} v${p.version}. Not the #6561 arm: stop.`);
  process.exit(3);
}
const parts = { head, fmt: FMT, suffix: OPUS_SUFFIX };

// ── pages: set A's Paddle text from the pilot sample, set B's from the page as served ──
const bDocs = new Map((await db.collection('pages').find({ id: { $in: draw.filter((d) => d.stratum !== 'A').map((d) => d.pid) } },
  { projection: { id: 1, 'ocr.data': 1, 'ocr.source': 1 } }).toArray()).map((d) => [d.id, d]));
await c.close();
fs.mkdirSync('img', { recursive: true });
const leafCache = new Map();
const sets = [];
for (const d of draw) {
  let paddle;
  if (d.stratum === 'A') paddle = pilot.get(d.pilot_uid)?.paddle;
  else { const doc = bDocs.get(d.pid); if (doc?.ocr?.source !== 'paddle') throw new Error(`${d.uid}: served read is no longer Paddle (${doc?.ocr?.source})`); paddle = doc.ocr.data; }
  if (typeof paddle !== 'string' || !paddle.trim()) throw new Error(`${d.uid}: no Paddle text`);
  let kanripo = null, kanripo_raw = null;
  if (d.kanripo_pb) {
    const [krId, , rest] = d.kanripo_pb.split('_'); const juan = Number(rest.split('-')[0]);
    const key = `${krId}_${juan}`;
    // align.mjs's rule: the juan files within 1 of the leaf's juan (file numbers can sit one off the pb's juan)
    if (!leafCache.has(key)) leafCache.set(key, await pbPages(krId, 'WYG', ((await workInfo(krId)).juan_files || []).filter((x) => Math.abs(x - juan) <= 1)));
    const leaf = leafCache.get(key).find((x) => x.pb === d.kanripo_pb);
    if (!leaf) throw new Error(`${d.uid}: no leaf ${d.kanripo_pb}`);
    kanripo = leaf.text; kanripo_raw = leaf.raw;
  }
  const image = `${process.cwd()}/img/${d.pid}.jpg`;
  if (!fs.existsSync(image) || fs.statSync(image).size < 10000) {
    const r = await fetch(d.image_url); if (!r.ok) throw new Error(`${d.uid}: image ${r.status}`);
    fs.writeFileSync(image, Buffer.from(await r.arrayBuffer()));
  }
  sets.push({ ...d, image, paddle, kanripo, kanripo_raw });
}

// ── the planted drafts, from the committed key (position, the character that was there, the one planted) ──
const anchors = anchorKey.map((a) => {
  const s = sets.find((x) => x.uid === a.base_uid); const raw = [...s.paddle];
  for (const pl of a.plants) {
    if (raw[pl.at] !== pl.was || raw.slice(Math.max(0, pl.at - 4), pl.at).join('') !== pl.left || raw.slice(pl.at + 1, pl.at + 5).join('') !== pl.right) throw new Error(`${a.uid}: the Paddle text changed at plant ${pl.at}`);
    raw[pl.at] = pl.now;
  }
  return { ...a, draft: raw.join('') };
});

const reqs = [...sets.map((s) => ({ uid: s.uid, image: s.image, prompt: correctPrompt(parts, s.paddle) })),
  ...anchors.map((x) => ({ uid: x.uid, image: sets.find((s) => s.uid === x.base_uid).image, prompt: correctPrompt(parts, x.draft) }))];
fs.writeFileSync('sets.json', JSON.stringify(sets, null, 1));
fs.writeFileSync('anchors.json', JSON.stringify(anchors, null, 1));
fs.writeFileSync('req-correct.jsonl', reqs.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`sets ${sets.length} (with leaf ${sets.filter((s) => s.kanripo).length}); anchors ${anchors.length}; requests ${reqs.length}; prompt ${p.name} v${p.version}, head ${sha(head)}`);
