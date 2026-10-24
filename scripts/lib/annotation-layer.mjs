/**
 * Text and annotations as two things (#5942): split a stored page's inline markup into the book's
 * words and a list of annotations, each anchored by the phrase it attaches to (W3C Web Annotation
 * TextQuoteSelector: exact + prefix + suffix, plus a TextPositionSelector start/end), and find an
 * anchor again in a text that has since been rewritten.
 *
 * PRIOR ART: src/lib/translation-layers.ts (#5958) splits stored TRANSLATIONS exactly, by running
 * the reader's own notes-off functions, and anchors a note by a phrase + one offset. It cannot be
 * reused for what this module is for: (1) it is TypeScript behind `@/` imports, so the .mjs eval
 * and pipeline scripts cannot call it; (2) on any unclosed tag it gives up (`exact: false`, no
 * annotations), where the question here is what a malformed page looks like as layers; (3) its
 * anchor has no prefix/suffix, so after a rewrite it cannot tell the same phrase in the same place
 * from the same phrase elsewhere, which is the whole risk once correction lanes rewrite stored text
 * (#7263, #5924); (4) its `text` keeps page-mark tags, so it is not plain text. The eval
 * (scripts/eval/notes-layer-5942/) measures the two against each other on the same pages.
 * scripts/lib/term-definitions.mjs is called, not restated (shape 1: a definition inside a chip).
 *
 * The model of a page:
 *   - `text`: the book's words only. No tag of the closed vocabulary (#3825) is left in it.
 *     Unknown tags (`<sup>`, `<column-break/>`, `<leaf-break/>` …) are layout and stay.
 *   - annotations, three kinds:
 *       commentary  `<note>`, `<image-desc>`, a `<gloss>` straight after a `<term>` (the model's
 *                   definition): removed from `text`, `body` kept, anchored to the phrase before it;
 *       mark        `<margin>`, `<gloss>` (printed), `<insert>`, `<unclear>`, `<term>`: the words are
 *                   transcription and stay in `text`; the annotation spans them (`body` null);
 *       page        `<summary>`, `<keywords>`, `<vocab>`, `<warning>`, `<meta>`, `<abbrev>` and the
 *                   page-data tags (`<page-type>`, `<folio>` …): no anchor, scope the page.
 *   - an UNCLOSED tag is an annotation flagged `malformed: 'unclosed'` with `body: null`; only the
 *     tag itself leaves the text, the words after it stay. `suspect` marks the stretch (to the end
 *     of its paragraph) that today's reader would have hidden. A stray close tag is
 *     `malformed: 'stray-close'`.
 *
 * Every removed piece of markup is kept verbatim in `inline` (where it stood in `text`), so
 * `renderInline(split)` gives back the input byte for byte. Offsets are UTF-16 code units (JS
 * string indices), not the code points the W3C spec counts.
 *
 * Pure: no I/O, no model, no database.
 */

import { splitInlineTermDefinitions } from './term-definitions.mjs';

export const COMMENTARY_TAGS = ['note', 'image-desc'];
export const MARK_TAGS = ['margin', 'gloss', 'insert', 'unclear', 'term'];
export const PAGE_TAGS = ['summary', 'keywords', 'vocab', 'warning', 'meta', 'abbrev'];
export const PAGE_DATA_TAGS = ['page-type', 'page-num', 'folio', 'sig', 'lang', 'language', 'script', 'scan-quality', 'columns', 'header', 'detected-images'];
const VOCAB = [...COMMENTARY_TAGS, ...MARK_TAGS, ...PAGE_TAGS, ...PAGE_DATA_TAGS];
const TAG_RE = new RegExp(`<(\\/?)(${VOCAB.map((t) => t.replace('-', '\\-')).join('|')})((?:\\s[^<>]*)?)>`, 'gi');
// Legacy bracket syntax the reader still reads: [[notes: …]], [[meta: …]] and friends.
const LEGACY_RE = /\[\[(notes?|meta|warning|language|page\s*number|folio|signature|abbrev|summary|keywords):\s*([\s\S]*?)\]\]/gi;

/** Context kept on each side of an anchor (characters). */
export const CONTEXT = 32;
const MAX_ANCHOR_WORDS = 12;
const MIN_ANCHOR_WORDS = 3;

// The glossary-line shape of src/lib/notes-off.ts `preprocessTerms` (TS, not importable here).
const GLOSSARY_LINE = /^[\s*\->#\d.]*(?:<term>[^\n]*?<\/term>\s*<note>[^\n]*?<\/note>[\s.,;:]*)+[\s*]*$/i;

const kindOf = (tag) => (COMMENTARY_TAGS.includes(tag) ? 'commentary' : MARK_TAGS.includes(tag) ? 'mark' : 'page');

/**
 * @param {string} markup a stored translation or OCR page
 * @param {{ source?: string, termDefinitions?: boolean }} [opts]
 *   source: provenance label for every annotation (e.g. `inline-v13`).
 *   termDefinitions: first lift a definition written inside a `<term>` chip into a `<note>`
 *   (term-definitions.mjs shape 1), as every reader surface does. Default true. When it fires,
 *   `renderInline` rebuilds the lifted form, not the stored one; `termDefinitionsLifted` says so.
 */
export function splitAnnotations(markup, { source = 'inline', termDefinitions = true } = {}) {
  let input = String(markup ?? '');
  let lifted = 0;
  if (termDefinitions && /<term>/i.test(input)) {
    const r = splitInlineTermDefinitions(input);
    lifted = r.n.split + r.n.head_dropped + r.n.apparatus;
    input = r.text;
  }
  const tokens = tokenize(input);
  /** @type {any[]} */
  const anns = [];
  // Pieces of markup that leave the text: [startInInput, endInInput, ann, role].
  /** @type {Array<{s:number,e:number,ann:any,role:string}>} */
  const cuts = [];

  // Glossary lines: nothing but `<term>` + `<note>` pairs, every term also in the page's text.
  // The whole line is the model's (notes-off deletes it); each entry becomes a definition
  // anchored to its word in the text. A line whose word is nowhere else is a headword: left alone.
  const glossaryEntries = [];
  {
    let at = 0;
    const lines = input.split('\n');
    const plain = lines.filter((l) => !GLOSSARY_LINE.test(l)).join('\n').replace(/<[^>]+>/g, '').toLowerCase();
    for (const line of lines) {
      const s = at, e = at + line.length;
      at = e + 1;
      if (!GLOSSARY_LINE.test(line)) continue;
      const entries = [...line.matchAll(/<term>([^\n]*?)<\/term>\s*<note>([^\n]*?)<\/note>/gi)].map((m) => ({ term: m[1], body: m[2] }));
      if (!entries.every((x) => x.term.trim() && plain.includes(x.term.trim().toLowerCase()))) continue;
      const anns2 = entries.map((x) => ({ type: 'definition', kind: 'commentary', tag: 'note', glossary: true, term: x.term.trim(), body: x.body, anchor: null, source }));
      anns.push(...anns2);
      glossaryEntries.push(...anns2);
      const end = e < input.length ? e + 1 : e;
      const start = e < input.length || s === 0 ? s : s - 1;
      cuts.push({ s: start, e: end, ann: anns2[0], role: 'whole', glossary: true });
      for (const t of tokens) if (t.start >= s && t.end <= e) t.consumed = true;
    }
  }
  const markStack = [];
  let lastClosedTerm = null; // token index of the last </term>, for gloss-after-term

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.consumed) continue;
    const kind = kindOf(t.name);
    if (t.close) {
      if (kind === 'mark') {
        const k = findLast(markStack, (m) => m.tok.name === t.name);
        if (k >= 0) {
          const m = markStack.splice(k, 1)[0];
          cuts.push({ s: t.start, e: t.end, ann: m.ann, role: 'close' });
          m.ann._closeAt = t.start;
          if (t.name === 'term') lastClosedTerm = { end: t.end, ann: m.ann };
          continue;
        }
      }
      const ann = { type: t.name, kind, malformed: 'stray-close', body: null, anchor: null, source };
      anns.push(ann);
      cuts.push({ s: t.start, e: t.end, ann, role: 'whole' });
      continue;
    }
    if (kind === 'mark') {
      // A <gloss> straight after a </term> is the model's definition of the term: commentary.
      const afterTerm = t.name === 'gloss' && lastClosedTerm && /^\s*$/.test(input.slice(lastClosedTerm.end, t.start));
      if (!afterTerm) {
        const ann = { type: t.name, kind, body: null, anchor: null, source, _open: t };
        anns.push(ann);
        markStack.push({ tok: t, ann });
        cuts.push({ s: t.start, e: t.end, ann, role: 'open' });
        continue;
      }
    }
    // Commentary and page blocks: the matching close of the same name, nesting counted.
    const j = matchClose(tokens, i);
    const type = t.name === 'gloss' ? 'definition' : t.name === 'image-desc' ? 'image' : PAGE_DATA_TAGS.includes(t.name) ? 'pagedata' : t.name;
    const k2 = t.name === 'gloss' ? 'commentary' : kind;
    if (j < 0) {
      const ann = { type, kind: k2, tag: t.name, malformed: 'unclosed', body: null, anchor: null, source };
      anns.push(ann);
      cuts.push({ s: t.start, e: t.end, ann, role: 'whole', unclosedAt: t.end });
      continue;
    }
    for (let x = i + 1; x <= j; x++) tokens[x].consumed = true;
    const close = tokens[j];
    const ann = { type, kind: k2, tag: t.name, body: input.slice(t.end, close.start), anchor: null, source };
    if (t.attrs.trim()) ann.attrs = t.attrs.trim();
    if (type === 'note' && /^\s*original\s*:/i.test(ann.body)) ann.type = 'original';
    if (type === 'note' && lastClosedTerm && /^[ \t]*$/.test(input.slice(lastClosedTerm.end, t.start))) { ann.type = 'definition'; ann._term = lastClosedTerm.ann; }
    if (type === 'definition') ann._term = lastClosedTerm.ann;
    anns.push(ann);
    cuts.push({ s: t.start, e: close.end, ann, role: 'whole' });
  }
  for (const m of markStack) m.ann.malformed = 'unclosed';

  // Legacy [[…]] blocks, outside any cut.
  for (const m of input.matchAll(LEGACY_RE)) {
    const s = m.index, e = s + m[0].length;
    if (cuts.some((c) => s < c.e && e > c.s)) continue;
    const label = m[1].toLowerCase().replace(/\s+/g, ' ');
    const type = /^notes?$/.test(label) ? 'note' : PAGE_TAGS.includes(label) ? label : 'pagedata';
    const ann = { type, kind: type === 'note' ? 'commentary' : 'page', tag: `[[${label}]]`, body: m[2], anchor: null, source };
    anns.push(ann);
    cuts.push({ s, e, ann, role: 'whole' });
  }
  cuts.sort((a, b) => a.s - b.s);

  // Whitespace that goes with a removed block, so `text` does not keep a hole.
  for (const c of cuts) {
    if (c.role !== 'whole' || c.ann.malformed || c.glossary) continue;
    const lineStart = c.s === 0 || input[c.s - 1] === '\n' || /\n[ \t]*$/.test(input.slice(0, c.s));
    const after = input.slice(c.e);
    const lineEnd = /^[ \t]*(\n|$)/.test(after);
    if (c.ann.kind === 'page' || (lineStart && lineEnd)) {
      // A block on its own line(s): take the line break(s) after it; at the end of the page, before it.
      const post = after.match(/^[ \t]*(?:\n[ \t]*)*/)[0];
      if (c.e + post.length < input.length) c.e += post.length;
      else { c.e += post.length; c.s -= input.slice(0, c.s).match(/\s*$/)[0].length; }
    } else {
      // Mid-line: the space before it, when punctuation or the line end follows (as notes-off does),
      // looking past the close tags of marks it sits inside.
      const pre = input.slice(0, c.s).match(/[ \t]+$/);
      const next = after.replace(/^(?:<\/(?:margin|gloss|insert|unclear|term)>)+/i, '');
      if (pre && /^(?:[ \t,.;:!?)\]]|\n|$)/.test(next)) c.s -= pre[0].length;
    }
  }
  // Overlaps after widening (two blocks sharing a line break): give the space to the first.
  for (let k = 1; k < cuts.length; k++) if (cuts[k].s < cuts[k - 1].e) cuts[k].s = Math.min(cuts[k - 1].e, cuts[k].e);

  // Build text, and the map from input offsets to text offsets.
  let text = '';
  let pos = 0;
  const inline = [];
  for (const c of cuts) {
    if (c.s < pos) continue;
    text += input.slice(pos, c.s);
    const raw = input.slice(c.s, c.e);
    inline.push({ at: text.length, raw, ann: c.ann, role: c.role });
    if (c.role === 'open') c.ann._openText = text.length;
    if (c.role === 'close') c.ann._closeText = text.length;
    if (c.role === 'whole') c.ann._at = text.length;
    pos = c.e;
  }
  text += input.slice(pos);
  // Whitespace left at the end of the page by blocks removed there goes with the first of them.
  const tail = text.match(/\s+$/);
  if (tail && inline.length && inline[inline.length - 1].at === text.length) {
    // Only the whitespace after the last piece that stands inside it (a mark's close tag) moves.
    let cut = text.length - tail[0].length;
    for (const p of inline) if (p.at > cut && p.at < text.length) cut = p.at;
    const w = text.slice(cut);
    if (w) {
      text = text.slice(0, cut);
      const first = inline.findIndex((p) => p.at === text.length + w.length);
      for (let k = first; k < inline.length; k++) inline[k].at = text.length;
      inline[first].raw = w + inline[first].raw;
      for (const a of anns) {
        for (const key of ['_openText', '_closeText', '_at']) if (a[key] > text.length) a[key] = text.length;
      }
    }
  }

  // Anchors.
  for (const a of anns) {
    if (a.kind === 'page' && !a.malformed) { a.scope = 'page'; continue; }
    if (a.kind === 'mark') {
      if (a.malformed === 'unclosed') { a.anchor = pointAnchor(text, a._openText); continue; }
      if (a.malformed) continue;
      a.anchor = spanAnchor(text, a._openText, a._closeText);
      continue;
    }
    if (a.malformed === 'stray-close') continue;
    if (a.glossary) {
      let i = text.indexOf(a.term);
      if (i < 0) i = text.toLowerCase().length === text.length ? text.toLowerCase().indexOf(a.term.toLowerCase()) : -1;
      a.anchor = i >= 0 ? spanAnchor(text, i, i + a.term.length) : null;
      a.attach = 'after';
      continue;
    }
    const at = a._at;
    if (a.malformed === 'unclosed') {
      a.anchor = pointAnchor(text, at);
      const para = text.slice(at).search(/\n[ \t]*\n/);
      a.suspect = { start: at, end: para < 0 ? text.length : at + para };
      continue;
    }
    if (a._term && a._term._openText != null && a._term._closeText != null && a._term._closeText > a._term._openText) {
      a.anchor = spanAnchor(text, a._term._openText, a._term._closeText);
    } else {
      a.anchor = phraseBefore(text, at);
      // What stands between the phrase and the note (a closing quote, `*`, a full stop): the note
      // goes after it again. Kept beside the anchor, not in it, so the phrase matches without it.
      const gap = a.anchor.end < at ? text.slice(a.anchor.end, at) : '';
      if (gap && gap.length <= 8 && !/\n/.test(gap)) a.gap = gap;
    }
    a.attach = 'after';
    if (a.body != null) a.body = a.body.trim();
  }
  const annotations = anns.map((a) => {
    const { _open, _openText, _closeText, _closeAt, _at, _term, ...rest } = a;
    return rest;
  });
  const layout = inline.map((p) => ({ at: p.at, raw: p.raw, ann: annotations[anns.indexOf(p.ann)], role: p.role }));
  return { text, annotations, inline: layout, termDefinitionsLifted: lifted };
}

/** The markup again: `text` with every removed piece put back where it stood. */
export function renderInline({ text, inline }) {
  let out = '';
  let pos = 0;
  for (const p of inline) {
    out += text.slice(pos, p.at) + p.raw;
    pos = p.at;
  }
  return out + text.slice(pos);
}

const FRONT_PAGE_TYPES = new Set(['meta', 'warning', 'pagedata']);

/**
 * Inline markup from `text` and the annotations alone — what a store that keeps the two apart
 * (and no layout) would hand the reader. Marks wrap their span; commentary follows its phrase,
 * one space before it; page-level blocks go first (meta, warning, page data) or last (summary,
 * keywords, vocab, abbrev). Each anchor is first resolved against `text`, so the same call works
 * on a rewritten text: an orphaned annotation is left out and counted in `orphans`.
 * @returns {{ markup: string, orphans: any[] }}
 */
export function renderMarkup(text, annotations) {
  const ins = []; // [at, order, string]
  const orphans = [];
  const front = [], back = [];
  annotations.forEach((a, order) => {
    if (a.malformed === 'stray-close') return;
    const open = a.tag && !a.tag.startsWith('[[') ? `<${a.tag}${a.attrs ? ' ' + a.attrs : ''}>` : `<${a.type}>`;
    const tag = a.tag && !a.tag.startsWith('[[') ? a.tag : a.type;
    if (a.glossary) { back.push(`<term>${a.term}</term> <note>${a.body ?? ''}</note>`); return; }
    if (a.scope === 'page') {
      (FRONT_PAGE_TYPES.has(a.type) ? front : back).push(`<${tag}>${a.body ?? ''}</${tag}>`);
      return;
    }
    const r = resolveAnchor(text, a.anchor);
    if (!r) { orphans.push(a); return; }
    if (a.kind === 'mark') {
      if (a.malformed) { ins.push([r.start, 1, order, `<${a.type}>`]); return; }
      ins.push([r.start, 2, order, `<${a.type}>`]);
      ins.push([r.end, 0, order, `</${a.type}>`]);
      return;
    }
    if (a.malformed) { ins.push([r.start, 1, order, open]); return; }
    const t = a.type === 'definition' ? (a.tag === 'gloss' ? 'gloss' : 'note') : tag;
    const at = a.gap && text.startsWith(a.gap, r.end) ? r.end + a.gap.length : r.end;
    const space = at > 0 && !/\s/.test(text[at - 1]) && r.start !== r.end ? ' ' : '';
    // A note that stood in its own paragraph gets its paragraph back.
    const block = r.start === r.end && (at === 0 || text[at - 1] === '\n') && at < text.length ? '\n\n' : '';
    ins.push([at, 1, order, `${space}${open.replace(/^<[\w-]+/, `<${t}`)}${a.body ?? ''}</${t}>${block}`]);
  });
  // Close tags first, then commentary, then open tags; page order within each.
  ins.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  let out = '';
  let pos = 0;
  for (const [at, , , s] of ins) {
    out += text.slice(pos, at) + s;
    pos = at;
  }
  out += text.slice(pos);
  const markup = [front.join('\n'), out, back.join('\n')].filter(Boolean).join('\n\n');
  return { markup, orphans };
}

function tokenize(s) {
  const out = [];
  TAG_RE.lastIndex = 0;
  for (let m = TAG_RE.exec(s); m; m = TAG_RE.exec(s)) {
    out.push({ start: m.index, end: m.index + m[0].length, close: m[1] === '/', name: m[2].toLowerCase(), attrs: m[3] || '' });
  }
  return out;
}

function matchClose(tokens, i) {
  const name = tokens[i].name;
  let depth = 0;
  for (let j = i + 1; j < tokens.length; j++) {
    if (tokens[j].consumed || tokens[j].name !== name) continue;
    if (!tokens[j].close) depth++;
    else if (depth === 0) return j;
    else depth--;
  }
  return -1;
}

function findLast(arr, f) {
  for (let i = arr.length - 1; i >= 0; i--) if (f(arr[i])) return i;
  return -1;
}

const count = (text, phrase) => {
  if (!phrase) return 0;
  let n = 0;
  for (let i = text.indexOf(phrase); i !== -1; i = text.indexOf(phrase, i + 1)) n++;
  return n;
};

/** A TextQuoteSelector + position for text[start, end). */
export function spanAnchor(text, start, end) {
  return { exact: text.slice(start, end), prefix: text.slice(Math.max(0, start - CONTEXT), start), suffix: text.slice(end, end + CONTEXT), start, end };
}
/** A zero-width anchor (a note that stands in its own paragraph): context only. */
export function pointAnchor(text, at) {
  return spanAnchor(text, at, at);
}

/**
 * The phrase a note attaches to: the words just before it on its line, 3 to 12 of them, as many
 * as it takes to occur once on the page (the rule of translation-layers.ts `anchorFor`). None
 * before it on the line: a point anchor.
 */
function phraseBefore(text, at) {
  const before = text.slice(0, at);
  const line = before.slice(before.lastIndexOf('\n') + 1);
  const run = line.replace(/(?:[\s*_,;:.!?"'’”)\]])+$/, '');
  const lineStart = at - line.length;
  const words = [...run.matchAll(/\S+/g)].filter((w) => !/^(?:#+|->|<-|[-*+]|\d+[.)])$/.test(w[0]));
  if (!words.length) return pointAnchor(text, at);
  let take = Math.min(MIN_ANCHOR_WORDS, words.length);
  const startOf = (k) => lineStart + words[words.length - k].index;
  const end = lineStart + run.length;
  while (take < Math.min(MAX_ANCHOR_WORDS, words.length) && count(text, text.slice(startOf(take), end)) > 1) take++;
  return spanAnchor(text, startOf(take), end);
}

// ---------- resolution ----------

const commonSuffix = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n; };
const commonPrefix = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };

/** How much of the anchor's context agrees with `text` around [s, e): characters, both sides. */
function contextScore(text, anchor, s, e) {
  const pre = anchor.prefix || '', suf = anchor.suffix || '';
  return commonSuffix(text.slice(Math.max(0, s - pre.length), s), pre) + commonPrefix(text.slice(e, e + suf.length), suf);
}

/** Folded form for the fuzzy pass: lower case, punctuation and markdown out, whitespace collapsed; with a map back. */
function fold(s) {
  let out = '';
  const map = [];
  let space = true;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (/[\s\p{P}*_#]/u.test(ch)) {
      if (!space) { out += ' '; map.push(i); space = true; }
      continue;
    }
    const low = ch.toLowerCase();
    for (const c of low) { out += c; map.push(i); }
    space = false;
  }
  map.push(s.length);
  return { out, map };
}

/** Minimum characters of agreeing context to accept a short or repeated phrase. */
const MIN_CONTEXT = 8;
/** A phrase this long that occurs exactly once is accepted on its own. */
const SELF_SUFFICIENT = 16;

function pick(text, anchor, hits, exactLen) {
  if (!hits.length) return null;
  const scored = hits.map(([s, e]) => ({ s, e, c: contextScore(text, anchor, s, e) })).sort((a, b) => b.c - a.c);
  const [best, second] = scored;
  if (scored.length === 1) return best.c >= MIN_CONTEXT || exactLen >= SELF_SUFFICIENT ? best : null;
  // Repeated: the context must choose, clearly.
  return best.c >= MIN_CONTEXT && best.c - second.c >= MIN_CONTEXT ? best : null;
}

/**
 * Find an anchor in `text` (which may have been rewritten since the anchor was made).
 * Returns { start, end, how } or null (the annotation is orphaned). It prefers no answer to a wrong
 * one: a phrase that occurs more than once must be chosen by its context, and a phrase that has
 * gone is never replaced by its neighbours.
 *   offset — the phrase is still at its recorded position, with agreeing context;
 *   quote  — the phrase is elsewhere, found by exact + prefix/suffix;
 *   fuzzy  — found after folding case, punctuation and spacing, or (4+ words) with one word in four changed.
 * @param {string} text
 * @param {{ exact: string, prefix?: string, suffix?: string, start?: number, end?: number } | null} anchor
 * @returns {{ start: number, end: number, how: 'offset'|'quote'|'fuzzy' } | null}
 */
export function resolveAnchor(text, anchor) {
  if (!anchor || text == null) return null;
  const exact = anchor.exact || '';
  const pre = anchor.prefix || '', suf = anchor.suffix || '';
  if (!exact) return resolvePoint(text, anchor);
  const n = exact.length;

  // 1. offset
  if (anchor.start != null && text.slice(anchor.start, anchor.start + n) === exact) {
    const c = contextScore(text, anchor, anchor.start, anchor.start + n);
    if (c >= Math.min(MIN_CONTEXT, pre.length + suf.length)) return { start: anchor.start, end: anchor.start + n, how: 'offset' };
  }
  // 2. quote
  const hits = [];
  for (let i = text.indexOf(exact); i !== -1; i = text.indexOf(exact, i + 1)) hits.push([i, i + n]);
  if (hits.length) {
    const b = pick(text, anchor, hits, n);
    return b ? { start: b.s, end: b.e, how: 'quote' } : null; // present but ambiguous: orphan, never a guess
  }
  // 3. fuzzy: folded exact match
  const ft = fold(text), fe = fold(exact).out.trim();
  if (fe.length >= 3) {
    const fhits = [];
    for (let i = ft.out.indexOf(fe); i !== -1; i = ft.out.indexOf(fe, i + 1)) {
      // whole words only
      if ((i > 0 && ft.out[i - 1] !== ' ') || (i + fe.length < ft.out.length && ft.out[i + fe.length] !== ' ')) continue;
      fhits.push([ft.map[i], ft.map[i + fe.length - 1] + 1]);
    }
    if (fhits.length) {
      const b = pick(text, anchor, fhits, fe.length);
      return b ? { start: b.s, end: b.e, how: 'fuzzy' } : null;
    }
  }
  // 4. fuzzy: word window, at most one word in four changed, context required on a side.
  const ew = fe.split(' ').filter(Boolean);
  if (ew.length >= 4) {
    const words = [...ft.out.matchAll(/\S+/g)];
    const allowed = Math.floor(ew.length / 4);
    const cands = [];
    for (let i = 0; i + ew.length <= words.length; i++) {
      let miss = 0;
      for (let k = 0; k < ew.length && miss <= allowed; k++) if (words[i + k][0] !== ew[k]) miss++;
      if (miss > allowed || miss === 0) continue;
      const fs = words[i].index, fe2 = words[i + ew.length - 1].index + words[i + ew.length - 1][0].length;
      cands.push([ft.map[fs], ft.map[fe2 - 1] + 1]);
    }
    if (cands.length) {
      const scored = cands.map(([s, e]) => ({ s, e, c: contextScore(text, anchor, s, e) })).sort((a, b) => b.c - a.c);
      const [best, second] = scored;
      if (best.c >= MIN_CONTEXT && (!second || best.c - second.c >= MIN_CONTEXT)) return { start: best.s, end: best.e, how: 'fuzzy' };
    }
  }
  return null;
}

/** A zero-width anchor: its prefix must end and its suffix begin at the same place. */
function resolvePoint(text, anchor) {
  const pre = anchor.prefix || '', suf = anchor.suffix || '';
  if (!pre && !suf) return text.length === 0 ? { start: 0, end: 0, how: 'offset' } : null;
  if (anchor.start != null && text.slice(Math.max(0, anchor.start - pre.length), anchor.start) === pre && text.slice(anchor.start, anchor.start + suf.length) === suf) {
    return { start: anchor.start, end: anchor.start, how: 'offset' };
  }
  const both = pre + suf;
  const at = [];
  for (let i = text.indexOf(both); i !== -1; i = text.indexOf(both, i + 1)) at.push(i + pre.length);
  if (at.length === 1) return { start: at[0], end: at[0], how: 'quote' };
  if (at.length > 1) return null;
  // Folded, both sides adjacent. The point goes where the suffix's words begin (back over any
  // punctuation or markdown that opens it, never over whitespace): folding drops those characters,
  // so the end of the prefix's last word is not the point (#5942 by-eye read: 10 of 26 landed early).
  const ft = fold(text);
  const fp = fold(pre).out.trim(), fs = fold(suf).out.trim();
  const back = (pos, floor) => { while (pos > floor && /[^\s\p{L}\p{N}]/u.test(text[pos - 1])) pos--; return pos; };
  if (!fp && fs.length >= 16) {
    // It stood at the very start of the text: only the start will do.
    return ft.out.startsWith(fs) ? { start: back(ft.map[0], 0), end: back(ft.map[0], 0), how: 'fuzzy' } : null;
  }
  if (!fs && fp.length >= 16) {
    return ft.out.endsWith(fp) ? { start: text.length, end: text.length, how: 'fuzzy' } : null;
  }
  if (fp && fs && fp.length + fs.length >= 16) {
    const key = `${fp} ${fs}`;
    const hits = [];
    for (let i = ft.out.indexOf(key); i !== -1; i = ft.out.indexOf(key, i + 1)) hits.push(i);
    if (hits.length === 1) {
      const prefixEnd = ft.map[hits[0] + fp.length - 1] + 1;
      const pos = back(ft.map[hits[0] + fp.length + 1], prefixEnd);
      return { start: pos, end: pos, how: 'fuzzy' };
    }
  }
  return null;
}
