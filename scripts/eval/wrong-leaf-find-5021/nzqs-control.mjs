#!/usr/bin/env node
// PRIOR ART: scripts/lib/block-page-guard.mjs, scripts/lib/block-drift.mjs (the guards under test, unchanged) and
// scripts/eval/caseless-shift-5021/ (LaBSE windows). This only feeds them one natural Han positive (#5021 B.1).
/**
 *   node --env-file=.env.production.local scripts/eval/wrong-leaf-find-5021/nzqs-control.mjs OUT_DIR
 * 農政全書 6992cbd8018b80967354ba40, the block written 2026-04-04T19:32:46 (pp.488-492, gemini-3.1-flash-lite-preview, v10),
 * with the English of 490-492 rebuilt from page_revisions as it stood before the 2026-11-03 withhold. Read-only.
 * Writes OUT_DIR/nzqs-rows.jsonl.gz (for labse_sims.py) and prints every guard's verdict.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { dropDriftedPages, detectCaselessDrift, sourceProse, translationProse, blockDriftBoundaries } from '../../lib/block-drift.mjs';
import { blockAbsorptions, blockNumberVotes, lengthRatioK } from '../../lib/block-page-guard.mjs';
import { classifyBook } from '../../lib/leaf-shift.mjs';
const OUT = process.argv[2];
const B = '6992cbd8018b80967354ba40';
const c = await MongoClient.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
const db = c.db('bookstore');
const ps = await db.collection('pages').find({ book_id: B, page_number: { $gte: 470, $lte: 510 } }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.updated_at': 1 } }).sort({ page_number: 1 }).toArray();
const revs = await db.collection('page_revisions').find({ page_id: { $in: ps.map((p) => p.id) }, field: 'translation' }).sort({ created_at: -1 }).toArray();
const en = new Map();
for (const p of ps) if (p.translation?.data) en.set(p.page_number, p.translation.data);
for (const r of revs) { const p = ps.find((q) => q.id === r.page_id); if (!en.has(p.page_number)) en.set(p.page_number, r.data); }
const by = new Map(ps.map((p) => [p.page_number, p]));
const call = [488, 489, 490, 491, 492].map((n) => by.get(n));
const tr = new Map(call.map((p) => [p.page_number, en.get(p.page_number)]));
// Book k from every page in the slice with English (what claude-translate would pass).
const k = lengthRatioK(ps.filter((p) => en.has(p.page_number)).map((p) => ({ src: p.ocr?.data, en: en.get(p.page_number), type: p.page_type })));
console.log('book-slice k', k?.toFixed(3));
for (const p of call) console.log(p.page_number, 'src', p.ocr.data.length, 'en', tr.get(p.page_number).length, 'log(en/src)-k', (Math.log(tr.get(p.page_number).length / p.ocr.data.length) - k).toFixed(2));
console.log('\n1. dropDriftedPages (caseless), the whole write-time guard without anchors:');
const r = dropDriftedPages(call, new Map(tr), { caseless: true, prevOcr: by.get(487).ocr.data, nextOcr: by.get(493).ocr.data, k });
console.log(JSON.stringify(r.drifted));
console.log('  absorptions (call k):', JSON.stringify(blockAbsorptions(call, tr, { k })));
console.log('  number votes:', JSON.stringify(blockNumberVotes(call, tr, { prevOcr: by.get(487).ocr.data, nextOcr: by.get(493).ocr.data })));
console.log('  caseless clause drift per boundary:');
for (let i = 0; i + 1 < call.length; i++) { const a = call[i], b = call[i + 1]; const d = detectCaselessDrift({ ocrPrev: a.ocr.data, ocrNext: b.ocr.data, trPrev: tr.get(a.page_number), trNext: tr.get(b.page_number) }); console.log('   ', a.page_number, '→', b.page_number, d.drift, d.reason || '', d.shift?.toFixed?.(2) ?? ''); }
console.log('\n2. book-level number classifier (leaf-shift.mjs, gappy, names, absorb) over pp.470-510:');
const rows = ps.map((p) => ({ page_number: p.page_number, ocr: p.ocr?.data || '', tr: en.get(p.page_number) || '', updated_at: p.translation?.updated_at, page_type: p.page_type }));
const cb = classifyBook(rows, { rule: 'gappy', names: true, absorb: true });
console.log('  rows 486-494:', cb.rows.filter((x) => x.page_number >= 486 && x.page_number <= 494).map((x) => `${x.page_number}:${x.cls}`).join(' '));
console.log('  runs:', JSON.stringify(cb.runs ?? null), 'absorptions:', JSON.stringify((cb.absorptions || []).filter((a) => a.page_number >= 480 && a.page_number <= 500)));
// LaBSE rows: each page of the call, its English against its own and neighbours' source.
fs.mkdirSync(OUT, { recursive: true });
const gz = zlib.createGzip(); const ws = fs.createWriteStream(`${OUT}/nzqs-rows.jsonl.gz`); gz.pipe(ws);
for (const n of [486, 487, 488, 489, 490, 491, 492, 493, 494]) {
  const p = by.get(n), P = by.get(n - 1), N = by.get(n + 1);
  gz.write(JSON.stringify({ fam: 'han', book_id: B, page_id: `${p.id}`, n, block: true, en: translationProse(en.get(n)).slice(0, 3000), src: sourceProse(p.ocr.data).slice(0, 2000), srcPrev: sourceProse(P.ocr.data).slice(0, 2000), srcNext: sourceProse(N.ocr.data).slice(0, 2000) }) + '\n');
}
gz.end(); await new Promise((res) => ws.on('close', res));
fs.writeFileSync(`${OUT}/nzqs-text.json`, JSON.stringify([487, 488, 489, 490, 491, 492, 493].map((n) => ({ n, src: by.get(n).ocr.data, en: en.get(n) })), null, 1));
await c.close();
