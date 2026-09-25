// PRIOR ART: scripts/eval/benchmark-dashboard-data.mjs — counts referenced pages per cell from results files; this census counts LIVE pages per catalogue stratum against references, for eval-design.md §11 (2026-09-25 snapshot, not a tool).
// Referenced pages (any engine has a numeric cer) across results/benchmark/*.json, by language x period x origin.
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
function period(y) {
  if (y == null) return 'unknown';
  if (y < 1500) return 'pre-1500';
  if (y < 1600) return '1500s';
  if (y < 1700) return '1600s';
  if (y < 1800) return '1700s';
  if (y < 1900) return '1800s';
  return '1900+';
}
const cells = new Map();
const seen = new Set();
const files = [];
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { console.log('PARSE FAIL', f, e.message.slice(0, 60)); continue; }
  const pages = j.pages || j.results || [];
  let ref = 0, run = 0;
  for (const p of pages) {
    run++;
    const hasRef = Object.values(p.engines || {}).some(e => e && typeof e.cer === 'number');
    if (!hasRef) continue;
    ref++;
    const key = p.slug || `${p.book_id}:${p.page_number}`;
    if (seen.has(key)) continue; seen.add(key);
    const k = [p.language || '?', period(p.year ?? null), p.book_id ? 'sl-book' : 'external', p.tier || '?', String(p.non_canonical ?? 'unset')].join('\t');
    cells.set(k, (cells.get(k) || 0) + 1);
  }
  files.push(`${f}\trun=${run}\treferenced=${ref}`);
}
console.log(files.join('\n'));
console.log('\nlanguage\tperiod\torigin\ttier\tnon_canonical\tpages');
for (const [k, v] of [...cells].sort()) console.log(k + '\t' + v);
