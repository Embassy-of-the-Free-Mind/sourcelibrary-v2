#!/usr/bin/env node
// PRIOR ART: scripts/eval/tibetan-correct-6560/pass/derge-guard.mjs (the wave-3 rows / score-in / only tool, #7263; three steps, no ALLOWED list) and scripts/eval/route-judge-6740/tib-derge.py (locate + score against OpenPecha P000001; used here unchanged)
// and cli-ocr.mjs apply's guards (25% cap, ya-btags, Latin letters), which see only the draft and the reply, never
// a printed parallel. This adds the one guard of Derek's rule (#6740) that needs Derge.
/**
 * Derge guard for a Flash correction read dir (#6740, Derek 2026-10-26): a correction is NOT written when the page has a
 * Derge parallel (the draft places in Derge at identity >= 0.85) and the correction lowers that identity by more than
 * 0.01. Pages with no parallel (not Kangyur, or not placed) pass this guard; the other guards still apply.
 *
 *   node --env-file=... derge-guard-allow.mjs --dir=READ_DIR --p1=/root/derge-kangyur --out=ALLOWED.json [--work=DIR]
 *
 * Writes ALLOWED.json (page ids for `cli-ocr.mjs apply --only` and `leafcheck.mjs audit-req --only`) and
 * <out>.rows.jsonl (per page: vol, imgnum, draft and correction identity, verdict). Reads only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const DIR = arg('dir'), P1 = arg('p1', '/root/derge-kangyur'), OUT = arg('out');
const PARALLEL = 0.85, MAX_DROP = 0.01;
if (!DIR || !OUT) { console.error('usage: derge-guard-allow.mjs --dir=READ_DIR --out=ALLOWED.json [--p1=DIR]'); process.exit(2); }
const WORK = arg('work', `${OUT}.work`);
fs.mkdirSync(WORK, { recursive: true });
const TIB = path.join(path.dirname(new URL(import.meta.url).pathname), '../../route-judge-6740/tib-derge.py');

const metas = fs.readdirSync(DIR).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')))
  .filter((m) => m.mode === 'correct' && m.exit === 0 && !m.wrapper);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const drafts = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: metas.map((m) => m.page_id) } }, { projection: { id: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p.ocr?.data || '']));
await c.close();
const corr = new Map(metas.map((m) => [m.page_id, fs.readFileSync(path.join(DIR, `${m.page_id}.txt`), 'utf8')]));
const ids = metas.map((m) => m.page_id).filter((id) => drafts.get(id));

const run = (args) => { const r = spawnSync('python3', [TIB, ...args, '--p1', P1], { encoding: 'utf8', maxBuffer: 1 << 28 }); if (r.status) { console.error(r.stderr.slice(-2000)); process.exit(1); } };
const loc = path.join(WORK, 'locate-in.jsonl'), locOut = path.join(WORK, 'locate-out.jsonl');
fs.writeFileSync(loc, ids.map((id) => JSON.stringify({ key: id, text: drafts.get(id) })).join('\n') + '\n');
run(['locate', loc, locOut]);
const place = new Map(fs.readFileSync(locOut, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.key, r]));
const sc = path.join(WORK, 'score-in.jsonl'), scOut = path.join(WORK, 'score-out.json');
const placed = ids.filter((id) => place.get(id)?.vol);
fs.writeFileSync(sc, placed.flatMap((id) => [['draft', drafts.get(id)], ['flash', corr.get(id)]].map(([route, text]) => JSON.stringify({ key: id, route, vol: place.get(id).vol, imgnum: place.get(id).imgnum, text }))).join('\n') + '\n');
if (placed.length) run(['score', sc, scOut]);
const S = placed.length ? JSON.parse(fs.readFileSync(scOut, 'utf8')).pages : {};
const rows = ids.map((id) => {
  const d = S[id]?.draft?.identity ?? null, f = S[id]?.flash?.identity ?? null;
  const parallel = d != null && d >= PARALLEL;
  const verdict = !parallel ? 'no-parallel' : f < d - MAX_DROP ? 'refused' : 'ok';
  return { page_id: id, vol: place.get(id)?.vol ?? null, imgnum: place.get(id)?.imgnum ?? null, draft: d, flash: f, verdict };
});
fs.writeFileSync(`${OUT}.rows.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(OUT, JSON.stringify(rows.filter((r) => r.verdict !== 'refused').map((r) => r.page_id)));
const t = rows.reduce((a, r) => ({ ...a, [r.verdict]: (a[r.verdict] || 0) + 1 }), {});
const par = rows.filter((r) => r.verdict !== 'no-parallel');
const mean = (k) => par.length ? +(par.reduce((s, r) => s + r[k], 0) / par.length).toFixed(4) : null;
console.log(JSON.stringify({ pages: rows.length, ...t, parallel_mean_draft: mean('draft'), parallel_mean_flash: mean('flash') }));
