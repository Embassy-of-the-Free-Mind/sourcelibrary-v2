#!/usr/bin/env node
// PRIOR ART: scripts/eval/siku-kanripo-7503/align.mjs (whole pilot volumes against Kanripo WYG, CER only; workInfo, pbPages,
// best, fold and bodyText are imported from the same places); scripts/eval/siku-error-types-5600/draw.mjs (one page per
// book, but judges the English, not the typed text). Neither draws one aligned page per WORK across the Siku classes.
//
// #6552 collection A: 30 works, one page each, Paddle's stored read aligned to its Kanripo WYG leaf at Dice >= 0.9, so a
// different leaf is not what is measured. Stratified over KR1-KR4; 漢書 and 後漢書 are forced in. READ-ONLY on Mongo.
//   node --env-file=/root/sourcelibrary/.env.production.local draw-a.mjs   (private text goes under $JOB_SCRATCH/a, never here)
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { bodyText } from '../ground-truth-5935/lib.mjs';
process.argv.push(`--dir=${process.env.JOB_SCRATCH}/kanripo-cache`);
const { workInfo, pbPages, best, fold } = await import('../zh-skqs-5568-kanripo.mjs');

const SEED = 6552, DICE = 0.9, MIN_HAN = 120;
const QUOTA = { KR1: 9, KR2: 9, KR3: 9, KR4: 3 };   // 30 works; KR4 is what we hold least of (50 works)
const FORCED = ['KR2a0007', 'KR2a0009'];            // 漢書, 後漢書 (brief)
const OUT = path.join(process.env.JOB_SCRATCH, 'a');
fs.mkdirSync(OUT, { recursive: true });
const rng = makeRng(SEED);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const c = await MongoClient.connect(process.env.MONGODB_URI, { compressors: ['zlib'] });
const db = c.db('bookstore');
const works = {};
for await (const b of db.collection('books').find({ work_id: /^kr:KR[1-4]/ }, { projection: { id: 1, work_id: 1 } }).batchSize(1000)) (works[b.work_id.slice(3)] ||= []).push(b.id);
const ids = Object.keys(works).sort();
const order = [...FORCED, ...shuffle(ids.filter((k) => !FORCED.includes(k)))];
const got = { KR1: 0, KR2: 0, KR3: 0, KR4: 0 }, picked = [], skipped = [];
for (const kr of order) {
  const cls = kr.slice(0, 3);
  if (got[cls] >= QUOTA[cls]) continue;
  const bookIds = shuffle([...works[kr]]);
  const pool = await db.collection('pages').find({ book_id: { $in: bookIds.slice(0, 8) }, 'ocr.source': 'paddle', 'ocr.qa_screen.dice': { $gte: DICE } }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.qa_screen': 1, archived_photo: 1, display_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1 } }).toArray();
  if (!pool.length) { skipped.push({ kr, why: 'no paddle page with stored dice >= 0.9 in up to 8 volumes' }); continue; }
  const w = await workInfo(kr);
  if (!w.witness) { skipped.push({ kr, why: 'no Kanripo witness' }); continue; }
  if (w.witness !== 'WYG') { skipped.push({ kr, why: `witness ${w.witness}, not WYG` }); continue; }
  const pbs = await pbPages(kr, w.witness, w.juan_files);
  let done = false;
  for (const p of shuffle(pool)) {
    const Q = fold(bodyText(p.ocr.data));
    if ([...Q].length < MIN_HAN) continue;
    const m = best(Q, pbs);
    if (!m || m.dice < DICE) continue;
    const pb = pbs[m.i];
    const b = await db.collection('books').findOne({ id: p.book_id }, { projection: { title: 1, visible: 1 } });
    picked.push({ uid: `A-${kr}`, kr, cls, witness_sha: w.witness_sha, book_id: p.book_id, title: b.title, visible: !!b.visible, page_id: p.id, pn: p.page_number, image: getPageSource(p), pb: pb.pb, dice: +m.dice.toFixed(3), runner_up: +m.second.toFixed(3), ocr_source: p.ocr.source });
    fs.writeFileSync(path.join(OUT, `A-${kr}.json`), JSON.stringify({ ocr: bodyText(p.ocr.data), typed: (pbs[m.i - 1]?.raw || '').slice(-60) + '\u0001' + pb.raw + '\u0001' + (pbs[m.i + 1]?.raw || '').slice(0, 60) }));
    got[cls]++; done = true;
    console.log(`${kr} ${b.title.slice(0, 30)} p${p.page_number} ${pb.pb} dice ${m.dice.toFixed(3)} (2nd ${m.second.toFixed(3)})`);
    break;
  }
  if (!done) skipped.push({ kr, why: 'no page >= 0.9 on recomputed dice' });
  if (picked.length >= 30) break;
}
await c.close();
fs.writeFileSync(new URL('./draw-a.json', import.meta.url), JSON.stringify({ seed: SEED, drawn_at: new Date().toISOString(), dice_min: DICE, quota: QUOTA, frame_works: ids.length, picked, skipped }, null, 1) + '\n');
console.log(got, 'skipped', skipped.length);
