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
import { findPageLinks } from '@/lib/embassy/citation-pages';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';

const arg = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const readMaybeGz = (f: string) => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)) : fs.readFileSync(f)).toString('utf8');

const rows: Array<{ key: string; q: string; text: string }> = readMaybeGz(arg('answers')!).split('\n').filter(Boolean).map(l => JSON.parse(l));
const support: Record<string, { pages: GroundingPage[] }> = JSON.parse(readMaybeGz(arg('support')!));
const dir = arg('dir')!;
const tag = arg('tag')!;
const runs = (arg('runs', 'J1') as string).split(',');
const PAGE_CHARS = 20000;

fs.mkdirSync(path.join(dir, 'packets'), { recursive: true });
const linksOut: Record<string, Array<{ id: string; slug: string; page: number; at: number; text: string }>> = {};

for (const r of rows) {
  const links = findPageLinks(r.text);
  const ids = links.map((l, i) => ({ id: `L${i + 1}`, slug: l.slug, page: l.page, at: l.start, text: l.label }));
  linksOut[r.key] = ids;
  if (links.length === 0) continue;
  // Marker after each link, from the end so offsets hold.
  let marked = r.text;
  for (let i = links.length - 1; i >= 0; i--) marked = `${marked.slice(0, links[i].end)} ⟦L${i + 1}⟧${marked.slice(links[i].end)}`;
  const pages = support[r.key]?.pages ?? [];
  const bySlug = new Map<string, GroundingPage[]>();
  for (const p of pages) bySlug.set(p.bookSlug, [...(bySlug.get(p.bookSlug) ?? []), p]);
  const cited = new Set(links.map(l => `${l.slug} p.${l.page}`));
  const head = (p: GroundingPage) => `${p.bookSlug} p.${p.page}`;
  const ordered = [...pages].sort((a, b) => Number(cited.has(head(b))) - Number(cited.has(head(a))) || a.bookSlug.localeCompare(b.bookSlug) || a.page - b.page);
  const linkList = ids.map(l => {
    const known = pages.some(p => p.bookSlug === l.slug && p.page === l.page);
    return `- ${l.id} → ${l.slug} p.${l.page}${known ? '' : ' (this page is NOT among the pages below)'}`;
  }).join('\n');
  const pageBlocks = ordered.map(p => {
    // Editorial wrappers (<meta>, <summary>…) describe the page, often its neighbours: never page text.
    const [tr, orig] = [p.parts?.[0] ?? p.text, p.parts?.[1] ?? ''].map(t => (t ? stripEditorialWrappers(t) : t));
    return `### ${head(p)} — ${p.bookTitle}\n\n**English translation:**\n\n${(tr || '(none)').slice(0, PAGE_CHARS)}${orig ? `\n\n**Original transcription:**\n\n${orig.slice(0, PAGE_CHARS)}` : ''}`;
  });
  const qid = r.key.replace(/:.*/, '');
  const md = `## Question\n\n${r.q}\n\n## Answer\n\n${marked}\n\n## Links to label\n\n${linkList}\n\n## Pages the Librarian read (${pages.length})\n\n${pageBlocks.join('\n\n---\n\n') || '(none)'}\n`;
  for (const run of runs) fs.writeFileSync(path.join(dir, 'packets', `${qid}-${tag}-${run}.md`), md);
}
fs.writeFileSync(path.join(dir, `links-${tag}.json`), JSON.stringify(linksOut, null, 1));
console.log(`${rows.length} answers, ${Object.values(linksOut).reduce((s, l) => s + l.length, 0)} page links → ${dir}/packets (${tag})`);
