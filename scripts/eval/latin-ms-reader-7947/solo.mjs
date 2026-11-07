#!/usr/bin/env node
// PRIOR ART: packets.mjs here (one book a packet, every arm side by side). This is its control: does judging the arms
// side by side move the verdicts? 10 books (seeded), the stored and the Opus entries each judged ALONE, one entry a packet,
// by a fresh reader, with the same brief. Added after the first 9 side-by-side packets, before any second-reader call.
/**
 *   node scripts/eval/latin-ms-reader-7947/solo.mjs --scratch <job dir> [--books 10] [--arms stored,opus]
 * Writes <scratch>/judge/ms-solo/packets/packet-<label>.json and key.json (the side-by-side key's rows). No model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SCR = opt('scratch');
const N = Number(opt('books', 10));
const ARMS = opt('arms', 'stored,opus').split(',');
const D = path.join(SCR, 'judge', 'ms');
const key = JSON.parse(fs.readFileSync(path.join(D, 'key.json'), 'utf8'));
const rng = makeRng(20261103 + 11);
const packets = fs.readdirSync(path.join(D, 'packets')).sort().map((f) => [rng(), f]).sort((a, b) => a[0] - b[0]).slice(0, N).map((x) => x[1]);
const out = path.join(SCR, 'judge', 'ms-solo');
fs.mkdirSync(path.join(out, 'packets'), { recursive: true });
const soloKey = {};
for (const f of packets) for (const e of JSON.parse(fs.readFileSync(path.join(D, 'packets', f), 'utf8'))) {
  if (!ARMS.includes(key[e.book_id].arm)) continue;
  soloKey[e.book_id] = key[e.book_id];
  fs.writeFileSync(path.join(out, 'packets', `packet-${e.book_id}.json`), JSON.stringify([{ ...e, slot: 1 }], null, 1));
}
fs.writeFileSync(path.join(out, 'key.json'), JSON.stringify(soloKey, null, 1));
console.log(`${Object.keys(soloKey).length} solo packets from ${packets.length} books: ${packets.join(' ')}`);
