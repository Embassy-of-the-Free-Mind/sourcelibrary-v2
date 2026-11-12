#!/usr/bin/env node
/**
 * PRIOR ART: scripts/lib/page-text-writer.mjs writes the prior field to page_revisions at write time, and
 * scripts/maintenance/revert-run.mjs undoes a run from those rows. That is the revert path and it is kept. This is the
 * extra, independent copy Derek asked for (#6420, 2026-11-12): the full "before" text of every pilot page, frozen in
 * the repo BEFORE anything writes, so the before/after comparison and a revert do not depend on the database alone.
 *
 *   node --env-file=… scripts/eval/error-zoo/repair-pilot/snapshot.mjs --set=DIR --out=FILE.jsonl
 * One row per manifest page: page_id, book_id, page_number, ocr {data, model, source, prompt_version, updated_at,
 * sha256}, translation {data, model, updated_at, content_hash, sha256}, translation_stale, snapshot_at. Read-only.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const SET = path.resolve(arg('set')), OUT = path.resolve(arg('out'));
const man = fs.readFileSync(path.join(SET, 'manifest.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sha = (s) => (typeof s === 'string' ? createHash('sha256').update(s).digest('hex') : null);
const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const docs = await c.db('bookstore').collection('pages').find({ id: { $in: man.map((m) => m.page_id) } }, { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1, translation: 1, translation_stale: 1 } }).toArray();
await c.close();
const by = new Map(docs.map((d) => [d.id, d]));
const at = new Date().toISOString();
const rows = man.map((m) => {
  const d = by.get(m.page_id);
  if (!d) throw new Error(`page ${m.page_id} not found`);
  return { page_id: d.id, book_id: d.book_id, page_number: d.page_number,
    ocr: { data: d.ocr?.data ?? null, model: d.ocr?.model ?? null, source: d.ocr?.source ?? null, prompt_version: d.ocr?.prompt_version ?? null, updated_at: iso(d.ocr?.updated_at), sha256: sha(d.ocr?.data) },
    translation: { data: d.translation?.data ?? null, model: d.translation?.model ?? null, updated_at: iso(d.translation?.updated_at), content_hash: d.translation?.content_hash ?? null, sha256: sha(d.translation?.data) },
    translation_stale: d.translation_stale ?? null, snapshot_at: at };
});
fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log('snapshot', rows.length, 'pages →', OUT);
