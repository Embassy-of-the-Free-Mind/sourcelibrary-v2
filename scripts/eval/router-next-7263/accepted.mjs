#!/usr/bin/env node
// PRIOR ART: scripts/eval/euro-gpu-correct-7567/write-back.mjs — lays out the best judged read per page for
// cli-ocr.mjs apply, rebuilding each read's meta. These reads were made BY cli-ocr.mjs read (judge.mjs correct), so
// their folders already have apply's shape; this only chooses which pages apply may take (--only) and which it may not.
// scripts/batch/ocr-convergence/lib.mjs translationLaneReason — the paid re-translation check, reused unchanged.
/**
 * Which judged reads may be written (#7263 router-next). Per corrector folder DIR/corr/<cell>/<route>/, the pages whose
 * read the Opus judge ACCEPTED (and no wrong-text defect), that are not the draft returned UNCHANGED, in a book not held.
 * What a write would queue is recorded per page (translationLaneReason: a translating status, or a translated book
 * under the 92% gap-fill line: a lane there re-translates a page whose OCR is newer than its English). Writes DIR/apply/<cell>.only.json (page ids for apply --only) and
 * DIR/apply/plan.json (every judged page: accepted / rejected / deferred and why).
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/router-next-7263/accepted.mjs --out=DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { translationLaneReason } from '../../batch/ocr-convergence/lib.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const DIR = path.resolve(arg('out'));
const J = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const slug = (route) => route.replace(/[^a-z0-9]+/gi, '_');
const vf = path.join(DIR, 'verdicts-opus.jsonl');
const V = new Map((fs.existsSync(vf) ? fs.readFileSync(vf, 'utf8') : zlib.gunzipSync(fs.readFileSync(vf + '.gz')).toString('utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r.verdict]));
const s = J('sample.json'), key = J('key.json');
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const plan = [];
fs.mkdirSync(path.join(DIR, 'apply'), { recursive: true });
for (const [cell, cs] of Object.entries(s.cells)) {
  const route = cs.routes[0], only = [];
  const books = new Map((await db.collection('books').find({ id: { $in: cs.pages.map((p) => p.book_id) } }, { projection: { _id: 0, id: 1, pipeline_auto: 1, pages_ocr: 1, pages_blank: 1, pages_translated: 1 } }).toArray()).map((b) => [b.id, b]));
  for (const sp of cs.pages) {
    const k = key.find((x) => x.kind === 'item' && x.cell === cell && x.page_id === sp.page_id);
    const v = k && V.get(k.judged_as);
    const row = { cell, route, page_id: sp.page_id, book_id: sp.book_id, page_number: sp.page_number, book_reads: sp.book_reads };
    if (!v) { plan.push({ ...row, status: 'not judged', why: 'no read (cut, quota, or not read)' }); continue; }
    const wt = (v.defects || []).filter((d) => d.severity === 'wrong_text');
    row.defects = (v.defects || []).filter((d) => d.severity !== 'cosmetic').map((d) => `${d.class} ${d.severity}: ${d.what}`);
    if (!v.accept || wt.length) { plan.push({ ...row, status: 'rejected', why: v.accept ? 'wrong-text defect' : 'not accepted' }); continue; }
    if (k.unchanged) { plan.push({ ...row, status: 'accepted, unchanged', why: 'the corrector returned the draft: nothing to write' }); continue; }
    const b = books.get(sp.book_id), why = translationLaneReason(b);
    if (why === 'book is held') { plan.push({ ...row, status: 'refused', why }); continue; }
    // A lane that would translate the book reads the better text; a page already in English is re-translated by it
    // (paid, cents) — recorded, not refused (2026-10-28: 3 such pages; the written pages' pipeline is not a WITHHOLD_LANE).
    only.push(sp.page_id); plan.push({ ...row, status: 'to write', ...(why && { queues: why }) });
  }
  fs.writeFileSync(path.join(DIR, 'apply', `${cell}.only.json`), JSON.stringify(only));
  console.log(`${cell} (${route}, corr/${cell}/${slug(route)}): ${only.length} to write`);
}
await c.close();
fs.writeFileSync(path.join(DIR, 'apply', 'plan.json'), JSON.stringify(plan, null, 1));
const t = {}; for (const p of plan) t[`${p.cell} ${p.status}`] = (t[`${p.cell} ${p.status}`] || 0) + 1; console.log(t);
for (const p of plan.filter((x) => x.queues)) console.log('queues', p.cell, p.page_id, p.queues);
