// PRIOR ART: none — looked in scripts/eval/INDEX.md and scripts/eval/lib/ (no tally for classify.mjs output); markdown count tables for #7065.
// Usage: node summarize.mjs <label> <cls.jsonl> [<label> <cls.jsonl> ...]
import fs from 'node:fs';
const args = process.argv.slice(2);
const ORDER = ['known-genuine', 'known-doubtful', 'known-spurious', 'testimonium', 'noise', 'unmatched'];
for (let i = 0; i < args.length; i += 2) {
  const rows = fs.readFileSync(args[i + 1], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  console.log(`\n### ${args[i]} — ${rows.length} passages in ${new Set(rows.map((r) => r.id)).size} books\n`);
  console.log('| class | passages | by original-language text | by rule on the English | books |\n|---|---:|---:|---:|---:|');
  for (const c of ORDER) {
    const rs = rows.filter((r) => r.cls === c);
    console.log(`| ${c} | ${rs.length} | ${rs.filter((r) => r.via === 'text').length} | ${rs.filter((r) => r.via !== 'text').length} | ${new Set(rs.map((r) => r.id)).size} |`);
  }
  const refs = {};
  for (const r of rows.filter((r) => r.cls !== 'noise')) { const k = `${r.cls} · ${String(r.ref).replace(/ \[.*\]$/, '')}`; refs[k] = (refs[k] || 0) + 1; }
  console.log('\nTop references:\n');
  for (const [k, n] of Object.entries(refs).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`- ${n} × ${k}`);
}
