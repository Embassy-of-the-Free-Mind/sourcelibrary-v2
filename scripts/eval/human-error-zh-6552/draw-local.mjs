#!/usr/bin/env node
// PRIOR ART: draw-a2.mjs (this directory; stored Paddle reads only, and only 4 KR2 works and no KR4 work have one); /root/pz/code/paddle-vl-run.py
// (the reader, used as is). This draws the missing works, reads candidates locally into scratch, and keeps the first aligned page per work.
// #6552. READ-ONLY on Mongo; a local read is never written anywhere but $JOB_SCRATCH and is labelled ocr_source: "local-paddle-vl".
//   node --env-file=... draw-local.mjs --stage=stored        adds 史記 (the one KR2 work left with a stored Paddle read)
//   node --env-file=... draw-local.mjs --stage=candidates    writes $JOB_SCRATCH/a/local/{manifest.tsv,cand.json}, fetches images
//   node --env-file=... draw-local.mjs --stage=match         aligns the reads, appends to draw-a2.json
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { bodyText } from '../ground-truth-5935/lib.mjs';
process.argv.push(`--dir=${process.env.JOB_SCRATCH}/kanripo-cache`);
const { workInfo, pbPages, best, fold } = await import('../zh-skqs-5568-kanripo.mjs');
const STAGE = process.argv.find((x) => x.startsWith('--stage='))?.slice(8), SEED = 65523, DICE = 0.9, MIN_HAN = 120, NEED = { KR2: 5, KR4: 3 }, OVER = { KR2: 10, KR4: 8 }, PER = 3;
const A = path.join(process.env.JOB_SCRATCH, 'a'), L = path.join(A, 'local'), DRAW = new URL('./draw-a2.json', import.meta.url), rng = makeRng(SEED);
fs.mkdirSync(path.join(L, 'img'), { recursive: true });
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const copyOf = async (ia) => { const r = await (await fetch(`https://archive.org/metadata/${ia}/metadata`)).json(); const d = [].concat(r.result?.description || []).join('|'); return /薈要|會要/.test(d) ? 'huiyao' : /欽定四庫全書/.test(d) ? 'wenyuange' : 'unknown'; };
const c = await MongoClient.connect(process.env.MONGODB_URI, { compressors: ['zlib'] }), db = c.db('bookstore'), draw = JSON.parse(fs.readFileSync(DRAW));
const save = () => fs.writeFileSync(DRAW, JSON.stringify(draw, null, 1) + '\n');
const keep = (p, kr, cls, w, pbs, m, text, source, visible, title, image) => {
  const pb = pbs[m.i];
  draw.picked.push({ uid: `A-${kr}`, kr, cls, witness_sha: w.witness_sha, book_id: p.book_id, title, visible, page_id: p.page_id, pn: p.pn, image, pb: pb.pb, dice: +m.dice.toFixed(3), runner_up: +m.second.toFixed(3), ocr_source: source, copy: 'wenyuange', dice_recomputed: true });
  fs.writeFileSync(path.join(A, `A-${kr}.json`), JSON.stringify({ ocr: bodyText(text), typed: (pbs[m.i - 1]?.raw || '').slice(-60) + '\u0001' + pb.raw + '\u0001' + (pbs[m.i + 1]?.raw || '').slice(0, 60) }));
};
if (STAGE === 'stored') {
  const kr = 'KR2a0001', w = await workInfo(kr), pbs = await pbPages(kr, w.witness, w.juan_files);
  for (const b of shuffle(await db.collection('books').find({ work_id: `kr:${kr}` }, { projection: { id: 1, title: 1, visible: 1, ia_identifier: 1 } }).toArray())) {
    if (draw.picked.some((p) => p.kr === kr) || await copyOf(b.ia_identifier) !== 'wenyuange') continue;
    for (const p of await db.collection('pages').aggregate([{ $match: { book_id: b.id, 'ocr.source': 'paddle' } }, { $sample: { size: 25 } }, { $project: { id: 1, page_number: 1, 'ocr.data': 1, archived_photo: 1, display_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1 } }]).toArray()) {
      const Q = fold(bodyText(p.ocr.data)); if ([...Q].length < MIN_HAN) continue;
      const m = best(Q, pbs); if (!m || m.dice < DICE) continue;
      keep({ book_id: b.id, page_id: p.id, pn: p.page_number }, kr, 'KR2', w, pbs, m, p.ocr.data, 'paddle', !!b.visible, b.title, getPageSource(p));
      console.log('picked', kr, b.title.slice(0, 24), p.page_number, m.dice.toFixed(3)); break;
    }
  }
  save();
} else if (STAGE === 'candidates') {
  const works = {};
  for await (const b of db.collection('books').find({ work_id: /^kr:KR[24]/ }, { projection: { id: 1, work_id: 1, ia_identifier: 1 } }).batchSize(1000)) (works[b.work_id.slice(3)] ||= []).push(b);
  const PADDLE = new Set(['KR2a0001', 'KR2a0007', 'KR2a0009', 'KR2a0012']), cand = [], rows = [], got = { KR2: 0, KR4: 0 };
  for (const kr of shuffle(Object.keys(works).filter((k) => !PADDLE.has(k)))) {
    const cls = kr.slice(0, 3); if (got[cls] >= OVER[cls]) continue;
    const w = await workInfo(kr).catch(() => ({})); if (w.witness !== 'WYG') continue;
    const b = shuffle([...works[kr]])[0]; if (!b.ia_identifier || await copyOf(b.ia_identifier) !== 'wenyuange') continue;
    const pool = await db.collection('pages').aggregate([{ $match: { book_id: b.id, page_number: { $gt: 8 } } }, { $sample: { size: PER } }, { $project: { id: 1, page_number: 1, photo: 1 } }]).toArray();
    let n = 0;
    for (const p of pool) {
      if (!/archive\.org/.test(p.photo || '')) continue;
      const r = await fetch(p.photo, { redirect: 'follow' }); if (!r.ok) continue;
      const rel = `img/${kr}-${p.page_number}.jpg`; fs.writeFileSync(path.join(L, rel), Buffer.from(await r.arrayBuffer()));
      rows.push(`${kr}\t${p.page_number}\t${rel}`); cand.push({ kr, cls, book_id: b.id, page_id: p.id, pn: p.page_number, image: p.photo, rel }); n++;
    }
    if (n) { got[cls]++; console.log(kr, b.id, n); }
  }
  fs.writeFileSync(path.join(L, 'manifest.tsv'), rows.join('\n') + '\n'); fs.writeFileSync(path.join(L, 'cand.json'), JSON.stringify(cand)); console.log('DONE', got, rows.length);
} else {
  const cand = JSON.parse(fs.readFileSync(path.join(L, 'cand.json'))), got = { KR2: 0, KR4: 0 }, done = new Set(draw.picked.map((p) => p.kr)), tried = [];
  for (const p of cand) {
    if (got[p.cls] >= NEED[p.cls] || done.has(p.kr)) continue;
    const f = path.join(L, 'out', p.kr, `${p.pn}.txt`); if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, 'utf8'), Q = fold(bodyText(text)); if ([...Q].length < MIN_HAN) { tried.push({ kr: p.kr, pn: p.pn, han: [...Q].length }); continue; }
    const w = await workInfo(p.kr), pbs = await pbPages(p.kr, w.witness, w.juan_files), m = best(Q, pbs);
    tried.push({ kr: p.kr, pn: p.pn, dice: m ? +m.dice.toFixed(3) : null });
    if (!m || m.dice < DICE) continue;
    const bk = await db.collection('books').findOne({ id: p.book_id }, { projection: { title: 1, visible: 1 } });
    keep(p, p.kr, p.cls, w, pbs, m, text, 'local-paddle-vl', !!bk.visible, bk.title, p.image);
    fs.copyFileSync(path.join(L, p.rel), path.join(A, 'img', `A-${p.kr}.jpg`));
    got[p.cls]++; done.add(p.kr); console.log('picked', p.kr, p.pn, m.dice.toFixed(3));
  }
  draw.local_tried = tried; draw.drawn_at_local = new Date().toISOString(); save();
  console.log('DONE', got, 'total', draw.picked.length, JSON.stringify(tried));
}
await c.close();
