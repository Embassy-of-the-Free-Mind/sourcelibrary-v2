#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-corpus-audit/draw.mjs reads pages.translation.data + ocr.data for a DRAWN sample
// (it chooses the pages); scripts/eval/lib/sampling.mjs getPage returns OCR only. Here the pages are fixed by the
// reference set (a track found a published translation of THIS page), so this only reads them. Read-only: no writes.
/** Add the SERVED English (pages.translation.data) as a candidate arm to translation-vs-reference records, read-only; optionally fill source_text and the neighbouring pages' edges from pages.ocr.data. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/translation-vs-reference/fetch-served.mjs \
 *        --input <records.jsonl> --out <records-with-served.jsonl> [--arm served] [--fill-source] [--neighbours] [--edge-chars 300]
 * Records missing book_id/page_number in Mongo, or with no served translation, are written unchanged and listed in
 * <out>.skips.json — a reference page with nothing served is a recorded skip, never a silent drop.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { readJsonl, writeJsonl, sha16 } from './common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const INPUT = opt('input'); const OUT = opt('out'); const ARM = opt('arm', 'served');
const FILL = args.includes('--fill-source'); const NEIGH = args.includes('--neighbours'); const EDGE = Number(opt('edge-chars', 300));
if (!INPUT || !OUT) { console.error('--input and --out required'); process.exit(1); }

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const pages = client.db(process.env.MONGODB_DB || 'bookstore').collection('pages');
const proj = { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.model': 1, 'translation.prompt_version': 1, 'translation.source': 1, 'translation.edited_by': 1, 'translation.updated_at': 1 } };
const out = []; const skips = [];
try {
  for (const r of readJsonl(INPUT)) {
    const p = await pages.findOne({ book_id: r.book_id, page_number: Number(r.page_number) }, proj);
    if (!p) { skips.push({ book_id: r.book_id, page_number: r.page_number, skipped: 'no-page' }); out.push(r); continue; }
    const rec = { ...r, candidates: [...(r.candidates || []).filter((c) => c.arm !== ARM)] };
    if (FILL && !rec.source_text) rec.source_text = p.ocr?.data || '';
    if (NEIGH) {
      const [prev, next] = await Promise.all([-1, 1].map((d) => pages.findOne({ book_id: r.book_id, page_number: Number(r.page_number) + d }, { projection: { 'ocr.data': 1 } })));
      if (prev?.ocr?.data) rec.source_prev_tail = prev.ocr.data.slice(-EDGE);
      if (next?.ocr?.data) rec.source_next_head = next.ocr.data.slice(0, EDGE);
    }
    const t = p.translation?.data;
    if (typeof t !== 'string' || !t.trim()) skips.push({ book_id: r.book_id, page_number: r.page_number, skipped: 'no-served-translation' });
    else rec.candidates.push({ arm: ARM, text: t, model: p.translation.model ?? null, prompt_version: p.translation.prompt_version ?? null, source: p.translation.source ?? null, edited_by: p.translation.edited_by ?? null, updated_at: p.translation.updated_at ?? null, text_sha: sha16(t), ocr_sha: sha16(p.ocr?.data || '') });
    out.push(rec);
  }
} finally { await client.close(); }
writeJsonl(OUT, out);
fs.writeFileSync(`${OUT}.skips.json`, JSON.stringify(skips, null, 1));
console.log(`${out.length} records → ${OUT}; served added to ${out.length - skips.length}; skips ${skips.length}`);
