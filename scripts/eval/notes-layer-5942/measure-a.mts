// PRIOR ART: scripts/eval/notes-layer/measure-parser.mts (#5942 phase 2) — round trip of parseTranslationLayers
// through prepareNotesMarkdown on 800 translations. This one measures scripts/lib/annotation-layer.mjs the same way,
// on OCR as well, against that parser on the same pages, and adds what neither measured: malformed tags as
// annotations, and whether an anchor survives the page's NEXT stored version (page_revisions).
/**
 * #5942 Part A — $0, no database, no model. Reads the draws written by draw.mjs.
 *
 *   node node_modules/.bin/tsx scripts/eval/notes-layer-5942/measure-a.mts
 *
 * Writes scripts/eval/results/notes-layer-5942/part-a.json (committed) and $JOB_SCRATCH/a/survival.jsonl,
 * $JOB_SCRATCH/a/by-eye.md (the cases to read by eye; they quote page text, so not committed).
 */
import fs from 'node:fs';
import { diffWordsWithSpace } from 'diff';
import { alignment, truthOf, classify } from './align.mjs';
import { splitAnnotations, renderInline, renderMarkup, resolveAnchor } from '../../lib/annotation-layer.mjs';
import * as TL from '@/lib/translation-layers';
import * as NR from '@/components/reader/NotesRenderer';

// tsx loads these TS modules as CommonJS: the named exports sit on `default`.
const { parseTranslationLayers } = ((TL as any).parseTranslationLayers ? TL : (TL as any).default) as typeof TL;
const { prepareNotesMarkdown } = ((NR as any).prepareNotesMarkdown ? NR : (NR as any).default) as typeof NR;

const W = `${process.env.JOB_SCRATCH}/a`;
const R = new URL('../results/notes-layer-5942/', import.meta.url).pathname;
const squash = (t: string) => t.replace(/\s+/g, ' ').trim();
const reader = (t: string, showNotes: boolean, pageType?: string) => prepareNotesMarkdown(t, { showNotes, pageType }).processedText;
const tally = (o: Record<string, number>, k: string, n = 1) => { o[k] = (o[k] || 0) + n; };
const load = (f: string) => fs.readFileSync(`${W}/${f}.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/**
 * Why the split text and today's notes-off reader differ:
 *   spacing — the same characters but whitespace;
 *   today shows commentary — every word only today has is a word of a note/definition this split lifted
 *     (a note nested in a page mark, which the reader flattens into the mark; a gloss after a term; an unclosed chip);
 *   text keeps words today drops — the split keeps words the reader deletes (a heading kept as term + gloss, a lone list);
 *   other — read by eye.
 */
function diffClass(today: string, mine: string, anns: any[]) {
  if (today.replace(/\s+/g, '') === mine.replace(/\s+/g, '')) return 'spacing';
  const words = (t: string) => (t.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  const onlyToday: string[] = [], onlyMine: string[] = [];
  for (const part of diffWordsWithSpace(mine, today)) {
    if (part.added) onlyToday.push(...words(part.value));
    else if (part.removed) onlyMine.push(...words(part.value));
  }
  const commentary = new Set(words(anns.filter((a) => a.kind === 'commentary').map((a) => `${a.body ?? ''} ${a.term ?? ''}`).join(' ')));
  if (!onlyMine.length && onlyToday.length && onlyToday.every((w) => commentary.has(w))) return 'today shows commentary words';
  if (!onlyToday.length && onlyMine.length) return 'text keeps words today drops';
  if (onlyToday.every((w) => commentary.has(w)) && onlyMine.length <= 2) return 'today shows commentary words (+ spacing)';
  return 'other';
}

function summarize(field: 'translation' | 'ocr') {
  const pages = load(field);
  const S: any = {
    field, pages: pages.length, pages_with_annotations: 0, pages_with_commentary: 0, pages_with_malformed: 0,
    by_type: {}, by_kind: {}, malformed: {}, malformed_by_tag: {},
    inline_byte_exact: 0, term_definitions_lifted_pages: 0,
    text_vs_reader_notes_off: { equal: 0, differs: 0 }, markup_from_layers_vs_reader: { notes_on_equal: 0, notes_off_equal: 0, orphans: 0 },
    own_text_anchor: {}, phrase_occurrences: { once: 0, more: 0, point: 0 },
    vs_translation_layers: { compared: 0, text_equal: 0, ts_inexact: 0, annotation_count_equal: 0 },
  };
  const diffs: any[] = [];
  for (const p of pages) {
    const s = splitAnnotations(p.data, { source: `inline-v${p.prompt_version ?? 'unknown'}` });
    if (renderInline(s) === p.data) S.inline_byte_exact++;
    if (s.termDefinitionsLifted) S.term_definitions_lifted_pages++;
    if (s.annotations.length) S.pages_with_annotations++;
    if (s.annotations.some((a: any) => a.kind === 'commentary' && !a.malformed)) S.pages_with_commentary++;
    if (s.annotations.some((a: any) => a.malformed)) S.pages_with_malformed++;
    for (const a of s.annotations as any[]) {
      if (a.malformed) { tally(S.malformed, a.malformed); tally(S.malformed_by_tag, `${a.malformed}:${a.tag || a.type}`); continue; }
      tally(S.by_type, a.type); tally(S.by_kind, a.kind);
      if (a.anchor) {
        const r = resolveAnchor(s.text, a.anchor);
        tally(S.own_text_anchor, r ? (r.start === a.anchor.start ? r.how : `${r.how}-moved`) : 'null');
        if (a.kind === 'commentary') {
          if (!a.anchor.exact) S.phrase_occurrences.point++;
          else if (s.text.split(a.anchor.exact).length === 2) S.phrase_occurrences.once++;
          else S.phrase_occurrences.more++;
        }
      } else if (a.kind !== 'page') tally(S.own_text_anchor, 'no-anchor');
    }
    const off = squash(reader(p.data, false, p.page_type)), mine = squash(reader(s.text, false, p.page_type));
    if (off === mine) S.text_vs_reader_notes_off.equal++;
    else {
      S.text_vs_reader_notes_off.differs++;
      const cls = diffClass(off, mine, s.annotations);
      tally((S.notes_off_diff_class ||= {}), cls);
      diffs.push({ page_id: p.page_id, field, cls, today: off.slice(0, 4000), text: mine.slice(0, 4000) });
    }
    const { markup, orphans } = renderMarkup(s.text, s.annotations);
    S.markup_from_layers_vs_reader.orphans += orphans.length;
    if (squash(reader(markup, true, p.page_type)) === squash(reader(p.data, true, p.page_type))) S.markup_from_layers_vs_reader.notes_on_equal++;
    if (squash(reader(markup, false, p.page_type)) === off) S.markup_from_layers_vs_reader.notes_off_equal++;
    if (field === 'translation') {
      const t = parseTranslationLayers(p.data, { promptVersion: p.prompt_version });
      S.vs_translation_layers.compared++;
      if (!t.exact) S.vs_translation_layers.ts_inexact++;
      const tsText = t.text.replace(/<\/?(?:term|margin|gloss|insert|unclear)(?:\s[^>]*)?>/gi, '');
      if (squash(tsText) === squash(s.text)) S.vs_translation_layers.text_equal++;
      const mineN = s.annotations.filter((a: any) => a.kind === 'commentary' && !a.malformed).length;
      if (t.exact && t.annotations.length === mineN) S.vs_translation_layers.annotation_count_equal++;
    }
  }
  return { S, diffs, pages };
}

function survival(pages: any[], field: string) {
  const out: any[] = [];
  const T: any = { field, pages_with_history: 0, pairs: 0, pairs_text_unchanged: 0, pairs_with_anchors: 0, by_band: {} };
  for (const p of pages) {
    if (!p.revisions?.length) continue;
    T.pages_with_history++;
    const versions = [...p.revisions.map((r: any) => ({ data: r.data, source: r.source ?? null, at: r.created_at })), { data: p.data, source: p.source ?? null, at: 'current' }];
    for (let k = 0; k + 1 < versions.length; k++) {
      const a = splitAnnotations(versions[k].data), b = splitAnnotations(versions[k + 1].data);
      T.pairs++;
      if (a.text === b.text) { T.pairs_text_unchanged++; continue; }
      const anchored = (a.annotations as any[]).filter((x) => x.anchor && !x.malformed && (x.kind === 'commentary' || x.kind === 'mark'));
      if (!anchored.length) continue;
      T.pairs_with_anchors++;
      const { map, similarity } = alignment(a.text, b.text);
      const band = similarity >= 0.8 ? 'edit (≥0.8 kept)' : similarity >= 0.4 ? 'partial (0.4–0.8)' : 'rewrite (<0.4)';
      const bt = (T.by_band[band] ||= { pairs: 0, commentary: {}, mark: {} });
      bt.pairs++;
      for (const x of anchored) {
        const truth = truthOf(map, x.anchor);
        const r = resolveAnchor(b.text, x.anchor);
        const cls = classify(r, truth);
        tally(bt[x.kind], cls);
        out.push({ page_id: p.page_id, field, k, band, similarity: Math.round(similarity * 1000) / 1000, src_old: versions[k].source, src_new: versions[k + 1].source, kind: x.kind, type: x.type, cls, how: r?.how ?? null,
          exact: x.anchor.exact, prefix: x.anchor.prefix, suffix: x.anchor.suffix, body: x.body?.slice(0, 300) ?? null,
          new_ctx: r ? b.text.slice(Math.max(0, r.start - 60), r.start) + '⟦' + b.text.slice(r.start, r.end) + '⟧' + b.text.slice(r.end, r.end + 60) : null,
          truth_ctx: truth ? b.text.slice(Math.max(0, truth[0] - 60), truth[0]) + '⟦' + b.text.slice(truth[0], truth[1]) + '⟧' + b.text.slice(truth[1], truth[1] + 60) : null });
      }
    }
  }
  return { T, out };
}

const result: any = { date: new Date().toISOString().slice(0, 10), seed: 5942 };
const allSurv: any[] = [];
const allDiffs: any[] = [];
for (const field of ['translation', 'ocr'] as const) {
  const { S, diffs, pages } = summarize(field);
  const { T, out } = survival(pages, field);
  result[field] = { ...S, survival: T };
  allSurv.push(...out);
  allDiffs.push(...diffs);
}
fs.mkdirSync(R, { recursive: true });
fs.writeFileSync(`${R}part-a.json`, JSON.stringify(result, null, 2) + '\n');
fs.writeFileSync(`${W}/survival.jsonl`, allSurv.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(`${W}/notes-off-diffs.jsonl`, allDiffs.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify(result, null, 1));
