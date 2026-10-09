#!/usr/bin/env node
/**
 * Compare two runs of lanes.harness.ts (#5517): per query, what each keyword
 * lane found before and after, against what the word's other forms find.
 *
 * PRIOR ART: scripts/eval/search-recall/run.mjs --compare — recall@k against
 * expected.json for /api/search; these files have no expected set, they hold
 * lane counts for a word and its sibling forms.
 *
 *   node scripts/eval/search-word-forms/compare.mjs before.json after.json [--md]
 *
 * Columns: book = catalogue book lane (ids, limit 1000); sibling = the largest
 * count any other form of the word gets in that lane (after file); lost = ids
 * the before run had and the after run does not (a lane capped at 1000 is an
 * unordered sample, so some "lost" there is the sample); coll = collections on
 * /api/search/unified; rows = book rows + passage rows on /api/search.
 * "share" = book count / sibling count, capped at 1, averaged over queries
 * that have siblings. It is a count ratio, not a relevance judgement.
 */
import { readFileSync } from 'node:fs';

const [beforeFile, afterFile] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const md = process.argv.includes('--md');
const before = JSON.parse(readFileSync(beforeFile, 'utf8'));
const after = JSON.parse(readFileSync(afterFile, 'utf8'));
const n = v => (Array.isArray(v) ? v.length : null);
const show = v => (v === null || v === undefined ? 'ERR' : String(v));

const rows = [];
const shares = { before: [], after: [] };
for (const [id, a] of Object.entries(after)) {
  const b = before[id];
  if (!b) continue;
  const sibling = Math.max(0, ...Object.values(a.family).map(f => n(f.book) ?? 0));
  const afterIds = new Set(Array.isArray(a.book) ? a.book : []);
  const lost = Array.isArray(b.book) && Array.isArray(a.book) ? b.book.filter(x => !afterIds.has(x)).length : null;
  if (sibling > 0 && n(b.book) !== null && n(a.book) !== null) {
    shares.before.push(Math.min(1, n(b.book) / sibling));
    shares.after.push(Math.min(1, n(a.book) / sibling));
  }
  rows.push([
    a.query, a.kind, show(n(b.book)), show(n(a.book)), sibling || '', show(lost),
    `${b.unified?.collections?.length ?? 'ERR'} → ${a.unified?.collections?.length ?? 'ERR'}`,
    `${b.search ? `${b.search.books.length}+${b.search.passages.length}` : 'ERR'} → ${a.search ? `${a.search.books.length}+${a.search.passages.length}` : 'ERR'}`,
    `${show(b.page?.pages)} → ${show(a.page?.pages)}`,
  ]);
}
const head = ['query', 'kind', 'book before', 'book after', 'sibling', 'lost', 'coll', '/api/search rows', 'pages matched'];
if (md) {
  console.log(`| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|`);
  for (const r of rows) console.log(`| ${r.join(' | ')} |`);
} else {
  for (const r of [head, ...rows]) console.log(r.map((c, i) => String(c).padEnd([20, 10, 12, 11, 8, 5, 8, 18, 18][i])).join(''));
}
const mean = xs => (xs.length ? (xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(2) : 'n/a');
console.log(`\nshare of the sibling form's books (${shares.after.length} queries with siblings): before ${mean(shares.before)}, after ${mean(shares.after)}`);
