#!/usr/bin/env node
// PRIOR ART: ../score2.js (round 1: verdict counting over every read). Round 2 (PREREGISTRATION.md here) scores only
// the pages the #4523 write rule would WRITE: blank-band marker lines stripped, scripts/lib/first-ocr-guard.mjs
// firstOcrVerdict(text, image) unflagged, ≥ 150 Tibetan syllables.
//   node score-r2.mjs --reads DIR --verdicts FILE --refs references-A.jsonl --img DIR
import fs from 'node:fs';
import path from 'node:path';
import { firstOcrVerdict } from '../../../lib/first-ocr-guard.mjs';

const arg = (k) => process.argv[process.argv.indexOf(`--${k}`) + 1];
const MARK = /^\s*(empty page|ཤོག་སྟོང[་།]*)\s*$/i;
const syl = (t) => (t.match(/[ཀ-ྼ]+/gu) || []).length;
const jl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const refs = Object.fromEntries(jl(arg('refs')).map((r) => [r.id, r]));
const V = Object.fromEntries(jl(arg('verdicts')).map((v) => [v.id, v]));
let written = 0, textPages = 0, inv = 0, refL = 0, drop = 0, clean = 0, okm = 0, readL = 0, headMarks = 0;
const rows = [];
for (const id of Object.keys(refs)) {
  if (refs[id].has_text) textPages++;
  const raw = fs.existsSync(path.join(arg('reads'), `${id}.txt`)) ? fs.readFileSync(path.join(arg('reads'), `${id}.txt`), 'utf8') : '';
  const lines = raw.replace(/\n+$/, '').split('\n');
  const text = lines.filter((l) => !MARK.test(l)).join('\n');
  const g = await firstOcrVerdict(text, fs.readFileSync(path.join(arg('img'), `${id}.jpg`)));
  const n = syl(text);
  const w = !g.flag && n >= 150;
  const v = V[id];
  const keep = v ? v.line_verdicts.map((x, i) => ({ x, l: lines[i] || '' })).filter(({ l }) => !MARK.test(l)) : [];
  // invented = ≥ 3 Tibetan syllables not on the page, or a loop (prereg); a punctuation-only line is recorded, not counted
  const invLines = keep.filter(({ x, l }) => (x === 'invented' && syl(l) >= 3) || x === 'loop');
  headMarks += keep.filter(({ x, l }) => x === 'invented' && syl(l) < 3).length;
  rows.push({ id, written: w, syllables: n, guard: g.flags, invented_lines: invLines.length });
  if (!w || !v) continue;
  written++;
  const c = (k) => keep.filter(({ x }) => x === k).length;
  const ref = refs[id].body_lines; refL += ref; drop += Math.min(v.dropped_body_lines, ref);
  if (invLines.length) inv++;
  okm += c('ok') + c('minor'); readL += c('ok') + c('minor') + c('wrong') + c('invented') + c('loop');
  if (!v.dropped_body_lines && !v.loop && !c('loop') && !invLines.length && c('wrong') <= 1) clean++;
}
const out = { text_pages: textPages, written, coverage: +(written / textPages).toFixed(3), invented_written_pages: inv,
  line_recall: refL ? +(1 - drop / refL).toFixed(3) : null, clean_share: written ? +(clean / written).toFixed(3) : null,
  okminor: readL ? +(okm / readL).toFixed(3) : null, punctuation_only_insertions: headMarks };
out.pass_1_4 = out.invented_written_pages === 0 && out.line_recall >= 0.95 && out.clean_share >= 0.9 && out.okminor >= 0.9;
console.log(JSON.stringify(out));
console.log(rows.map((r) => `${r.id} ${r.written ? 'W' : '-'} syl=${r.syllables} ${r.guard.join('+')} inv=${r.invented_lines}`).join('\n'));
