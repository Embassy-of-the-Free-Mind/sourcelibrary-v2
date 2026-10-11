#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-zh-qa-6388/prepare.mjs `packet` (opaque, seeded request ids so a reviewer cannot tell a
// sample page from a control; images under $JOB_SCRATCH). That packet carried one text per page; this one carries three
// (superseded reading, Paddle reading, stale English) and plants its errors in the English. No model call, no Mongo. $0.
//   node scripts/eval/paddle-stale-english-6388/prepare.mjs
// In: draw.json, $JOB_SCRATCH/draw-texts.json, $JOB_SCRATCH/control-bases.json (controls-pick.mjs).
// Out: controls.json, packet-map.json (committed); $JOB_SCRATCH/img/<qid>.jpg, agy-requests.jsonl (one page per row),
//      opus-batches.json (17 calls of 5 pages, in packet order).
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = process.env.JOB_SCRATCH;
const R = f => fs.readFileSync(path.join(HERE, f), 'utf8');
const draw = JSON.parse(R('draw.json')).items;
const texts = new Map(JSON.parse(fs.readFileSync(path.join(SCRATCH, 'draw-texts.json'))).map(t => [t.page_id, t]));
const bases = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'control-bases.json')));

// The five plants, written by hand against each page's Paddle text (which reads the image correctly at the span).
const PLANTS = [
  { kind: 'negation', from: 'Both its flowers and its leaves are similar to those of the common bean.', to: 'Neither its flowers nor its leaves resemble those of the common bean.', truth: '花葉俱似家豆 (its flowers and leaves resemble the common bean)' },
  { kind: 'name', from: 'following in the tracks of Zhong <note>Zhong Yao</note>', to: 'following in the tracks of Yan <note>Yan Zhenqing</note>', truth: '追跡鍾王 (follows Zhong [Yao] and Wang)' },
  { kind: 'number', from: 'It has a population of 27,000 people', to: 'It has a population of 72,000 people', truth: '居民二萬七千丁 (27,000)' },
  { kind: 'name', from: '| Wind Master |', to: '| Thunder Master |', truth: '風師 (Wind Master)' },
  { kind: 'number', from: 'is five <term>inches [cun]</term>', to: 'is eight <term>inches [cun]</term>', truth: '耜廣五寸 (five cun)' },
];
const controls = bases.map((b, i) => {
  const p = PLANTS[i];
  if (!b.english.includes(p.from)) throw new Error(`plant ${i} span not found`);
  return { page_id: b.page_id, book_id: b.book_id, title: b.title, page_number: b.page_number, image: b.image, cer: b.cer, plant: p, old: b.old, paddle: b.paddle, english: b.english.replace(p.from, p.to) };
});
fs.writeFileSync(path.join(HERE, 'controls.json'), JSON.stringify(controls.map(({ old, paddle, english, ...c }) => c), null, 1) + '\n');

const items = [
  ...draw.map(d => ({ role: 'sample', arm: d.arm, page_id: d.page_id, image: d.image, ...texts.get(d.page_id) })),
  ...controls.map(c => ({ role: 'control', arm: 'control', page_id: c.page_id, image: c.image, old: c.old, paddle: c.paddle, english: c.english })),
];
const rng = makeRng(6391);
for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
items.forEach((it, i) => { it.qid = `p${String(i + 1).padStart(2, '0')}`; });
fs.writeFileSync(path.join(HERE, 'packet-map.json'), JSON.stringify({ seed: 6391, items: items.map(({ qid, role, arm, page_id }) => ({ qid, role, arm, page_id })) }, null, 1) + '\n');

fs.mkdirSync(path.join(SCRATCH, 'img'), { recursive: true });
for (const it of items) {
  const f = path.join(SCRATCH, 'img', `${it.qid}.jpg`);
  if (fs.existsSync(f) && fs.statSync(f).size > 1000) continue;
  const res = await fetch(it.image, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`image ${it.qid} ${res.status}`);
  fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
}
const block = (it, id) => `\n\n===== PAGE ${id} =====${id.startsWith('p') ? ` (image: ./${id}.jpg)` : ''}\n\nREADING A:\n${it.old}\n\nREADING B:\n${it.paddle}\n\nENGLISH:\n${it.english}\n`;
const BODY = R('prompt-page.txt');
fs.writeFileSync(path.join(SCRATCH, 'agy-requests.jsonl'), items.map(it => JSON.stringify({ uid: it.qid, image: path.join(SCRATCH, 'img', `${it.qid}.jpg`), prompt: BODY + block(it, 'X').replace('===== PAGE X =====', '===== THE PAGE =====') + R('prompt-single-tail.txt') + '\nThe page image:' })).join('\n') + '\n');
const batches = [];
for (let i = 0; i < items.length; i += 5) {
  const b = items.slice(i, i + 5);
  batches.push({ bid: `b${String(i / 5 + 1).padStart(2, '0')}`, qids: b.map(x => x.qid), images: b.map(x => path.join(SCRATCH, 'img', `${x.qid}.jpg`)), prompt: BODY + R('prompt-batch-tail.txt') + b.map(x => block(x, x.qid)).join('') });
}
fs.writeFileSync(path.join(SCRATCH, 'opus-batches.json'), JSON.stringify(batches, null, 1));
console.log('items', items.length, 'batches', batches.length, 'controls at', items.filter(i => i.role === 'control').map(i => i.qid).join(','));
