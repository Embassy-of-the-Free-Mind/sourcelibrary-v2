#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-ref/build-packet-stored.py (PR #5806) packs blinded A/B pairs for
// reference-based judges. #5829 packs single translations for reference-free reviewers, with three
// control kinds mixed in blind, and two independent reviewer partitions; the shape differs throughout.
/**
 * build-packet.mjs — $0, no DB. Step 2b of #5829: mix the 150 sample pages and 60 controls, shuffle
 * (seed 5829), give opaque ids, render every English the same way, and cut two independent reviewer
 * partitions (A, B) of 10 items each.
 *
 *   node scripts/eval/tengyur-characterize/build-packet.mjs
 *
 * Writes <work>/items.jsonl (what reviewers see), <work>/batches/{A,B}-NN.jsonl, and
 * <out>/key.json (id → item type, page, plant / #5797 verdict). The key never goes to a reviewer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { rng as mkRng, shuffle, renderEnglish } from './common.mjs';

const out = 'scripts/eval/results/tengyur-characterize-5829';
const work = '/root/tchar';
const read = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sample = read(path.join(work, 'sample-pages.jsonl')).map((x) => ({ ...x, ctype: 'SAMPLE' }));
const controls = read(path.join(work, 'controls.jsonl'));
const all = [...sample, ...controls];
if (new Set(all.map((x) => x.page_id)).size !== all.length) throw new Error('a page appears twice');

const R = mkRng(5829);
const mixed = shuffle(all, R);
const ids = new Set();
const opaque = () => { for (;;) { const id = 'P' + Math.floor(R() * 36 ** 4).toString(36).toUpperCase().padStart(4, '0'); if (!ids.has(id)) { ids.add(id); return id; } } };
const sampleMeta = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(out, 'sample.json'), 'utf8')).pages.map((p) => [p.page_id, p]));

const items = [], key = {};
for (const x of mixed) {
  const id = opaque();
  const toh = x.text_toh || (x.toh ? 'D' + x.toh.replace(/^toh/, '').toUpperCase() : null);
  items.push({
    id,
    where: `Derge Tengyur vol. ${x.vol} (${x.section}), folio ${x.folio || '?'}${toh ? `, in text ${toh}` : ''}`,
    tibetan: x.bo, previous_side_last_line: x.prev_last || '', next_side_first_line: x.next_first || '',
    english: renderEnglish(x.en),
  });
  key[id] = {
    type: x.ctype, page_id: x.page_id, book_id: x.book_id, vol: x.vol, section: x.section, page_number: x.page_number, folio: x.folio,
    ...(x.ctype === 'SAMPLE' ? { text_toh: x.text_toh, opens_text: sampleMeta[x.page_id].opens_text, colophon: sampleMeta[x.page_id].colophon, verse_share: sampleMeta[x.page_id].verse_share } : {}),
    ...(x.ctype === 'PLANT' ? { plant_kind: x.plant_kind, plant: x.plant } : {}),
    ...(x.ctype === 'HUMAN' ? { toh: x.toh } : {}),
    ...(x.ctype === 'J5797' ? { toh: x.toh, j5797: x.j5797 } : {}),
  };
}
fs.writeFileSync(path.join(work, 'items.jsonl'), items.map((x) => JSON.stringify(x)).join('\n') + '\n');
fs.writeFileSync(path.join(out, 'key.json'), JSON.stringify(key, null, 1));
fs.mkdirSync(path.join(work, 'batches'), { recursive: true });
for (const [rev, seed] of [['A', 5829 * 11], ['B', 5829 * 13]]) {
  const order = shuffle(items, mkRng(seed));
  for (let b = 0; b * 10 < order.length; b++) {
    fs.writeFileSync(path.join(work, 'batches', `${rev}-${String(b + 1).padStart(2, '0')}.jsonl`), order.slice(b * 10, b * 10 + 10).map((x) => JSON.stringify(x)).join('\n') + '\n');
  }
}
const t = Object.values(key).reduce((m, k) => ((m[k.type] = (m[k.type] || 0) + 1), m), {});
console.log(`${items.length} items`, t, `batches: ${Math.ceil(items.length / 10)} per reviewer`);
