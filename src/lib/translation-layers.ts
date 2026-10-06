/**
 * Split a stored translation into the book's words and the machine's commentary (#5942 phase 2).
 *
 * PRIOR ART: src/lib/notes-off.ts — decides what disappears when a reader turns notes off, and
 * src/lib/term-definitions.ts — decides which `<term>`/`<gloss>` content is the model's own
 * definition. Both answer "what is commentary?" by REMOVING it from a string; neither says where
 * it stood or what it was attached to, so nothing can store the two layers apart. This module calls
 * them (it never restates their regexes) and adds only the bookkeeping: positions, anchors, types.
 * src/lib/normalize-annotation-spans.ts gives the balanced, non-nested spans the scan relies on.
 *
 * `parseTranslationLayers(markup)` returns
 *
 *   - `text`: the page as the reader shows it with notes off, except that page marks (`<margin>`,
 *     a `<gloss>` printed in the source, `<insert>`, `<unclear>`) and `<term>` chips keep their
 *     tags — they are transcription. It is `stripAiAnnotations` applied to the page, so the spacing
 *     around a removed note is whatever notes-off already produces.
 *   - `annotations[]`: one per `<note>` / `<image-desc>`, each `{ type, anchor, body, source }`.
 *   - `pageLevel[]`: the model's page-level housekeeping (`<summary>`, `<keywords>`, `<meta>`),
 *     which is machine text with no phrase to attach to.
 *
 * `renderTranslationLayers(layers, { notes: true })` rebuilds the inline markup the reader's
 * pipeline takes today; `{ notes: false }` is `text` alone. Nothing here writes anywhere.
 *
 * Not handled, on purpose: single `[brackets]` (the translator's supplied words) stay in `text`
 * with their brackets — they are part of the sentence, and the reader already marks or hides them.
 */

import { normalizeAnnotationSpans } from '@/lib/normalize-annotation-spans';
import { separateTermDefinitions } from '@/lib/term-definitions';
import { preprocessTerms, stripAiAnnotations } from '@/lib/notes-off';

export type AnnotationType = 'note' | 'definition' | 'gloss-model' | 'image' | 'original';

export interface AnnotationAnchor {
  /** The words in `text` the annotation attaches to; null when it stands alone (its own paragraph). */
  phrase: string | null;
  /** Where the phrase starts in `text`; for a null phrase, where the annotation stood. Null when the phrase is not in `text`. */
  offset: number | null;
  /** How many times the phrase occurs in `text`: 1 = resolves alone, >1 = needs the offset, 0 = not found. */
  occurrences: number;
}

/** What the inline form needs to be rebuilt byte for byte. A store that never renders inline can drop it. */
export interface InlineLayout {
  /** Insertion point in `text`, and the annotation's place in page order (shared with `pageLevel`). */
  at: number;
  order: number;
  /** Whitespace (or glossary-line punctuation) removed with the annotation, before and after it. */
  pre: string;
  post: string;
  /** The opening tag as written, when it is not the bare `<note>` / `<image-desc>`. */
  open?: string;
  /** A glossary-line entry: the term chip that was removed with its note, and the gap between them. */
  term?: string;
  gap?: string;
  /** Which glossary line the entry came from (its offset in the normalised page). */
  line?: number;
}

export interface TranslationAnnotation {
  type: AnnotationType;
  anchor: AnnotationAnchor;
  body: string;
  /** `inline-v<prompt_version>` for annotations parsed out of a stored translation. */
  source: string;
  layout: InlineLayout;
}

export interface PageLevelBlock {
  kind: 'summary' | 'keywords' | 'meta';
  body: string;
  source: string;
  layout: { at: number; order: number; raw: string };
}

export interface TranslationLayers {
  text: string;
  annotations: TranslationAnnotation[];
  pageLevel: PageLevelBlock[];
  /** False when the page could not be split position-for-position; `text` is then the notes-off text and the lists are empty. */
  exact: boolean;
  /** Why `exact` is false. */
  reason?: string;
}

type Kind = 'written' | 'chip' | 'gloss';

interface Cut {
  start: number;
  end: number;
  tag?: 'note' | 'image-desc';
  open?: string;
  body?: string;
  kind?: Kind;
  term?: string;
  gap?: string;
  page?: PageLevelBlock['kind'];
  /** An entry of a glossary line, with the line's own text around it (list marker, separators, the newline). */
  glossary?: boolean;
  line?: number;
  lead?: string;
  trail?: string;
}

// Private-use stand-ins, so the provenance of a `<note>` survives `separateTermDefinitions`
// (which only ever writes the literal `<note>`). They keep the leading `<`, so its `[^<]` classes
// stop at them exactly as they stop at the real tag.
const WRITTEN_OPEN = '<\uE000n>';
const WRITTEN_CLOSE = '<\uE000/n>';
const CHIP_OPEN = '<\uE001n>';
const CHIP_CLOSE = '<\uE001/n>';
const GLOSS_MASK = '<\uE002gloss';

/**
 * `separateTermDefinitions`, run so that each resulting `<note>` is known to be one the model
 * wrote as a note, a definition lifted out of a `<term>` chip, or a `<gloss>` after a term.
 * Returns null if the staged run does not give the same string as the plain call.
 */
function separateWithProvenance(normalized: string): { canonical: string; kinds: Kind[] } | null {
  if (/[-]/.test(normalized)) return null;
  const canonical = separateTermDefinitions(normalized);
  // Stage 1: hide the notes already there and every gloss, so only chip definitions become <note>.
  const hidden = normalized
    .replace(/<note>/gi, WRITTEN_OPEN).replace(/<\/note>/gi, WRITTEN_CLOSE)
    .replace(/<gloss/gi, GLOSS_MASK);
  const chips = separateTermDefinitions(hidden)
    .replace(/<note>/g, CHIP_OPEN).replace(/<\/note>/g, CHIP_CLOSE)
    .split(GLOSS_MASK).join('<gloss');
  // Stage 2: with glosses back, the only new <note>s are glosses that followed a term.
  const staged = separateTermDefinitions(chips);
  const kinds: Kind[] = [];
  const restored = staged.replace(/<(?:note|\uE000n|\uE001n)>|<(?:\/note|\uE000\/n|\uE001\/n)>/g, (tag) => {
    if (tag.includes('/')) return '</note>';
    kinds.push(tag === WRITTEN_OPEN ? 'written' : tag === CHIP_OPEN ? 'chip' : 'gloss');
    return '<note>';
  });
  return restored === canonical ? { canonical, kinds } : null;
}

const SPAN_OPEN = /<(note|image-desc)((?:\s[^>]*)?)>/gi;
const SPAN_CLOSE = { note: /<\/note>/gi, 'image-desc': /<\/image-desc>/gi };
const PAGE_BLOCK = /<(summary|keywords|meta)>([\s\S]*?)<\/\1>/gi;

/** The commentary spans of a normalised page: `<note>` and `<image-desc>`, open tag to its first close. */
function scanSpans(text: string): Cut[] {
  const cuts: Cut[] = [];
  SPAN_OPEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPAN_OPEN.exec(text)) !== null) {
    const tag = m[1].toLowerCase() as 'note' | 'image-desc';
    // Matched in place, never on a lower-cased copy: "İ".toLowerCase() is two characters long.
    const closeRe = SPAN_CLOSE[tag];
    closeRe.lastIndex = SPAN_OPEN.lastIndex;
    const close = closeRe.exec(text);
    if (!close) break;
    const end = close.index + close[0].length;
    cuts.push({ start: m.index, end, tag, open: m[0], body: text.slice(SPAN_OPEN.lastIndex, close.index) });
    SPAN_OPEN.lastIndex = end;
  }
  return cuts;
}

/** A line notes-off drops whole: nothing but `<term>` + `<note>` pairs. `preprocessTerms` is the judge. */
const isGlossaryLine = (line: string) => line.trim() !== '' && /<note>/i.test(line) && preprocessTerms(line) === '';

function classify(cut: Cut, textBefore: string): AnnotationType {
  if (cut.tag === 'image-desc') return 'image';
  if (cut.kind === 'gloss') return 'gloss-model';
  if (/^\s*original\s*:/i.test(cut.body || '')) return 'original';
  if (cut.kind === 'chip' || cut.glossary || /<\/term>[ \t]*$/i.test(textBefore)) return 'definition';
  return 'note';
}

function countOccurrences(text: string, phrase: string): number {
  let n = 0;
  for (let i = text.indexOf(phrase); i !== -1; i = text.indexOf(phrase, i + 1)) n++;
  return n;
}

/** Longest run of words an anchor phrase may take from the text before a note. */
const MAX_ANCHOR_WORDS = 12;
const MIN_ANCHOR_WORDS = 3;

/**
 * The phrase an annotation attaches to. A note after a `<term>` chip attaches to the term (and
 * one after a page mark to the marked words). Any
 * other inline note attaches to the words just before it on the same line (never across a tag),
 * taking as many as it needs — 3 to 12 — to be the only such run on the page. A note with no words
 * before it on its line stands alone.
 */
function anchorFor(text: string, at: number, glossaryTerm?: string): AnnotationAnchor {
  if (glossaryTerm != null) {
    // A glossary entry names its word; the word is in the sentence above, possibly capitalised.
    const phrase = glossaryTerm.trim();
    if (!phrase) return { phrase: null, offset: at, occurrences: 0 };
    const exact = countOccurrences(text, phrase);
    if (exact) return { phrase, offset: text.indexOf(phrase), occurrences: exact };
    const folded = text.toLowerCase();
    const occurrences = folded.length === text.length ? countOccurrences(folded, phrase.toLowerCase()) : 0;
    return { phrase, offset: occurrences ? folded.indexOf(phrase.toLowerCase()) : null, occurrences };
  }
  const before = text.slice(0, at);
  // Straight after a chip on the same line — a term, or a page mark — the note is about what the
  // chip holds. A note in its own paragraph is not, whatever the paragraph above ended with.
  const chip = before.match(/<(term|unclear|margin|gloss|insert)>([^<]*)<\/\1>[ \t]*$/i);
  if (chip && chip[2].trim()) {
    const phrase = chip[2].trim();
    const offset = chip.index! + chip[0].indexOf(phrase, chip[1].length + 2);
    return { phrase, offset, occurrences: countOccurrences(text, phrase) };
  }
  // Words before the note on its own line, back to the nearest tag. Layout markers are not words:
  // a heading's "#", the "->" and "<-" of a centred line.
  const line = before.slice(before.lastIndexOf('\n') + 1);
  const run = line.slice(line.lastIndexOf('>') + 1).replace(/(?:<-|[\s*_,;:.!?"'’”)\]])+$/, '');
  const words = [...run.matchAll(/\S+/g)].filter(w => !/^(?:#+|->|<-)$/.test(w[0]));
  if (words.length === 0) return { phrase: null, offset: at, occurrences: 0 };
  const runStart = at - line.length + line.lastIndexOf('>') + 1;
  let take = Math.min(MIN_ANCHOR_WORDS, words.length);
  let phrase = run.slice(words[words.length - take].index);
  while (take < Math.min(MAX_ANCHOR_WORDS, words.length) && countOccurrences(text, phrase) > 1) {
    take++;
    phrase = run.slice(words[words.length - take].index);
  }
  return { phrase, offset: runStart + words[words.length - take].index!, occurrences: countOccurrences(text, phrase) };
}

const inexact = (markup: string, reason: string): TranslationLayers => ({
  text: stripAiAnnotations(separateTermDefinitions(normalizeAnnotationSpans(markup))),
  annotations: [],
  pageLevel: [],
  exact: false,
  reason,
});

export function parseTranslationLayers(
  markup: string,
  { promptVersion }: { promptVersion?: string | number | null } = {}
): TranslationLayers {
  if (!markup) return { text: markup || '', annotations: [], pageLevel: [], exact: true };
  // Stored prompt versions come as 13, "13" and "v10" alike.
  const source = `inline-v${String(promptVersion ?? 'unknown').replace(/^v/i, '')}`;

  // Legacy bracket syntax for the same thing (`[[notes: …]]`), as the reader converts it.
  const legacy = markup.replace(/\[\[(notes?):\s*([\s\S]*?)\]\]/gi, '<note>$2</note>');
  const staged = separateWithProvenance(normalizeAnnotationSpans(legacy));
  if (!staged) return inexact(markup, 'provenance staging disagrees with separateTermDefinitions');
  const { canonical, kinds } = staged;

  // A "glossary line" whose word appears nowhere else on the page is not a glossary: it is a
  // heading or a dictionary headword that happens to be a term and its gloss. Notes-off deletes
  // such a line today, the book's word with it. Here the word stays in the text and only the
  // note is lifted, so the split is tried once with every glossary line out and again without
  // the ones whose terms the text would lose.
  const first = splitCanonical(markup, canonical, kinds, source, new Set());
  if (!first.exact) return first;
  const lost = new Set<number>();
  const haystack = first.text.toLowerCase();
  for (const a of first.annotations) {
    if (a.layout.term === undefined || a.layout.line === undefined) continue;
    const word = a.layout.term.trim().toLowerCase();
    if (!word || !haystack.includes(word)) lost.add(a.layout.line);
  }
  return lost.size ? splitCanonical(markup, canonical, kinds, source, lost) : first;
}

function splitCanonical(markup: string, canonical: string, kinds: Kind[], source: string, keepLines: Set<number>): TranslationLayers {
  // 1. Everything that leaves the text, in page order.
  const allSpans = scanSpans(canonical);
  if (allSpans.filter(c => c.tag === 'note').length !== kinds.length) return inexact(markup, 'unbalanced <note> after normalisation');
  let k = 0;
  for (const c of allSpans) if (c.tag === 'note') c.kind = kinds[k++];

  const cuts: Cut[] = [];
  const glossary: Array<[number, number]> = [];
  let lineStart = 0;
  for (const line of canonical.split('\n')) {
    const lineEnd = lineStart + line.length;
    if (isGlossaryLine(line) && !keepLines.has(lineStart)) glossary.push([lineStart, lineEnd]);
    lineStart = lineEnd + 1;
  }
  const inGlossary = (at: number) => glossary.some(([s, e]) => at >= s && at < e);

  for (const [s, e] of glossary) {
    // The newline goes with the line: the one after it, or the one before when it is the last line.
    const cutEnd = e < canonical.length ? e + 1 : e;
    const cutStart = e < canonical.length || s === 0 ? s : s - 1;
    const spans = allSpans.filter(c => c.start >= s && c.end <= e);
    let cursor = cutStart;
    spans.forEach((span, n) => {
      // An entry is the term chip, the gap and the note; list markers and separators ride along.
      const lead = canonical.slice(cursor, span.start);
      const term = lead.match(/<term>([^\n]*?)<\/term>(\s*)$/i);
      const end = n === spans.length - 1 ? cutEnd : span.end;
      cuts.push({
        ...span, start: cursor, end, glossary: true, line: s,
        term: term ? term[1] : undefined, gap: term ? term[2] : undefined,
        lead: term ? lead.slice(0, term.index) : lead, trail: canonical.slice(span.end, end),
      });
      cursor = end;
    });
  }
  for (const span of allSpans) if (!inGlossary(span.start)) cuts.push(span);
  PAGE_BLOCK.lastIndex = 0;
  for (let m = PAGE_BLOCK.exec(canonical); m !== null; m = PAGE_BLOCK.exec(canonical)) {
    const start = m.index;
    const end = start + m[0].length;
    if (cuts.some(c => c.start <= start && c.end >= end)) continue; // inside a note or a glossary line: it stays there
    // A note written inside the block goes with the block.
    for (let n = cuts.length - 1; n >= 0; n--) if (cuts[n].start >= start && cuts[n].end <= end) cuts.splice(n, 1);
    if (cuts.some(c => start < c.end && end > c.start)) return inexact(markup, 'a page-level block overlaps a note');
    cuts.push({ start, end, page: m[1].toLowerCase() as PageLevelBlock['kind'], body: m[2] });
  }
  cuts.sort((a, b) => a.start - b.start);

  // 2. The text, as notes-off leaves it once glossary lines and page-level blocks are out.
  //    stripAiAnnotations decides the spacing; the walk below only finds where each cut landed.
  let withoutBlocks = '';
  let pos = 0;
  const events: Array<{ cut: Cut; start: number; end: number }> = [];
  for (const cut of cuts) {
    withoutBlocks += canonical.slice(pos, cut.start);
    const start = withoutBlocks.length;
    if (cut.tag && !cut.glossary) withoutBlocks += canonical.slice(cut.start, cut.end); // stripAiAnnotations removes it
    events.push({ cut, start, end: withoutBlocks.length });
    pos = cut.end;
  }
  withoutBlocks += canonical.slice(pos);
  const text = stripAiAnnotations(withoutBlocks);

  // 3. Walk both strings. Every character of `withoutBlocks` is kept, or inside a span, or
  //    whitespace that went with a cut: before it (`pre`) or after it (`post`).
  const placed: Array<{ cut: Cut; at: number; pre: string; post: string }> = [];
  let i = 0;
  let j = 0;
  let next = 0;
  let pending = '';
  let last: { post: string } | null = null;
  for (;;) {
    while (next < events.length && events[next].start === i) {
      const entry = { cut: events[next].cut, at: j, pre: pending, post: '' };
      placed.push(entry);
      last = entry;
      pending = '';
      i = events[next].end;
      next++;
    }
    if (i >= withoutBlocks.length) break;
    if (j < text.length && withoutBlocks[i] === text[j]) {
      // Kept. Past the next word, dropped whitespace no longer belongs to the cut behind it; and
      // whitespace dropped away from any cut (a blank-line run collapsed) is not ours to keep.
      if (!/\s/.test(text[j])) {
        pending = '';
        last = null;
      }
      i++;
      j++;
    } else if (/\s/.test(withoutBlocks[i])) {
      if (last) last.post += withoutBlocks[i];
      else pending += withoutBlocks[i];
      i++;
    } else {
      return inexact(markup, 'notes-off text does not align with the page');
    }
  }
  if (j !== text.length || next !== events.length) return inexact(markup, 'notes-off text does not align with the page');

  // 4. Annotations and page-level blocks, in page order, each with its place in `text`.
  const annotations: TranslationAnnotation[] = [];
  const pageLevel: PageLevelBlock[] = [];
  placed.forEach((e, order) => {
    const { cut } = e;
    if (cut.page) {
      const raw = e.pre + canonical.slice(cut.start, cut.end) + e.post;
      pageLevel.push({ kind: cut.page, body: (cut.body || '').trim(), source, layout: { at: e.at, order, raw } });
      return;
    }
    const layout: InlineLayout = { at: e.at, order, pre: e.pre + (cut.lead || ''), post: (cut.trail || '') + e.post };
    if (cut.open !== `<${cut.tag}>`) layout.open = cut.open;
    if (cut.term !== undefined) {
      layout.term = cut.term;
      layout.gap = cut.gap || '';
      layout.line = cut.line;
    }
    annotations.push({
      type: classify(cut, text.slice(0, e.at)),
      anchor: anchorFor(text, e.at, cut.glossary ? cut.term ?? '' : undefined),
      body: cut.body || '',
      source,
      layout,
    });
  });

  const layers: TranslationLayers = { text, annotations, pageLevel, exact: true };
  // The inline form must come back exactly, or the split is not trustworthy for this page.
  // (A collapsed blank-line run is the one thing allowed to differ: notes-off removes it too.)
  const squeeze = (t: string) => t.replace(/\n{3,}/g, '\n\n');
  if (squeeze(renderTranslationLayers(layers, { notes: true })) !== squeeze(canonical)) return inexact(markup, 'inline form does not rebuild');
  return layers;
}

/** The inline markup for the reader's pipeline: `text` alone, or `text` with every annotation back in place. */
export function renderTranslationLayers(layers: TranslationLayers, { notes }: { notes: boolean }): string {
  if (!notes || !layers.exact) return layers.text;
  const pieces = [
    ...layers.annotations.map(a => {
      const tag = a.type === 'image' ? 'image-desc' : 'note';
      const open = a.layout.open ?? `<${tag}>`;
      const term = a.layout.term !== undefined ? `<term>${a.layout.term}</term>${a.layout.gap ?? ''}` : '';
      return { at: a.layout.at, order: a.layout.order, raw: `${a.layout.pre}${term}${open}${a.body}</${tag}>${a.layout.post}` };
    }),
    ...layers.pageLevel.map(b => ({ at: b.layout.at, order: b.layout.order, raw: b.layout.raw })),
  ].sort((a, b) => a.order - b.order);
  let out = '';
  let pos = 0;
  for (const p of pieces) {
    out += layers.text.slice(pos, p.at) + p.raw;
    pos = p.at;
  }
  return out + layers.text.slice(pos);
}
