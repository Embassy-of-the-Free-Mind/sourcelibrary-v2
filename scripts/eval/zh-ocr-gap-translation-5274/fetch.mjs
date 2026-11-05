#!/usr/bin/env node
// PRIOR ART: scripts/batch/zh-ditto-5274/pilot.mjs (PR #8062; its draw, arms and Kanripo leaves, on cloudlayer's
// scratch, which this box cannot read) and scripts/lib/candidate-reads.mjs (every pilot read was kept in R2 the moment
// it was made: listKeptReads gives the models, not the bodies, so this reads the bodies itself). Nothing else holds
// the pilot's Opus and Flash-low corrections; no correction is made here.
/**
 * Second #5274 test (Derek, inbox 2026-11-04 11:04Z): the ditto pilot's stored texts, for translation. Read-only.
 *
 *   node --env-file=... scripts/eval/zh-ocr-gap-translation-5274/fetch.mjs --out=DIR --side-by-side=FILE
 *
 * Pages: the pilot's 70 (side-by-side.md of PR #8062: 30 zero-丨 per-call 1, 30 zero-丨 per-call 10, 10 keep). Per page:
 *   P  the Paddle draft the pilot corrected: the stored OCR when it is still PaddleOCR, else the newest page_revisions
 *      snapshot of a PaddleOCR text (the bulk runner wrote some pages since);
 *   O  the pilot's Opus correction, Fl its Flash-low correction (agy), kept in R2 candidate-reads (job, task, model
 *      recorded in each read's meta); the Opus fresh read and the Sonnet correction are left out.
 * The Kanripo pb of the page (ocr.qa_screen.pb, as the pilot) is recorded for the cause trace.
 * Writes DIR/texts.json { pages: [{ page_id, book_id, page_number, slug, kind, percall, pb, P, O, Fl, why }] }.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { contentHash } from '../../lib/write-provenance.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = path.resolve(arg('out'));
const md = fs.readFileSync(arg('side-by-side'), 'utf8');
const secs = [...md.matchAll(/^## (\S+) — ([^,]+), ([^,]+), per-call (\d+)\n\nScan: \S+\/book\/([0-9a-f]{24})\?page=(\d+)/gm)]
  .map((m) => ({ slug: m[1], family: m[2], kind: m[3], percall: +m[4], book_id: m[5], page_number: +m[6] }));
const sdk = await import('@aws-sdk/client-s3');
const s3 = new sdk.S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const get = async (Key) => JSON.parse(await (await s3.send(new sdk.GetObjectCommand({ Bucket: 'sl-corpus-snapshots', Key }))).Body.transformToString());
const list = async (Prefix) => (await s3.send(new sdk.ListObjectsV2Command({ Bucket: 'sl-corpus-snapshots', Prefix }))).Contents?.map((o) => o.Key) ?? [];
const PADDLE = /paddle/i;

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const out = [];
for (const s of secs) {
  const p = await db.collection('pages').findOne({ book_id: s.book_id, page_number: s.page_number }, { projection: { id: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.qa_screen': 1, 'translation.data': 1, 'translation.model': 1, 'translation.edited_by': 1, 'ocr.edited_by': 1 } });
  const row = { ...s, page_id: p.id, pb: p.ocr?.qa_screen?.pb ?? null, stored_ocr_model: p.ocr?.model ?? null, stored_tr_model: p.translation?.model ?? null, human_edit: !!(p.translation?.edited_by || p.ocr?.edited_by) };
  if (PADDLE.test(p.ocr?.model || '')) row.P = p.ocr.data;
  else {
    const rev = await db.collection('page_revisions').find({ page_id: p.id, field: 'ocr' }).sort({ created_at: -1 }).toArray();
    const r = rev.find((x) => PADDLE.test(x.model || x.data_model || x.ocr_model || '') || PADDLE.test(JSON.stringify(x.meta || x.previous || {}))) || rev.find((x) => typeof x.data === 'string');
    row.P = r?.data ?? null; row.P_from = r ? `page_revisions ${r.reason ?? ''} ${r.created_at?.toISOString?.() ?? ''}` : null;
  }
  const reads = [];
  for (const key of await list(`candidate-reads/${s.book_id}/${p.id}/ocr/`)) {
    const b = await get(key); const m = b.meta || {};
    if ((m.exit !== undefined && m.exit !== 0) || m.error_class || m.wrapper || !b.text) continue;
    reads.push({ key, model: b.reuse?.model ?? m.model_requested ?? b.model, job: b.job, read_at: b.read_at, task: m.task ?? m.mode ?? m.prompt_variant ?? null, fresh: !!(m.fresh || /fresh/i.test(JSON.stringify(m).slice(0, 4000)) && !/correct/i.test(m.mode || '')), meta_keys: Object.keys(m), text: b.text });
  }
  row.reads = reads.map(({ text, ...r }) => ({ ...r, chars: text.length, hash: contentHash(text) }));
  row._reads = reads;
  out.push(row);
}
await c.close();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'reads-raw.json'), JSON.stringify(out, null, 1));
console.log(`${out.length} pilot pages; P found ${out.filter((r) => r.P).length}; reads per page ${JSON.stringify(out.reduce((o, r) => ((o[r.reads.length] = (o[r.reads.length] || 0) + 1), o), {}))}`);
console.log(JSON.stringify(out[0].reads, null, 1).slice(0, 3000));
