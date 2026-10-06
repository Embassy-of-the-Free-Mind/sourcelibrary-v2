// PRIOR ART: tests/unit/term-definitions.test.ts and tests/unit/notes-toggle-page-marks.test.ts call
// prepareNotesMarkdown on a handful of fixtures; nothing runs the reader's text pipeline over a corpus draw, and
// nothing compares two inputs to it. This does both for the #5942 parser, offline, from the saved draw.
/** #5942 phase 2: round trip, anchor resolution and inventory of parseTranslationLayers over the seeded draw. */
/**
 *   node node_modules/.bin/tsx scripts/eval/notes-layer/measure-parser.mts
 *
 * Reads results/notes-layer-2026-10/parser/work/pages.jsonl (draw-pages.mjs). Writes parser/results.json,
 * parser/per-page.jsonl and parser/diffs.jsonl. No database, no model.
 */
import fs from 'node:fs';
import { parseTranslationLayers, renderTranslationLayers } from '@/lib/translation-layers';
import { prepareNotesMarkdown } from '@/components/reader/NotesRenderer';

const DIR = new URL('../results/notes-layer-2026-10/parser/', import.meta.url).pathname;
const pages = fs.readFileSync(`${DIR}work/pages.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const squash = (t: string) => t.replace(/\s+/g, ' ').trim();
const context = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return { at: i, today: a.slice(Math.max(0, i - 70), i + 90), layers: b.slice(Math.max(0, i - 70), i + 90) }; };

/** Why two reader outputs differ, mildest first. Anything left as "content" is read by eye. */
function classify(today: string, mine: string): string {
  if (today === mine) return 'identical';
  if (today.trim() === mine.trim()) return 'edge-whitespace';
  const blank = (t: string) => t.replace(/\n{3,}/g, '\n\n').trim();
  if (blank(today) === blank(mine)) return 'blank-line-run';
  if (today.replace(/\s+/g, '') === mine.replace(/\s+/g, '')) return 'spacing-only';
  return 'content';
}

const rows: any[] = []; const diffs: any[] = [];
const tally = (o: Record<string, number>, k: string, n = 1) => { o[k] = (o[k] || 0) + n; };
const sum = { n: pages.length, exact: 0, inexact: {} as Record<string, number>, on: {} as Record<string, number>, off: {} as Record<string, number>, off_ws: {} as Record<string, number>,
  metadata_on_equal: 0, description_only_flag_differs: { on: 0, off: 0 }, annotations: 0, pages_with_annotations: 0, by_type: {} as Record<string, number>,
  anchors: {} as Record<string, Record<string, number>>, page_level: {} as Record<string, number>, pages_with_single_brackets: 0, pages_with_legacy_brackets: 0, by_prompt_version: {} as Record<string, any> };
for (const p of pages) {
  const pageType = p.page_type ?? undefined;
  const layers = parseTranslationLayers(p.data, { promptVersion: p.prompt_version });
  const today = { on: prepareNotesMarkdown(p.data, { showNotes: true, pageType }), off: prepareNotesMarkdown(p.data, { showNotes: false, pageType }) };
  const mine = { on: prepareNotesMarkdown(renderTranslationLayers(layers, { notes: true }), { showNotes: true, pageType }), off: prepareNotesMarkdown(renderTranslationLayers(layers, { notes: false }), { showNotes: false, pageType }) };
  const on = classify(today.on.processedText, mine.on.processedText); const off = classify(today.off.processedText, mine.off.processedText);
  if (layers.exact) sum.exact++; else tally(sum.inexact, layers.reason || 'unknown');
  tally(sum.on, on); tally(sum.off, off);
  if (JSON.stringify(today.on.metadata) === JSON.stringify(mine.on.metadata)) sum.metadata_on_equal++;
  if (today.on.isDescriptionOnly !== mine.on.isDescriptionOnly) sum.description_only_flag_differs.on++;
  if (today.off.isDescriptionOnly !== mine.off.isDescriptionOnly) sum.description_only_flag_differs.off++;
  sum.annotations += layers.annotations.length; if (layers.annotations.length) sum.pages_with_annotations++;
  const anchor = (a: any) => (a.anchor.phrase == null ? 'stands alone (no phrase)' : a.anchor.occurrences === 1 ? 'once' : a.anchor.occurrences > 1 ? 'more than once' : 'not found');
  for (const a of layers.annotations) { tally(sum.by_type, a.type); sum.anchors[a.type] ??= {}; tally(sum.anchors[a.type], anchor(a)); sum.anchors.all ??= {}; tally(sum.anchors.all, anchor(a)); }
  for (const b of layers.pageLevel) tally(sum.page_level, b.kind);
  const brackets = (layers.text.match(/(?<!\[)\[([^\[\]\n]{1,240})\](?!\]|\()/g) || []).filter((m) => !/^\[[\s.…·—–-]*\]$/.test(m)).length;
  if (brackets) sum.pages_with_single_brackets++;
  if (/\[\[(?:notes?|image|margin|gloss|term):/i.test(p.data)) sum.pages_with_legacy_brackets++;
  const v = String(p.prompt_version ?? 'none'); sum.by_prompt_version[v] ??= { pages: 0, annotations: 0, on_identical: 0, off_identical: 0 };
  const pv = sum.by_prompt_version[v]; pv.pages++; pv.annotations += layers.annotations.length; if (on === 'identical') pv.on_identical++; if (off === 'identical') pv.off_identical++;
  const types: Record<string, number> = {}; for (const a of layers.annotations) tally(types, a.type);
  rows.push({ book_id: p.book_id, page_number: p.page_number, prompt_version: p.prompt_version, page_type: p.page_type, chars: p.chars, text_chars: layers.text.length, exact: layers.exact, reason: layers.reason, on, off,
    annotations: layers.annotations.length, types, anchors_once: layers.annotations.filter((a) => a.anchor.occurrences === 1).length, anchors_no_phrase: layers.annotations.filter((a) => a.anchor.phrase == null).length, page_level: layers.pageLevel.map((b) => b.kind), single_brackets: brackets });
  for (const [mode, cls] of [['on', on], ['off', off]] as const) if (cls !== 'identical') diffs.push({ book_id: p.book_id, page_number: p.page_number, mode, class: cls, exact: layers.exact, reason: layers.reason, ...context(today[mode].processedText, mine[mode].processedText) });
}
const pct = (k: number) => Math.round((1000 * k) / pages.length) / 10;
const out = { generated: new Date().toISOString(), issue: 5942, measure: 'exact string comparison of the reader pipeline output (prepareNotesMarkdown.processedText), today against text + annotations', ...sum,
  pct: { exact: pct(sum.exact), on_identical: pct(sum.on.identical || 0), off_identical: pct(sum.off.identical || 0), off_identical_or_edge_ws: pct((sum.off.identical || 0) + (sum.off['edge-whitespace'] || 0)) } };
fs.writeFileSync(`${DIR}results.json`, JSON.stringify(out, null, 1));
fs.writeFileSync(`${DIR}per-page.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(`${DIR}diffs.jsonl`, diffs.map((r) => JSON.stringify(r)).join('\n') + (diffs.length ? '\n' : ''));
console.log(JSON.stringify({ ...out, by_prompt_version: undefined }, null, 1));
