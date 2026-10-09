#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/score.mjs scores judge controls (wrong page, planted change,
// duplicate) by fidelity rank; nothing scores a sentence-level detector against a planted sentence number.
/** #5982 control scores: recall on planted sentences, false-flag rate on clean pages, and the read against judge-named pages. */
/**   node scripts/eval/untagged-additions/score-controls.mjs --round 1 --model gemini-3.1-flash-lite [--show] */
import fs from 'node:fs';
import path from 'node:path';
import { countedFlags, wilson } from './detector.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const ROUND = opt('round', '1'), MODEL = opt('model', 'gemini-3.1-flash-lite'), SHOW = args.includes('--show');
const DIR = new URL('../results/untagged-additions-2026-10/', import.meta.url).pathname;
const key = JSON.parse(fs.readFileSync(path.join(DIR, `controls-r${ROUND}.key.json`), 'utf8'));
const src = Object.fromEntries(fs.readFileSync(path.join(DIR, 'work', `controls-r${ROUND}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r.source]));
// every model flag passes the detector's mechanical filter (keepFlag) before it counts; raw_flags keeps the model's list
const rows = Object.fromEntries(fs.readFileSync(path.join(DIR, 'work', `controls-r${ROUND}.${MODEL}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error).map((r) => { const c = countedFlags(r, src[r.id]); return [r.id, { ...r, raw_flags: r.flags, flags: [...c.additions, ...c.continuation] }]; }));
const pct = (k, n) => `${k}/${n} = ${n ? (100 * k / n).toFixed(0) : '—'}% [${wilson(k, n).map((x) => (100 * x).toFixed(0)).join(', ')}]`;
const add = (f) => f.kind !== 'continuation';

const pos = key.positives.map((p) => { const r = rows[p.id]; const hit = r?.flags.find((f) => f.n === p.n && add(f)); return { ...p, answered: !!r, hit: !!hit, kind_given: hit?.kind || null, kind_right: hit?.kind === p.kind, extra: r ? r.flags.filter((f) => f.n !== p.n && add(f)).length : 0 }; });
const neg = key.negatives.map((p) => { const r = rows[p.id]; return { ...p, answered: !!r, flags: r ? r.flags.filter(add) : [], cont: r ? r.flags.filter((f) => !add(f)) : [], units: r?.units, n_units: r?.n_units || 0, checkable: r?.checkable }; });
const out = { round: Number(ROUND), arm: key.arm, model: MODEL, positives: pos.length, recall: pos.filter((p) => p.hit).length, recall_by_kind: {}, kind_right: pos.filter((p) => p.kind_right).length, negatives: neg.length, clean_pages_flagged: neg.filter((p) => p.flags.length).length, clean_flags: neg.reduce((s, p) => s + p.flags.length, 0), clean_units: neg.reduce((s, p) => s + p.n_units, 0), clean_continuation_pages: neg.filter((p) => p.cont.length).length, clean_pages_flagged_before_filter: key.negatives.filter((p) => rows[p.id]?.raw_flags.some(add)).length, unanswered: [...pos, ...neg].filter((p) => !p.answered).length };
for (const k of [...new Set(pos.map((p) => p.kind))]) out.recall_by_kind[k] = `${pos.filter((p) => p.kind === k && p.hit).length}/${pos.filter((p) => p.kind === k).length}`;
out.recall_by_form = Object.fromEntries(['bare', 'bracketed'].map((f) => [f, `${pos.filter((p) => p.form === f && p.hit).length}/${pos.filter((p) => p.form === f).length}`]));
out.clean_flags_by_kind = {}; for (const p of neg) for (const f of p.flags) out.clean_flags_by_kind[f.kind] = (out.clean_flags_by_kind[f.kind] || 0) + 1;
// judge-named pages: does the detector flag the page, and a sentence carrying the judge's quoted words?
const fold = (s) => String(s).toLowerCase().replace(/<[a-z/][^<>]*>/gi, ' ').replace(/[^\p{L}\p{N}]+/gu, '');
const named = key.judge_named.map((p) => {
  const r = rows[p.id]; if (!r) return null;
  const quotes = [...new Map(p.entries.map((e) => [fold(e.quote), e])).values()];
  const res = quotes.map((e) => { const q = fold(e.quote.split(/\.\.\.|…/).sort((a, b) => b.length - a.length)[0]); const n = r.units.findIndex((u) => q.length >= 4 && fold(u).includes(q)) + 1; return { kind: e.kind, where: e.where, quote: e.quote, unit: n || null, flagged: !!n && r.flags.some((f) => f.n === n), both_judges: p.entries.filter((x) => fold(x.quote) === fold(e.quote)).length > 1 }; });
  return { id: p.id, flags: r.flags.length, quotes: res };
}).filter(Boolean);
const nq = named.flatMap((p) => p.quotes).filter((q) => q.unit);
out.judge_named = { pages: named.length, pages_flagged: named.filter((p) => p.flags).length, quotes_located: nq.length, quotes_flagged: nq.filter((q) => q.flagged).length, by_kind: {} };
for (const k of [...new Set(nq.map((q) => `${q.kind}/${q.where}`))]) out.judge_named.by_kind[k] = `${nq.filter((q) => `${q.kind}/${q.where}` === k && q.flagged).length}/${nq.filter((q) => `${q.kind}/${q.where}` === k).length}`;
out.pass = { recall_ge_80: out.recall / out.positives >= 0.8, false_flag_le_10: out.clean_pages_flagged / out.negatives <= 0.1 };
fs.writeFileSync(path.join(DIR, `controls-r${ROUND}.${MODEL}.score.json`), JSON.stringify({ ...out, positives_detail: pos, clean_flag_detail: neg.filter((p) => p.flags.length).map((p) => ({ id: p.id, lang: p.lang, flags: p.flags.map((f) => ({ ...f, sentence: p.units[f.n - 1] })) })), judge_named_detail: named }, null, 1));
console.log(`round ${ROUND} ${MODEL} (${key.arm})`);
console.log(`  recall on planted sentences: ${pct(out.recall, out.positives)}   by kind ${JSON.stringify(out.recall_by_kind)}  by form ${JSON.stringify(out.recall_by_form)}  kind named right ${out.kind_right}`);
console.log(`  clean pages with ≥ 1 addition flag: ${pct(out.clean_pages_flagged, out.negatives)}   flags ${out.clean_flags} on ${out.clean_units} sentences  ${JSON.stringify(out.clean_flags_by_kind)}  continuation pages ${out.clean_continuation_pages}; before the mechanical filter ${out.clean_pages_flagged_before_filter}`);
console.log(`  judge-named pages flagged ${out.judge_named.pages_flagged}/${out.judge_named.pages}; located quotes flagged ${out.judge_named.quotes_flagged}/${out.judge_named.quotes_located} ${JSON.stringify(out.judge_named.by_kind)}`);
console.log(`  unanswered ${out.unanswered}; missed plants: ${pos.filter((p) => !p.hit).map((p) => `${p.kind}:"${p.sentence.slice(0, 50)}"`).join(' | ')}`);
if (SHOW) for (const p of neg.filter((x) => x.flags.length)) for (const f of p.flags) console.log(`  FF ${p.id} ${p.lang} [${f.kind}${f.whole ? ', whole' : ''}] «${f.words}» — src: ${f.source_has || ''} — ${f.reason}\n       in: ${p.units[f.n - 1].slice(0, 260)}`);
