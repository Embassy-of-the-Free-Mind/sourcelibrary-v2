#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-arms/negcheck.py — the same idea for Tibetan (negation counts in sliding windows),
// at chance against the judges (precision 0.09 at a 27 % flag rate, #5713). This is the 20-page check the brief asks
// for before D1 is built for any other language: Latin, the largest corpus, with unambiguous negation words.
/** D1 pre-check (#5695 extra test): do Latin-vs-English negation counts separate the pages the judges marked as reversed? $0, 20 pages. */
/**
 *   node scripts/eval/translation-vs-reference/backtrans/d1-negation-check.mjs --set <dir>/set.jsonl --out <dir>/d1-latin-check.json
 * Rule fixed before the run: D1 is built only if the AUC of the window score is ≥ 0.70 on these 20 pages.
 */
import fs from 'node:fs';
import { readJsonl } from '../common.mjs';
import { negationScore } from './negation.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const score = (src, en) => negationScore('Latin', src, en);
const auc = (pos, neg) => { let s = 0; for (const p of pos) for (const q of neg) s += p > q ? 1 : p === q ? 0.5 : 0; return s / (pos.length * neg.length); };

const latin = readJsonl(opt('set')).filter((r) => r.lang === 'Latin');
const pos = latin.filter((r) => r.labels.reversal_judges > 0); const neg = latin.filter((r) => r.labels.reversal_judges === 0).slice(0, 20 - pos.length);
const rows = [...pos, ...neg].map((r) => ({ id: r.id, reversal_judges: r.labels.reversal_judges, ...score(r.source_text, r.english) }));
const col = (k, f) => rows.filter(f).map((r) => r[k]);
const out = { language: 'Latin', n: rows.length, positives: pos.length, rule: 'build D1 only if window AUC >= 0.70',
  auc_window: auc(col('window', (r) => r.reversal_judges > 0), col('window', (r) => r.reversal_judges === 0)),
  auc_page_diff: auc(col('page_diff', (r) => r.reversal_judges > 0), col('page_diff', (r) => r.reversal_judges === 0)), rows };
out.verdict = out.auc_window >= 0.70 ? 'build D1' : 'skip D1';
fs.writeFileSync(opt('out'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, rows: undefined }), '\n' + rows.map((r) => `${r.reversal_judges} src=${r.src_neg} en=${r.en_neg} win=${r.window}`).join('\n'));
