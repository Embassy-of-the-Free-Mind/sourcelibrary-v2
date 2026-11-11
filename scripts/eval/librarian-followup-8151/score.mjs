/**
 * Librarian follow-up search replay (#8151) — score run.ts's output.
 *
 * PRIOR ART: scripts/eval/librarian-speed-6904/run.ts prints per-turn lines only;
 * its summary table was built by hand. This prints aggregates and no reader text.
 *
 * Usage: node scripts/eval/librarian-followup-8151/score.mjs <out.jsonl>
 */
import fs from 'node:fs';

const rows = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const pct = (xs, p) => {
  const s = xs.filter(x => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};
const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
// Tools that look something up. Saving to the notebook or declining is not a search.
const NOT_SEARCH = new Set(['no_search_needed', 'add_to_notebook', 'present_choices']);
const searches = r => r.toolCalls.filter(t => !NOT_SEARCH.has(t.name)).length;
const secs = ms => (ms == null ? '-' : `${(ms / 1000).toFixed(1)}s`);

function line(name, rs) {
  const ok = rs.filter(r => !r.error);
  const noTool = ok.filter(r => searches(r) === 0).length;
  console.log(
    `${name}: n=${ok.length} errors=${rs.length - ok.length} no-search=${noTool} (${((100 * noTool) / (ok.length || 1)).toFixed(1)}%)`
    + ` first p50=${secs(pct(ok.map(r => r.firstTextMs), 50))} done p50=${secs(pct(ok.map(r => r.doneMs), 50))} p90=${secs(pct(ok.map(r => r.doneMs), 90))}`
    + ` rounds=${mean(ok.map(r => r.rounds)).toFixed(2)} searches=${mean(ok.map(searches)).toFixed(2)} sources=${mean(ok.map(r => r.sourceCount)).toFixed(1)}`
    + ` prompt=${Math.round(mean(ok.map(r => r.usage?.promptTokens ?? 0)))} output=${Math.round(mean(ok.map(r => (r.usage?.outputTokens ?? 0) + (r.usage?.thinkingTokens ?? 0))))}`
    + ` $/turn=${mean(ok.map(r => r.cost)).toFixed(4)} $/turn@3-flash=${mean(ok.map(r => r.costAtProductionRate)).toFixed(4)}`,
  );
}

for (const label of ['research', 'other', null]) {
  for (const arm of ['A', 'B']) {
    line(`${label ?? 'all'} ${arm}`, rows.filter(r => r.arm === arm && (!label || r.label === label)));
  }
}

// Paired, on questions where both arms finished.
const byId = new Map();
for (const r of rows) if (!r.error) byId.set(`${r.id}:${r.arm}`, r);
const deltas = [];
for (const r of rows) {
  const other = r.arm === 'A' && byId.get(`${r.id}:B`);
  if (other && !r.error) deltas.push(other.doneMs - r.doneMs);
}
console.log(`paired done B−A: n=${deltas.length} median=${secs(pct(deltas, 50))}`);
console.log(`total spent: $${rows.reduce((a, r) => a + (r.cost ?? 0), 0).toFixed(3)}`);
