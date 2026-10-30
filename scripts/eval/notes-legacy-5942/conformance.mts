// PRIOR ART: scripts/eval/notes-layer-5942/pilot-checks.mts compares reader(data) with reader(text) — both through
// the reader, which strips whatever the parser left behind, so a [[vocabulary: …]] left in `text` passes there. This
// compares the reader's notes-off words of the stored markup with the parser's `text` DIRECTLY (interpolation spans
// dropped, as notes-off drops them), per legacy syntax. word-conservation.mjs (same folder's sibling) is reused.
/**
 * #5942 legacy syntaxes — read-only, $0. The conformance oracle and the prevalence table.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local node_modules/.bin/tsx \
 *     scripts/eval/notes-legacy-5942/conformance.mts --in $JOB_SCRATCH/draw.jsonl.gz [--in more.jsonl.gz] \
 *     --out $JOB_SCRATCH/conformance [--old <annotation-layer /2: git show 7bee1ae87:scripts/lib/annotation-layer.mjs > scripts/lib/annotation-layer-v2.tmp.mjs>] [--total 5726305]
 *
 * Oracle per page: the reader's notes-off view (`prepareNotesMarkdown(data, { showNotes: false })`, the function the
 * reader calls; empty on a description-only page, which the reader hides whole) against `notesOffText(split)` — the
 * parser's `text` with its 'interp' spans removed. Compared as bags of words (letters, marks, digits); tags stripped.
 * Writes <out>.json (tables) and <out>.diffs.jsonl.gz (every page that differs, with both word lists).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { splitAnnotations, renderInline, notesOffText } from '../../lib/annotation-layer.mjs';
import { wordConservation } from '../notes-layer-5942/word-conservation.mjs';
import { SYNTAXES, REMOVE, detect, versionOf } from './syntaxes.mjs';
import * as NR from '@/components/reader/NotesRenderer';

const { prepareNotesMarkdown } = ((NR as any).prepareNotesMarkdown ? NR : (NR as any).default) as typeof NR;
const args = process.argv.slice(2);
const all = (k: string) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const arg = (k: string) => all(k)[0];
const OUT = arg('--out')!;
const TOTAL = Number(arg('--total') ?? 5726305);
const old = arg('--old') ? await import(pathToFileURL(arg('--old')!).href) : null;

const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const words = (s: string) => s.replace(/<\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>/gi, ' ').match(WORD) || [];
function bagDiff(reader: string[], mine: string[]) {
  const m = new Map<string, number>();
  for (const w of reader) m.set(w, (m.get(w) || 0) + 1);
  for (const w of mine) m.set(w, (m.get(w) || 0) - 1);
  const lost: string[] = [], leaked: string[] = [];
  for (const [w, n] of m) { if (n > 0) lost.push(...Array(n).fill(w)); else if (n < 0) leaked.push(...Array(-n).fill(w)); }
  return { lost, leaked };
}
function readerOff(data: string, pageType?: string | null) {
  const r = prepareNotesMarkdown(data, { showNotes: false, pageType: pageType ?? undefined });
  return r.isDescriptionOnly ? '' : r.processedText;
}

const rows: any[] = [];
const seenIds = new Set<string>(); // a page in two draws counts once (the first, so a uniform row keeps its weight)
for (const f of all('--in')) {
  const rl = readline.createInterface({ input: fs.createReadStream(f).pipe(zlib.createGunzip()) });
  for await (const l of rl) if (l.trim()) { const r = JSON.parse(l); if (!seenIds.has(r.id)) { seenIds.add(r.id); rows.push(r); } }
}
const uniformN = rows.filter((r) => r.w != null).length;
type Agg = { pages: number; uniform: number; versions: Record<string, number>; v2_equal: number; v3_equal: number; round_trip: number; v3_examples: any[]; v2_own: number; v3_own: number; own_examples: any[] };
const per: Record<string, Agg> = {};
const total = { pages: 0, uniform: 0, v2_equal: 0, v3_equal: 0, round_trip: 0, ledger_lost: 0, ledger_leaked: 0, legacy_pages: 0, legacy_v2_equal: 0, legacy_v3_equal: 0 };
const byVersion: Record<string, { pages: number; legacy: number }> = {};
const diffs = zlib.createGzip();
diffs.pipe(fs.createWriteStream(`${OUT}.diffs.jsonl.gz`));
for (const r of rows) {
  const data: string = r.data;
  const ids = detect(data);
  const v = versionOf(r);
  const R = words(readerOff(data, r.page_type));
  const split: any = splitAnnotations(data);
  const d3 = bagDiff(R, words(notesOffText(split)));
  const key = (d: { lost: string[]; leaked: string[] }) => [...d.lost].sort().join(' ') + '|' + [...d.leaked].sort().join(' ');
  // Differential: with this syntax deleted from the page, do the reader and the parser disagree on the same words?
  const own = (id: string, parse: (x: string) => string, d: { lost: string[]; leaked: string[] }) => {
    const f = (REMOVE as any)[id];
    if (!f) return null;
    const data2 = f(data);
    return key(bagDiff(words(readerOff(data2, r.page_type)), words(parse(data2)))) === key(d);
  };
  const eq3 = !d3.lost.length && !d3.leaked.length;
  let eq2 = null as boolean | null;
  let d2: any = null;
  if (old) { d2 = bagDiff(R, words(old.splitAnnotations(data).text)); eq2 = !d2.lost.length && !d2.leaked.length; }
  const rt = renderInline(split) === data;
  const c = wordConservation(data, split);
  const legacy = ids.some((id) => !['«…»', '<lacuna>', '[…] lacuna'].includes(id));
  total.pages++; if (r.w != null) total.uniform++;
  if (eq3) total.v3_equal++; if (eq2) total.v2_equal++; if (rt) total.round_trip++;
  if (c.comparable && c.lost.length) total.ledger_lost++;
  if (c.comparable && c.leaked.length) total.ledger_leaked++;
  if (legacy) { total.legacy_pages++; if (eq3) total.legacy_v3_equal++; if (eq2) total.legacy_v2_equal++; }
  byVersion[v] ??= { pages: 0, legacy: 0 };
  byVersion[v].pages++; if (legacy) byVersion[v].legacy++;
  for (const id of ids) {
    const a = (per[id] ??= { pages: 0, uniform: 0, versions: {}, v2_equal: 0, v3_equal: 0, round_trip: 0, v3_examples: [], v2_own: 0, v3_own: 0, own_examples: [] });
    const o3 = eq3 || own(id, (x) => notesOffText(splitAnnotations(x)), d3);
    const o2 = old ? eq2 || own(id, (x) => old.splitAnnotations(x).text, d2) : null;
    if (o3) a.v3_own++;
    if (o2) a.v2_own++;
    if (o3 === false && a.own_examples.length < 8) a.own_examples.push({ id: r.id, lost: d3.lost.slice(0, 8), leaked: d3.leaked.slice(0, 8) });
    a.pages++; if (r.w != null) a.uniform++;
    a.versions[v] = (a.versions[v] || 0) + 1;
    if (eq2) a.v2_equal++; if (eq3) a.v3_equal++; if (rt) a.round_trip++;
    if (!eq3 && a.v3_examples.length < 5) a.v3_examples.push({ id: r.id, lost: d3.lost.slice(0, 8), leaked: d3.leaked.slice(0, 8) });
  }
  if (!eq3 || !rt) diffs.write(JSON.stringify({ id: r.id, book_id: r.book_id, v, ids, rt, lost: d3.lost, leaked: d3.leaked, own: Object.fromEntries(ids.filter((id) => (REMOVE as any)[id]).map((id) => [id, own(id, (x) => notesOffText(splitAnnotations(x)), d3)])) }) + '\n');
}
await new Promise((res) => diffs.end(res));
const table = SYNTAXES.map(([id, , from]) => {
  const a = per[id as string];
  if (!a) return { syntax: id, from, pages: 0 };
  const versions = Object.entries(a.versions).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k}:${n}`).join(' ');
  const has = (REMOVE as any)[id as string] ? 1 : 0;
  return { syntax: id, from, pages: a.pages, uniform: a.uniform, est_pages: Math.round((a.uniform / uniformN) * TOTAL), versions, v2_equal: a.v2_equal, v3_equal: a.v3_equal, v2_own: has ? a.v2_own : null, v3_own: has ? a.v3_own : null, round_trip: a.round_trip, v3_examples: a.v3_examples, own_examples: a.own_examples };
});
const res = { total, uniformN, byVersion, table };
fs.writeFileSync(`${OUT}.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(total));
for (const t of table as any[]) console.log(`${String(t.syntax).padEnd(40)} n=${t.pages} est=${t.est_pages ?? 0} v2=${t.v2_equal ?? '-'} v3=${t.v3_equal ?? '-'} own2=${t.v2_own ?? '-'} own3=${t.v3_own ?? '-'} rt=${t.round_trip ?? '-'}  ${String(t.versions ?? '').slice(0, 120)}`);
