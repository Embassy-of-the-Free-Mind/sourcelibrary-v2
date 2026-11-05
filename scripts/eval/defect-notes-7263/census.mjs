// PRIOR ART: scripts/eval/lib/judge-rows.mjs — origin/selection fields and verdictQuery; this reads every origin on purpose.
// scripts/eval/route-judge-6740/defect-rate.mjs and scripts/eval/estimator/pooled-quality/build-table.mjs roll up accept /
// wrong_text per route for the router, not defect NOTES by class; route-panel-7263/analyze.mjs is one test's panel.
// none of them groups the `what` text or crosses class x severity x language x print/manuscript across the store.
/**
 * #7263 defect-notes census (read-only). Dumps one compact JSONL row per judged page (controls excluded) to
 * $JOB_SCRATCH/rows.jsonl.gz, and prints the census by origin / selection / lane / cell / route.
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/defect-notes-7263/census.mjs
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import zlib from 'node:zlib';
const OUT = process.env.JOB_SCRATCH || '/tmp';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const col = c.db('bookstore').collection('lane_judge_verdicts');
const proj = { origin: 1, selection: 1, kind: 1, page_id: 1, book_id: 1, page_number: 1, cell: 1, route: 1, lane: 1, lang: 1, task: 1, script_type: 1, draw: 1, 'test.id': 1, 'test.arm': 1, 'test.stratum': 1, 'verdict.accept': 1, 'verdict.fidelity': 1, 'verdict.defects': 1, 'judge.instrument': 1, 'judge.model_reported': 1, 'write.model': 1, draft_model: 1, image_url: 1, judged_at: 1, 'test.judged_at': 1 };
const rows = []; const kinds = {};
for await (const r of col.find({}, { projection: proj })) {
  const k = r.kind ?? 'item'; kinds[k] = (kinds[k] ?? 0) + 1;
  if (k === 'wrong_page' || k === 'planted') continue;
  rows.push({ id: String(r._id), origin: r.origin ?? 'live', selection: r.selection ?? (r.origin === 'test' ? 'unknown' : 'live-sample'), kind: k,
    page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, cell: r.cell, route: r.route, lane: r.lane, lang: r.lang,
    task: r.task ?? (/translat|english|>en/i.test(`${r.lane} ${r.route}`) ? 'translation?' : 'ocr'), script_type: r.script_type ?? null,
    test: r.test?.id ?? null, arm: r.test?.arm ?? null, stratum: r.test?.stratum ?? null, draw: r.draw ?? null,
    instrument: r.judge?.instrument ?? null, judge_model: r.judge?.model_reported ?? null, write_model: r.write?.model ?? null, draft_model: r.draft_model ?? null,
    image_url: r.image_url ?? null, judged_at: r.judged_at ?? r.test?.judged_at ?? null,
    accept: r.verdict?.accept ?? null, fidelity: r.verdict?.fidelity ?? null, defects: (r.verdict?.defects || []).map((d) => ({ class: d?.class, severity: d?.severity, quote: String(d?.quote ?? '').slice(0, 300), what: String(d?.what ?? '').slice(0, 600) })) });
}
await c.close();
fs.writeFileSync(`${OUT}/rows.jsonl.gz`, zlib.gzipSync(rows.map((r) => JSON.stringify(r)).join('\n')));
const tally = (f) => { const m = {}; for (const r of rows) { const k = f(r); m[k] ??= { rows: 0, books: new Set(), pages: new Set(), notes: 0, withDef: 0 }; const x = m[k]; x.rows++; x.books.add(r.book_id); x.pages.add(r.page_id ?? `${r.book_id}:${r.page_number}`); x.notes += r.defects.length; if (r.defects.length) x.withDef++; } return Object.entries(m).sort((a, b) => b[1].rows - a[1].rows).map(([k, x]) => `${String(x.rows).padStart(6)} rows ${String(x.withDef).padStart(6)} w/def ${String(x.notes).padStart(6)} notes ${String(x.books.size).padStart(5)} books ${String(x.pages.size).padStart(6)} pages  ${k}`).join('\n'); };
console.log('kinds (all rows):', kinds);
console.log(`items kept: ${rows.length}, notes ${rows.reduce((s, r) => s + r.defects.length, 0)}`);
for (const [name, f] of [['origin|selection', (r) => `${r.origin}|${r.selection}`], ['instrument', (r) => r.instrument], ['task', (r) => r.task], ['origin|lane', (r) => `${r.origin}|${r.lane}`], ['cell', (r) => r.cell], ['route', (r) => r.route], ['test', (r) => r.test], ['lang', (r) => r.lang], ['script_type', (r) => r.script_type]]) console.log(`\n== ${name}\n${tally(f)}`);
