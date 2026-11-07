// Judge-free failure census for the #6101 Qwen translation eval: every arm, all 57 pages (stored source) and the
// 40 zh pages × 3 seeds read from Paddle P1s text. Same checks as score.mjs `mech` (the preregistered list) plus the
// production write guard (assessTranslationHealth) and the prompt's own worked example copied into a page.
//   node scripts/eval/qwen-translate-6101/mech.mjs --dir=$JOB_SCRATCH
import fs from 'fs';
import path from 'path';
import { assessTranslationHealth } from '../../lib/translate-core.mjs';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';
import { clean } from './packets.mjs';

const DIR = (process.argv.find(a => a.startsWith('--dir=')) || '').slice(6);
const set = new Map(JSON.parse(fs.readFileSync(path.join(DIR, 'set', 'set.json'), 'utf8')).items.map(s => [s.id, s]));
const cjkShare = t => { const s = String(t).replace(/<(term|gloss|note|meta|warning)>[\s\S]*?<\/\1>/g, ''); const L = [...s].filter(c => /\p{L}/u.test(c)); return L.length ? L.filter(c => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(c)).length / L.length : 0; };
const EXAMPLE = /pelican/i;   // the house prompt's <image-desc> worked example
function census(rows, srcOf) {
  const c = { n: rows.length, error: 0, hit_cap: 0, untranslated: 0, chatter: 0, any_prereg: 0, guard: {}, prompt_example: 0, out_tok_median: null };
  for (const r of rows) {
    const t = clean(r.text); const f = [];
    if (r.error) f.push('error'); if (r.finish === 'length') f.push('cap');
    if (!r.error && cjkShare(t) > 0.2) f.push('untr'); if (!r.error && cliChatterReason(t)) f.push('chat');
    c.error += f.includes('error'); c.hit_cap += f.includes('cap'); c.untranslated += f.includes('untr'); c.chatter += f.includes('chat'); c.any_prereg += f.length > 0;
    if (EXAMPLE.test(t)) c.prompt_example++;
    if (!r.error) { const s = set.get(r.key.split('#')[0]); const h = assessTranslationHealth(srcOf(r, s), t, { lang: s.language }); if (!h.healthy) c.guard[h.reason] = (c.guard[h.reason] || 0) + 1; }
  }
  const toks = rows.filter(r => r.completion_tokens).map(r => r.completion_tokens).sort((a, b) => a - b); c.out_tok_median = toks[toks.length >> 1] ?? null;
  return c;
}
const out = { A_stored: census([...set.values()].map(s => ({ key: s.id, text: s.A.text })), (r, s) => s.source_text) };
for (const d of fs.readdirSync(path.join(DIR, 'gpu')).filter(d => d.startsWith('out-'))) {
  const rd = f => { const p = path.join(DIR, 'gpu', d, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
  out[`${d.slice(4)} stored-source`] = census(rd('eval.jsonl'), (r, s) => s.source_text);
  out[`${d.slice(4)} P1s-source ×3`] = census(rd('thru.jsonl'), (r, s) => s.p1_text);
}
console.log(JSON.stringify(out, null, 1));
