/**
 * Librarian citations (#6946) — one Opus packet per re-pointed link: the claim, the page it was linked
 * to, the page it now links to, both whole. The gate is zero re-points onto a page that does not say it.
 *
 * PRIOR ART: build-packets.ts (whole-answer packets, every link labelled); this isolates each MOVE so a
 * judge reads both pages side by side instead of finding them among forty.
 *
 * Usage:
 *   npx tsx scripts/eval/librarian-citations-6946/verify-moves.ts --replay=<out.jsonl> --support=<support.json.gz> --dir=<dir> [--arms=B]
 *   then: for p in <dir>/packets/*.md; do cat VERIFY-PROMPT.md $p | claude -p --model opus …; done (judge-driver.sh with JUDGE_PROMPT=VERIFY-PROMPT.md, KEY=verdict)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { GroundingPage } from '@/lib/embassy/grounding';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';

const arg = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const arms = (arg('arms', 'B') as string).split(',');
const support: Record<string, { pages: GroundingPage[] }> = JSON.parse(zlib.gunzipSync(fs.readFileSync(arg('support')!)).toString('utf8'));
const dir = arg('dir')!;
fs.mkdirSync(path.join(dir, 'packets'), { recursive: true });

const rows = fs.readFileSync(arg('replay')!, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => arms.includes(r.key.split(':')[1]));
const index: Array<{ id: string; key: string; by: string; claim: string; from: string; to: string }> = [];
const show = (p: GroundingPage | undefined, k: string) => {
  if (!p) return `(page ${k} was not loaded)`;
  const [tr, orig] = [p.parts?.[0] ?? p.text, p.parts?.[1] ?? ''].map(t => (t ? stripEditorialWrappers(t) : t));
  return `**${p.bookTitle}, page ${p.page}** (${p.bookSlug})\n\nEnglish translation:\n\n${tr || '(none)'}${orig ? `\n\nOriginal transcription:\n\n${orig}` : ''}`;
};
for (const r of rows) {
  const pages = support[r.key]?.pages ?? [];
  const byKey = new Map(pages.map(p => [`${p.bookId}:${p.page}`, p]));
  (r.report.moves ?? []).forEach((m: { by: string; claim: string; from: string; to: string }, i: number) => {
    const id = `${r.key.replace(':', '-')}-m${i + 1}`;
    index.push({ id, key: r.key, ...m });
    // Blind to which page is old and which is new: the order is fixed by id parity.
    const swap = i % 2 === 1;
    const [a, b] = swap ? [m.to, m.from] : [m.from, m.to];
    fs.writeFileSync(path.join(dir, 'packets', `${id}.md`),
      `## Claim\n\n${m.claim}\n\n## Page A\n\n${show(byKey.get(a), a)}\n\n---\n\n## Page B\n\n${show(byKey.get(b), b)}\n`);
    index[index.length - 1] = { ...index[index.length - 1], ...(swap ? { A: 'to', B: 'from' } : { A: 'from', B: 'to' }) } as never;
  });
}
fs.writeFileSync(path.join(dir, 'moves.json'), JSON.stringify(index, null, 1));
console.log(`${index.length} moves → ${dir}/packets`);
