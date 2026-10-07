#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-prompt-ab.mjs `scoreTranslation` — reused for invented tags and em-dashes, and
// `parseTranslationTerms` (scripts/lib/page-terms-parse.mjs) for the verified-original tiers. Neither knows a note
// TYPE, counts notes per type, or compares more than two arms against a noise-floor arm, which is what
// PREREGISTRATION-translation-prompt-v17.md asks for. `classifyNote` in quality-census-score.mjs is the clutter
// detector, but that script runs its main on import; CLUTTER_RE below is a narrower stand-in and the judge's
// per-note audit is the primary clutter count.
/** Mechanical outcomes for #5698 v17: notes by type, typed share, verified originals, clutter, body length, loops; paired CIs against v13-a with the v13-b noise floor. */
/**
 *   node scripts/eval/translation-prompt-v17/score.mjs --pack     # work/<arm>/*.json -> arms.jsonl (one line per page x arm)
 *   node scripts/eval/translation-prompt-v17/score.mjs            # arms.jsonl -> mechanical.json + a table
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseTranslationTerms } from '../../lib/page-terms-parse.mjs';
import { scoreTranslation } from '../translation-prompt-ab.mjs';
import { resetSeed, seededRand, mean } from '../lib/paired-stats.mjs';
import { readJsonl, writeJsonl } from '../translation-vs-reference/common.mjs';

const DIR = new URL('../results/translation-prompt-v17-2026-10/', import.meta.url).pathname;
export const ARMS = ['v13-a', 'v13-b', 'v17-study', 'v17-reading'];
export const TYPES = ['original', 'clarification', 'context', 'alternative', 'image'];
const NOTE_RE = /<note(\s[^>]*)?>([\s\S]*?)<\/note>/gi;
const CLUTTER_RE = /\b(?:decorat\w+ initial|ornament\w* initial|historiated initial|drop cap|initial letter|head-?piece|tail-?piece|printer'?s (?:device|ornament|mark)|ornamental border|show-?through|bleed-?through|foxing|stain(?:ed|ing)?|water ?damage|cropped|illegible|scan(?:ned)? (?:quality|is)|damaged)\b/i;
// What v13 already writes for a second reading, with no type to carry it.
const UNTYPED_ALT_RE = /^\s*(?:or[:,]?\s|alt(?:ernative(?:ly)?)?\b|lit(?:erally|\.)|also (?:read|possible)|could also|may also|possibly\b|perhaps\b)/i;

export function notesOf(text) {
  return [...String(text || '').matchAll(NOTE_RE)].map((m) => {
    const body = m[2].trim();
    const t = /^(original|clarification|context|alternative|image)\s*:/i.exec(body);
    return { body, attr: !!m[1], type: t ? t[1].toLowerCase() : 'untyped', clutter: CLUTTER_RE.test(body), untyped_alt: !t && UNTYPED_ALT_RE.test(body) };
  });
}
const bodyNoNotes = (text) => String(text || '').replace(NOTE_RE, ' ')
  .replace(/<(meta|summary|keywords|warning)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<\/?[a-zA-Z][^>]*>/g, ' ').replace(/->|<-/g, ' ').replace(/\s+/g, ' ').trim();
/** Preregistered loop class: MAX_TOKENS, or >= 40 sentences of which fewer than half are distinct. */
export function looped(text, finish) {
  const s = bodyNoNotes(text).split(/(?<=[.!?。།॥])\s+/).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 3);
  return finish === 'MAX_TOKENS' || (s.length >= 40 && new Set(s).size / s.length < 0.5);
}

export function pageScore(text, ocr, finish) {
  const notes = notesOf(text);
  const by = Object.fromEntries([...TYPES, 'untyped'].map((t) => [t, notes.filter((n) => n.type === t).length]));
  const orig = parseTranslationTerms(text, ocr).filter((r) => r.kind === 'original');
  const checkable = orig.filter((r) => r.match !== 'script');
  const s = scoreTranslation(text, ocr);
  return {
    notes: notes.length, ...Object.fromEntries(Object.entries(by).map(([k, v]) => [`n_${k}`, v])),
    typed: notes.length - by.untyped, attr_notes: notes.filter((n) => n.attr).length, clutter: notes.filter((n) => n.clutter).length,
    untyped_alt: notes.filter((n) => n.untyped_alt).length,
    alt_any: by.alternative + notes.filter((n) => n.untyped_alt).length,
    orig_emitted: orig.length, orig_checkable: checkable.length, orig_verified: checkable.filter((r) => r.verified === true).length,
    orig_absent: orig.filter((r) => r.match === 'absent').length, orig_script: orig.length - checkable.length,
    invented_tags: s.invented_tags, invented_names: s.invented_names, housekeeping_tags: s.housekeeping_tags, emdashes: s.emdashes,
    body_chars: bodyNoNotes(text).length, note_chars: notes.reduce((n, x) => n + x.body.length, 0), looped: looped(text, finish),
  };
}

/** Paired bootstrap over pages of mean(f(b) − f(a)); the noise floor F is the larger absolute CI bound for v13-b − v13-a. */
export function pairedCI(pages, f, a, b, iters = 10000) {
  const d = pages.filter((p) => f(p[a]) != null && f(p[b]) != null).map((p) => f(p[b]) - f(p[a]));
  if (d.length < 2) return { n: d.length, delta: null, ci: null };
  resetSeed();
  const ms = [];
  for (let i = 0; i < iters; i++) { let s = 0; for (let j = 0; j < d.length; j++) s += d[Math.floor(seededRand() * d.length)]; ms.push(s / d.length); }
  ms.sort((x, y) => x - y);
  return { n: d.length, delta: mean(d), ci: [ms[Math.floor(iters * 0.025)], ms[Math.floor(iters * 0.975)]] };
}
export function ratioCI(pages, num, den, a, b, iters = 10000) {
  const rate = (ps, arm) => { const D = ps.reduce((s, p) => s + den(p[arm]), 0); return D ? ps.reduce((s, p) => s + num(p[arm]), 0) / D : null; };
  resetSeed();
  const out = [];
  for (let i = 0; i < iters; i++) { const bs = Array.from({ length: pages.length }, () => pages[Math.floor(seededRand() * pages.length)]); const x = rate(bs, a), y = rate(bs, b); if (x != null && y != null) out.push(y - x); }
  out.sort((x, y) => x - y);
  const ra = rate(pages, a), rb = rate(pages, b);
  return { a: ra, b: rb, delta: ra != null && rb != null ? rb - ra : null, ci: out.length > 1 ? [out[Math.floor(out.length * 0.025)], out[Math.floor(out.length * 0.975)]] : null };
}
/** Preregistered test: CI against v13-a excludes 0 AND the point estimate exceeds the floor. */
export function verdict(eff, floor) {
  if (!eff?.ci || eff.delta == null) return 'n/a';
  const F = floor?.ci ? Math.max(Math.abs(floor.ci[0]), Math.abs(floor.ci[1])) : 0;
  const excl = (eff.ci[0] > 0 && eff.ci[1] > 0) || (eff.ci[0] < 0 && eff.ci[1] < 0);
  return excl && Math.abs(eff.delta) > F ? (eff.delta > 0 ? 'higher' : 'lower') : 'not established';
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.argv.includes('--pack')) {
    const rows = [];
    for (const arm of ARMS) for (const f of fs.readdirSync(path.join(DIR, 'work', arm)).filter((x) => x.endsWith('.json') && !x.includes('failed')).sort()) rows.push(JSON.parse(fs.readFileSync(path.join(DIR, 'work', arm, f), 'utf8')));
    writeJsonl(path.join(DIR, 'arms.jsonl'), rows);
    console.log(`packed ${rows.length} rows -> arms.jsonl; cost $${rows.reduce((s, r) => s + r.cost_usd, 0).toFixed(4)}`);
    process.exit(0);
  }
  const sample = new Map(readJsonl(path.join(DIR, 'sample.jsonl')).map((r) => [`${r.book_id}_${r.page_number}`, r]));
  const pages = new Map();
  for (const r of readJsonl(path.join(DIR, 'arms.jsonl'))) {
    const s = sample.get(r.id);
    if (!pages.has(r.id)) pages.set(r.id, { id: r.id, lang: s.lang, set: s.set, model: r.model });
    pages.get(r.id)[r.arm] = { ...pageScore(r.text, s.source_text, r.finishReason), finish: r.finishReason };
  }
  const all = [...pages.values()].filter((p) => ARMS.every((a) => p[a]));
  const main = all.filter((p) => p.set === 'main');
  const sum = (ps, arm, k) => ps.reduce((s, p) => s + (p[arm][k] || 0), 0);
  const METRICS = ['notes', 'n_original', 'n_clarification', 'n_context', 'n_alternative', 'n_image', 'n_untyped', 'alt_any', 'clutter', 'attr_notes', 'orig_verified', 'invented_tags', 'emdashes', 'note_chars'];
  const out = { generated: new Date().toISOString(), n_main: main.length, n_all: all.length, arms: {}, paired_vs_v13a: {}, per_page: all };
  for (const arm of ARMS) {
    const nl = main.filter((p) => !p[arm].looped && !p['v13-a'].looped);
    const ratios = nl.map((p) => p[arm].body_chars / Math.max(1, p['v13-a'].body_chars)).sort((x, y) => x - y);
    out.arms[arm] = {
      per_page: Object.fromEntries(METRICS.map((k) => [k, sum(main, arm, k) / main.length])),
      typed_share: sum(main, arm, 'notes') ? sum(main, arm, 'typed') / sum(main, arm, 'notes') : null,
      verified_rate: sum(main, arm, 'orig_checkable') ? sum(main, arm, 'orig_verified') / sum(main, arm, 'orig_checkable') : null,
      orig: { emitted: sum(main, arm, 'orig_emitted'), checkable: sum(main, arm, 'orig_checkable'), verified: sum(main, arm, 'orig_verified'), absent: sum(main, arm, 'orig_absent'), script_uncheckable: sum(main, arm, 'orig_script') },
      pages_with_alternative: main.filter((p) => p[arm].n_alternative > 0).length, pages_with_any_alt: main.filter((p) => p[arm].alt_any > 0).length,
      pages_with_notes: main.filter((p) => p[arm].notes > 0).length,
      looped: main.filter((p) => p[arm].looped).length, body_ratio_median_vs_v13a: ratios[Math.floor(ratios.length / 2)],
      invented_names: [...new Set(main.flatMap((p) => p[arm].invented_names))],
    };
  }
  for (const arm of ARMS.slice(1)) {
    out.paired_vs_v13a[arm] = Object.fromEntries(METRICS.map((k) => [k, pairedCI(main, (x) => x[k], 'v13-a', arm)]));
    out.paired_vs_v13a[arm].verified_rate = ratioCI(main, (x) => x.orig_verified, (x) => x.orig_checkable, 'v13-a', arm);
  }
  out.verdicts = {};
  for (const arm of ['v17-study', 'v17-reading']) out.verdicts[arm] = Object.fromEntries([...METRICS, 'verified_rate'].map((k) => [k, verdict(out.paired_vs_v13a[arm][k], out.paired_vs_v13a['v13-b'][k])]));
  fs.writeFileSync(path.join(DIR, 'mechanical.json'), JSON.stringify(out, null, 1));
  const f2 = (x) => (x == null ? '—' : x.toFixed(2));
  console.log(`main n=${main.length}\n${'metric/page'.padEnd(16)}${ARMS.map((a) => a.padStart(12)).join('')}   study vs v13-a [CI] (verdict) | reading | floor v13-b`);
  for (const k of METRICS) {
    const e = (arm) => { const x = out.paired_vs_v13a[arm][k]; return `${f2(x.delta)} [${f2(x.ci?.[0])},${f2(x.ci?.[1])}]`; };
    console.log(`${k.padEnd(16)}${ARMS.map((a) => f2(out.arms[a].per_page[k]).padStart(12)).join('')}   ${e('v17-study')} (${out.verdicts['v17-study'][k]}) | ${e('v17-reading')} (${out.verdicts['v17-reading'][k]}) | ${e('v13-b')}`);
  }
  for (const arm of ARMS) { const a = out.arms[arm]; console.log(`${arm.padEnd(12)} typed ${f2(a.typed_share)}  verified ${a.orig.verified}/${a.orig.checkable} = ${f2(a.verified_rate)} (absent ${a.orig.absent}, uncheckable ${a.orig.script_uncheckable})  alt pages ${a.pages_with_alternative} (any-alt ${a.pages_with_any_alt})  looped ${a.looped}  body ratio ${f2(a.body_ratio_median_vs_v13a)}  invented ${a.invented_names.join(',') || '-'}`); }
  for (const arm of ARMS.slice(1)) { const v = out.paired_vs_v13a[arm].verified_rate; console.log(`verified-rate Δ ${arm}: ${f2(v.delta)} [${f2(v.ci?.[0])},${f2(v.ci?.[1])}]`); }
}
