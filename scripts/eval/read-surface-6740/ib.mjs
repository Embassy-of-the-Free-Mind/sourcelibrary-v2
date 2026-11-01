#!/usr/bin/env node
// #6740 read-surface, Amendment 6 third form: the incomplete-block allocation of the screen. Every book of the census
// panel is read under live (`LI`, 4 a call, image as served, low) and 3 of the 8 other cells of pages a call × thinking
// (`G01`–`G08`, design-ib.json). Books are taken in era order (then a seeded hash), and each takes the 3-subset that
// least raises the spread of the cells' book counts, then of the pair counts (a greedy near-balanced incomplete block
// design: every pair of cells shares about the same number of books), ties broken by a seeded hash.
//
// PRIOR ART: run.mjs (this directory: one run reads every panel target); scripts/eval/lib/sampling.mjs (one page per book,
//   no blocks). Nothing in the repo allocates incomplete blocks.
//
//   node scripts/eval/read-surface-6740/ib.mjs allocate --work=DIR --lang=de   -> DIR/ib-allocation-de.json (+ printed balance)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const WORK = path.resolve(arg('work', '.'));
const LANG = arg('lang');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const ERA = (p) => ({ '1400s': 0, '1500s': 1, '1600s': 2, '1700s': 3, '1800s': 4, '1900s': 5 }[p] ?? 6);

export function allocate(books, cells, k = 3, salt = 'ib-6740') {
  const n = cells.length, count = Array(n).fill(0), pair = Array.from({ length: n }, () => Array(n).fill(0));
  const subsets = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) subsets.push([a, b, c]);
  const out = {};
  for (const bk of books) {
    let best = null;
    for (const s of subsets) {
      const c2 = count.slice(); for (const i of s) c2[i]++;
      const p2 = pair.map((r) => r.slice()); for (const i of s) for (const j of s) if (i < j) p2[i][j]++;
      const pv = p2.flatMap((r, i) => r.filter((_, j) => j > i));
      const score = [Math.max(...c2) - Math.min(...c2), Math.max(...pv) - Math.min(...pv), pv.reduce((t, x) => t + x * x, 0), h(`${salt}${bk}${s.join()}`)];
      if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && (score[1] < best.score[1] || (score[1] === best.score[1] && (score[2] < best.score[2] || (score[2] === best.score[2] && score[3] < best.score[3])))))) best = { s, score };
    }
    for (const i of best.s) count[i]++;
    for (const i of best.s) for (const j of best.s) if (i < j) pair[i][j]++;
    out[bk] = best.s.map((i) => cells[i]);
  }
  const pv = pair.flatMap((r, i) => r.filter((_, j) => j > i));
  return { blocks: out, count: Object.fromEntries(cells.map((c, i) => [c, count[i]])), pair_min: Math.min(...pv), pair_max: Math.max(...pv) };
}

if (process.argv[2] === 'allocate') {
  const panel = JSON.parse(fs.readFileSync(path.join(WORK, 'panel.json'), 'utf8'));
  const design = JSON.parse(fs.readFileSync(path.join(HERE, 'design-ib.json'), 'utf8'));
  const T = panel.langs[LANG].targets;
  const order = [...T].sort((a, b) => ERA(a.period) - ERA(b.period) || h(`ib-6740${a.book_id}`).localeCompare(h(`ib-6740${b.book_id}`))).map((t) => t.book_id);
  const A = allocate(order, design.runs.map((r) => r.id));
  const res = { lang: LANG, built_at: new Date().toISOString(), rule: 'live (LI) on every book + 3 of G01–G08 a book; greedy near-balanced incomplete blocks, books in era order then sha256("ib-6740"+book_id)', books: T.length, live: 'LI', ...A,
    era_by_cell: Object.fromEntries(design.runs.map((r) => [r.id, T.filter((t) => A.blocks[t.book_id].includes(r.id)).reduce((m, t) => ({ ...m, [t.period]: (m[t.period] || 0) + 1 }), {})])) };
  fs.writeFileSync(path.join(WORK, `ib-allocation-${LANG}.json`), JSON.stringify(res, null, 1));
  console.log(`${LANG}: ${T.length} books; books a cell ${JSON.stringify(A.count)}; books a pair ${A.pair_min}–${A.pair_max}`);
  console.log(JSON.stringify(res.era_by_cell));
}
