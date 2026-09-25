// PRIOR ART: scripts/eval/benchmark-dashboard-data.mjs — counts referenced pages per cell from results files; this census counts LIVE pages per catalogue stratum against references, for eval-design.md §11 (2026-09-25 snapshot, not a tool).
// Strata census over the local mirror: live books (visible && pages_count>0) by language x period.
// Period is parsed from books.published (free text; first plausible 4-digit year) — CATALOGUE date, labelled as such.
import fs from 'node:fs';
import readline from 'node:readline';

const src = process.argv[2] || '/Users/dereklomas/sl-corpus/books.jsonl';
const out = process.argv[3] || './strata.json';

function year(s) {
  if (!s) return null;
  const m = String(s).match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  return m ? Number(m[1]) : null;
}
function period(y) {
  if (y == null) return 'unknown';
  if (y < 1500) return 'pre-1500';
  if (y < 1600) return '1500s';
  if (y < 1700) return '1600s';
  if (y < 1800) return '1700s';
  if (y < 1900) return '1800s';
  return '1900+';
}
function lang(s) {
  if (!s) return '(none)';
  return String(s).trim().replace(/\s+/g, ' ');
}

const strata = new Map(); // key lang||period -> {books,pages}
const langs = new Map();
let live = 0, livePages = 0, total = 0;
const rl = readline.createInterface({ input: fs.createReadStream(src) });
for await (const line of rl) {
  if (!line.trim()) continue;
  total++;
  let b; try { b = JSON.parse(line); } catch { continue; }
  if (!b.visible || !(b.pages_count > 0)) continue;
  live++; livePages += b.pages_count;
  const l = lang(b.language), p = period(year(b.published));
  const k = l + '||' + p;
  const s = strata.get(k) || { language: l, period: p, books: 0, pages: 0 };
  s.books++; s.pages += b.pages_count; strata.set(k, s);
  const L = langs.get(l) || { language: l, books: 0, pages: 0, unknownYearBooks: 0 };
  L.books++; L.pages += b.pages_count; if (p === 'unknown') L.unknownYearBooks++; langs.set(l, L);
}
const rows = [...strata.values()].sort((a, b) => b.pages - a.pages);
const langRows = [...langs.values()].sort((a, b) => b.pages - a.pages);
fs.writeFileSync(out, JSON.stringify({ source: src, total_books: total, live_books: live, live_pages: livePages, strata: rows, languages: langRows }, null, 2));
console.log(`books=${total} live=${live} livePages=${livePages} strata=${rows.length} strata>=20books=${rows.filter(r => r.books >= 20).length}`);
console.log('\nTop languages (live):');
for (const r of langRows.slice(0, 30)) console.log(`${r.language}\t${r.books}\t${r.pages}\tunknownYear=${r.unknownYearBooks}`);
