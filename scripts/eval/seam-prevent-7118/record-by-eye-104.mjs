#!/usr/bin/env node
// PRIOR ART: scripts/batch/zh-retranslate-8169/check.mjs (records a job's page verdicts through recordPageVerdicts). It
// records Opus judge verdicts from a packet; this records the five joins the v3#104 job opened by eye (by-eye.json), on
// the stored English, under method seam-fr-it-104-by-eye.
/**
 * node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/seam-prevent-7118/record-by-eye-104.mjs [--apply]
 * Dry run by default. One book_checks row per book (reader_warning false: these rows derive nothing).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { recordPageVerdicts, readMethod } from '../../lib/book-checks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(HERE, '..', 'results', 'seam-fr-it-104');
const METHOD = 'seam-fr-it-104-by-eye';
const eye = JSON.parse(fs.readFileSync(path.join(RES, 'by-eye.json'), 'utf8'));
const ctx = zlib.gunzipSync(fs.readFileSync(path.join(RES, 'ctx.jsonl.gz'))).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
const judged = new Map();
for (const r of ctx) {
  judged.set(r.before.id, { ocr: r.ocr[r.before.n], translation: r.before.tr });
  r.block.forEach((n, i) => judged.set(r.pageIds[i], { ocr: r.ocr[n], translation: r.stored[n] }));
}
const verdicts = eye.joins.flatMap((j) => j.pages.map((p) => ({
  page_id: p.page_id, outcome: p.outcome, page_verdict: p.outcome === 'serious' ? 'fix' : p.outcome === 'minor' ? 'caveat' : 'show',
  note: `${p.note} (join ${j.row}; pass ${j.pass})`, defects: p.defects ?? [], judged: judged.get(p.page_id),
})));
const apply = process.argv.includes('--apply');
const c = await MongoClient.connect(process.env.MONGODB_URI);
const res = await recordPageVerdicts(c.db('bookstore'), {
  method_id: METHOD, method_version: readMethod(METHOD).version, run_id: 'seam-fr-it-104-by-eye-20261113', checked_at: new Date('2026-11-13T13:30:00Z'),
  selection: 'picked', stages: ['translation'], reader: { kind: 'model', model: 'claude-opus-5-5', image_opened: true },
  evidence_path: 'repo:scripts/eval/results/seam-fr-it-104/by-eye.json', reader_warning: false, exposure: 'live',
  note: 'v3#104 seam-pass test: joins opened by eye', verdicts,
}, { apply });
await c.close();
console.log(JSON.stringify({ apply, rows: res.rows.length, inserted: res.inserted, already: res.already, failed: res.failed, sample: apply ? undefined : res.rows[0] }, null, 1).slice(0, 3000));
