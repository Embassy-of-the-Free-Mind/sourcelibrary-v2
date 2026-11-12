#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/revert-run.mjs (dry run lists what a run wrote; it does not compare with a frozen
 * snapshot). Read-only check for the pilot: how many page_revisions rows carry the run id, and does each pilot page
 * still hold exactly the OCR and English frozen in before-2026-11-12.jsonl (or, after a write, the judged correction).
 *   node --env-file=… scripts/eval/error-zoo/repair-pilot/verify.mjs [--run-id=error-zoo-pilot-7809-ocr]
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const RUN = process.argv.find((a) => a.startsWith('--run-id='))?.slice(9) ?? 'error-zoo-pilot-7809-ocr';
const snap = fs.readFileSync(path.join(HERE, 'before-2026-11-12.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sha = (s) => (typeof s === 'string' ? createHash('sha256').update(s).digest('hex') : null);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const revs = await db.collection('page_revisions').countDocuments({ run_id: RUN });
const docs = await db.collection('pages').find({ id: { $in: snap.map((s) => s.page_id) } }, { projection: { id: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
await c.close();
const by = new Map(docs.map((d) => [d.id, d]));
let same = 0; const changed = [];
for (const s of snap) { const d = by.get(s.page_id); if (d && sha(d.ocr?.data) === s.ocr.sha256 && sha(d.translation?.data) === s.translation.sha256) same++; else changed.push(s.page_id); }
console.log(JSON.stringify({ run_id: RUN, page_revisions_rows: revs, pages: snap.length, unchanged_since_snapshot: same, changed }));
