#!/usr/bin/env node
// PRIOR ART: the 2026-10-28T12:06Z rule in #7263's job inbox (pages.script_type, else the <script> tag of the current
// ocr.data, else the book majority, else unknown) — applied here to the #7567 panel: our pages read the field and the
// stored text from Mongo; external pages (DTA, Wikisource) have neither, so their tag comes from this job's own reads
// (arm C's <script> tag, the judged read every page has), and the book majority is moot (one page per book).
/** script-type.mjs — writes $J/script-type.json {slug: {script_type: print|manuscript|unknown, source}} */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
const J = process.env.J || '/root/jobs/gpu-flash-vs-opus-7263';
const jl = (p) => Object.fromEntries(fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.page_id || r.slug, r]));
const S = jl('/root/jobs/euro-gpu-correct-7567/drafts/S.jsonl');
const panel = JSON.parse(fs.readFileSync(new URL('../euro-gpu-correct-7567/panel.json', import.meta.url), 'utf8')).pages;
const tag = (t) => { const m = String(t || '').match(/<script>\s*(printed|handwritten|mixed)\s*<\/script>/i); return m ? (m[1].toLowerCase() === 'printed' ? 'print' : 'manuscript') : null; };
const norm = (v) => (v == null ? null : /hand|manu|ms/i.test(v) ? 'manuscript' : /print/i.test(v) ? 'print' : null);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const ids = panel.map((p) => S[p.slug]?.sl_page_id).filter(Boolean);
const pages = new Map((await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, script_type: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p]));
await c.close();
const out = {};
for (const p of panel) {
  const pg = pages.get(S[p.slug]?.sl_page_id);
  const own = (() => { try { return JSON.parse(fs.readFileSync(path.join(J, 'e2', 'c', `${p.slug}.json`), 'utf8')).final; } catch { return ''; } })();
  const field = norm(pg?.script_type); const stored = tag(pg?.ocr?.data); const mine = tag(own);
  out[p.slug] = stored && field && stored !== field ? { script_type: stored, source: 'ocr.data tag (conflicts with field; tag preferred)' }
    : field ? { script_type: field, source: 'pages.script_type' } : stored ? { script_type: stored, source: 'ocr.data <script> tag' }
    : mine ? { script_type: mine, source: 'arm C read <script> tag (external page)' } : { script_type: 'unknown', source: 'none' };
}
fs.writeFileSync(path.join(J, 'script-type.json'), JSON.stringify(out, null, 1));
const n = {}; for (const v of Object.values(out)) n[v.script_type] = (n[v.script_type] || 0) + 1;
console.log(JSON.stringify(n));
