import { MongoClient } from 'mongodb';
import { paddleTableRisk } from '/mnt/HC_Volume_105839809/worktrees/job-stale-gate-6567/scripts/lib/paddle-table-detect.mjs';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const ps = await db.collection('pages').find({ 'translation_stale.lane': 'paddle-zh-2026-10' }, { projection: { _id:0, id:1, book_id:1, 'ocr.data':1, 'translation_stale':1, held:1, 'ocr.held':1 } }).toArray();
let g=0, s=0, f=0; const reasons={};
for (const p of ps) { const r = paddleTableRisk(p.ocr?.data); if (r.gate) g++; if (r.shape) s++; if (r.flag) f++; reasons[p.translation_stale?.reason]=(reasons[p.translation_stale?.reason]||0)+1; }
console.log({ lane_stale_any_reason: ps.length, gate: g, shape_no_title: s, flag_no_title: f, reasons });
console.log(await db.collection('pages').countDocuments({ 'translation_stale.lane': 'paddle-zh-2026-10', 'ocr.source': { $ne: 'paddle' } }));
await c.close();
