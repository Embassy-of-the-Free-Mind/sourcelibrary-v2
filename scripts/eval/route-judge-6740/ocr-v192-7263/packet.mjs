#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs `packet` (its files are what this writes; its stage is wired to named
// cells with stored drafts, so it cannot take two prompts' reads off disk).
// packet.mjs <reads-dir> <analysis.json> <set-S.json> <set-O.json> <image-dir> <out-dir>: the blind packet for the v19.2 test (#7263).
// Judged: v19.1 and v19.2 on (1) O pages over the posted bar, (2) O pages whose v19.2 read is over 1.5x their own noise and
// at least 0.05 away, (3) O pages where v19.2 is under 75% of the shorter v19.1 read, (4) S pages whose v19.2 read holds
// under 0.8x or over 1.5x v19.1's Han characters. Plus a wrong-page control per arm and five repeats.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [READS, ANALYSIS, SETS, SETO, IMG, OUT] = process.argv.slice(2);
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);
const read = (dir, id) => fs.readFileSync(path.join(READS, dir, `${id}.txt`), 'utf8');
const han = (t) => (t.replace(/<note>[\s\S]*?<\/note>/g, '').match(/\p{Script=Han}/gu) || []).length;
const an = load(ANALYSIS), setS = load(SETS), setO = load(SETO);
const lang = new Map(setO.map((p) => [p.page_id, p.lang]));
const O = an.O.pages.filter((r) => {
  const m = Math.min(r.ac, r.bc), [a, b, c] = r.len;
  return r.beyond || (m > 1.5 * r.ab && m >= 0.05) || c < 0.75 * Math.min(a, b);
}).map((r) => ({ cell: 'O', page_id: r.page_id, book_id: r.book_id, page_number: r.n, a: read('O-v191a', r.page_id), c: read('O-v192', r.page_id), why: r.beyond ? 'over the posted bar' : 'over its own noise or short', lang: r.lang }));
const S = setS.filter((p) => { const x = han(read('S-v192', p.page_id)) / han(read('S-v191', p.page_id)); return x < 0.8 || x > 1.5; })
  .map((p) => ({ cell: 'S', page_id: p.page_id, book_id: p.book_id, page_number: p.n, a: read('S-v191', p.page_id), c: read('S-v192', p.page_id), why: 'Han count moved', lang: 'Chinese' }));
const pages = [...O, ...S];
const items = [], key = [];
const add = (route, kind, p, text, extra = {}, salt = '') => {
  const id = `j${h(`${kind}:${route}:${p.page_id}:${salt}`)}`;
  items.push({ id, task: 'ocr', lang: p.lang, image_file: path.join(IMG, `${p.page_id}.jpg`), text });
  key.push({ id: `k${h(id)}`, judged_as: id, cell: 'v192', route, kind, page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, set: p.cell, why: p.why, ...extra });
};
for (const p of pages) { add('v19.1', 'item', p, p.a); add('v19.2', 'item', p, p.c); }
const q = O.find((x) => x.lang === 'Latin') ?? O[0], w = O.find((x) => x.lang === q.lang && x !== q) ?? S[0];
add('v19.1', 'wrong_page', q, w.a, { other: w.page_id }); add('v19.2', 'wrong_page', q, w.c, { other: w.page_id });
pages.slice(0, 5).forEach((p, i) => { const route = i % 2 ? 'v19.2' : 'v19.1'; add(route, 'repeat', p, i % 2 ? p.c : p.a, {}, 'r'); });
const order = items.map((it) => [h(`order:${it.id}`), it]).sort((x, y) => x[0].localeCompare(y[0])).map(([, it]) => it);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'packet.json'), JSON.stringify({ items: order }, null, 1));
fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 1));
console.log(`${pages.length} pages (O ${O.length}, S ${S.length}), ${items.length} judge calls`);
for (const p of pages) console.log(p.cell, p.lang, p.page_id, p.why);
