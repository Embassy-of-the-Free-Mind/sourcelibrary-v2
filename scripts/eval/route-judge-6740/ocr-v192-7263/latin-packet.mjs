#!/usr/bin/env node
// PRIOR ART: packet.mjs in this directory (the same files and blind ids, but it judges a and c on sets S and O up front).
// The posted Latin rule calls in stages: c first, and only a rejected c gets its repeat and the two v19.1 reads.
// latin-packet.mjs <reads-dir> <analysis.json> <set.json> <image-dir> <out-dir> <map-page-id>: writes packet.json and key.json
// with what is due now, keeping every id already there, up to 15 calls (#7263).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [READS, ANALYSIS, SET, IMG, OUT, MAP] = process.argv.slice(2);
const load = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);
const read = (arm, id) => fs.readFileSync(path.join(READS, arm, `${id}.txt`), 'utf8');
const an = load(ANALYSIS), set = new Map(load(SET).map((p) => [p.page_id, p]));
const packetFile = path.join(OUT, 'packet.json'), keyFile = path.join(OUT, 'key.json'), vFile = path.join(OUT, 'verdicts-opus.jsonl');
const items = load(packetFile, { items: [] }).items, key = load(keyFile, []);
const verdicts = new Map(fs.existsSync(vFile) ? fs.readFileSync(vFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r.verdict]) : []);
const seen = new Set(key.map((k) => `${k.kind}:${k.route}:${k.page_id}:${k.read}`));
const CAP = 15;
function add(route, read_, kind, pageId, text, why, extra = {}) {
  const tag = `${kind}:${route}:${pageId}:${read_}`;
  if (seen.has(tag) || items.length >= CAP) return false;
  seen.add(tag);
  const id = `j${h(tag)}`, p = set.get(pageId) ?? { book_id: 'map', n: null };
  items.push({ id, task: 'ocr', lang: pageId === MAP ? 'Chinese' : 'Latin', image_file: path.join(IMG, `${pageId}.jpg`), text });
  key.push({ id: `k${h(id)}`, judged_as: id, cell: 'v192-latin', route, read: read_, kind, page_id: pageId, book_id: p.book_id, page_number: p.n, set: 'L', why, ...extra });
  return true;
}
const queue = an.judge_queue;
const [q, w] = [queue[0], queue[1]];
add('v19.1', 'a', 'wrong_page', q, read('v191a', w), 'control', { other: w });
add('v19.2', 'c', 'wrong_page', q, read('v192', w), 'control', { other: w });
add('v19.2', 'map', 'diagnostic', MAP, read('map-v192', MAP), 'map page: reported, does not decide');
for (const id of queue) {
  add('v19.2', 'c', 'item', id, read('v192', id), 'beyond v19.1 noise');
  const first = key.find((k) => k.kind === 'item' && k.route === 'v19.2' && k.page_id === id);
  if (verdicts.get(first?.judged_as)?.accept === false) {
    add('v19.2', 'c2', 'repeat', id, read('v192', id), 'c rejected: the posted repeat');
    add('v19.1', 'a', 'item', id, read('v191a', id), 'c rejected');
    add('v19.1', 'b', 'item', id, read('v191b', id), 'c rejected');
  }
}
const order = items.map((it) => [h(`order:${it.id}`), it]).sort((x, y) => x[0].localeCompare(y[0])).map(([, it]) => it);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(packetFile, JSON.stringify({ items: order }, null, 1));
fs.writeFileSync(keyFile, JSON.stringify(key, null, 1));
console.log(`${items.length} of ${CAP} calls; ${items.filter((it) => !verdicts.has(it.id)).length} to judge`);
