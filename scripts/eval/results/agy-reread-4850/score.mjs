#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-ocr-per-call-6740/score.mjs — scores per-call arms against one another; this scores old vs
// new read per page for the #4850 gate, so it is its own 60-line tally.
/**
 * #4850 gated test, score. Per page: guard (cli-ocr apply's reply checks + loopVerdict), old/new fidelity, better/same/
 * worse (new fidelity vs old), and WRITE-ELIGIBLE = guard pass AND better AND the new read has no wrong_text defect.
 *   node scripts/eval/results/agy-reread-4850/score.mjs DRAW.json READS_DIR VERDICTS.jsonl QUOTA.jsonl OUT.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { loopVerdict } from '../../../lib/ocr-loop-guard.mjs';
const [DRAW, READS, VERD, QUOTA, OUT] = process.argv.slice(2);
const drawn = JSON.parse(fs.readFileSync(DRAW, 'utf8')).drawn;
const v = new Map(fs.readFileSync(VERD, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.verdict).map((r) => [`${r.page_id}:${r.which}`, r.verdict]));
const wt = (x) => (x?.defects || []).filter((d) => d.severity === 'wrong_text').length;
const pages = drawn.map((d) => {
  const m = JSON.parse(fs.readFileSync(path.join(READS, `${d.page_id}.meta.json`), 'utf8'));
  const t = fs.readFileSync(path.join(READS, `${d.page_id}.txt`), 'utf8').trim();
  const guard = m.exit !== 0 ? `exit ${m.exit}` : m.wrapper ? `reply: ${m.wrapper}` : t.length < 5 ? 'empty' : !/<page-type>/.test(t) ? 'no header' : loopVerdict(t).refuse ? 'loop' : 'pass';
  const o = v.get(`${d.page_id}:old`), n = guard === 'pass' ? v.get(`${d.page_id}:new`) : null;
  const cmp = !n || !o ? 'failed' : n.fidelity > o.fidelity ? 'better' : n.fidelity < o.fidelity ? 'worse' : 'same';
  const usage = (m.usage || []).reduce((a, u) => a + (u.total || 0), 0);
  return { stratum: d.stratum, book: d.book, page_number: d.page_number, page_id: d.page_id, language: d.language, guard, old: o && { fidelity: o.fidelity, accept: o.accept, wrong_text: wt(o), note: o.reader_note }, new: n && { fidelity: n.fidelity, accept: n.accept, wrong_text: wt(n), note: n.reader_note }, cmp, write_eligible: guard === 'pass' && cmp === 'better' && wt(n) === 0, agy_tokens: usage, agy_calls: (m.usage || []).length, read_secs: m.seconds ?? null };
});
const S = [...new Set(drawn.map((d) => d.stratum))];
const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
const table = [...S, 'ALL'].map((s) => {
  const ps = pages.filter((p) => s === 'ALL' || p.stratum === s);
  const both = ps.filter((p) => p.old && p.new);
  return { stratum: s, n: ps.length, guard_pass: ps.filter((p) => p.guard === 'pass').length, better: ps.filter((p) => p.cmp === 'better').length, same: ps.filter((p) => p.cmp === 'same').length, worse: ps.filter((p) => p.cmp === 'worse').length, failed: ps.filter((p) => p.cmp === 'failed').length, old_fid: mean(ps.filter((p) => p.old).map((p) => p.old.fidelity)), new_fid: mean(both.map((p) => p.new.fidelity)), new_accept: ps.filter((p) => p.new?.accept).length, write_eligible: ps.filter((p) => p.write_eligible).length };
});
const q = fs.readFileSync(QUOTA, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), rule: 'better = new fidelity > old (blind absolute #7866 judge); write-eligible = guard pass AND better AND 0 wrong_text defects in the new read', table, quota: q, pages }, null, 1));
console.table(table);
for (const p of pages) console.log(p.stratum.padEnd(12), String(p.page_number).padStart(5), p.guard.padEnd(28), `f${p.old?.fidelity}->${p.new?.fidelity ?? '-'}`, p.cmp, `wt ${p.old?.wrong_text}->${p.new?.wrong_text ?? '-'}`, p.write_eligible ? 'WRITE' : '', p.agy_tokens);
