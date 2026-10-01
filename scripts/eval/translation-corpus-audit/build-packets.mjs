#!/usr/bin/env node
// PRIOR ART: scripts/eval/tibetan-mt-ab/ (one JSONL packet per judge dispatch); scripts/eval/translation-batch-shadow-judge.mjs
// --packet (pairwise packets with seeded left/right). This is the single-candidate packet builder for draw.mjs output:
// seeded shuffle so controls and languages are spread across packets, fixed chunk size, no provenance in the packet.
//
//   node scripts/eval/translation-corpus-audit/build-packets.mjs --dir scripts/eval/results/translation-corpus-audit-2026-09-30 [--size 15] [--seed 7]
// Writes <dir>/packets/packet-NN.jsonl and <dir>/packets/index.json (packet → item ids).

import fs from 'node:fs';
import path from 'node:path';
import { resetSeed, seededRand } from '../lib/paired-stats.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const DIR = args.dir, SIZE = Number(args.size || 15), SEED = Number(args.seed || 7);
if (!DIR) { console.error('--dir required'); process.exit(1); }

const items = fs.readFileSync(path.join(DIR, 'items.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const manifest = Object.fromEntries(fs.readFileSync(path.join(DIR, 'manifest.jsonl'), 'utf8').trim().split('\n').map((l) => { const m = JSON.parse(l); return [m.id, m]; }));

resetSeed(SEED);
for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
// keep a repeat and its original out of the same packet
const packets = [];
for (const it of items) {
  const orig = manifest[it.id].repeat_of;
  let placed = false;
  for (const p of packets) {
    if (p.length >= SIZE) continue;
    if (orig && p.some((x) => x.id === orig)) continue;
    if (p.some((x) => manifest[x.id].repeat_of === it.id)) continue;
    p.push(it); placed = true; break;
  }
  if (!placed) packets.push([it]);
}
const pdir = path.join(DIR, 'packets');
fs.mkdirSync(pdir, { recursive: true });
const index = {};
packets.forEach((p, i) => {
  const name = `packet-${String(i + 1).padStart(2, '0')}.jsonl`;
  fs.writeFileSync(path.join(pdir, name), p.map((x) => JSON.stringify(x)).join('\n') + '\n');
  index[name] = p.map((x) => x.id);
});
fs.writeFileSync(path.join(pdir, 'index.json'), JSON.stringify({ seed: SEED, size: SIZE, packets: index }, null, 2));
const chars = items.reduce((s, x) => s + x.source.length + x.translation.length, 0);
console.error(`${packets.length} packets of ≤${SIZE} from ${items.length} items (${(chars / 1e6).toFixed(2)} M chars) → ${pdir}`);
