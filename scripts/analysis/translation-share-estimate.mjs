#!/usr/bin/env node
/**
 * Per-language translated share from the uniform draw of translation-share-sample.mjs and the verdicts of
 * gap-validation-cli-adjudicate.mjs (#7751).
 *
 * PRIOR ART: scripts/analysis/gap-validation-estimate.mjs — the June two-stratum (Rogan–Gladen style) correction over a
 * STRATIFIED draw. This draw is uniform over works, so no reweighting is needed: the share is a binomial proportion
 * with a Wilson 95% interval. Same binary rule as that file's toBinary (container and uncertain are not well-posed).
 *
 * Verdict per work: Gemini (agy) on all n; on the Sonnet subset, where the two disagree, the third read settles it.
 *
 * Reads:  scripts/output/translation-share/<lang>-frame.json (answer key: ext, sl),
 *         <lang>-agy-verdicts.jsonl, <lang>-sonnet-verdicts.jsonl, <lang>-tiebreak-verdicts.jsonl (optional)
 * Writes: scripts/output/translation-share/<lang>-estimate.json, <lang>-final-verdicts.jsonl
 * Usage:  node scripts/analysis/translation-share-estimate.mjs --lang german
 *         node scripts/analysis/translation-share-estimate.mjs --lang all   # every language with verdicts, plus a
 *           pooled Rogan–Gladen correction of the Gemini read: its sensitivity and specificity measured on the
 *           double-read subsets (truth = Gemini and Sonnet agreeing, else the third read), 2000-rep bootstrap.
 *           Writes scripts/output/translation-share/summary.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dir, '../../scripts/output/translation-share');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const LANG_ARG = String(arg('lang', 'german')).toLowerCase();
const LANGS = LANG_ARG === 'all' ? ['german', 'french', 'italian', 'spanish', 'dutch'].filter((l) => fs.existsSync(path.join(DIR, `${l}-agy-verdicts.jsonl`))) : [LANG_ARG];
const readV = (p) => !fs.existsSync(p) ? new Map() : new Map(fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.translation_verdict && r.translation_verdict !== 'FAIL').map((r) => [r.key, r]));

function estimateLang(LANG) {
const f = (s) => path.join(DIR, `${LANG}-${s}`);
const frame = JSON.parse(fs.readFileSync(f('frame.json'), 'utf8'));
const G = readV(f('agy-verdicts.jsonl')), S = readV(f('sonnet-verdicts.jsonl')), T = readV(f('tiebreak-verdicts.jsonl'));
// three-way label for agreement; binary (well-posed) for the share, as gap-validation-estimate.mjs toBinary
const tri = (v) => v.relationship === 'container' ? 'unsure' : v.translation_verdict === 'translated' ? 'translated' : v.translation_verdict === 'untranslated' ? 'not_found' : 'unsure';
const wilson = (k, n, z = 1.96) => { if (!n) return null; const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; return { k, n, p: +p.toFixed(4), lo: +Math.max(0, c - h).toFixed(4), hi: +Math.min(1, c + h).toFixed(4) }; };

const rows = [];
for (const w of frame.works) {
  const g = G.get(w.key); if (!g) continue;
  const s = S.get(w.key), t = T.get(w.key);
  let final = g, by = 'gemini';
  if (s) { if (tri(s) === tri(g)) by = 'gemini=sonnet'; else if (t) { final = t; by = 'tiebreak'; } else by = 'gemini (dispute unsettled)'; }
  rows.push({ key: w.key, work: w.work, periodical_issue: !!w.periodical_issue, ext: w.ext, sl: w.sl, print_year: w.print_year, n_editions: w.n_editions, author: w.author, title: w.title,
    gemini: tri(g), sonnet: s ? tri(s) : null, tiebreak: t ? tri(t) : null, final: tri(final), by, relationship: final.relationship,
    era: final.composition_era ?? g.composition_era, prior: final.prior ?? null, translator: final.translator ?? null, publisher: final.publisher ?? null,
    translation_year: final.translation_year ?? null, evidence_url: final.evidence_url ?? null, quote: final.quote ?? null, no_search: !!g.no_search });
}
fs.writeFileSync(f('final-verdicts.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

const share = (rs, field = 'final') => { const wp = rs.filter((r) => r[field] !== 'unsure'); return wilson(wp.filter((r) => r[field] === 'translated').length, wp.length); };
const century = {};
for (const r of rows) { const c = `${Math.floor(r.print_year / 100)}00s`; (century[c] ??= []).push(r); }
const trans = rows.filter((r) => r.final === 'translated');

// Cohen's kappa, Gemini vs Sonnet, on the subset (three labels, and binary over the pairs both call well-posed)
function kappa(pairs) {
  const n = pairs.length; if (!n) return null;
  const labs = [...new Set(pairs.flat())];
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = labs.reduce((s, l) => s + (pairs.filter(([a]) => a === l).length / n) * (pairs.filter(([, b]) => b === l).length / n), 0);
  return { n, observed: +po.toFixed(3), kappa: pe === 1 ? null : +((po - pe) / (1 - pe)).toFixed(3) };
}
const both = rows.filter((r) => r.sonnet);
const out = {
  generated: new Date().toISOString().slice(0, 10), issue: '#7751', lang: LANG, seed: frame.seed, pool: frame.pool, n_drawn: frame.works.length, n_adjudicated: rows.length,
  share_translated: share(rows), share_translated_gemini_only: share(rows, 'gemini'),
  periodical_issues_in_sample: rows.filter((r) => r.periodical_issue).length,
  share_translated_excl_periodical_issues: share(rows.filter((r) => !r.periodical_issue)),
  unsure: rows.filter((r) => r.final === 'unsure').length,
  translated_via_other_language: trans.filter((r) => r.relationship === 'different_source_language').length,
  share_renaissance_composed: share(rows.filter((r) => r.era === 'renaissance_early_modern')),
  by_century: Object.fromEntries(Object.entries(century).sort().map(([c, rs]) => [c, share(rs)])),
  catalogue_recall: wilson(trans.filter((r) => r.ext).length, trans.length),
  ext_in_sample: rows.filter((r) => r.ext).length,
  sl_held_in_sample: rows.filter((r) => r.sl != null).length,
  sl_readable_in_sample: wilson(rows.filter((r) => r.sl === 'readable').length, rows.length),
  anonymous_in_sample: rows.filter((r) => !r.author).length,
  answered_without_search: rows.filter((r) => r.no_search).length,
  second_opinion: {
    n: both.length,
    agreement_3way: kappa(both.map((r) => [r.gemini, r.sonnet])),
    agreement_binary: kappa(both.filter((r) => r.gemini !== 'unsure' && r.sonnet !== 'unsure').map((r) => [r.gemini, r.sonnet])),
    disputes: both.filter((r) => r.gemini !== r.sonnet).length,
    settled_by_tiebreak: both.filter((r) => r.by === 'tiebreak').map((r) => ({ key: r.key, gemini: r.gemini, sonnet: r.sonnet, tiebreak: r.tiebreak })),
    gemini_said_translated_sonnet_not: both.filter((r) => r.gemini === 'translated' && r.sonnet !== 'translated').length,
    sonnet_said_translated_gemini_not: both.filter((r) => r.sonnet === 'translated' && r.gemini !== 'translated').length,
  },
};
fs.writeFileSync(f('estimate.json'), JSON.stringify(out, null, 2));
console.log(`${LANG}: translated ${pc(out.share_translated)}; gemini-only ${pc(out.share_translated_gemini_only)}; recall ${pc(out.catalogue_recall)}; kappa ${JSON.stringify(out.second_opinion.agreement_3way)}`);
return { out, rows };
}
const pc = (w) => w ? `${(100 * w.p).toFixed(1)}% [${(100 * w.lo).toFixed(1)}–${(100 * w.hi).toFixed(1)}] (${w.k}/${w.n})` : 'n/a';

const res = Object.fromEntries(LANGS.map((l) => [l, estimateLang(l)]));
if (LANG_ARG === 'all') {
  // Gemini's sensitivity / specificity against the reconciled truth on the double-read subsets, pooled over languages
  // (each language has too few positives alone). Unsure on either side is left out.
  const truthOf = (r) => r.gemini === r.sonnet ? r.gemini : r.tiebreak;
  const sub = Object.values(res).flatMap(({ rows }) => rows.filter((r) => r.sonnet).map((r) => ({ g: r.gemini, t: truthOf(r) })))
    .filter((x) => x.t && x.t !== 'unsure' && x.g !== 'unsure');
  const sensSpec = (xs) => { const P = xs.filter((x) => x.t === 'translated'), Nn = xs.filter((x) => x.t === 'not_found');
    return { sens: P.length ? P.filter((x) => x.g === 'translated').length / P.length : null, spec: Nn.length ? Nn.filter((x) => x.g === 'not_found').length / Nn.length : null, P: P.length, N: Nn.length }; };
  const rg = (p, ss) => (ss.sens == null || ss.sens + ss.spec - 1 <= 0) ? null : Math.min(1, Math.max(0, (p + ss.spec - 1) / (ss.sens + ss.spec - 1)));
  const ss = sensSpec(sub);
  let a = 7751; const rnd = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rs = (xs) => xs.map(() => xs[(rnd() * xs.length) | 0]);
  const corrected = {};
  for (const [l, { rows }] of Object.entries(res)) {
    const g = rows.filter((r) => r.gemini !== 'unsure').map((r) => r.gemini === 'translated');
    const p = g.filter(Boolean).length / g.length;
    const draws = [];
    for (let b = 0; b < 2000; b++) { const gb = rs(g); const v = rg(gb.filter(Boolean).length / gb.length, sensSpec(rs(sub))); if (v != null) draws.push(v); }
    draws.sort((x, y) => x - y);
    corrected[l] = { gemini_share: +p.toFixed(4), corrected: rg(p, ss) == null ? null : +rg(p, ss).toFixed(4),
      lo: +draws[Math.floor(0.025 * draws.length)].toFixed(4), hi: +draws[Math.floor(0.975 * draws.length)].toFixed(4) };
  }
  const summary = { generated: new Date().toISOString().slice(0, 10), issue: '#7751', gemini_vs_truth_pooled: { ...ss, n: sub.length }, corrected,
    per_language: Object.fromEntries(Object.entries(res).map(([l, { out }]) => [l, out])) };
  fs.writeFileSync(path.join(DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`pooled Gemini vs reconciled truth: sens ${ss.sens?.toFixed(3)} (${ss.P} positives), spec ${ss.spec?.toFixed(3)} (${ss.N} negatives)`);
  for (const [l, c] of Object.entries(corrected)) console.log(`  ${l}: gemini ${(100 * c.gemini_share).toFixed(1)}% -> corrected ${c.corrected == null ? 'n/a' : (100 * c.corrected).toFixed(1) + '%'} [${(100 * c.lo).toFixed(1)}–${(100 * c.hi).toFixed(1)}]`);
}
