// Turn <work>/hits.json into the page's browsable list, <out>/passages.json (#7073).
// Usage: node scripts/eval/figure-reception/build-list.mjs <figure>
//
// PRIOR ART: ~/sl-work/figure-reception/py-build.cjs — the Pythagoras one-off this generalises, unchanged in logic.
//
// Public books only (visible, pages_count > 0). Index/contents/errata/title pages dropped, editions grouped by
// work_id; a work is dated by when it was written (writtenYear: an old text in a later edition gets its author's
// death year, flagged wb so the card reads "by 474"); the edition shown is the one with a reported saying and the
// most pages. Row shape is documented in src/components/articles/figure-reception/FigureIndex.tsx.
import fs from 'node:fs';
import path from 'node:path';
import { workDir, outDir, writtenYear } from './lib.mjs';

const KEY = process.argv[2];
const d = JSON.parse(fs.readFileSync(path.join(workDir(KEY), 'hits.json'), 'utf8'));
const SKIP = new Set(['index', 'toc', 'errata', 'title-page', 'blank', 'digitizer-notice', 'digitizer-insert', 'colophon']);
const clean = (s) => s.replace(/<\/?[a-z][a-z-]*[^>]*>/gi, ' ').replace(/\^[^^\s]{1,6}\^/g, '').replace(/\[\d{1,3}\]/g, '').replace(/\s+/g, ' ').replace(/^[\s,;:.)\]—–-]+/, '').trim();
const trim = (s0) => { const s = clean(s0); return s.length > 300 ? s.slice(0, 297).replace(/\s\S*$/, '') + '…' : s; };

const books = d.filter((b) => b.v && b.pc > 0).map((b) => {
  const ps = b.passages.filter((p) => !SKIP.has(p.type) && clean(p.s).length > 25);
  ps.sort((x, y) => (y.q - x.q) || (y.n - x.n) || (x.p - y.p));
  return { ...b, ps };
}).filter((b) => b.ps.length);

const works = new Map();
for (const b of books) { const k = b.w || b.id; (works.get(k) ?? works.set(k, []).get(k)).push(b); }
const out = [];
for (const eds of works.values()) {
  eds.sort((a, b) => (b.ps.some((p) => p.q) - a.ps.some((p) => p.q)) || (b.ps.length - a.ps.length));
  const main = eds[0];
  const years = eds.map((e) => writtenYear(e.id, e.y)).filter((y) => y != null);
  const y = years.length ? Math.min(...years) : null;
  out.push({
    y, ...(y != null && !eds.some((e) => e.y === y) ? { wb: 1 } : {}), t: main.t, a: (main.a || '').trim(), l: main.lang, id: main.id,
    np: main.ps.length, q: main.ps.filter((p) => p.q).length, yr: main.y, pub: main.pub,
    P: main.ps.slice(0, 10).map((p) => [p.p, trim(p.s), p.q ? 1 : 0]),
    E: eds.slice(1).map((e) => [e.id, e.y, e.lang, e.t === main.t ? '' : e.t, e.ps.length, e.ps[0].p, trim(e.ps[0].s)]),
  });
}
out.sort((a, b) => (a.y == null) - (b.y == null) || a.y - b.y || b.np - a.np);
const file = path.join(outDir(KEY), 'passages.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(KEY, 'works', out.length, 'books', books.length, 'with a reported saying', out.filter((w) => w.q).length, 'bytes', fs.statSync(file).size);
