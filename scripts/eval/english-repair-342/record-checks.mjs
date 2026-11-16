#!/usr/bin/env node
// PRIOR ART: scripts/batch/zh-retranslate-8169/check.mjs record() — the same mapping from route-judge verdicts to
// recordPageVerdicts, but bound to that lane's plan.json and arm N; this one reads a paired-arm results dir's key.json
// and records only the stored (served) arm.
/**
 * Record the #342 English repair test's ARM A verdicts (the stored, served English) in book_checks
 * (method paired-arm-stored-english v1, reader_warning false). Arms B-D were never served: not recorded.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/english-repair-342/record-checks.mjs \
 *        --set=$JOB_SCRATCH/set --judge=$JOB_SCRATCH/judge [--apply]
 * Without --apply it builds every row and writes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { recordPageVerdicts, readMethod } from '../../lib/book-checks.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const SET = path.resolve(arg('set')), J = path.resolve(arg('judge')), apply = process.argv.includes('--apply');
const METHOD = 'paired-arm-stored-english';
const jsonl = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const set = new Map(jsonl(path.join(SET, 'set.jsonl')).map((r) => [r.page_id, r]));
const vs = new Map(jsonl(path.join(J, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
const key = JSON.parse(fs.readFileSync(path.join(J, 'key.json'), 'utf8')).filter((k) => k.route === 'stored' && k.kind === 'item');
const verdicts = [];
for (const k of key) {
  const v = vs.get(k.id), s = set.get(k.page_id);
  if (!v || !s) continue;
  const bad = (v.defects || []).filter((d) => d.severity === 'wrong_text' || d.severity === 'misleads');
  const wrongPage = (v.defects || []).some((d) => d.class === 'I1');
  verdicts.push({ page_id: k.page_id, note: String(v.reader_note || ''),
    outcome: bad.length || wrongPage ? 'serious' : (v.defects || []).length ? 'minor' : 'clean',
    page_verdict: bad.some((d) => d.severity === 'wrong_text') ? 'fix' : bad.length || wrongPage ? 'caveat' : 'show',
    verdict: v.accept ? 'accepted' : 'not accepted', ...(wrongPage ? { wrong_page: true } : {}),
    errors: bad.map((d) => ({ stage: 'translation', ...(d.class ? { class: d.class } : {}), problem: `${d.severity}: ${d.what ?? ''} «${String(d.quote ?? '').slice(0, 200)}»`.slice(0, 600) })),
    defects: v.defects || [], judged: { ocr: s.ocr, translation: s.translation } });
}
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
try {
  const r = await recordPageVerdicts(c.db('bookstore'), {
    method_id: METHOD, method_version: readMethod(METHOD).version, run_id: 'english-repair-342-2026-11-14', checked_at: new Date(),
    selection: 'picked', stages: ['translation'], reader: { kind: 'model', model: 'claude -p --model opus', image_opened: true },
    evidence_path: 'scripts/eval/route-judge-6740/results/english-repair-342/', reader_warning: false, exposure: 'live',
    note: 'Baseline arm of the #342 English repair test: the served English judged blind against the page image, one page per book, drawn from the weekly audit\'s flagged (English only / both) and clean pages.',
    frame: { test: 'english-repair-342', groups: ['en_only', 'both', 'clean'], pages_drawn: set.size },
    verdicts }, { apply });
  const res = { apply, verdicts: verdicts.length, rows: r.rows.length, inserted: r.inserted, already: r.already, failed: r.failed,
    changed_since_check: r.rows.filter((x) => x.text_provenance?.some((p) => p.changed_since_check)).length,
    verdict_counts: r.rows.reduce((m, x) => ({ ...m, [x.verdict]: (m[x.verdict] || 0) + 1 }), {}) };
  fs.writeFileSync(path.join(J, `record-checks${apply ? '' : '-dry'}.json`), JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ ...res, failed: r.failed.slice(0, 5), n_failed: r.failed.length }));
} finally { await c.close(); }
