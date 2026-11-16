#!/usr/bin/env node
// #264 stage 2: leaf-check packets. For each located candidate, the page image (downscaled) and the reference's
// first and last words; a reader says whether the image is that leaf. One in five packets is a planted control:
// the neighbouring leaf's text in place of the candidate's, so a reader who says "same leaf" to everything is
// caught. Readers see an opaque id only; the key (which packet is which row, which are controls) stays here.
// PRIOR ART: scripts/eval/typed-refs-6012/eye-packets.mjs (by-eye packets for #6012's pairs: whole-book claims,
// machine claim withheld, no planted controls) and scripts/eval/lib/contact-sheet.mjs (grids for many pages;
// a leaf check needs one page large enough to read its first and last line).
//   node scripts/eval/test-set-264/leaf-packets.mjs --cands=FILE --dir=DIR [--px=1100] [--seed=264]
// A candidate line carries: row, image_url, head, tail, and control_head/control_tail (the neighbour's).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { readJsonl, sha256 } from './refs-lib.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const DIR = argOf('dir');
const PX = Number(argOf('px', 1100));
const cands = readJsonl(argOf('cands'));
const rng = makeRng(Number(argOf('seed', 264)));
fs.mkdirSync(path.join(DIR, 'img'), { recursive: true });
const packets = [], key = [];
for (const c of cands) {
  const control = !!(c.control_head && rng() < 0.2);
  const pid = 'p' + sha256(`${c.row}|${argOf('seed', 264)}`).slice(0, 8);
  const img = path.join(DIR, 'img', `${pid}.jpg`);
  if (!fs.existsSync(img)) {
    const r = await fetch(c.image_url);
    if (!r.ok) { key.push({ pid, row: c.row, error: `image ${r.status}` }); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    await sharp(buf).resize({ width: PX, height: PX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(img);
  }
  packets.push({ pid, image: img, head: control ? c.control_head : c.head, tail: control ? c.control_tail : c.tail, script: c.script, note: c.note || null });
  key.push({ pid, row: c.row, control });
}
packets.sort((a, b) => a.pid.localeCompare(b.pid));
fs.writeFileSync(path.join(DIR, 'packets.jsonl'), packets.map((p) => JSON.stringify(p)).join('\n') + '\n');
fs.writeFileSync(path.join(DIR, 'key.jsonl'), key.map((p) => JSON.stringify(p)).join('\n') + '\n');
console.log(`${packets.length} packets (${key.filter((k) => k.control).length} controls), ${key.filter((k) => k.error).length} image errors -> ${DIR}`);
