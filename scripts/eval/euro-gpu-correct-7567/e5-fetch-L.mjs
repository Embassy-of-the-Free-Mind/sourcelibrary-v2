// PRIOR ART: fetch-stored.mjs (this directory: E2's stored-OCR fetch over panel.json). #7567 E5: the stored Flash-Lite draft (arm a's input, L) of e5 panel pages.
import fs from 'node:fs'; import { MongoClient } from 'mongodb'; import crypto from 'node:crypto';
const J = process.argv[2]; const P = JSON.parse(fs.readFileSync(`${J}/e5/panel.json`, 'utf8')).pages;
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
const docs = await db.collection('pages').find({ id: { $in: P.map((p) => p.page_id) } }, { projection: { id: 1, ocr: 1 } }).toArray();
const by = Object.fromEntries(docs.map((d) => [d.id, d])); const out = fs.createWriteStream(`${J}/e5/drafts/L.jsonl`);
for (const p of P) { const o = by[p.page_id]?.ocr || {}; out.write(JSON.stringify({ page_id: p.slug, sl_page_id: p.page_id, text: o.data || '', model: o.model, pipeline: o.pipeline ?? null, updated_at: o.updated_at, text_sha: crypto.createHash('sha256').update(o.data || '').digest('hex') }) + '\n'); }
out.end(); await c.close();
