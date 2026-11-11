#!/usr/bin/env node
// PRIOR ART: draw-a.mjs (this directory; selected on the stored qa_screen.dice, which KR2 and KR4 barely have, and never checked which
// Siku copy a scan is). Four of its 21 picks are 摛藻堂薈要 leaves, another manuscript from the 文淵閣 one Kanripo WYG keys: a difference
// there is not a keying error. This keeps its valid picks and refills from the same frame, recomputing Dice, 欽定四庫全書 only.
// READ-ONLY on Mongo. KR4 has no Paddle read: --kr4 lists candidate pages for a local read instead.
//   node --env-file=/root/sourcelibrary/.env.production.local draw-a2.mjs
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { bodyText } from '../ground-truth-5935/lib.mjs';
process.argv.push(`--dir=${process.env.JOB_SCRATCH}/kanripo-cache`);
const { workInfo, pbPages, best, fold } = await import('../zh-skqs-5568-kanripo.mjs');
const SEED = 65522, DICE = 0.9, MIN_HAN = 120, QUOTA = { KR1: 9, KR2: 9, KR3: 9 }, FORCED = ['KR2a0007'];
const OUT = path.join(process.env.JOB_SCRATCH, 'a'), rng = makeRng(SEED);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const metaCache = {};
const copyOf = async (ia) => { if (metaCache[ia]) return metaCache[ia]; const r = await (await fetch(`https://archive.org/metadata/${ia}/metadata`)).json(); const d = [].concat(r.result?.description || []).join('|'); return (metaCache[ia] = /薈要|會要/.test(d) ? 'huiyao' : /欽定四庫全書/.test(d) ? 'wenyuange' : 'unknown'); };
const prev = JSON.parse(fs.readFileSync(new URL('./draw-a.json', import.meta.url)));
const c = await MongoClient.connect(process.env.MONGODB_URI, { compressors: ['zlib'] }), db = c.db('bookstore');
const iaOf = async (id) => (await db.collection('books').findOne({ id }, { projection: { ia_identifier: 1 } }))?.ia_identifier;
const picked = [], dropped = [], skipped = [];
for (const p of prev.picked) { const copy = await copyOf(await iaOf(p.book_id)); if (copy === 'wenyuange') picked.push({ ...p, copy }); else dropped.push({ uid: p.uid, copy }); }
const works = {};
for await (const b of db.collection('books').find({ work_id: /^kr:KR[1-3]/ }, { projection: { id: 1, work_id: 1, ia_identifier: 1 } }).batchSize(1000)) (works[b.work_id.slice(3)] ||= []).push(b);
const save = () => fs.writeFileSync(new URL('./draw-a2.json', import.meta.url), JSON.stringify({ seed: SEED, drawn_at: new Date().toISOString(), dice_min: DICE, quota: QUOTA, dropped_not_wenyuange: dropped, picked, skipped_count: skipped.length }, null, 1) + '\n');
const have = new Set(prev.picked.map((p) => p.kr)), got = { KR1: 0, KR2: 0, KR3: 0 };
for (const p of picked) got[p.cls]++;
have.delete('KR2a0007');
const order = [...FORCED, ...shuffle(Object.keys(works).filter((k) => !have.has(k) && !FORCED.includes(k)))];
for (const kr of order) {
  const cls = kr.slice(0, 3);
  if (got[cls] >= QUOTA[cls]) continue;
  if (Object.keys(QUOTA).every((k) => got[k] >= QUOTA[k])) break;
  console.log('try', kr);
  const w = await workInfo(kr).catch(() => ({}));
  if (w.witness !== 'WYG') { skipped.push({ kr, why: `witness ${w.witness}` }); continue; }
  const pbs = await pbPages(kr, w.witness, w.juan_files); let done = false;
  for (const b of shuffle([...works[kr]]).slice(0, 3)) {
    if (await copyOf(b.ia_identifier) !== 'wenyuange') continue;
    const pool = await db.collection('pages').aggregate([{ $match: { book_id: b.id, 'ocr.source': 'paddle' } }, { $sample: { size: 25 } }, { $project: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.source': 1, archived_photo: 1, display_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1 } }]).toArray();
    for (const p of pool) {
      const Q = fold(bodyText(p.ocr.data));
      if ([...Q].length < MIN_HAN) continue;
      const m = best(Q, pbs);
      if (!m || m.dice < DICE) continue;
      const pb = pbs[m.i], bk = await db.collection('books').findOne({ id: b.id }, { projection: { title: 1, visible: 1 } });
      picked.push({ uid: `A-${kr}`, kr, cls, witness_sha: w.witness_sha, book_id: b.id, title: bk.title, visible: !!bk.visible, page_id: p.id, pn: p.page_number, image: getPageSource(p), pb: pb.pb, dice: +m.dice.toFixed(3), runner_up: +m.second.toFixed(3), ocr_source: p.ocr.source, copy: 'wenyuange', dice_recomputed: true });
      fs.writeFileSync(path.join(OUT, `A-${kr}.json`), JSON.stringify({ ocr: bodyText(p.ocr.data), typed: (pbs[m.i - 1]?.raw || '').slice(-60) + '\u0001' + pb.raw + '\u0001' + (pbs[m.i + 1]?.raw || '').slice(0, 60) }));
      got[cls]++; done = true; save(); console.log(kr, bk.title.slice(0, 24), p.page_number, pb.pb, m.dice.toFixed(3)); break;
    }
    if (done) break;
  }
  if (!done) skipped.push({ kr, why: 'no aligned page in sample' });
}
await c.close();
save();
console.log(got, 'dropped', dropped, 'skipped', skipped.length);
