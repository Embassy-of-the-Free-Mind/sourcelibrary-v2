#!/usr/bin/env node
// PRIOR ART: probe in prep.mjs (the frame); scripts/audit/field-sprawl.mjs (field coverage, not a backlog cut). backlog —
// the hidden Sanskrit books with page records and no by-eye script tag from #254, cut by what would decide a next wave:
// pipeline state, hold, the #5768 class, and translation rung (#254 step 8). Read-only.
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/sa-script-tags-254/backlog.mjs
import { MongoClient } from 'mongodb';
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
const match = { language: { $regex: '^sanskrit$', $options: 'i' }, visible: { $ne: true }, pages_count: { $gt: 0 }, 'book_class.version': { $ne: 'script-tags-254-v1' } };
const g = async (key) => (await db.collection('books').aggregate([{ $match: match }, { $group: { _id: key, n: { $sum: 1 }, pages: { $sum: '$pages_count' } } }, { $sort: { n: -1 } }]).toArray()).slice(0, 25);
const total = await g(null);
const out = { total, by_hold: await g('$pipeline_auto.hold.reason'), by_rung: await g('$translation_state.rung'), by_class: await g({ cls: '$book_class.class', fam: '$book_class.script_family' }), by_next: await g('$pipeline_next.step') };
const stubs = await db.collection('books').countDocuments({ language: { $regex: '^sanskrit$', $options: 'i' }, visible: { $ne: true }, $or: [{ pages_count: 0 }, { pages_count: { $exists: false } }] });
console.log(JSON.stringify({ ...out, stubs_without_pages: stubs }, null, 1));
await c.close();
