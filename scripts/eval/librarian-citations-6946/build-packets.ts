/**
 * Librarian citations (#6946) — one judge packet per answer.
 *
 * PRIOR ART: scripts/eval/librarian-speed-6904/build-packets.ts (pairwise X/Y
 * preference packets with whole retrieved pages; it asks which answer is
 * better and flags an answer, it does not label each link). This labels every
 * page link of ONE answer — cited / other page / no page / wrong fact — so the
 * same instrument reads the answers before and after the citation pass, blind
 * to which is which.
 *
 * Input rows (jsonl or jsonl.gz): {"key":"q01:B","q":"…","text":"…"} — the text
 * the reader sees. Support pages come from load-support.ts.
 *
 * Usage:
 *   npx tsx scripts/eval/librarian-citations-6946/build-packets.ts \
 *     --answers=<rows> --support=<support.json.gz> --dir=<judge dir> --tag=<before|after> [--runs=J1,J2]
 * Writes <dir>/packets/<qid>-<tag>-<run>.md and <dir>/links-<tag>.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { GroundingPage } from '@/lib/embassy/grounding';
import { judgePacket, type PacketLink } from './packet';

const arg = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const readMaybeGz = (f: string) => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)) : fs.readFileSync(f)).toString('utf8');

const rows: Array<{ key: string; q: string; text: string }> = readMaybeGz(arg('answers')!).split('\n').filter(Boolean).map(l => JSON.parse(l));
const support: Record<string, { pages: GroundingPage[] }> = JSON.parse(readMaybeGz(arg('support')!));
const dir = arg('dir')!;
const tag = arg('tag')!;
const runs = (arg('runs', 'J1') as string).split(',');
fs.mkdirSync(path.join(dir, 'packets'), { recursive: true });
const linksOut: Record<string, PacketLink[]> = {};

for (const r of rows) {
  const { md, links } = judgePacket(r.q, r.text, support[r.key]?.pages ?? []);
  linksOut[r.key] = links;
  if (links.length === 0) continue;
  const qid = r.key.replace(/:.*/, '');
  for (const run of runs) fs.writeFileSync(path.join(dir, 'packets', `${qid}-${tag}-${run}.md`), md);
}
fs.writeFileSync(path.join(dir, `links-${tag}.json`), JSON.stringify(linksOut, null, 1));
console.log(`${rows.length} answers, ${Object.values(linksOut).reduce((s, l) => s + l.length, 0)} page links → ${dir}/packets (${tag})`);
