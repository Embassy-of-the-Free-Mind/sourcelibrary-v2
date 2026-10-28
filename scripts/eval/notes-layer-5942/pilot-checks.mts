// PRIOR ART: measure-a.mts (this directory) measured the parser on a 3,000-page draw from files; this one
// re-reads the pages the storage pilot actually WROTE (pages + page_annotations, scripts/maintenance/
// notes-layer-backfill-5942/backfill.mjs) and checks what was stored, and builds Derek's spot-check sheet.
/**
 * #5942 storage pilot — the live half of the failure-mode table, and the spot-check sheet. Read-only, $0.
 *
 *   node --env-file=.env.production.local node_modules/.bin/tsx scripts/eval/notes-layer-5942/pilot-checks.mts \
 *     --pages $JOB_SCRATCH/pilot-apply.jsonl --out $JOB_SCRATCH/pilot-checks
 *
 * Writes <out>.json (numbers) and <out>.md (the spot-check sections; quoted page text).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { diffWordsWithSpace } from 'diff';
import { splitAnnotations, renderMarkup, resolveAnchor } from '../../lib/annotation-layer.mjs';
import { getTranslationText, translationTextIsCurrent, parserAnnotation } from '../../lib/translation-text.mjs';
import { wordConservation } from './word-conservation.mjs';
import * as NR from '@/components/reader/NotesRenderer';

const { prepareNotesMarkdown } = ((NR as any).prepareNotesMarkdown ? NR : (NR as any).default) as typeof NR;
const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const PAGES = arg('--pages')!, OUT = arg('--out')!;
const squash = (t: string) => t.replace(/\s+/g, ' ').trim();
const reader = (t: string, pageType?: string) => squash(prepareNotesMarkdown(t, { showNotes: false, pageType }).processedText);

const SCRIPTS: Record<string, RegExp> = {
  Arabic: /\p{Script=Arabic}/u, Hebrew: /\p{Script=Hebrew}/u, Han: /\p{Script=Han}/u, Tibetan: /\p{Script=Tibetan}/u,
  Greek: /\p{Script=Greek}/u, Devanagari: /\p{Script=Devanagari}/u, Syriac: /\p{Script=Syriac}/u, Cyrillic: /\p{Script=Cyrillic}/u,
  combining: /\p{M}/u, astral: /[\uD800-\uDBFF][\uDC00-\uDFFF]/,
};

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const ids = fs.readFileSync(PAGES, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.written === true).map((r) => r.page_id);
const client = new MongoClient(process.env.MONGODB_URI!, { appName: 'notes-layer-pilot-checks-5942' });
await client.connect();
const db = client.db('bookstore');
const pages = await db.collection('pages').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, translation: 1, translation_withheld: 1 } }).toArray();
const anns = new Map((await db.collection('page_annotations').find({ page_id: { $in: ids } }).toArray()).map((d) => [d.page_id, d]));
const books = new Map((await db.collection('books').find({ id: { $in: [...new Set(pages.map((p) => p.book_id))] } }, { projection: { _id: 0, id: 1, slug: 1, title: 1, language: 1 } }).toArray()).map((b) => [b.id, b]));

const S: any = {
  pages: pages.length, current: 0, served_from_store: 0, withheld_on_page: 0, placeholder: 0,
  conservation: { comparable: 0, not_comparable: 0, pages_lost: 0, pages_leaked: 0, words_lost: 0, words_leaked: 0, pages_chars_off: 0, chars_lost: 0, chars_leaked: 0, examples: [] as any[] },
  anchors: { annotations: 0, anchored: 0, slice_mismatch: 0, unresolved: 0, orphans: 0 },
  duplicates: { annotations_with_repeated_exact: 0, resolved_to_own: 0, resolved_elsewhere: 0, refused: 0 },
  scripts: {} as Record<string, { pages: number; anchors: number; slice_mismatch: number }>,
  malformed: { pages: 0, unclosed: 0, stray: 0 },
  reader_diff: { equal: 0, differ: 0 },
  longest: { chars: 0, split_ms: 0, page: '' },
  annotations_doc: { with_doc: 0, doc_count_matches: 0, doc_hash_current: 0 },
};
const rows: any[] = [];
for (const p of pages) {
  const t = p.translation;
  const data: string = t.data;
  if (translationTextIsCurrent(t)) S.current++;
  if (getTranslationText(p) === t.text) S.served_from_store++;
  if (p.translation_withheld) S.withheld_on_page++;
  if (/^\s*\[[^\]]{0,120}\]\s*$/.test(data)) S.placeholder++;
  const t0 = performance.now();
  const split: any = splitAnnotations(data);
  const ms = performance.now() - t0;
  if (data.length > S.longest.chars) S.longest = { chars: data.length, split_ms: Math.round(ms), page: p.id };
  const c = wordConservation(data, split);
  if (!c.comparable) S.conservation.not_comparable++;
  else {
    S.conservation.comparable++;
    if (c.lost.length) { S.conservation.pages_lost++; S.conservation.words_lost += c.lost.reduce((s: number, [, n]: any) => s + n, 0); }
    if (c.leaked.length) { S.conservation.pages_leaked++; S.conservation.words_leaked += c.leaked.reduce((s: number, [, n]: any) => s + n, 0); }
    if (c.chars_lost || c.chars_leaked) { S.conservation.pages_chars_off++; S.conservation.chars_lost += c.chars_lost; S.conservation.chars_leaked += c.chars_leaked; }
    if ((c.lost.length || c.leaked.length) && S.conservation.examples.length < 20) S.conservation.examples.push({ page: p.id, lost: c.lost.slice(0, 8), leaked: c.leaked.slice(0, 8), chars_lost: c.chars_lost, chars_leaked: c.chars_leaked });
  }
  const doc = anns.get(p.id);
  const stored: any[] = doc?.annotations ?? [];
  if (doc) {
    S.annotations_doc.with_doc++;
    if (stored.length === t.text_from?.annotations) S.annotations_doc.doc_count_matches++;
    if (doc.data_hash === t.text_from?.data_hash) S.annotations_doc.doc_hash_current++;
  }
  const text: string = t.text;
  const present = Object.entries(SCRIPTS).filter(([, re]) => re.test(data)).map(([k]) => k);
  let mism = 0, unres = 0;
  for (const a of stored) {
    S.anchors.annotations++;
    if (a.exact === undefined) continue;
    S.anchors.anchored++;
    if (text.slice(a.start, a.end) !== a.exact) { S.anchors.slice_mismatch++; mism++; }
    const r = resolveAnchor(text, parserAnnotation(a).anchor);
    if (!r) { S.anchors.unresolved++; unres++; }
    if (a.exact && text.split(a.exact).length > 2) {
      S.duplicates.annotations_with_repeated_exact++;
      if (!r) S.duplicates.refused++; else if (r.start === a.start) S.duplicates.resolved_to_own++; else S.duplicates.resolved_elsewhere++;
    }
  }
  for (const k of present) {
    S.scripts[k] ??= { pages: 0, anchors: 0, slice_mismatch: 0 };
    S.scripts[k].pages++; S.scripts[k].anchors += stored.filter((a) => a.exact !== undefined).length; S.scripts[k].slice_mismatch += mism;
  }
  const orphans = renderMarkup(text, stored.map(parserAnnotation)).orphans.length;
  S.anchors.orphans += orphans;
  const mal = split.annotations.filter((a: any) => a.malformed);
  if (mal.length) { S.malformed.pages++; S.malformed.unclosed += mal.filter((a: any) => a.malformed === 'unclosed').length; S.malformed.stray += mal.filter((a: any) => a.malformed === 'stray-close').length; }
  const off = reader(data, p.page_type), mine = reader(text, p.page_type);
  const d = diffWordsWithSpace(off, mine);
  const changed = d.filter((x) => x.added || x.removed).reduce((s, x) => s + x.value.trim().split(/\s+/).filter(Boolean).length, 0);
  if (changed) S.reader_diff.differ++; else S.reader_diff.equal++;
  rows.push({ p, book: books.get(p.book_id), split, stored, present, changed, d, malformed: mal.length, orphans, unres, conservation: c });
}

// ---------- spot-check sheet ----------
const rand = mulberry32(5942);
const shuffled = [...rows].sort((a, b) => (a.p.id < b.p.id ? -1 : 1));
for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
const picks: Array<{ why: string; r: any }> = [];
const seen = new Set<string>();
const add = (why: string, r: any) => { if (r && !seen.has(r.p.id)) { seen.add(r.p.id); picks.push({ why, r }); } };
for (const r of shuffled.slice(0, 20)) add('random (seed 5942)', r);
add('most annotations', [...rows].sort((a, b) => b.stored.length - a.stored.length)[0]);
for (const r of rows.filter((x) => x.split.annotations.some((a: any) => a.malformed === 'unclosed'))) add('unclosed tag', r);
for (const r of rows.filter((x) => x.malformed && !x.split.annotations.some((a: any) => a.malformed === 'unclosed')).slice(0, 3)) add('stray close tag', r);
for (const r of [...rows].sort((a, b) => b.changed - a.changed).slice(0, 3)) add(`text vs today's notes-off reader: ${r.changed} words differ`, r);
for (const k of Object.keys(SCRIPTS)) add(`script: ${k}`, rows.find((x) => x.present.includes(k)));
for (const r of rows.filter((x) => x.orphans || x.unres)) add('orphaned / unresolved anchor', r);
add('longest page', [...rows].sort((a, b) => b.p.translation.data.length - a.p.translation.data.length)[0]);
for (const r of rows.filter((x) => x.conservation.lost.length || x.conservation.leaked.length).slice(0, 5)) add('word ledger not even', r);

const CAP = 2500;
const cap = (s: string) => (s.length > CAP ? `${s.slice(0, CAP)}\n… [${s.length - CAP} more characters]` : s);
const fence = (s: string) => '````text\n' + cap(s).replace(/````/g, '``‵`') + '\n````';
const cell = (s: string | null | undefined, n = 140) => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, n);
let md = '';
picks.forEach(({ why, r }, i) => {
  const { p, book, stored, d } = r;
  const slug = book?.slug || p.book_id;
  md += `\n### ${i + 1}. ${cell(book?.title, 90)} — p. ${p.page_number} (${why})\n\n`;
  md += `https://sourcelibrary.org/book/${slug}/page/${p.id} · language ${book?.language ?? '?'} · prompt v${String(p.translation.prompt_version ?? '?').replace(/^v/i, '')} · ${p.translation.data.length} chars stored, ${p.translation.text.length} in text · ${stored.length} annotations · scripts: ${r.present.join(', ') || 'Latin only'}\n\n`;
  md += `**Raw \`translation.data\`**\n\n${fence(p.translation.data)}\n\n**Clean \`translation.text\`**\n\n${fence(p.translation.text)}\n\n`;
  if (stored.length) {
    md += `**Annotations** (${stored.length})\n\n| # | type | kind | anchor phrase (exact) | body |\n|---|---|---|---|---|\n`;
    stored.slice(0, 40).forEach((a: any, k: number) => { md += `| ${k + 1} | ${a.type}${a.malformed ? ` (${a.malformed})` : ''} | ${a.kind} | ${a.exact === undefined ? (a.scope === 'page' ? '*page*' : '—') : `“${cell(a.exact, 80)}”`} | ${cell(a.body)} |\n`; });
    if (stored.length > 40) md += `\n… ${stored.length - 40} more\n`;
  } else md += '**Annotations:** none\n';
  const parts = d.filter((x: any) => x.added || x.removed);
  md += `\n**Against today's notes-off reader** (word diff, \`[-reader only-]\` \`{+text only+}\`): ${parts.length ? '' : 'identical'}\n`;
  if (parts.length) md += '\n' + fence(parts.slice(0, 30).map((x: any) => (x.added ? `{+${x.value.trim()}+}` : `[-${x.value.trim()}-]`)).join('\n')) + '\n';
});
fs.writeFileSync(`${OUT}.json`, JSON.stringify(S, null, 1));
fs.writeFileSync(`${OUT}.md`, md);
console.log(JSON.stringify(S, null, 1));
console.log(`spot-check entries: ${picks.length}`);
await client.close();
