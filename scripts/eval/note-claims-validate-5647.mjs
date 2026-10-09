#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/results/note-facts-full-2026-10-02-5624/ (PR #5640) holds the 359
 * judged candidates this scores against; it has no matcher. scripts/eval/stats-cross-model.mjs
 * compares engines, not a lane against verdicts. Nothing else in scripts/eval reads verdicts.json.
 *
 * Does the $0 reference match (#5647 stage 2) agree with the #5624 fact-check verdicts?
 *
 * Input: the 359 candidate notes AS JUDGED (candidates.json) and their claim verdicts
 * (verdicts.json) from PR #5640. The notes are read from those files, not from production —
 * 18 were corrected afterwards (fix-note-facts-5624.mjs), and the lane must be scored on the
 * text the verifiers saw. Only the page OCR is read from production (read-only; it did not
 * change). Writes nothing to the database.
 *
 * Acceptance (Derek's brief, 2026-10-02):
 *   - every `conflict` is a note judged wrong or partly-wrong;
 *   - no note judged wrong or partly-wrong is `match`.
 *
 * Usage:
 *   git show origin/job-note-facts-full:scripts/eval/results/note-facts-full-2026-10-02-5624/candidates.json > /tmp/c.json
 *   git show origin/job-note-facts-full:scripts/eval/results/note-facts-full-2026-10-02-5624/verdicts.json > /tmp/v.json
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/note-claims-validate-5647.mjs \
 *     --candidates /tmp/c.json --verdicts /tmp/v.json --table /root/factcheck-lane/refs/tib-skt-table.jsonl \
 *     --out scripts/eval/results/note-claims-5647/validation.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { getScriptClient } from '../lib/mongo.mjs';
import { typeNote, matchRow, indexTable, MATCHER, EXTRACTOR } from '../lib/note-claims.mjs';

const arg = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
const CAND = arg('candidates'); const VERD = arg('verdicts');
const TABLE = arg('table', '/root/factcheck-lane/refs/tib-skt-table.jsonl');
const OUT = arg('out', 'scripts/eval/results/note-claims-5647/validation.json');
const OCR_CACHE = arg('ocr-cache', '/root/factcheck-lane/validate-ocr.json');
if (!CAND || !VERD) { console.error('--candidates and --verdicts are required'); process.exit(2); }

const candidates = JSON.parse(fs.readFileSync(CAND, 'utf8'));
const verdicts = JSON.parse(fs.readFileSync(VERD, 'utf8'));
const table = indexTable(fs.readFileSync(TABLE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));

const RANK = { wrong: 4, 'partly-wrong': 3, unverifiable: 2, correct: 1, 'no-claim': 0 };
const worst = {};
for (const v of verdicts) {
  if (!/^N\d+$/.test(v.cid)) continue; // seeds (S..) are excluded, as in #5624
  if (!(v.cid in worst) || RANK[v.verdict] > RANK[worst[v.cid]]) worst[v.cid] = v.verdict;
}

// Page OCR, read-only, cached.
let ocr = fs.existsSync(OCR_CACHE) ? JSON.parse(fs.readFileSync(OCR_CACHE, 'utf8')) : {};
const need = [...new Set(candidates.map((c) => `${c.book_id}|${c.page}`))].filter((k) => !(k in ocr));
if (need.length) {
  const { client, db } = await getScriptClient();
  for (let i = 0; i < need.length; i += 50) {
    const or = need.slice(i, i + 50).map((k) => { const [b, p] = k.split('|'); return { book_id: b, page_number: Number(p) }; });
    const pages = await db.collection('pages').find({ $or: or }, { projection: { book_id: 1, page_number: 1, 'ocr.data': 1 } }).toArray();
    for (const p of pages) ocr[`${p.book_id}|${p.page_number}`] = p.ocr?.data || '';
  }
  await client.close();
  fs.mkdirSync(path.dirname(OCR_CACHE), { recursive: true });
  fs.writeFileSync(OCR_CACHE, JSON.stringify(ocr));
}

const STATUSES = ['match', 'conflict', 'no-entry'];
const VERDICTS = ['wrong', 'partly-wrong', 'correct', 'unverifiable', 'no-claim'];
const confusion = Object.fromEntries(STATUSES.map((s) => [s, Object.fromEntries(VERDICTS.map((v) => [v, 0]))]));
const kindByVerdict = {};
const rows = [];
for (const c of candidates) {
  const typed = typeNote(c.note);
  const row = { source_tag: 'note', claim_kind: typed.claim_kind, claim: { sanskrit: typed.sanskrit, sanskrit_groups: typed.sanskrit_groups, wylie: typed.wylie, years: typed.years } };
  const res = matchRow({ ...row, note: c.note }, table, ocr[`${c.book_id}|${c.page}`] || '', '');
  const v = worst[c.nid] || 'no-claim';
  confusion[res.status][v]++;
  kindByVerdict[typed.claim_kind] ??= Object.fromEntries(VERDICTS.map((x) => [x, 0]));
  kindByVerdict[typed.claim_kind][v]++;
  rows.push({ nid: c.nid, book_id: c.book_id, page: c.page, note: c.note, verdict: v, claim_kind: typed.claim_kind, sanskrit: typed.sanskrit, wylie: typed.wylie, status: res.status, reason: res.reason, anchor: res.anchor, groups: res.groups, evidence: (res.evidence || []).slice(0, 4) });
}

const bad = (v) => v === 'wrong' || v === 'partly-wrong';
const conflictsNotBad = rows.filter((r) => r.status === 'conflict' && !bad(r.verdict));
const matchesBad = rows.filter((r) => r.status === 'match' && bad(r.verdict));
const caught = rows.filter((r) => r.status === 'conflict' && bad(r.verdict));
const summary = {
  run_at: new Date().toISOString(), extractor: EXTRACTOR, matcher: MATCHER, table_rows: table.size,
  notes: rows.length, confusion,
  claim_kind_by_verdict: kindByVerdict,
  acceptance: {
    conflicts: rows.filter((r) => r.status === 'conflict').length,
    conflicts_on_wrong_or_partly: caught.length,
    conflicts_on_other_verdicts: conflictsNotBad.map((r) => ({ nid: r.nid, verdict: r.verdict, note: r.note, evidence: r.evidence })),
    matches_on_wrong_or_partly: matchesBad.map((r) => ({ nid: r.nid, verdict: r.verdict, note: r.note, evidence: r.evidence })),
    wrong_or_partly_total: rows.filter((r) => bad(r.verdict)).length,
  },
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
