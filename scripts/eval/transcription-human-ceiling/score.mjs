#!/usr/bin/env node
// PRIOR ART: scripts/eval/reference-error-rate.mjs and build-edition-refs.mjs score an ENGINE against one reference
// with lib/metrics.mjs (normalizeForScript / normalizeCJK + windowedErrorRate); scripts/eval/en-ocr-reference-5124.mjs
// has its own English scorer with head/tail trimming. None scores one human transcription against another. This
// reuses the lib kernel unchanged, in both directions, so the human-vs-human floor lands on the scale of the bench's
// OCR figures, and puts our served OCR against each of the two transcriptions on the same pages.
/** Human ceiling, transcription (#5762 track 2): CER between two independent human transcriptions of the same page, and our served OCR against each, with book-clustered bootstrap CIs. */
/**
 *   node scripts/eval/transcription-human-ceiling/score.mjs --pairs <pairs.jsonl>[,<pairs.jsonl>…] --out <dir> [--seed 5762]
 * Input rows: PAIRS-BRIEF.md. Writes <dir>/results.json, pages.jsonl (one row per page, no texts) and table.md.
 * CER = windowedErrorRate over the lib normalisation of BOTH sides (letters only; case, diacritics, punctuation,
 * spacing, line breaks, u/v-style edition variants and markup are folded away by the lib: what is left is a
 * difference of LETTERS). Edges are free (one cut may be a word wider than the other), interior differences are
 * charged. The floor is the mean of the two directions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalizeForScript, normalizeCJK, windowedErrorRate, NORMALIZE_FOR_SCRIPT_VERSION } from '../lib/metrics.mjs';
import { resetSeed, bootstrapRatioCI } from '../lib/paired-stats.mjs';
import { readJsonl, writeJsonl } from '../translation-vs-reference/common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const OUT = opt('out'); const SEED = Number(opt('seed', 5762));
if (!opt('pairs') || !OUT) { console.error('--pairs and --out are required'); process.exit(1); }

const norm = (t, script) => (script === 'cjk' ? normalizeCJK(t || '') : normalizeForScript(t || '', script));
/** edits and reference length of hyp against ref, fitting alignment */
function err(ref, hyp, script) {
  const w = windowedErrorRate(norm(ref, script), norm(hyp, script));
  return { cer: w.windowedCer, units: w.windowUnits, edits: Math.round(w.windowedCer * w.windowUnits) };
}
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };

const rows = opt('pairs').split(',').flatMap((f) => readJsonl(f));
const pages = rows.map((r) => {
  const ab = err(r.a.text, r.b.text, r.script), ba = err(r.b.text, r.a.text, r.script);
  const oa = r.ours?.text ? err(r.a.text, r.ours.text, r.script) : null, ob = r.ours?.text ? err(r.b.text, r.ours.text, r.script) : null;
  return { id: r.id, lang: r.lang, script: r.script, work: r.work, edition: r.edition, book_id: r.book_id ?? null, page_number: r.page_number ?? null, printed_page: r.printed_page ?? null,
    cluster: r.book_id || r.work || r.id,
    a: { source: r.a.source, how_made: r.a.how_made, licence: r.a.licence, url: r.a.url, chars: ab.units }, b: { source: r.b.source, how_made: r.b.how_made, licence: r.b.licence, url: r.b.url, chars: ba.units },
    edition_check: r.edition_check, edition_check_by: r.edition_check_by, edition_note: r.edition_note || null, independence: r.independence, cut_method: r.cut_method,
    human_b_vs_a: ab, human_a_vs_b: ba, human_cer: r4((ab.cer + ba.cer) / 2),
    ours_model: r.ours?.model ?? null, ours_vs_a: oa, ours_vs_b: ob };
});

/** pooled CER (Σ edits / Σ reference chars) with a bootstrap over books, not pages */
function pooled(ps, pick) {
  const by = {};
  for (const p of ps) { const xs = pick(p).filter(Boolean); if (!xs.length) continue; const c = (by[p.cluster] ||= { e: 0, u: 0 }); for (const x of xs) { c.e += x.edits; c.u += x.units; } }
  const cs = Object.values(by);
  const b = bootstrapRatioCI(cs.map((c) => c.e), cs.map((c) => c.u));
  return { pooled_cer: r4(b.rate), ci: b.ci ? b.ci.map(r4) : null, books: cs.length, chars: b.denom };
}
function block(ps) {
  const withOurs = ps.filter((p) => p.ours_vs_a);
  return { pages: ps.length, books: new Set(ps.map((p) => p.cluster)).size,
    human_vs_human: { ...pooled(ps, (p) => [p.human_b_vs_a, p.human_a_vs_b]), median_page_cer: r4(median(ps.map((p) => p.human_cer))), pages_identical: ps.filter((p) => p.human_b_vs_a.edits === 0 && p.human_a_vs_b.edits === 0).length },
    on_pages_we_hold: withOurs.length ? { pages: withOurs.length,
      human_vs_human: pooled(withOurs, (p) => [p.human_b_vs_a, p.human_a_vs_b]),
      ours_vs_a: { ...pooled(withOurs, (p) => [p.ours_vs_a]), median_page_cer: r4(median(withOurs.map((p) => p.ours_vs_a.cer))) },
      ours_vs_b: { ...pooled(withOurs, (p) => [p.ours_vs_b]), median_page_cer: r4(median(withOurs.map((p) => p.ours_vs_b.cer))) },
      ours_models: Object.fromEntries([...new Set(withOurs.map((p) => p.ours_model))].map((m) => [m, withOurs.filter((p) => p.ours_model === m).length])) } : null };
}
resetSeed(SEED);
const groups = {};
for (const p of pages) {
  const same = p.edition_check === 'same' ? 'same-edition' : 'edition-mismatch';
  (groups[`${p.lang} · ${same}`] ||= []).push(p);
  (groups[`${p.lang} · ${same} · ${p.a.source.replace(/[\s#]*[A-Z]?\d[\w.-]*$/, '').trim()} vs ${p.b.source.replace(/[\s#]*[A-Z]?\d[\w.-]*$/, '').trim()}`] ||= []).push(p);
}
const results = { generated: new Date().toISOString(), seed: SEED, measure: 'agreement between two human transcriptions (not accuracy: neither is the truth); ours-vs-reference is accuracy against that reference',
  normalisation: `scripts/eval/lib/metrics.mjs normalizeForScript v${NORMALIZE_FOR_SCRIPT_VERSION} / normalizeCJK + windowedErrorRate, identical for every pair`,
  n_pages: pages.length, groups: Object.fromEntries(Object.entries(groups).map(([k, ps]) => [k, block(ps)])),
  edition_checked_by_eye: pages.filter((p) => p.edition_check_by === 'eye').length };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
writeJsonl(path.join(OUT, 'pages.jsonl'), pages);
const pct = (x) => (x == null ? '–' : `${(x * 100).toFixed(2)}%`);
const cell = (b) => (b ? `${pct(b.pooled_cer)} [${b.ci ? b.ci.map(pct).join(', ') : '–'}]` : '–');
const md = ['| pairs | pages (books) | human vs human, pooled CER [95% CI] | median page | identical pages | pages we hold | human vs human there | our OCR vs A | our OCR vs B |', '|---|---|---|---|---|---|---|---|---|'];
for (const [k, g] of Object.entries(results.groups)) md.push(`| ${k} | ${g.pages} (${g.books}) | ${cell(g.human_vs_human)} | ${pct(g.human_vs_human.median_page_cer)} | ${g.human_vs_human.pages_identical} | ${g.on_pages_we_hold?.pages ?? 0} | ${cell(g.on_pages_we_hold?.human_vs_human)} | ${cell(g.on_pages_we_hold?.ours_vs_a)} | ${cell(g.on_pages_we_hold?.ours_vs_b)} |`);
fs.writeFileSync(path.join(OUT, 'table.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
