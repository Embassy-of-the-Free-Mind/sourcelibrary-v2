// PRIOR ART: scripts/lib/ocr-loop-guard.mjs (loopVerdict, the production write-time loop screen) is imported for the
// loop count; persian_align.py produces every accuracy number. This only tabulates one row per arm for #5525 Stage 1b.
// Usage: node scripts/eval/persian-ganjoor/stage1b_table.mjs <arm>=<pages.jsonl>:<scores-folded.jsonl> ...
// A page counts as DEGENERATE (Stage 1's definition, made mechanical) when any of:
//   - loopVerdict refuses it (an exact repeated run covering ≥ half the body);
//   - one word is ≥ 14% of its words (Stage 1's lowest degenerate page, Masnavī 1500, was 14% `بود`);
//   - the model stopped at the output cap (MAX_TOKENS), which on these pages is always a runaway.
import fs from 'fs';
import { loopVerdict } from '../../lib/ocr-loop-guard.mjs';

const jl = p => fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const body = t => (t || '').replace(/<(meta|vocab|image-desc|summary|keywords|warning|language|page-type|script|scan-quality)[^>]*>[\s\S]*?<\/\1>/g, ' ');
function q(xs) {
  xs = xs.filter(x => x != null).sort((a, b) => a - b);
  if (!xs.length) return null;
  const at = f => { const i = (xs.length - 1) * f, lo = Math.floor(i); return xs[lo] + (xs[Math.ceil(i)] - xs[lo]) * (i - lo); };
  return { n: xs.length, median: +at(0.5).toFixed(3), q1: +at(0.25).toFixed(3), q3: +at(0.75).toFixed(3) };
}
export function degenerate(r) {
  const words = body(r.text).match(/[؀-ۿ‌]{2,}/g) || [];
  const cnt = {}; for (const w of words) cnt[w] = (cnt[w] || 0) + 1;
  const [topWord, topN] = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const share = words.length >= 50 ? topN / words.length : 0;
  const v = loopVerdict(r.text || '');
  const why = [v.refuse && 'loop_guard', share >= 0.14 && `word:${topWord}:${share.toFixed(2)}`, r.finish === 'MAX_TOKENS' && 'max_tokens'].filter(Boolean);
  return why.length ? why.join(',') : null;
}

const table = [];
for (const spec of process.argv.slice(2)) {
  const [arm, files] = spec.split('='); const [pagesPath, scoresPath] = files.split(':');
  const pages = jl(pagesPath); const scores = new Map(jl(scoresPath).map(s => [s.id, s]));
  const rows = pages.map(p => ({ id: p.id, poets: p.ganjoor_poets || [], degenerate: degenerate(p), ...scores.get(p.id) }));
  const inG = rows.filter(r => r.poets.length);
  table.push({
    arm, n_pages: rows.length, n_in_ganjoor: inG.length,
    located: rows.filter(r => r.status === 'scored').length,
    seq: q(rows.map(r => r.acc)), line_local: q(rows.map(r => r.line_local)),
    line_global_itt: q(inG.map(r => r.line_global ?? 0)),
    // the same pages' lines against a different poet's whole works: what line_global gives for text that is not this poem
    wrong_poet_floor: q(inG.map(r => r.wrong_poet_line)),
    // a location that covers < 20% of the OCR, or whose seq does not beat its own wrong-place control, is a flag that
    // the "located" span may be a fragment match rather than the page (reported, not removed, so Stage 1 stays comparable)
    located_weak: rows.filter(r => r.status === 'scored' && (r.coverage < 0.2 || r.acc <= (r.wrong_place_acc ?? 0))).map(r => `${r.id} cov ${r.coverage}`),
    loops: rows.filter(r => r.degenerate).length,
    loop_pages: rows.filter(r => r.degenerate).map(r => `${r.id} ${r.degenerate}`),
    per_page: Object.fromEntries(rows.map(r => [r.id, { acc: r.acc ?? null, line_local: r.line_local ?? null, line_global: r.line_global ?? null, degenerate: r.degenerate }])),
  });
}
console.log(JSON.stringify(table, null, 1));
