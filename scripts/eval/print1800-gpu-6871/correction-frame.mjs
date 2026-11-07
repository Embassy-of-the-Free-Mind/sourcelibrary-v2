#!/usr/bin/env node
/**
 * PRIOR ART: scripts/batch/cli-ocr-lane.mjs armc (the GPU>agy correction of a GPU draft, --over-stored with the E3 put-back:
 * the read and the write a correction pass uses) and scripts/batch/pero-draft.py (the --gpu-draft file shape). Neither
 * selects pages by the bare-GPU stamp: this script only builds that frame and prints the commands; it never calls agy.
 *
 * The correction frame for bare GPU print reads (#6871, Derek 2026-11-07: "we can use ocr gpu until we later correct").
 * PLANNED, NOT SCHEDULED: nothing runs this on a cron. READ-ONLY on Mongo; writes files under --out only.
 *
 * Selects pages whose stored OCR is a bare LightOnOCR read: `ocr.source: 'lightonocr'`, `ocr.engine.corrected` not true (the 10-29 pages predate the field),
 * `ocr.pipeline` in --pipelines (default the gpu-print lanes: gpu-print-en-2026-10, gpu-print-en19-2026-11,
 * gpu-print-fr-2026-11), no human edit. Per book: <out>/<bid>/page-ids.json and <out>/<bid>/gpu-draft.json (the stored body
 * as the draft, with the image sha the GPU read, the cli-ocr.mjs --gpu-draft shape), and a frame.json tally by pipeline.
 * A correction run then reads each book OVER the stored text with agy and the image (the commands are printed; the
 * stamp of the corrected write is the run's own --lane, so the page leaves this frame).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/print1800-gpu-6871/correction-frame.mjs --out=DIR [--pipelines=a,b] [--limit-books=N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../../lib/mongo.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = arg('out') && path.resolve(arg('out'));
if (!OUT) { console.error('--out=DIR is required'); process.exit(2); }
const PIPELINES = (arg('pipelines') || 'gpu-print-en-2026-10,gpu-print-en19-2026-11,gpu-print-fr-2026-11').split(',').filter(Boolean);
const LIMIT = Number(arg('limit-books') || 0);
const ENVELOPE = /^\s*<language>[^<]*<\/language>\s*\n<script>[^<]*<\/script>\s*\n+/;

const tally = { built_at: new Date().toISOString(), pipelines: PIPELINES, by_pipeline: {}, books: 0, pages: 0 };
await withMongo(async (db) => {
  const cur = db.collection('pages').find(
    { 'ocr.source': 'lightonocr', 'ocr.engine.corrected': { $ne: true }, 'ocr.pipeline': { $in: PIPELINES }, 'ocr.edited_by': { $exists: false }, 'ocr.edited_at': { $exists: false } },
    { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.pipeline': 1, 'ocr.language': 1, 'ocr.engine.input': 1 } },
  ).sort({ book_id: 1, page_number: 1 });
  let bid = null, ids = [], draft = null;
  const flush = () => {
    if (!bid || !ids.length) return;
    fs.mkdirSync(path.join(OUT, bid), { recursive: true });
    fs.writeFileSync(path.join(OUT, bid, 'page-ids.json'), JSON.stringify(ids));
    fs.writeFileSync(path.join(OUT, bid, 'gpu-draft.json'), JSON.stringify(draft));
    tally.books++; tally.pages += ids.length;
  };
  for await (const p of cur) {
    if (p.book_id !== bid) { flush(); if (LIMIT && tally.books >= LIMIT) break; bid = p.book_id; ids = []; draft = { _engine: { name: 'lightonocr', model: 'lightonai/LightOnOCR-3-1B', from: 'stored ocr (bare gpu-print read, #6871)' } }; }
    ids.push(p.id);
    draft[p.id] = { text: String(p.ocr.data || '').replace(ENVELOPE, ''), image_sha256: p.ocr.engine?.input?.image_sha256 ?? null };
    const k = p.ocr.pipeline;
    tally.by_pipeline[k] = tally.by_pipeline[k] || { books: new Set(), pages: 0 };
    tally.by_pipeline[k].books.add(p.book_id); tally.by_pipeline[k].pages++;
  }
  flush();
}, { timeoutMs: 3 * 3600 * 1000 });
for (const v of Object.values(tally.by_pipeline)) v.books = v.books.size;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'frame.json'), JSON.stringify(tally, null, 1));
console.log(JSON.stringify(tally));
console.log(`
To correct one book (agy Flash-low with the image, over the stored bare read, E3 put-back; ONE agy pool, --stop-on-quota):
  B=<bid>; node --env-file=/root/sourcelibrary/.env.production.local scripts/batch/cli-ocr.mjs read \\
    --page-ids-file=${OUT}/$B/page-ids.json --gpu-draft=${OUT}/$B/gpu-draft.json --over-stored \\
    --correct-prompt=scripts/eval/euro-gpu-correct-7567/prompts/agy-0601ef30e816f7a7.txt --lane=gpu-agy-correct-6871 \\
    --model=gemini-3.8-flash-low --stop-on-quota --out=<run dir>
  then cli-ocr.mjs apply --lane=gpu-agy-correct-6871 --print-only on that run dir. Gate a pilot first (the en19 gate's rule).`);
