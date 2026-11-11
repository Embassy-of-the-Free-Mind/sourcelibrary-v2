#!/usr/bin/env node
// PRIOR ART: scripts/lib/longs-orthography.mjs `applyLongS` (imported: it decides which f is a misread long s, with the
// #5924 by-eye gates) and analyze.mjs in this directory (the same text distance, but over sets S and O, with no long-s
// measure; it runs on import, so its distance is repeated here).
// longs.mjs <reads-dir> <set.json> <model.json.gz> <out.json>: the model-free half of the v19.2 Latin print test (#7263),
// by the rule posted before any read: https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/7263#issuecomment-6710851197
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Model, applyLongS, bodyOnly } from '../../../lib/longs-orthography.mjs';

const [READS, SET, MODEL, OUT] = process.argv.slice(2);
const model = new Model(JSON.parse(zlib.gunzipSync(fs.readFileSync(MODEL)).toString()));
const read = (arm, id) => fs.readFileSync(path.join(READS, arm, `${id}.txt`), 'utf8');
const stripType = (t) => t.replace(/<page-type>[^<]*<\/page-type>\s*/, '').trim();
function lev(a, b) {
  const A = [...a], B = [...b]; let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[B.length];
}
const dist = (x, y) => { const a = stripType(x), b = stripType(y), n = Math.max([...a].length, [...b].length); return n ? lev(a, b) / n : 0; };
const median = (xs) => { const s = [...xs].sort((u, v) => u - v), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r3 = (x) => +x.toFixed(3);

function measure(text) {
  const body = bodyOnly(text);
  const longS = (body.match(/ſ/g) || []).length, f = (body.match(/[fF]/g) || []).length;
  const F = applyLongS(text, model).kept;
  const S = (body.match(/s(?=\p{L})/gu) || []).length; // lower-case s that does not end a word
  return { longS, f, F, S, share: F + longS + S ? r3(F / (F + longS + S)) : 0, chars: stripType(text).length };
}

const pages = JSON.parse(fs.readFileSync(SET, 'utf8')).map((p) => {
  const [ta, tb, tc] = ['v191a', 'v191b', 'v192'].map((arm) => read(arm, p.page_id));
  const a = measure(ta), b = measure(tb), c = measure(tc);
  const ab = r3(dist(ta, tb)), ac = r3(dist(ta, tc)), bc = r3(dist(tb, tc));
  return {
    page_id: p.page_id, book_id: p.book_id, year: p.year, face: p.face, title: p.title, n: p.n, a, b, c, ab, ac, bc,
    longs_worse: c.F - Math.max(a.F, b.F) >= 5,
    placebo_a: a.F - Math.max(b.F, c.F) >= 5, placebo_b: b.F - Math.max(a.F, c.F) >= 5,
    beyond: Math.min(ac, bc) > ab,
  };
});
const out = {
  n: pages.length,
  median_share: { a: r3(median(pages.map((p) => p.a.share))), b: r3(median(pages.map((p) => p.b.share))), c: r3(median(pages.map((p) => p.c.share))) },
  median_max_share_ab: r3(median(pages.map((p) => Math.max(p.a.share, p.b.share)))),
  median_d: { ab: r3(median(pages.map((p) => p.ab))), ac: r3(median(pages.map((p) => p.ac))), bc: r3(median(pages.map((p) => p.bc))) },
  longs_worse: pages.filter((p) => p.longs_worse).map((p) => p.page_id),
  placebo: { a: pages.filter((p) => p.placebo_a).map((p) => p.page_id), b: pages.filter((p) => p.placebo_b).map((p) => p.page_id) },
  judge_queue: pages.filter((p) => p.beyond).sort((x, y) => Math.min(y.ac, y.bc) - Math.min(x.ac, x.bc)).map((p) => p.page_id),
  pages,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const { pages: _p, ...head } = out; console.log(JSON.stringify(head, null, 1));
const cell = (m) => `${m.longS}/${m.f}/${m.F}/${m.S}/${m.share}`;
console.log('page year face | a ſ/f/F/S/share | b | c | ab ac bc');
for (const p of pages) console.log(p.page_id.slice(-6), p.year, p.face.padEnd(13), cell(p.a).padEnd(22), cell(p.b).padEnd(22), cell(p.c).padEnd(22), p.ab, p.ac, p.bc, p.longs_worse ? 'LONGS-WORSE' : '', p.beyond ? 'BEYOND' : '');
