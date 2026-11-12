#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/error-zoo/zoo-stats.py — counts REVIEWED pages per language × half-century, but cannot say
 * what share of the LIBRARY each cell is, so an empty square reads the same whether the library has 3 books there or
 * 3,000. This counts live books (visible, pages_count > 0, the canonical filter) per language × half-century and joins
 * the reviewed counts from <dir>/zoo-stats.json. Read-only.
 *
 * Usage: node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/error-zoo/coverage.mjs <dir>
 * Writes <dir>/coverage.json and prints the largest unreviewed cells.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';

const dir = process.argv[2];
const stats = JSON.parse(fs.readFileSync(`${dir}/zoo-stats.json`, 'utf8'));
const BINS = [[0, 1450, 'before 1450'], [1450, 1500, '1450–99'], [1500, 1550, '1500–49'], [1550, 1600, '1550–99'], [1600, 1650, '1600–49'], [1650, 1700, '1650–99'], [1700, 1750, '1700–49'], [1750, 1800, '1750–99'], [1800, 1850, '1800–49'], [1850, 3000, '1850 on']];
const FOLD = { 'Ancient Greek': 'Greek', 'Classical Chinese': 'Chinese', 'Literary Chinese': 'Chinese', 'Middle French': 'French', 'Early Modern German': 'German', 'Middle High German': 'German' };
const langOf = (l) => { const s = String(l || '?').split(/[,;/(]| and /)[0].trim() || '?'; return FOLD[s] || s; };
const yearOf = (b) => { for (const v of [b.year, b.published, b.ai_metadata?.estimated_year]) { const m = String(v ?? '').match(/1[0-9]{3}|20[0-2][0-9]/); if (m) return +m[0]; } return null; };
const binOf = (y) => (y == null ? 'undated' : BINS.find(([a, b]) => y >= a && y < b)?.[2] ?? 'undated');

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const cur = c.db('bookstore').collection('books').find({ visible: true, pages_count: { $gt: 0 } }, { projection: { language: 1, year: 1, published: 1, 'ai_metadata.estimated_year': 1, pages_count: 1 } }).batchSize(1000);
const lib = {}; const libLang = {}; let total = 0;
for await (const b of cur) {
  const L = langOf(b.language), k = `${L}|${binOf(yearOf(b))}`;
  lib[k] = lib[k] || { books: 0, pages: 0 }; lib[k].books++; lib[k].pages += b.pages_count || 0;
  libLang[L] = (libLang[L] || 0) + 1; total++;
}
await c.close();

const rev = (h) => Object.fromEntries(h.cells.map((x) => [`${x.lang}|${x.bin}`, x.pages]));
const rAll = rev(stats.heat_all), rUni = rev(stats.heat_uniform);
const langs = Object.entries(libLang).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([l]) => l);
const cells = [];
for (const L of langs) for (const b of [...BINS.map((x) => x[2]), 'undated']) {
  const k = `${L}|${b}`; const l = lib[k]; if (!l) continue;
  cells.push({ lang: L, bin: b, books: l.books, pages: l.pages, reviewed_all: rAll[k] || 0, reviewed_uniform: rUni[k] || 0 });
}
fs.writeFileSync(`${dir}/coverage.json`, JSON.stringify({ total_books: total, langs, lib_by_lang: libLang, cells }));
console.log('live books', total);
console.log('\nper language: library books | reviewed pages (all stores) | uniform-audit pages | in the uniform heatmap?');
const uniLangs = new Set(stats.heat_uniform.langs), allLangs = new Set(stats.heat_all.langs);
for (const L of langs) {
  const a = cells.filter((x) => x.lang === L).reduce((s, x) => s + x.reviewed_all, 0), u = cells.filter((x) => x.lang === L).reduce((s, x) => s + x.reviewed_uniform, 0);
  console.log(`  ${L.padEnd(14)} ${String(libLang[L]).padStart(6)} | ${String(a).padStart(5)} | ${String(u).padStart(4)} | uniform ${uniLangs.has(L) ? 'yes' : 'no '} · all ${allLangs.has(L) ? 'yes' : 'no'}`);
}
const dated = cells.filter((x) => x.bin !== 'undated');
const unrev = dated.filter((x) => x.reviewed_all < 8).sort((a, b) => b.books - a.books);
const unBooks = unrev.reduce((s, x) => s + x.books, 0), datedBooks = dated.reduce((s, x) => s + x.books, 0);
console.log(`\ndated cells in top-20 languages: ${dated.length}; with < 8 reviewed pages in ANY store: ${unrev.length}, holding ${unBooks} of ${datedBooks} books (${Math.round(100 * unBooks / datedBooks)}%)`);
console.log('largest such cells:'); for (const x of unrev.slice(0, 15)) console.log(`  ${x.lang} ${x.bin}: ${x.books} books, ${x.reviewed_all} reviewed pages`);
const und = cells.filter((x) => x.bin === 'undated').reduce((s, x) => s + x.books, 0);
console.log(`undated books in top-20 languages: ${und}`);
