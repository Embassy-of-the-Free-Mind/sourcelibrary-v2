#!/usr/bin/env node
// PRIOR ART: scripts/audit/scope-progress.mjs — per-scope spend and book status; it does not count leaves by OCR/translation, which is what this job waits on.
// Usage: node --env-file=… progress.mjs   → one line: leaves / with OCR / with translation / batch_jobs by status (read-only)
import { MongoClient } from 'mongodb'; import fs from 'node:fs';
const ids = fs.readFileSync('/root/split-waveA-6114/ids.txt', 'utf8').trim().split('\n');
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
const q = { book_id: { $in: ids }, page_number: { $gt: 0 } };
const [n, ocr, tr, blank] = await Promise.all([
  db.collection('pages').countDocuments(q),
  db.collection('pages').countDocuments({ ...q, 'ocr.data': { $type: 'string', $ne: '' } }),
  db.collection('pages').countDocuments({ ...q, 'translation.data': { $type: 'string', $ne: '' } }),
  db.collection('pages').countDocuments({ ...q, page_type: 'blank' }),
]);
const jobs = await db.collection('batch_jobs').aggregate([{ $match: { book_id: { $in: ids }, created_at: { $gte: new Date('2026-10-07T13:40:00Z') } } }, { $group: { _id: { s: '$status', t: '$type' }, n: { $sum: 1 } } }]).toArray();
console.log(new Date().toISOString().slice(11, 19), `leaves=${n} ocr=${ocr} tr=${tr} blank=${blank}`, 'jobs:', jobs.map((j) => `${j._id.t || '?'}/${j._id.s}=${j.n}`).join(' '));
await c.close();
