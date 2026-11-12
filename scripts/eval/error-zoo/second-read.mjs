#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/error-zoo/calib-build.mjs (packet building: copied in reduced form, since that script also
 * plants errors and builds controls) and scripts/eval/second-reader/ (the Gemini reader this feeds, unchanged:
 * cli-requests / run-cli-arm.py / cli-assemble, with the weekly audit's frozen brief). The repair queue
 * (repair-queue.mjs) marks a finding from one model family `needs-second-read`; this is the gate that lets a reader of
 * the OTHER family confirm or reject it before any repair is queued (#8632: independent re-checks).
 *
 *   build    node --env-file=… second-read.mjs build --queue=queue.json --run=DIR [--max=80]
 *            packets for the top `--max` needs-second-read rows (most-read books first) whose flagging family is
 *            Claude, so the second reader is Gemini (the only family with spare quota for it). Writes DIR/packets,
 *            DIR/images, DIR/key.jsonl.
 *   confirm  node second-read.mjs confirm --queue=queue.json --run=DIR --reader=NAME
 *            reads DIR/readers/NAME/reviews and rewrites the queue's rows: confirmed (the second reader also finds a
 *            serious OCR error or a wrong leaf) → status `queued`; not confirmed → `not-confirmed`. Unread rows stay.
 * Read-only against Mongo. Writes files only.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { structureCounts, pageImageUrl } from '../spot-check/lib.mjs';
import { redactRecord } from '../second-reader/lib.mjs';
import { exposureOf } from '../../lib/review-vocabulary.mjs';

const cmd = process.argv[2];
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const QUEUE = arg('queue'), RUN = arg('run') && path.resolve(arg('run'));
const Q = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));

if (cmd === 'build') {
  const MAX = Number(arg('max', 80));
  const pick = Q.rows.filter((r) => r.status === 'needs-second-read' && r.families.length === 1 && r.families[0] === 'claude').slice(0, MAX);
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect(); const db = client.db('bookstore');
  fs.mkdirSync(path.join(RUN, 'packets'), { recursive: true }); fs.mkdirSync(path.join(RUN, 'images'), { recursive: true });
  const proj = { id: 1, book_id: 1, page_number: 1, page_type: 1, translation_withheld: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.model': 1, 'translation.data': 1, 'translation.model': 1, 'translation.source': 1, photo: 1, cropped_photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, crop: 1 };
  const key = []; let n = 0;
  for (const r of pick) {
    const p = await db.collection('pages').findOne({ id: r.page_id }, { projection: proj }); if (!p?.ocr?.data) continue;
    const url = pageImageUrl(p); if (!url) continue;
    let img = null;
    try { const res = await fetch(url, { signal: AbortSignal.timeout(60_000) }); if (res.ok) { const buf = Buffer.from(await res.arrayBuffer()); if (buf.length > 2000) { const h = crypto.createHash('sha256').update(buf).digest('hex'); img = { file: `images/${h.slice(0, 16)}.jpg`, sha256: h }; fs.writeFileSync(path.join(RUN, img.file), buf); } } } catch { /* no image */ }
    if (!img) continue;
    const b = await db.collection('books').findOne({ id: p.book_id }, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, language: 1, original_language: 1, published: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, page_progression: 1, visible: 1 } });
    const all = await db.collection('pages').find({ book_id: p.book_id }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
    const rec = { slot: 1, stratum: 'audit', exposure: exposureOf({ book: b, page: p }), book_id: p.book_id, book_url: `https://sourcelibrary.org/book/${p.book_id}`, tradition: null, book: b,
      structure: { ...structureCounts(all), pages_count_field: b.pages_count, pages_translated_field: b.pages_translated }, run: [p.page_number],
      pages: [{ page_number: p.page_number, page_id: String(p.id), image_url: url, image_file: img.file, image_sha256: img.sha256, ocr: p.ocr.data, ocr_engine: p.ocr?.source ?? null, ocr_model: p.ocr?.model ?? null, translation: p.translation?.data ?? '', translation_model: p.translation?.model ?? null, translation_source: p.translation?.source ?? null }] };
    const id = `p${String(n++).padStart(3, '0')}`;
    fs.writeFileSync(path.join(RUN, 'packets', `${id}.json`), JSON.stringify([redactRecord({ ...rec, exposure: undefined })], null, 1));
    key.push({ packet: id, page_id: r.page_id, cell: r.cell, ocr_sha256: crypto.createHash('sha256').update(p.ocr.data).digest('hex') });
  }
  await client.close();
  fs.writeFileSync(path.join(RUN, 'key.jsonl'), key.map((k) => JSON.stringify(k)).join('\n') + '\n');
  console.log(`built ${key.length} packets of ${pick.length} picked (queue rows needing a Gemini second read: ${Q.rows.filter((r) => r.status === 'needs-second-read' && r.families[0] === 'claude' && r.families.length === 1).length})`);
} else if (cmd === 'confirm') {
  const NAME = arg('reader');
  const key = fs.readFileSync(path.join(RUN, 'key.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const verdict = new Map();
  for (const k of key) {
    let p = null; try { p = JSON.parse(fs.readFileSync(path.join(RUN, 'readers', NAME, 'reviews', `${k.packet}.json`), 'utf8'))[0].pages[0]; } catch { continue; }
    const ocrSerious = (p.ocr_errors || []).some((e) => e.severity === 'serious') || p.right_page === 'no';
    verdict.set(k.page_id, ocrSerious);
  }
  let c = 0, nc = 0;
  for (const r of Q.rows) {
    if (!verdict.has(r.page_id)) continue;
    r.second_read = { reader: NAME, family: 'gemini', serious_ocr: verdict.get(r.page_id), run: path.basename(RUN) };
    if (verdict.get(r.page_id)) { r.status = 'queued'; r.families = [...new Set([...r.families, 'gemini'])]; c++; } else { r.status = 'not-confirmed'; nc++; }
  }
  Q.by_status = Q.rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  Q.second_read_at = new Date().toISOString();
  fs.writeFileSync(QUEUE, JSON.stringify(Q, null, 1));
  console.log(`second read: ${c} confirmed → queued, ${nc} not confirmed; queue now ${JSON.stringify(Q.by_status)}`);
} else { console.error('usage: second-read.mjs build|confirm …'); process.exit(2); }
