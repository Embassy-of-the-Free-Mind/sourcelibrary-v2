#!/usr/bin/env node
// PRIOR ART: none — looked in scripts/eval/paddle-correct-6561/batch/ (one box ran the whole table list) and
// scripts/workers/JOB-HOSTS.md (boxes, not work splits). This cuts prep.mjs's list into per-box shards.
//
// #6561 item 1: this box's share of the stale pages, by book (a book never spans two boxes, so run.mjs's per-book
// order holds). Stable: a book's box depends only on its id and the weights. Pages already corrected in the pilot
// (results/pilot-page-ids.txt: the pilot, the supplement and the held-out draw) are left out.
// Usage (cwd = scratch holding rest/pages.jsonl + prompt.json from prep.mjs):
//   node shard.mjs <box> [--weights=main:50,cloudlayer:30,l7a:20]   → <box>/pages.jsonl + <box>/prompt.json
import fs from 'node:fs';
import crypto from 'node:crypto';

const BOX = process.argv[2];
const W = (process.argv.find((a) => a.startsWith('--weights='))?.split('=')[1] || 'main:50,cloudlayer:30,l7a:20').split(',').map((x) => x.split(':')).map(([b, w]) => [b, Number(w)]);
if (!W.some(([b]) => b === BOX)) { console.error(`usage: shard.mjs <${W.map(([b]) => b).join('|')}> [--weights=…]`); process.exit(2); }
const total = W.reduce((a, [, w]) => a + w, 0);
const boxOf = (bid) => {
  const u = parseInt(crypto.createHash('sha256').update('6561-shard:' + bid).digest('hex').slice(0, 8), 16) / 0x100000000 * total;
  let acc = 0; for (const [b, w] of W) { acc += w; if (u < acc) return b; } return W.at(-1)[0];
};
const done = new Set(fs.readFileSync(new URL('./results/pilot-page-ids.txt', import.meta.url), 'utf8').split('\n').filter(Boolean));
const rows = fs.readFileSync('rest/pages.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const mine = rows.filter((r) => !done.has(r.pid) && boxOf(r.bid) === BOX);
fs.mkdirSync(BOX, { recursive: true });
fs.writeFileSync(`${BOX}/pages.jsonl`, mine.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.copyFileSync('prompt.json', `${BOX}/prompt.json`);
const per = {}; for (const r of rows) if (!done.has(r.pid)) { const b = boxOf(r.bid); per[b] = (per[b] || 0) + 1; }
console.log(`${BOX}: ${mine.length} pages in ${new Set(mine.map((r) => r.bid)).size} books; all shards ${JSON.stringify(per)}; pilot pages left out ${done.size}`);
