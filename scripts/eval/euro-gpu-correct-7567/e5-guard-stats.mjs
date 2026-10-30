#!/usr/bin/env node
// PRIOR ART: none for this count — e5-write.mjs runs the same guards on the pages it writes; this runs them on EVERY
// arm-c answer, so E3 can say how often each guard fires on the lane's output, by language.
/**
 * e5-guard-stats.mjs — #7567 E3 on arm c's whole E5 output: the long-s pass and the diff guard
 * (scripts/lib/correction-diff-guard.mjs), against c's own draft X (what the corrector changed) and against L, the
 * stored Flash-Lite text (what a reader would see change). Writes <J>/guard-stats.json and prints a table.
 *   J=<e5 dir> node e5-guard-stats.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { correctionDiffs, longSPass } from '../../lib/correction-diff-guard.mjs';

const J = process.env.J;
const jl = (p) => Object.fromEntries(fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.page_id, r]));
const panel = JSON.parse(fs.readFileSync(path.join(J, 'panel.json'), 'utf8')).pages;
const L = jl(path.join(J, 'drafts', 'L.jsonl')), X = jl(path.join(J, 'drafts', 'X.jsonl'));
const T = {}; const rows = [];
for (const p of panel) {
  const f = path.join(J, 'arms', 'c', `${p.slug}.json`); if (!fs.existsSync(f)) continue;
  const r = JSON.parse(fs.readFileSync(f, 'utf8')); if (r.outcome !== 'corrected') continue;
  const ls = longSPass(r.text, { lang: p.lang, convention: L[p.slug]?.text || '' });
  const vsX = correctionDiffs(X[p.slug]?.text || '', ls.text, { lang: p.lang }).flags;
  const vsL = correctionDiffs(L[p.slug]?.text || '', ls.text, { lang: p.lang }).flags;
  for (const lang of [p.lang, 'all']) {
    const t = (T[lang] ??= { pages: 0, long_s_tell_pages: 0, long_s_tells: 0, long_s_folded_pages: 0, vs_draft: { pages: 0, negation: 0, number: 0, expansion: 0 }, vs_stored: { pages: 0, negation: 0, number: 0, expansion: 0 } });
    t.pages++; t.long_s_tells += ls.tells.length; t.long_s_tell_pages += ls.tells.length > 0; t.long_s_folded_pages += ls.folded > 0;
    for (const [k, fl] of [['vs_draft', vsX], ['vs_stored', vsL]]) { t[k].pages += fl.length > 0; for (const x of fl) t[k][x.kind]++; }
  }
  rows.push({ slug: p.slug, tells: ls.tells, vs_draft: vsX.map((x) => ({ kind: x.kind, draft: x.draft, next: x.next })), vs_stored: vsL.map((x) => ({ kind: x.kind, draft: x.draft, next: x.next })) });
}
fs.writeFileSync(path.join(J, 'guard-stats.json'), JSON.stringify({ by_lang: T, rows }, null, 1));
for (const [lang, t] of Object.entries(T)) console.log(`${lang}: ${t.pages} corrected pages | long-s tells on ${t.long_s_tell_pages} pages (${t.long_s_tells}), ſ folded on ${t.long_s_folded_pages} | flagged vs draft ${t.vs_draft.pages} (neg ${t.vs_draft.negation}, num ${t.vs_draft.number}, exp ${t.vs_draft.expansion}) | vs stored ${t.vs_stored.pages} (neg ${t.vs_stored.negation}, num ${t.vs_stored.number}, exp ${t.vs_stored.expansion})`);
