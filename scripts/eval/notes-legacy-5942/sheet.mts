// PRIOR ART: scripts/eval/notes-layer-5942/pilot-checks.mts builds the storage pilot's spot-check sheet from pages it
// wrote, picked at random; this one picks LEGACY pages on purpose — old prompt versions, every legacy syntax at least
// once, one page per book — and shows the reader's notes-off view beside the parser's (conformance.mts's oracle).
/**
 * #5942 legacy syntaxes, step 6 — the spot-check sheet. Read-only.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local node_modules/.bin/tsx scripts/eval/notes-legacy-5942/sheet.mts \
 *     --in $JOB_SCRATCH/draw.jsonl.gz --in … --n 30 --out $JOB_SCRATCH/sheet.md
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { diffWordsWithSpace } from 'diff';
import { splitAnnotations, notesOffText } from '../../lib/annotation-layer.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { detect, versionOf } from './syntaxes.mjs';
import * as NR from '@/components/reader/NotesRenderer';

const { prepareNotesMarkdown } = ((NR as any).prepareNotesMarkdown ? NR : (NR as any).default) as typeof NR;
const args = process.argv.slice(2);
const all = (k: string) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const N = Number(all('--n')[0] ?? 30);
const OLD = new Set(['none', 'v0', 'v1', 'v2', '1', '2', '3', 'v5.2026-02', 'v5.1.2026-03b', 'v5.1.2026-03c', 'v6']);
const SKIP = new Set(['«…»', '[…] lacuna', '"# Title Page"-style heading']);
const rows: any[] = [];
const seen = new Set<string>();
for (const f of all('--in')) for (const l of zlib.gunzipSync(fs.readFileSync(f)).toString().split('\n')) {
  if (!l.trim()) continue;
  const r = JSON.parse(l);
  if (seen.has(r.id) || !OLD.has(versionOf(r))) continue;
  seen.add(r.id);
  r.ids = detect(r.data).filter((x: string) => !SKIP.has(x));
  if (r.ids.length) rows.push(r);
}
rows.sort((a, b) => (a.id < b.id ? -1 : 1));
const rng = makeRng(5942);
for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
// Every syntax first (the page that has it, in shuffled order), then fill; one page per book.
const picks: any[] = [];
const books = new Set<string>();
const covered = new Set<string>();
const add = (r: any) => { if (picks.length < N && !books.has(r.book_id)) { picks.push(r); books.add(r.book_id); r.ids.forEach((x: string) => covered.add(x)); } };
for (const id of new Set(rows.flatMap((r) => r.ids))) if (!covered.has(id as string)) { const r = rows.find((x) => x.ids.includes(id) && !books.has(x.book_id)); if (r) add(r); }
for (const r of rows) add(r);

const c = new MongoClient(process.env.MONGODB_URI!, { appName: 'notes-legacy-5942-sheet' });
await c.connect();
const db = c.db('bookstore');
const meta = new Map((await db.collection('books').find({ id: { $in: picks.map((p) => p.book_id) } }).project({ _id: 0, id: 1, slug: 1, title: 1 }).toArray()).map((b) => [b.id, b]));
const ocr = new Map((await db.collection('pages').find({ id: { $in: picks.map((p) => p.id) } }).project({ _id: 0, id: 1, 'ocr.data': 1 }).toArray()).map((p) => [p.id, p.ocr?.data ?? '']));
await c.close();

const CAP = 1800;
const fence = (s: string) => '````text\n' + (s.length > CAP ? `${s.slice(0, CAP)}\n… [${s.length - CAP} more characters]` : s) + '\n````';
const cell = (s: any, n = 120) => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, n);
const strip = (s: string) => s.replace(/<\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
let md = `# #5942 legacy syntaxes — spot-check sheet (${picks.length} pages, old prompt versions, seed 5942)\n\nSyntaxes covered: ${[...covered].join(', ')}\n`;
picks.forEach((r, i) => {
  const b: any = meta.get(r.book_id);
  const split: any = splitAnnotations(r.data, { ocr: ocr.get(r.id) });
  const rd = prepareNotesMarkdown(r.data, { showNotes: false, pageType: r.page_type ?? undefined });
  const R = rd.isDescriptionOnly ? '' : strip(rd.processedText);
  const T = strip(notesOffText(split));
  const d = diffWordsWithSpace(R, T).filter((x) => x.added || x.removed);
  md += `\n## ${i + 1}. ${cell(b?.title, 80)} — p. ${r.page_number}\n\nhttps://sourcelibrary.org/book/${b?.slug ?? r.book_id}/page/${r.id} · prompt ${versionOf(r)} · syntaxes: ${r.ids.join(', ')}\n\n`;
  md += `**Raw \`translation.data\`**\n\n${fence(r.data)}\n\n**Clean \`text\` (annotation-layer/3)**\n\n${fence(split.text)}\n\n`;
  md += `**Annotations** (${split.annotations.length})\n\n| # | type | tag | anchor (exact) | body |\n|---|---|---|---|---|\n`;
  split.annotations.slice(0, 30).forEach((a: any, k: number) => { md += `| ${k + 1} | ${a.type}${a.printed ? ' (printed)' : ''}${a.malformed ? ` (${a.malformed})` : ''} | ${cell(a.tag ?? '')} | ${a.anchor ? `“${cell(a.anchor.exact, 60)}”` : a.scope === 'page' ? '*page*' : '—'} | ${cell(a.body)} |\n`; });
  if (split.annotations.length > 30) md += `\n… ${split.annotations.length - 30} more\n`;
  md += `\n**Reader notes-off vs parser notes-off** (\`[-reader only-]\` \`{+parser only+}\`): ${d.length ? '' : 'same words'}\n`;
  if (d.length) md += '\n' + fence(d.slice(0, 20).map((x) => (x.added ? `{+${x.value.trim()}+}` : `[-${x.value.trim()}-]`)).join('\n')) + '\n';
});
fs.writeFileSync(all('--out')[0], md);
console.log(`${picks.length} pages; syntaxes covered: ${[...covered].length}`);
