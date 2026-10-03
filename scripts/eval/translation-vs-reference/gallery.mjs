#!/usr/bin/env node
// PRIOR ART: none generates a reader-facing example gallery from judge verdicts — the #4742/#5606 experiment files
// quote examples by hand, and translation-corpus-audit/score.mjs emits tables only. Looked in scripts/eval/ (INDEX.md),
// scripts/eval/lib/report.mjs (blog/consistency/matrix reports, no side-by-side pages). This is #5695 step 3.
/** Example gallery for translation-vs-reference: 5 best / 5 median / 5 worst pages per arm as markdown — source, reference (≤ 15 words if private) and ours side by side, page link, defect class. */
/**
 *   node scripts/eval/translation-vs-reference/gallery.mjs --results <results.json> --input <records.jsonl> --out <gallery.md>
 *        [--arm served] [--per 5] [--words 60]
 * Ordering is by page fidelity (mean over judges); ties broken by id so the gallery is reproducible. Control pages are
 * included (their real arms are real pages); control candidates never are.
 */
import fs from 'node:fs';
import { readJsonl, itemId, pageUrl, firstWords, clipPrivate, PRIVATE_QUOTE_WORDS } from './common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const RES = opt('results'); const INPUT = opt('input'); const OUT = opt('out');
const PER = Number(opt('per', 5)); const W = Number(opt('words', 60)); const ONLY = opt('arm', null);
if (!RES || !INPUT || !OUT) { console.error('--results, --input, --out required'); process.exit(1); }

const res = JSON.parse(fs.readFileSync(RES, 'utf8'));
const recs = Object.fromEntries(readJsonl(INPUT).map((r) => [itemId(r), r]));
// notes, glosses and term echoes are the house apparatus, not the running English a reader compares
// Centring markers go FIRST: stripped after the tags, the `<` of `<-` opens a "tag" that eats body text (#5105).
const strip = (t) => String(t || '').replace(/->|<-/g, ' ').replace(/<(summary|keywords|meta|note|gloss|term)>[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const cell = (t) => t.replace(/\|/g, '\\|');

function defectClass(page, arm) {
  const counts = {};
  for (const v of Object.values(page.arms[arm].by_judge)) {
    if (!v) continue;
    for (const d of v.defects || []) counts[d.class || 'unclassed'] = (counts[d.class || 'unclassed'] || 0) + (d.severity === 'major' ? 2 : 1);
    if (v.reversal) counts.T8 = (counts.T8 || 0) + 2;
    for (const i of v.invention || []) if (i.kind === 'unreadable_fill' || i.kind === 'boundary') counts[`invention:${i.kind}`] = (counts[`invention:${i.kind}`] || 0) + 1;
    if (v.omission) counts.omission = (counts.omission || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return top.length ? top.slice(0, 2).join(', ') : 'none found';
}

function block(page, arm) {
  const r = recs[page.id];
  const ours = r.candidates.find((c) => c.arm === arm)?.text || '';
  const ref = r.reference_meta.private
    ? `${firstWords(clipPrivate(strip(r.reference_text), r.reference_text), PRIVATE_QUOTE_WORDS)} *(private reference: ≤ ${PRIVATE_QUOTE_WORDS} words)*`
    : firstWords(strip(r.reference_text.split('\n').filter((l) => !l.startsWith('[context]')).join(' ')), W);
  const judges = Object.entries(page.arms[arm].by_judge).map(([j, v]) => `${j} ${v?.fidelity ?? '–'}`).join(', ');
  const reason = Object.values(page.reasons).filter(Boolean).map((x) => (r.reference_meta.private ? clipPrivate(x, r.reference_text) : x))[0] || '';
  const rev = Object.values(page.arms[arm].by_judge).find((v) => v?.reversal)?.reversal;
  return [
    `#### ${r.reference_meta.title} — [p. ${r.page_number}](${pageUrl(r)}) · ${r.lang} · fidelity ${page.arms[arm].fidelity} (${judges}) · defect: ${defectClass(page, arm)}`,
    '',
    `| source (${r.lang}) | reference (${r.reference_meta.translator}${r.reference_meta.year ? `, ${r.reference_meta.year}` : ''}; ${r.reference_meta.style}) | ours (${arm}) |`,
    '|---|---|---|',
    `| ${cell(firstWords(strip(r.source_text), W))} | ${cell(ref)} | ${cell(firstWords(strip(ours), W))} |`,
    '',
    ...(rev ? [`Reversal: ours “${rev.candidate}” vs “${rev.source_or_reference}”.`, ''] : []),
    `Judge: ${reason}`,
    '',
  ].join('\n');
}

const lines = [`# Gallery — ${RES}`, '', `Pages ordered by fidelity against the reference (mean of ${res.judges.length} blind judges). Quotes are the first ${W} words of each text, not the aligned span; follow the page link for the whole page.`, ''];
const arms = ONLY ? [ONLY] : Object.keys(res.arms);
for (const arm of arms) {
  const pages = res.per_page.filter((p) => p.arms[arm]?.fidelity != null).sort((a, b) => b.arms[arm].fidelity - a.arms[arm].fidelity || a.id.localeCompare(b.id));
  const n = pages.length;
  const best = pages.slice(0, PER);
  const worst = pages.slice(Math.max(PER, n - PER)).reverse();
  const midStart = Math.max(best.length, Math.floor(n / 2 - PER / 2));
  const median = pages.slice(midStart, Math.min(midStart + PER, n - worst.length));
  lines.push(`## ${arm} (n=${n}, fidelity ${res.arms[arm].fidelity.mean} [${(res.arms[arm].fidelity.ci || []).join(', ')}])`, '');
  for (const [name, set] of [['Best', best], ['Median', median], ['Worst', worst]]) {
    lines.push(`### ${name} ${set.length}`, '');
    for (const p of set) lines.push(block(p, arm));
  }
}
fs.writeFileSync(OUT, lines.join('\n'));
console.log(`gallery: ${arms.length} arm(s) → ${OUT}`);
