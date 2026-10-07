#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-characterize/build-packet.mjs (#5829): mix sample and controls, shuffle,
// opaque ids, render every English the same way (renderEnglish), two independent reviewer partitions of
// 10. Kept as is; the differences are that an item is one ARM's English of a page (so the key also
// records the arm), and that no batch holds the same page twice, so a reviewer never compares two arms.
/**
 * build-packet.mjs — $0, no DB. Blind review packet for #6121.
 *
 *   node scripts/eval/tengyur-levers/build-packet.mjs --round 1 --arms S,A,C,P
 *   node scripts/eval/tengyur-levers/build-packet.mjs --round 2 --arms S,PC     (only if PC is triggered)
 *
 * Writes /root/tlev/r<round>/items.jsonl, /root/tlev/r<round>/batches/{A,B}-NN.jsonl and
 * <out>/r<round>/key.json (id → arm, page, plant). The key never goes to a reviewer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { rng as mkRng, shuffle, renderEnglish } from '../tengyur-characterize/common.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const ROUND = Number(arg('round', 1));
const ARMS = arg('arms', 'S,A,C,P').split(',');
const out = path.join('scripts/eval/results/tengyur-levers-6121', `r${ROUND}`);
const work = path.join('/root/tlev', `r${ROUND}`);
fs.mkdirSync(path.join(work, 'batches'), { recursive: true }); fs.mkdirSync(out, { recursive: true });
const read = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sample = read('/root/tlev/sample-pages.jsonl');
const armText = Object.fromEntries(ARMS.filter((a) => a !== 'S').map((a) => [a, new Map(read(`/root/tlev/arms/${a}.jsonl`).map((x) => [x.page_id, x.text]))]));
const controls = read('/root/tlev/controls.jsonl');

const all = [];
for (const p of sample) {
  for (const a of ARMS) {
    const en = a === 'S' ? p.en : armText[a].get(p.page_id);
    if (!en) throw new Error(`arm ${a} has no English for ${p.page_id}`);
    all.push({ ...p, en, arm: a });
  }
}
for (const x of ROUND === 1 ? controls : controls.slice(0, 10)) all.push({ ...x, arm: 'PLANT' });

const R = mkRng(6121 + ROUND);
const mixed = shuffle(all, R);
const ids = new Set();
const opaque = () => { for (;;) { const id = 'Q' + Math.floor(R() * 36 ** 4).toString(36).toUpperCase().padStart(4, '0'); if (!ids.has(id)) { ids.add(id); return id; } } };
const items = [], key = {};
for (const x of mixed) {
  const id = opaque();
  items.push({
    id, page_id: x.page_id,
    where: `Derge Tengyur vol. ${x.vol} (${x.section}), folio ${x.folio || '?'}${x.text_toh ? `, in text ${x.text_toh}` : ''}`,
    tibetan: x.bo, previous_side_last_line: x.prev_last || '', next_side_first_line: x.next_first || '',
    english: renderEnglish(x.en),
  });
  key[id] = { arm: x.arm, page_id: x.page_id, book_id: x.book_id, vol: x.vol, section: x.section, page_number: x.page_number, folio: x.folio,
    ...(x.arm === 'PLANT' ? { plant_kind: x.plant_kind, plant: x.plant } : { text_toh: x.text_toh, verse_share: x.verse_share }) };
}
// Partitions: batches of ≤ 10, never the same page twice in one batch.
function partition(seed) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const order = shuffle(items, mkRng(seed + attempt));
    const nb = Math.ceil(order.length / 10);
    const batches = Array.from({ length: nb }, () => []);
    let ok = true;
    order.forEach((it, i) => {
      for (let j = 0; j < nb; j++) {
        const b = batches[(i + j) % nb];
        if (b.length < 10 && !b.some((y) => y.page_id === it.page_id)) { b.push(it); return; }
      }
      ok = false;
    });
    if (ok) return batches;
  }
  throw new Error('could not partition');
}
const strip = ({ page_id, ...rest }) => rest;
fs.writeFileSync(path.join(work, 'items.jsonl'), items.map((x) => JSON.stringify(strip(x))).join('\n') + '\n');
fs.writeFileSync(path.join(out, 'key.json'), JSON.stringify(key, null, 1));
for (const [rev, seed] of [['A', 6121 * 11 + ROUND], ['B', 6121 * 13 + ROUND]]) {
  partition(seed).forEach((b, i) => fs.writeFileSync(path.join(work, 'batches', `${rev}-${String(i + 1).padStart(2, '0')}.jsonl`), b.map((x) => JSON.stringify(strip(x))).join('\n') + '\n'));
}
const t = Object.values(key).reduce((m, k) => ((m[k.arm] = (m[k.arm] || 0) + 1), m), {});
console.log(`round ${ROUND}: ${items.length} items`, t, `batches: ${Math.ceil(items.length / 10)} per reviewer`);
