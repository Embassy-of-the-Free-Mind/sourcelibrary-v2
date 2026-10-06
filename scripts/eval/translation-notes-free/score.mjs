#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-prompt-v17/score.mjs (#5698) — its pageScore, looped and pairedCI are imported
// and used unchanged; its main is tied to the four v17 arms and the typed-note metrics, and it has no rule for
// non-inferiority. scripts/eval/translation-prompt-v17/report.mjs joins a dimension pass this test does not run.
// This adds only what #5919's P1–P4 ask for: <gloss>, single-bracket and <image-desc> counts, tokens and $/page,
// the body-length check against the v13-b gap, and the preregistered non-inferiority rule on fidelity and reversals.
/** #5919 note-free translation: pack arm outputs, build harness records, mechanical P3/P4, and the preregistered P1/P2 rule on the #5695 fidelity results. */
/**
 *   node scripts/eval/translation-notes-free/score.mjs --pack      # work/<arm>/*.json -> arms.jsonl, records.jsonl
 *   node scripts/eval/translation-notes-free/score.mjs             # arms.jsonl -> mechanical.json + a table (P3, P4)
 *   node scripts/eval/translation-notes-free/score.mjs --rule      # results-fidelity.json + mechanical.json -> results.json (P1, P2, Decision)
 */
import fs from 'node:fs';
import path from 'node:path';
import { pageScore, pairedCI } from '../translation-prompt-v17/score.mjs';
import { mean } from '../lib/paired-stats.mjs';
import { readJsonl, writeJsonl } from '../translation-vs-reference/common.mjs';

const DIR = new URL('../results/translation-notes-free-2026-10/', import.meta.url).pathname;
const SAMPLE = new URL('../results/translation-prompt-v17-2026-10/sample.jsonl', import.meta.url).pathname;
const ARMS = ['v13-a', 'v13-b', 'v13-plain'];
const count = (text, re) => (String(text || '').match(re) || []).length;
const inner = (text, tag) => [...String(text || '').matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].reduce((n, m) => n + m[1].trim().length, 0);
/** The page's English with every apparatus span removed from BOTH arms alike (notes, glosses, image descriptions, housekeeping). */
const translationOnly = (text) => String(text || '')
  .replace(/<(note|gloss|image-desc|meta|summary|keywords|warning)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  .replace(/->|<-/g, ' ').replace(/<\/?[a-zA-Z][^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
// A single [bracketed] run that is not a markdown link, a [[double bracket]] or a bare number/siglum.
const BRACKET_RE = /(?<!\[)\[(?!\[)([^\[\]\n]{1,200})\](?!\]|\()/g;
const brackets = (text) => [...String(text || '').matchAll(BRACKET_RE)].map((m) => m[1]);

function extra(r, src) {
  const b = brackets(r.text);
  return {
    gloss: count(r.text, /<gloss\b/gi), gloss_chars: inner(r.text, 'gloss'), term: count(r.text, /<term\b/gi),
    image_desc: count(r.text, /<image-desc\b/gi), src_image_desc: count(src, /<image-desc\b/gi), src_gloss: count(src, /<gloss\b/gi), src_note: count(src, /<note\b/gi),
    brackets_gloss: count(r.text, /<\/term>\s*\[(?!\[)[^\[\]\n]{1,200}\]|\[<term>[^\[\]\n]{1,200}<\/term>\]/gi), meta_chars: inner(r.text, 'meta'),
    brackets: b.length, brackets_words: b.filter((x) => /[A-Za-z]{2}/.test(x) && !/^\s*(sic|\.\.\.|…)\s*$/i.test(x)).length,
    parens: count(translationOnly(r.text), /\([^()\n]{2,200}\)/g), src_parens: count(src, /[(（][^()（）\n]{2,200}[)）]/g),
    translation_chars: translationOnly(r.text).length, total_chars: r.text.length,
    outputTokens: r.outputTokens, inputTokens: r.inputTokens, cost_usd: r.cost_usd, max_tokens: r.finishReason === 'MAX_TOKENS',
  };
}

if (process.argv.includes('--pack')) {
  const rows = [];
  for (const arm of ARMS) for (const f of fs.readdirSync(path.join(DIR, 'work', arm)).filter((x) => x.endsWith('.json') && !x.includes('failed')).sort()) rows.push(JSON.parse(fs.readFileSync(path.join(DIR, 'work', arm, f), 'utf8')));
  writeJsonl(path.join(DIR, 'arms.jsonl'), rows);
  const by = new Map(rows.map((r) => [`${r.arm}\u0000${r.id}`, r]));
  const recs = readJsonl(SAMPLE).map((s) => ({ ...s, candidates: ARMS.map((arm) => { const r = by.get(`${arm}\u0000${s.book_id}_${s.page_number}`); if (!r) throw new Error(`missing ${arm} ${s.book_id}_${s.page_number}`); return { arm, text: r.text }; }) }));
  writeJsonl(path.join(DIR, 'records.jsonl'), recs);
  console.log(`packed ${rows.length} rows -> arms.jsonl; ${recs.length} records; cost $${rows.reduce((s, r) => s + r.cost_usd, 0).toFixed(4)}`);
  process.exit(0);
}

const sample = new Map(readJsonl(SAMPLE).map((r) => [`${r.book_id}_${r.page_number}`, r]));
const pages = new Map();
for (const r of readJsonl(path.join(DIR, 'arms.jsonl'))) {
  const s = sample.get(r.id);
  if (!pages.has(r.id)) pages.set(r.id, { id: r.id, lang: s.lang, set: s.set, model: r.model });
  pages.get(r.id)[r.arm] = { ...pageScore(r.text, s.source_text, r.finishReason), ...extra(r, s.source_text), finish: r.finishReason };
}
const all = [...pages.values()].filter((p) => ARMS.every((a) => p[a]));
const main = all.filter((p) => p.set === 'main');
const sum = (ps, arm, k) => ps.reduce((s, p) => s + (p[arm][k] || 0), 0);
const f2 = (x, d = 2) => (x == null ? '—' : x.toFixed(d));
const METRICS = ['outputTokens', 'inputTokens', 'cost_usd', 'notes', 'note_chars', 'gloss', 'gloss_chars', 'term', 'image_desc', 'brackets', 'brackets_words', 'parens', 'body_chars', 'translation_chars', 'total_chars', 'emdashes', 'invented_tags'];

if (!process.argv.includes('--rule')) {
  const out = { generated: new Date().toISOString(), n_main: main.length, n_all: all.length, models: {}, arms: {}, paired_vs_v13a: {}, per_page: all };
  for (const p of main) out.models[p.model] = (out.models[p.model] || 0) + 1;
  for (const arm of ARMS) {
    const nl = main.filter((p) => !p[arm].looped && !p['v13-a'].looped);
    const med = (k) => { const xs = nl.map((p) => p[arm][k] / Math.max(1, p['v13-a'][k])).sort((x, y) => x - y); return xs[Math.floor(xs.length / 2)]; };
    out.arms[arm] = {
      per_page: Object.fromEntries(METRICS.map((k) => [k, sum(main, arm, k) / main.length])),
      totals: Object.fromEntries(['notes', 'gloss', 'term', 'image_desc', 'src_image_desc', 'src_gloss', 'src_note', 'brackets', 'brackets_words', 'brackets_gloss', 'meta_chars', 'parens', 'src_parens', 'invented_tags'].map((k) => [k, sum(main, arm, k)])),
      image_desc_pages_over_source: main.filter((p) => p[arm].image_desc > p[arm].src_image_desc).length, meta_over_200_pages: main.filter((p) => p[arm].meta_chars > 200).map((p) => `${p.id} ${p.lang} ${p[arm].meta_chars}`),
      pages_with: Object.fromEntries(['notes', 'gloss', 'brackets_words', 'image_desc'].map((k) => [k, main.filter((p) => p[arm][k] > 0).length])),
      looped: main.filter((p) => p[arm].looped).length, max_tokens: main.filter((p) => p[arm].max_tokens).length,
      body_ratio_median_vs_v13a: med('body_chars'), translation_ratio_median_vs_v13a: med('translation_chars'),
      body_ratio_total_vs_v13a: sum(main, arm, 'body_chars') / sum(main, 'v13-a', 'body_chars'), translation_ratio_total_vs_v13a: sum(main, arm, 'translation_chars') / sum(main, 'v13-a', 'translation_chars'),
      output_tokens_ratio_vs_v13a: sum(main, arm, 'outputTokens') / sum(main, 'v13-a', 'outputTokens'), cost_ratio_vs_v13a: sum(main, arm, 'cost_usd') / sum(main, 'v13-a', 'cost_usd'),
      by_model: Object.fromEntries(Object.keys(out.models).map((m) => { const ps = main.filter((p) => p.model === m); return [m, { n: ps.length, cost_usd: sum(ps, arm, 'cost_usd') / ps.length, outputTokens: sum(ps, arm, 'outputTokens') / ps.length }]; })),
    };
  }
  // P4 body length: relative gap per page, plain against v13-a, with v13-b − v13-a as the allowed gap.
  const rel = (k) => (x, base) => x[k] / Math.max(1, base[k]) - 1;
  for (const arm of ARMS.slice(1)) {
    out.paired_vs_v13a[arm] = Object.fromEntries(METRICS.map((k) => [k, pairedCI(main, (x) => x[k], 'v13-a', arm)]));
    for (const k of ['body_chars', 'translation_chars']) {
      const d = main.filter((p) => !p[arm].looped && !p['v13-a'].looped).map((p) => ({ 'v13-a': 0, [arm]: rel(k)(p[arm], p['v13-a']) }));
      out.paired_vs_v13a[arm][`${k}_rel`] = pairedCI(d, (x) => x, 'v13-a', arm);
    }
  }
  const gap = (k) => { const b = out.arms['v13-b'][`${k}_ratio_total_vs_v13a`] - 1, p = out.arms['v13-plain'][`${k}_ratio_total_vs_v13a`] - 1; return { v13b_gap: b, plain_gap: p, allowed_shortfall: Math.abs(b), pass: p >= -Math.abs(b) }; };
  out.p4 = { note_or_gloss_left_in_plain: { notes: out.arms['v13-plain'].totals.notes, gloss: out.arms['v13-plain'].totals.gloss, source_printed_gloss: out.arms['v13-plain'].totals.src_gloss, source_printed_note: out.arms['v13-plain'].totals.src_note },
    loops: Object.fromEntries(ARMS.map((a) => [a, out.arms[a].looped])),
    body_length_as_preregistered: gap('body'), body_length_translation_only: gap('translation'),
    note: 'body_chars (the #5698 bodyNoNotes) drops <note> spans but keeps <gloss> definitions and, in plain, the <image-desc> text that v13 puts inside a <note>; translation_chars drops notes, glosses and image descriptions from every arm alike.' };
  fs.writeFileSync(path.join(DIR, 'mechanical.json'), JSON.stringify(out, null, 1));
  console.log(`main n=${main.length}; models ${JSON.stringify(out.models)}`);
  console.log(`${'metric/page'.padEnd(20)}${ARMS.map((a) => a.padStart(12)).join('')}   plain − v13-a [CI] | v13-b − v13-a [CI]`);
  for (const k of METRICS) { const d = k === 'cost_usd' ? 5 : 2; const e = (arm) => { const x = out.paired_vs_v13a[arm][k]; return `${f2(x.delta, d)} [${f2(x.ci?.[0], d)},${f2(x.ci?.[1], d)}]`; };
    console.log(`${k.padEnd(20)}${ARMS.map((a) => f2(out.arms[a].per_page[k], d).padStart(12)).join('')}   ${e('v13-plain')} | ${e('v13-b')}`); }
  for (const arm of ARMS) { const a = out.arms[arm]; console.log(arm.padEnd(10), 'totals', JSON.stringify(a.totals), 'pages_with', JSON.stringify(a.pages_with), `looped ${a.looped} max_tokens ${a.max_tokens} tokens× ${f2(a.output_tokens_ratio_vs_v13a)} cost× ${f2(a.cost_ratio_vs_v13a)} body× ${f2(a.body_ratio_total_vs_v13a, 3)} (median ${f2(a.body_ratio_median_vs_v13a, 3)}) translation-only× ${f2(a.translation_ratio_total_vs_v13a, 3)} (median ${f2(a.translation_ratio_median_vs_v13a, 3)})`, JSON.stringify(a.by_model)); }
  console.log('P4', JSON.stringify(out.p4, null, 1));
  process.exit(0);
}

// ── the preregistered rule (#5919): P1 fidelity non-inferiority, P2 reversal pages ──
const fid = JSON.parse(fs.readFileSync(path.join(DIR, 'results-fidelity.json'), 'utf8'));
const mech = JSON.parse(fs.readFileSync(path.join(DIR, 'mechanical.json'), 'utf8'));
const setOf = new Map([...sample.values()].map((s) => [`${s.book_id}_${String(s.page_number).padStart(5, '0')}`, s.set]));
const fp = fid.per_page.filter((p) => setOf.get(p.id) === 'main').map((p) => {
  const o = { id: p.id, lang: p.lang, reference_fit: p.reference_fit };
  for (const arm of ARMS) { const a = p.arms[arm]; const js = Object.values(a.by_judge); o[arm] = { fidelity: a.fidelity, by_judge: Object.fromEntries(Object.entries(a.by_judge).map(([j, v]) => [j, v.fidelity])), omission: js.filter((j) => j.omission).length / js.length, reversal_any: js.some((j) => j.reversal) ? 1 : 0, reversal_both: js.every((j) => j.reversal) ? 1 : 0, reversal_quotes: js.map((j) => j.reversal).filter(Boolean) }; }
  return o;
});
if (fp.length !== 40) throw new Error(`expected 40 main pages in results-fidelity.json, found ${fp.length}`);
const scored = fp.filter((p) => ARMS.every((a) => p[a].fidelity != null));
const m = (arm, f) => mean(scored.map((p) => f(p[arm])));
const armCI = (arm) => { const z = scored.map((p) => ({ zero: { fidelity: 0 }, [arm]: p[arm] })); return pairedCI(z, (x) => x.fidelity, 'zero', arm); };
const plain = pairedCI(scored, (x) => x.fidelity, 'v13-a', 'v13-plain'); const floor = pairedCI(scored, (x) => x.fidelity, 'v13-a', 'v13-b');
const margin = Math.max(Math.abs(floor.delta), 0.15);
const rev = Object.fromEntries(ARMS.map((a) => [a, fp.filter((p) => p[a].reversal_any).length]));
const p1 = { mean: Object.fromEntries(ARMS.map((a) => [a, m(a, (x) => x.fidelity)])), ci: Object.fromEntries(ARMS.map((a) => [a, armCI(a).ci])), plain_minus_v13a: plain, v13b_minus_v13a: floor, margin, ci_lower_bound_needed: -0.30,
  pass_mean: plain.delta >= -margin, pass_ci: plain.ci[0] > -0.30 };
p1.pass = p1.pass_mean && p1.pass_ci;
const p2 = { reversal_pages_either_judge: rev, reversal_pages_both_judges: Object.fromEntries(ARMS.map((a) => [a, fp.filter((p) => p[a].reversal_both).length])), allowed: rev['v13-a'] + 1, pass: rev['v13-plain'] <= rev['v13-a'] + 1,
  pages: fp.filter((p) => ARMS.some((a) => p[a].reversal_any)).map((p) => ({ id: p.id, lang: p.lang, ...Object.fromEntries(ARMS.map((a) => [a, p[a].reversal_quotes])) })) };
const perJudge = Object.fromEntries(fid.judges.map((j) => { const ps = fp.filter((p) => ARMS.every((a) => p[a].by_judge[j] != null)); return [j, { ...Object.fromEntries(ARMS.map((a) => [a, mean(ps.map((p) => p[a].by_judge[j]))])), plain_minus_v13a: pairedCI(ps.map((p) => Object.fromEntries(ARMS.map((a) => [a, { f: p[a].by_judge[j] }]))), (x) => x.f, 'v13-a', 'v13-plain') }]; }));
const byModel = Object.fromEntries(Object.keys(mech.models).map((mod) => { const ids = new Set(mech.per_page.filter((p) => p.model === mod).map((p) => { const [b, n] = p.id.split('_'); return `${b}_${n.padStart(5, '0')}`; })); const ps = scored.filter((p) => ids.has(p.id)); return [mod, { n: ps.length, ...Object.fromEntries(ARMS.map((a) => [a, mean(ps.map((p) => p[a].fidelity))])), plain_minus_v13a: pairedCI(ps, (x) => x.fidelity, 'v13-a', 'v13-plain') }]; }));
const GROUPS = { 'Latin': ['Latin'], 'Greek': ['Greek'], 'vernaculars': ['German', 'French', 'Italian', 'Dutch'], 'Hebrew/Aramaic': ['Hebrew', 'Aramaic'], 'Arabic/Persian': ['Arabic', 'Persian'], 'Sanskrit/Pali': ['Sanskrit', 'Pali'], 'Chinese': ['Chinese'] };
const byLang = Object.fromEntries(Object.entries(GROUPS).map(([g, langs]) => { const ps = scored.filter((p) => langs.includes(p.lang)); return [g, { n: ps.length, ...Object.fromEntries(ARMS.map((a) => [a, mean(ps.map((p) => p[a].fidelity))])) }]; }));
const out = { generated: new Date().toISOString(), issue: 5919, n_main: fp.length, n_scored: scored.length, measure: 'fidelity: judged against a human reference, two blind Opus judges (#5695 harness, unchanged); mechanical: exact string counts',
  gate: fid.gate, agreement: fid.agreement, P1_fidelity: p1, P2_reversals: p2,
  omission_rate: { ...Object.fromEntries(ARMS.map((a) => [a, m(a, (x) => x.omission)])), plain_minus_v13a: pairedCI(scored, (x) => x.omission, 'v13-a', 'v13-plain'), v13b_minus_v13a: pairedCI(scored, (x) => x.omission, 'v13-a', 'v13-b') },
  P3_cost: Object.fromEntries(ARMS.map((a) => [a, { usd_per_page: mech.arms[a].per_page.cost_usd, output_tokens_per_page: mech.arms[a].per_page.outputTokens, output_tokens_ratio_vs_v13a: mech.arms[a].output_tokens_ratio_vs_v13a, cost_ratio_vs_v13a: mech.arms[a].cost_ratio_vs_v13a, by_model: mech.arms[a].by_model }])),
  P4_leakage: mech.p4, brackets: Object.fromEntries(ARMS.map((a) => [a, { total: mech.arms[a].totals.brackets, with_words: mech.arms[a].totals.brackets_words, definition_after_term: mech.arms[a].totals.brackets_gloss, pages: mech.arms[a].pages_with.brackets_words }])),
  by_judge: perJudge, by_model: byModel, by_lang: byLang,
  decision: { P1: p1.pass, P2: p2.pass, rule: p1.pass && p2.pass ? 'P1 and P2 pass: recommend note-free translation plus a separate, on-demand notes step' : 'P1 or P2 fails: notes stay inline' }, per_page: fp };
fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify(out, null, 1));
console.log(`gate ${fid.gate.pass}; κ ${fid.agreement.weighted_kappa}; scored ${scored.length}/40`);
console.log('P1', JSON.stringify(p1));
console.log('P2', JSON.stringify({ ...p2, pages: undefined })); for (const p of p2.pages) console.log('  ', p.id, p.lang, ARMS.map((a) => `${a}:${p[a].length}`).join(' '));
console.log('omission', JSON.stringify(out.omission_rate)); console.log('by_judge', JSON.stringify(perJudge)); console.log('by_model', JSON.stringify(byModel)); console.log('by_lang', JSON.stringify(byLang));
console.log('DECISION', JSON.stringify(out.decision));
