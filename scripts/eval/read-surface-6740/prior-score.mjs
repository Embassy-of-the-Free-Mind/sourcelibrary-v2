#!/usr/bin/env node
// #6740 read-surface, STEER 1: score the earlier agy first reads the inventory found (prior-inventory.mjs) against their
// typed pages, with this design's scorer, and write the power-prior points (one per language × setting × prompt version).
//
// PRIOR ART: score.mjs (this directory: the scorer, reused through bodyOf and scoreAgainstReference); panel.mjs (typed
//   text from the #6012 shards, the same read). Neither reads kept or stored reads made outside this design.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/read-surface-6740/prior-score.mjs --work=DIR
// Writes DIR/prior/scored.jsonl and DIR/prior/points.json. Reads R2 and Mongo only.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2 } from '../typed-refs-6012/lib.mjs';
import { scoreAgainstReference } from '../lib/metrics.mjs';
import { bodyOf } from './score.mjs';

const WORK = path.resolve(process.argv.find((a) => a.startsWith('--work='))?.slice(7));
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(WORK, 'prior');
const readGz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const getJson = async (key) => { const o = await r2().send(new GetObjectCommand({ Bucket: 'sl-corpus-snapshots', Key: key })); const c = []; for await (const x of o.Body) c.push(x); return Buffer.concat(c); };

const aligned = new Map(), manifests = {};
for (const [lang, src] of [['de', 'dta'], ['la', 'camena']]) {
  manifests[src] = new Map(readGz(path.join(HERE, '..', 'output', `typed-refs-6012-2026-10-06.${src}.manifest.jsonl.gz`)).map((m) => [m.source_id, m]));
  for (const r of readGz(path.join(HERE, '..', 'output', `typed-refs-6012-2026-10-06.${src}.aligned-pages.jsonl.gz`))) if (r.congruent && r.ref_page_idx[0] === r.ref_page_idx[1]) aligned.set(`${r.book_id}:${r.page_number}`, { lang, src, ...r });
}
// Candidates: kept plain reads (meta not correct mode, no draft) and stored plain agy reads.
const cands = [];
for (const row of fs.readFileSync(path.join(OUT, 'reads.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))) {
  if (/correct/.test(row.job) && !/reread/.test(row.job)) continue;
  if (!/^gemini-3\.[78]-flash/.test(row.model || '')) continue;
  const body = JSON.parse((await getJson(row.key)).toString('utf8'));
  const m = body.meta || {};
  if (m.mode === 'correct' || m.draft) continue;
  cands.push({ from: 'kept', job: row.job, book_id: row.book_id, page_number: row.page_number, page_id: row.page_id, model: row.model, per_call: m.call_pages ?? 1, prompt: `job:${row.job}`, text: body.text, chatter: m.chatter ?? null });
}
const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const books = [...new Set([...aligned.values()].map((a) => a.book_id))];
for (const p of await client.db('bookstore').collection('pages').find({ book_id: { $in: books }, 'ocr.engine.api': 'cli', 'ocr.model': { $regex: '^gemini-3\\.[78]-flash' }, 'ocr.pipeline': null }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.engine': 1 } }).toArray()) {
  if (!aligned.has(`${p.book_id}:${p.page_number}`)) continue;
  const e = p.ocr.engine || {};
  if (e.input?.draft) continue;
  cands.push({ from: 'stored', job: e.job ?? null, book_id: p.book_id, page_number: p.page_number, page_id: p.id, model: p.ocr.model, per_call: e.input?.per_call ?? e.call_pages ?? 1, prompt: e.prompt?.version ? `v:${e.prompt.version}` : e.prompt?.id ? `id:${e.prompt.id}` : 'unknown', text: p.ocr.data, chatter: null });
}
await client.close();
// Typed pages for the candidates.
const need = new Map();
for (const c of cands) { const a = aligned.get(`${c.book_id}:${c.page_number}`); const m = manifests[a.src].get(a.source_id); if (!need.has(m.derived_key)) need.set(m.derived_key, new Set()); need.get(m.derived_key).add(a.source_id); }
const typed = new Map();
for (const [key, srcs] of need) for (const l of zlib.gunzipSync(await getJson(key)).toString('utf8').split('\n')) { if (!l) continue; const r = JSON.parse(l); if (srcs.has(r.source_id)) typed.set(r.source_id, r); }
const scored = [];
for (const c of cands) {
  const a = aligned.get(`${c.book_id}:${c.page_number}`);
  const tp = typed.get(a.source_id)?.pages?.[a.ref_page_idx[0]];
  if (!tp || (tp.notes || []).join('').trim() || c.chatter || !c.text?.trim()) continue;
  const s = scoreAgainstReference(tp.text, bodyOf(c.text), 'latin');
  scored.push({ ...c, text: undefined, lang: a.lang, cer: s.charAccuracyWindowed == null ? 1 : Math.min(1, Math.max(0, 1 - s.charAccuracyWindowed)), aligned: s.aligned, think: c.model.replace(/^.*-/, '') });
}
fs.writeFileSync(path.join(OUT, 'scored.jsonl'), scored.map((r) => JSON.stringify(r)).join('\n') + '\n');
// One point per language × setting × prompt version: the mean over BOOKS (a book's pages averaged first), its variance
// by the spread of book means.
const groups = new Map();
for (const r of scored.filter((x) => x.aligned)) { const k = `${r.lang}|${r.per_call}|${r.think}|${r.prompt}`; if (!groups.has(k)) groups.set(k, new Map()); const g = groups.get(k); if (!g.has(r.book_id)) g.set(r.book_id, []); g.get(r.book_id).push(r.cer); }
const points = [...groups].map(([k, g]) => {
  const [lang, per_call, think, prompt] = k.split('|');
  const bm = [...g.values()].map((xs) => xs.reduce((a, b) => a + b, 0) / xs.length);
  const mean = bm.reduce((a, b) => a + b, 0) / bm.length;
  const sd = bm.length > 1 ? Math.sqrt(bm.reduce((a, b) => a + (b - mean) ** 2, 0) / (bm.length - 1)) : null;
  return { lang, per_call: Number(per_call), think, prompt, books: bm.length, pages: [...g.values()].flat().length, cer: mean, v: sd ? (sd * sd) / bm.length : null };
});
fs.writeFileSync(path.join(OUT, 'points.json'), JSON.stringify({ at: new Date().toISOString(), candidates: cands.length, scored: scored.length, unaligned: scored.filter((x) => !x.aligned).length, points }, null, 1));
console.log(`${cands.length} candidate plain reads; ${scored.length} scored (${scored.filter((x) => !x.aligned).length} fail the identity guard)`);
for (const p of points) console.log(`  ${p.lang} @${p.per_call} ${p.think} ${p.prompt}: ${p.books} books, ${p.pages} pages, CER ${(100 * p.cer).toFixed(2)}% (sd of mean ${p.v ? (100 * Math.sqrt(p.v)).toFixed(2) : '-'} pp)`);
