#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/score.mjs (#5695) — decodes the blinded key and reports invention
// as a per-arm RATE by kind; it does not say where in the candidate a named invention sits (inside <note>/<gloss>, in
// [brackets], or bare in the running text), which is the whole of #5982's Q1. scripts/eval/translation-notes-free/
// score.mjs (#5919) counts tags and brackets mechanically but reads no verdicts. This joins the two: every stored
// `invention` entry, decoded to its arm, then located in that arm's text.
/** #5982 Q1 ($0): additions and inventions the #5919 / #5942 fidelity judges named, per arm, split by where the quoted words sit in the candidate. */
/**
 *   node scripts/eval/untagged-additions/q1-stored-verdicts.mjs
 * Reads the two stored verdict sets (no model call) and writes results/untagged-additions-2026-10/q1.json.
 * The #5942 set lives on PR #5958's branch until it merges: read from disk when present, else `git show <ref>:`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { INVENTION_KINDS, itemId } from '../translation-vs-reference/common.mjs';
import { pairedCI } from '../translation-prompt-v17/score.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;
const OUT = path.join(ROOT, 'scripts/eval/results/untagged-additions-2026-10/q1.json');
const SETS = [
  { name: '#5919 (28 Flash + 12 Lite pages)', dir: 'scripts/eval/results/translation-notes-free-2026-10', ref: 'origin/main' },
  { name: '#5942 phase 1 (40 Lite pages)', dir: 'scripts/eval/results/notes-layer-2026-10/lite', ref: process.env.Q1_LITE_REF || 'origin/job-notes-layer-5942' },
];
const ARMS = ['v13-a', 'v13-b', 'v13-plain'];
const APPARATUS = ['note', 'gloss', 'meta', 'summary', 'keywords', 'image-desc', 'warning'];

const read = (set, f) => {
  const p = path.join(ROOT, set.dir, f);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : execFileSync('git', ['show', `${set.ref}:${set.dir}/${f}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
};
const jsonl = (t) => t.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

/**
 * The candidate as the plain characters a judge quotes from, each with the container it sits in:
 * 'tagged' (inside a house apparatus tag), 'bracket' ([..] or (..) outside any apparatus tag), or 'bare'.
 */
export function layout(text) {
  const chars = [], where = [];
  const stack = []; let sq = 0, par = 0;
  const re = /<\/?([a-zA-Z][\w-]*)\b[^<>]*>|->|<-/g;
  let last = 0;
  const push = (s) => {
    for (const ch of s) {
      if (ch === '[') sq++; if (ch === '(') par++;
      chars.push(ch); where.push(stack.length ? `tagged:${stack[stack.length - 1]}` : (sq > 0 || par > 0) ? 'bracket' : 'bare');
      if (ch === ']') sq = Math.max(0, sq - 1); if (ch === ')') par = Math.max(0, par - 1);
      if (ch === '\n') { sq = 0; par = 0; }
    }
  };
  for (const m of String(text || '').matchAll(re)) {
    push(text.slice(last, m.index)); last = m.index + m[0].length;
    const tag = (m[1] || '').toLowerCase();
    if (!APPARATUS.includes(tag)) { push(' '); continue; }
    if (m[0].startsWith('</')) { const i = stack.lastIndexOf(tag); if (i >= 0) stack.splice(i, 1); } else if (!m[0].endsWith('/>')) stack.push(tag);
    push(' ');
  }
  push(String(text || '').slice(last));
  return { chars, where };
}
const fold = (ch) => ch.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
/** Squeeze to letters/digits with a position map, so a quote matches whatever the spacing and punctuation. */
function squeeze(chars) {
  const out = [], map = [];
  chars.forEach((ch, i) => { if (/[\p{L}\p{N}]/u.test(ch)) { out.push(fold(ch)); map.push(i); } });
  return { s: out.join(''), map };
}
/** Where the judge's quote sits in the candidate: 'tagged:<tag>' | 'bracket' | 'bare' | 'not-located'. */
export function locate(text, quote) {
  const { chars, where } = layout(text);
  const hay = squeeze(chars);
  const parts = String(quote || '').replace(/<\/?[a-zA-Z][^<>]*>/g, ' ').split(/\.\.\.|…/).map((p) => squeeze([...p]).s).filter((p) => p.length >= 4).sort((a, b) => b.length - a.length);
  // the judge's own quote can carry the container: "<gloss>maidenhair fern</gloss>", "[may tinge]"
  const own = /<(note|gloss|meta|summary|keywords|image-desc|warning)\b/i.exec(String(quote || ''));
  const ownBracket = /^\s*[[(].*[\])]\s*$/s.test(String(quote || ''));
  for (const needle of parts) {
    // every occurrence: a short quote ("[perfect]") can also sit bare elsewhere on the page; the most contained one wins
    const found = [];
    for (let at = hay.s.indexOf(needle); at >= 0 && found.length < 50; at = hay.s.indexOf(needle, at + 1)) {
      const span = where.slice(hay.map[at], hay.map[at + needle.length - 1] + 1);
      const tagged = span.find((w) => w.startsWith('tagged:'));
      // a quote that opens or closes a bracket is the bracketed gloss itself
      const before = chars.slice(Math.max(0, hay.map[at] - 2), hay.map[at]).join('');
      found.push(tagged || (span.some((w) => w === 'bracket') || /[[(]/.test(before) ? 'bracket' : 'bare'));
    }
    if (!found.length) continue;
    if (own) return found.find((f) => f.startsWith('tagged:')) || `tagged:${own[1].toLowerCase()}`;
    if (ownBracket) return found.find((f) => f === 'bracket') || 'bracket';
    return found.length === 1 ? found[0] : found.find((f) => f === 'bare') ? (found.every((f) => f === 'bare') ? 'bare' : found.find((f) => f !== 'bare')) : found[0];
  }
  return 'not-located';
}

const out = { generated: new Date().toISOString(), issue: 5982, measure: 'counts of `invention` entries written by two blind Opus judges (judged against a human reference); the container of each quote is an exact string location in the arm text', judge_reports: { field: 'invention', kinds: INVENTION_KINDS, note: 'the judge prompt asks for a list of {kind, quote ≤ 15 words} per candidate; it does not ask whether the quoted words are tagged, and it does not ask for an exhaustive list of every added sentence' }, sets: {} };

for (const set of SETS) {
  const key = JSON.parse(read(set, 'fidelity-key.json'));
  const recs = Object.fromEntries(jsonl(read(set, 'records.jsonl')).map((r) => [itemId(r), r]));
  const main = Object.keys(recs).filter((id) => recs[id].set === 'main');
  const entries = [];
  const pages = Object.fromEntries(main.map((id) => [id, { id, ...Object.fromEntries(ARMS.map((a) => [a, { all: 0, untagged: 0, bare: 0, bracket: 0, tagged: 0, commentary_untagged: 0 }])) }]));
  for (const j of key.judges) {
    for (const v of jsonl(read(set, `fidelity-verdicts-${j}.jsonl`))) {
      if (!pages[v.id]) continue;
      for (const [label, arm] of Object.entries(key.items[j][v.id] || {})) {
        if (!ARMS.includes(arm)) continue; // controls and the duplicate are not arms
        const text = recs[v.id].candidates.find((c) => c.arm === arm).text;
        for (const inv of v.scores?.[label]?.invention || []) {
          const kind = INVENTION_KINDS.includes(inv.kind) ? inv.kind : 'unknown';
          const loc = locate(text, inv.quote);
          const container = loc.startsWith('tagged') ? 'tagged' : loc;
          entries.push({ id: v.id, judge: j, arm, kind, quote: inv.quote, where: loc, model: recs[v.id].model_routed || null, lang: recs[v.id].lang });
          const p = pages[v.id][arm];
          p.all += 0.5; // mean of the two judges
          if (container === 'tagged') p.tagged += 0.5; else if (container !== 'not-located') { p.untagged += 0.5; p[container] += 0.5; if (kind === 'gloss' || kind === 'added_fact') p.commentary_untagged += 0.5; }
        }
      }
    }
  }
  const rows = Object.values(pages);
  const table = {};
  for (const arm of ARMS) {
    const es = entries.filter((e) => e.arm === arm);
    const cell = (f) => ({ entries: es.filter(f).length, pages_either_judge: new Set(es.filter(f).map((e) => e.id)).size, pages_both_judges: main.filter((id) => key.judges.every((j) => es.some((e) => e.id === id && e.judge === j && f(e)))).length });
    const untag = (e) => e.where === 'bare' || e.where === 'bracket';
    table[arm] = {
      all: cell(() => true),
      by_kind: Object.fromEntries(INVENTION_KINDS.map((k) => [k, cell((e) => e.kind === k)])),
      by_where: Object.fromEntries(['tagged', 'bracket', 'bare', 'not-located'].map((w) => [w, cell((e) => (w === 'tagged' ? e.where.startsWith('tagged') : e.where === w))])),
      untagged: cell(untag),
      untagged_commentary: cell((e) => untag(e) && (e.kind === 'gloss' || e.kind === 'added_fact')),
      untagged_commentary_bare: cell((e) => e.where === 'bare' && (e.kind === 'gloss' || e.kind === 'added_fact')),
      untagged_by_kind: Object.fromEntries(INVENTION_KINDS.map((k) => [k, { bracket: es.filter((e) => e.kind === k && e.where === 'bracket').length, bare: es.filter((e) => e.kind === k && e.where === 'bare').length }])),
    };
  }
  const paired = {};
  for (const m of ['all', 'untagged', 'commentary_untagged', 'bare', 'bracket']) paired[m] = { noise_floor_b_minus_a: pairedCI(rows, (x) => x[m], 'v13-a', 'v13-b'), plain_minus_a: pairedCI(rows, (x) => x[m], 'v13-a', 'v13-plain'), plain_minus_b: pairedCI(rows, (x) => x[m], 'v13-b', 'v13-plain') };
  out.sets[set.name] = { dir: set.dir, n_pages: main.length, judges: key.judges, table, paired_per_page_mean_of_judges: paired, entries };
  console.log(`\n${set.name}: ${main.length} pages, ${entries.length} invention entries (two judges)`);
  console.log(`${''.padEnd(34)}${ARMS.map((a) => a.padStart(16)).join('')}   (entries / pages either judge)`);
  const line = (label, f) => console.log(`${label.padEnd(34)}${ARMS.map((a) => { const c = f(table[a]); return `${c.entries} / ${c.pages_either_judge}`.padStart(16); }).join('')}`);
  line('all inventions named', (t) => t.all);
  for (const k of INVENTION_KINDS) line(`  kind ${k}`, (t) => t.by_kind[k]);
  for (const w of ['tagged', 'bracket', 'bare', 'not-located']) line(`  where ${w}`, (t) => t.by_where[w]);
  line('UNTAGGED (bracket + bare)', (t) => t.untagged);
  line('UNTAGGED gloss + added_fact', (t) => t.untagged_commentary);
  line('  of which bare (no bracket)', (t) => t.untagged_commentary_bare);
  const f2 = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(2));
  for (const [m, p] of Object.entries(paired)) console.log(`  per page ${m.padEnd(20)} plain − a ${f2(p.plain_minus_a.delta)} [${f2(p.plain_minus_a.ci?.[0])}, ${f2(p.plain_minus_a.ci?.[1])}]   floor b − a ${f2(p.noise_floor_b_minus_a.delta)} [${f2(p.noise_floor_b_minus_a.ci?.[0])}, ${f2(p.noise_floor_b_minus_a.ci?.[1])}]`);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`\nwrote ${path.relative(ROOT, OUT)}`);
