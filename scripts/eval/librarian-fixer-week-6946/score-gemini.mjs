// PRIOR ART: scripts/eval/librarian-fixer-6946/score.mjs (scores the replay against Opus labels, per run; this
// scores the dry-run sample against Gemini page labels, per stratum).
/**
 * Agreement between the citation fixer's decision and the Gemini cross-label (label-gemini.mjs), per stratum.
 *   keep  agrees when the linked page is "supported";
 *   move  agrees when the target is "supported" and the linked page is not;
 *   drop  agrees when the linked page is "not".
 * "partly" never agrees; it is counted apart so the table shows how much of the disagreement is a half-supported page.
 *
 * Usage: node scripts/eval/librarian-fixer-week-6946/score-gemini.mjs --sample=S.jsonl --labels=L.jsonl [--md]
 */
import fs from 'node:fs';

const arg = (n, d) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const read = f => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const sample = new Map(read(arg('sample')).map(r => [r.key, r]));
const labels = read(arg('labels'));
const norm = v => String(v ?? '').toLowerCase().trim();

const agree = (s, l) => s === 'keep' ? norm(l.A) === 'supported'
  : s === 'move' ? norm(l.B) === 'supported' && norm(l.A) !== 'supported'
    : norm(l.A) === 'not';

const by = {};
const dis = [];
for (const r of labels) {
  const s = r.stratum;
  const t = by[s] ??= { n: 0, agree: 0, unparsed: 0, A: {}, B: {} };
  if (!r.label) { t.unparsed++; continue; }
  t.n++;
  t.A[norm(r.label.A)] = (t.A[norm(r.label.A)] ?? 0) + 1;
  if (s === 'move') t.B[norm(r.label.B)] = (t.B[norm(r.label.B)] ?? 0) + 1;
  if (agree(s, r.label)) t.agree++;
  else dis.push({ key: r.key, s, item: sample.get(r.key), l: r.label });
}
const fmt = o => Object.entries(o).sort().map(([k, v]) => `${k} ${v}`).join(', ');
console.log(`| stratum | labelled | agree | linked page (A) | target page (B) | unparsed |\n|---|---:|---:|---|---|---:|`);
for (const s of ['keep', 'move', 'drop']) {
  const t = by[s]; if (!t) continue;
  console.log(`| ${s} | ${t.n} | **${t.agree} (${Math.round(100 * t.agree / Math.max(1, t.n))}%)** | ${fmt(t.A)} | ${s === 'move' ? fmt(t.B) : ''} | ${t.unparsed} |`);
}
console.log(`\nDisagreements (${dis.length}):\n`);
for (const d of dis) {
  const it = d.item ?? {};
  console.log(`- **${d.s}** \`${d.key}\` ${it.url?.replace('https://sourcelibrary.org', '')}${it.to ? ` → ${it.to}` : ''} (fixer: ${it.outcome}). Gemini: A=${d.l.A}${d.s === 'move' ? `, B=${d.l.B}` : ''}. Claim: ${d.l.claim}.${d.l.A_quote ? ` A: "${String(d.l.A_quote).slice(0, 200)}"` : ''}${d.l.B_quote ? ` B: "${String(d.l.B_quote).slice(0, 200)}"` : ''}`);
}
