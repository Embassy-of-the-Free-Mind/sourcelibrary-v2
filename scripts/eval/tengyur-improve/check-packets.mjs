#!/usr/bin/env node
// PRIOR ART: verse-packets.mjs (the drafter packets). This turns them and the drafts into BLIND checker packets.
/**
 * check-packets.mjs — step 3 of #6141, $0, files only. Per verse: the draft plus every rendering the drafter did not
 * mark misaligned, shuffled under opaque ids. The key (id → draft | r) is written apart from the packets.
 *   node scripts/eval/tengyur-improve/check-packets.mjs --work /root/timp --seed 61412
 */
import fs from 'node:fs';
import path from 'node:path';
import { rng, shuffle } from '../tengyur-characterize/common.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const WORK = arg('work', '/root/timp'), R = rng(Number(arg('seed', 61412)));
const dir = path.join(WORK, 'vm');
const files = fs.readdirSync(path.join(dir, 'packets')).filter((f) => f.startsWith('draft-')).sort();
const key = {};
fs.mkdirSync(path.join(dir, 'check'), { recursive: true });
for (const f of files) {
  const packet = JSON.parse(fs.readFileSync(path.join(dir, 'packets', f), 'utf8'));
  const drafts = JSON.parse(fs.readFileSync(path.join(dir, 'drafts', f), 'utf8'));
  const out = packet.map((v) => {
    const d = drafts.find((x) => x.vid === v.vid);
    const items = [{ src: 'draft', text: d.reference.join('\n') },
      ...v.renderings.filter((r) => !d.misaligned.includes(r.r)).map((r) => ({ src: `r${r.r}`, text: r.rendering.replace(/<\/?[a-z][a-z-]*[^>]*>/g, '') }))];
    const sh = shuffle(items, R); key[v.vid] = {};
    const candidates = sh.map((it, i) => { key[v.vid][`c${i + 1}`] = it.src; return { c: `c${i + 1}`, text: it.text }; });
    return { vid: v.vid, span_padas: v.span_padas, verse_padas: v.verse_padas, tibetan_context: v.renderings[0]?.tibetan_context, sanskrit: v.sanskrit, candidates };
  });
  fs.writeFileSync(path.join(dir, 'check', f.replace('draft-', 'check-')), JSON.stringify(out, null, 1));
}
fs.writeFileSync(path.join(dir, 'check-key.json'), JSON.stringify(key, null, 1));
console.log(`${Object.keys(key).length} verses, ${Object.values(key).reduce((s, k) => s + Object.keys(k).length, 0)} candidates`);
