/**
 * Librarian citation fixer (#6946) — judge packets for the existing Opus instrument (packet.ts + JUDGE-PROMPT.md,
 * run by librarian-citations-6946/judge-driver.sh), so the fixed answers are read exactly as the pre-fix ones were.
 *
 *   --mode=before   items with no pre-fix labels (the gauge's turns): the text as the reader saw it.
 *   --mode=after    every answer the fixer CHANGED (fixed.jsonl): the fixed text, same pages. Unchanged answers
 *                   keep their pre-fix labels; re-judging them would only add judge noise.
 * Packets are blind: the file name is the item key and a tag, the packet has no before/after mark.
 * Writes <dir>/packets/<key>-<tag>-J1.md and <dir>/links-<tag>.json (key → link list, packet.ts ids).
 *
 * PRIOR ART: scripts/eval/librarian-citations-6946/build-packets.ts (same packets from an answers file; this
 * reads the replay items and the fixer's output instead, and keys by item, not by question id).
 *
 * Usage: npx tsx scripts/eval/librarian-fixer-6946/label-packets.ts --items=<items.jsonl.gz> --dir=<judge dir>
 *          --mode=before|after --tag=<tag> [--fixed=<fixed.jsonl>] [--only=<regex>]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { judgePacket, type PacketLink } from '../librarian-citations-6946/packet';
import type { Item } from './build-items';

const arg = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const readMaybeGz = (f: string) => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)) : fs.readFileSync(f)).toString('utf8');
const safe = (k: string) => k.replace(/[^a-zA-Z0-9_-]+/g, '_');

const items: Item[] = readMaybeGz(arg('items')!).split('\n').filter(Boolean).map(l => JSON.parse(l));
const dir = arg('dir')!;
const tag = arg('tag')!;
const mode = arg('mode')!;
const only = arg('only') ? new RegExp(arg('only')!) : null;
fs.mkdirSync(path.join(dir, 'packets'), { recursive: true });
const fixed = new Map<string, { changed: boolean; fixed: string }>(
  mode === 'after' ? readMaybeGz(arg('fixed')!).split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return [r.key, r]; }) : [],
);
const linksOut: Record<string, PacketLink[]> = {};
let n = 0;
for (const it of items) {
  if (only && !only.test(it.key)) continue;
  let text: string;
  if (mode === 'before') {
    if (it.before) continue;
    text = it.text;
  } else {
    const f = fixed.get(it.key);
    if (!f?.changed) continue;
    text = f.fixed;
  }
  const { md, links } = judgePacket(it.q, text, it.pages);
  linksOut[it.key] = links;
  if (links.length === 0) continue;
  fs.writeFileSync(path.join(dir, 'packets', `${safe(it.key)}-${tag}-J1.md`), md);
  n++;
}
fs.writeFileSync(path.join(dir, `links-${tag}.json`), JSON.stringify(linksOut, null, 1));
console.log(`${n} packets (${tag}) → ${dir}/packets`);
