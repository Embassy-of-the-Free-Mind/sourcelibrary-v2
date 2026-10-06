/**
 * Grounding checks on a finished Librarian answer (#5904).
 *
 * The answer has already streamed to the reader by the time this runs, so the
 * output is a list of EDITS — exact substrings of the streamed text and their
 * replacements — that the route applies to the persisted message and the
 * clients apply on screen (applyGroundingEdits in citation-fixes.ts), the same
 * round trip as citation_fixes and image_removals. Deterministic: no model
 * call, so it costs nothing and adds no latency to the turn.
 *
 * Four checks, all against the SUPPORT SET — the text of every page the
 * Librarian retrieved this turn, every page the answer cites, and every page
 * cited by an earlier answer in the thread (THREAD scope: on turn three the
 * Librarian may legitimately quote the page it read on turn one; a turn-scoped
 * set would strip that quote — the #4704 image-guard bug in another form):
 *
 *  1. Quotes. Text in quotation marks (3+ words) and blockquotes must occur on
 *     a support page, folded for case/diacritics/long-s and compared word by
 *     word, one ellipsis fragment at a time. A near-verbatim paraphrase (80% of
 *     its words on one page) is left alone. Anything else: an inline quote
 *     loses its quotation marks; a blockquote is removed with a visible note,
 *     because a blockquote under a page link asserts the page says it.
 *  2. Quantities. A number attached to a unit ("280 pounds", "twenty times an
 *     hour", "£10,000") must occur on a support page or in another tool result
 *     the model read (a catalogue count, a Wikipedia summary) or the question.
 *     Otherwise the sentence is dropped — there is no honest rewrite of a
 *     number nobody gave the model — or, when the paragraph cites nothing and
 *     matches no page, the whole paragraph, so nothing is left hanging on it.
 *     Years are not checked: dates of a life or an edition are general
 *     knowledge the prompt allows, and dropping them costs more than it saves.
 *  3. Uncited claims. A paragraph or list item stating facts (a number, a
 *     quote, a proper name past the sentence start) with no /book/ link gets
 *     the best-matching support page attached, when one matches clearly.
 *     When none does it is left as it is: general framing the prompt allows,
 *     and dropping it would leave answers full of holes.
 *  4. Captions. An embedded image the tools described (its own book, page,
 *     description) gets a caption that says what it is. A caption that does
 *     not name the image's own book, links a different book, or ties the
 *     picture to a name from the question that its own record never mentions
 *     (Khunrath's athanor captioned as Drebbel's oven) is replaced with one
 *     built from the image's own record. A missing caption is added.
 *
 * Uncheckable is not unsupported (measurement-instruments.md, #4777): when the
 * support text could not be loaded, or a quote is mostly in a non-Latin script
 * (folding and word boundaries are not trustworthy there), nothing is changed.
 *
 * PRIOR ART: src/lib/embassy/citation-fixes.ts (link repair + image removal,
 * the edit round trip this joins — it checks that links RESOLVE, not what the
 * text claims); scripts/lib/page-terms-parse.mjs verifyQuote (tiered quote
 * check for translation notes against one page's OCR — per-fragment ellipsis
 * handling kept here; its romanisation tier is not needed for answers, which
 * quote translations or Latin-script originals); src/lib/search-grounding.ts
 * (query-term grounding for search results — a different question: does an
 * item match a query, not does a page support a sentence). Folding reuses
 * normalizeNeedle from src/lib/align-text.ts.
 *
 * Client-safe: no server imports.
 */
import { normalizeNeedle } from '@/lib/align-text';
import { findCitedBookLinks } from '@/lib/embassy/citation-fixes';

export interface GroundingPage {
  bookId: string;
  bookSlug: string;
  bookTitle: string;
  page: number;
  /** Translation + original (+ localized) text of the page. */
  text: string;
}

export interface GroundingImage {
  url: string;
  bookId?: string;
  bookSlug?: string;
  /** Other slugs the same book answers to (old gallery slug, slug_aliases). */
  bookAliases?: string[];
  bookTitle: string;
  bookAuthor?: string;
  page?: number;
  type?: string;
  description?: string;
}

export type GroundingEditReason = 'attach_citation' | 'unquote' | 'drop_sentence' | 'drop_blockquote' | 'caption';

export interface GroundingEdit {
  /** Exact substring of the streamed text. Edits are in document order. */
  find: string;
  replace: string;
  reasons: GroundingEditReason[];
}

export interface GroundingReport {
  checkable: boolean;
  claimUnits: number;
  attached: number;
  uncitedLeft: number;
  quotesChecked: number;
  quotesUnquoted: number;
  blockquotesRemoved: number;
  quantitiesChecked: number;
  sentencesDropped: number;
  captionsChecked: number;
  captionsRewritten: number;
  /** What was removed or rewritten, for the monitoring trace. */
  details: string[];
}

export interface GroundingInput {
  text: string;
  pages: GroundingPage[];
  /**
   * False when the support text could not be loaded (a DB error): nothing is
   * judged then. An EMPTY page list is still checkable — a quote the model gave
   * after reading no page at all came from nowhere in the library.
   */
  supportLoaded: boolean;
  /** Other text the model read this turn (tool results) plus the question. Numbers and quotes found here are supported. */
  extraSupport?: string;
  images: GroundingImage[];
  question: string;
  /** `https://sourcelibrary.org` or `https://sourcelibrary.org/es`. */
  siteBase: string;
}

/**
 * Page citations whose text belongs in the support set: this turn's answer,
 * plus every EARLIER ASSISTANT answer in the thread. THREAD scope on purpose —
 * on turn three the Librarian may quote what it read and cited on turn one.
 * User messages are not a source of support (they are client-supplied and
 * cite nothing the Librarian read).
 */
export function supportCitations(
  text: string,
  history: Array<{ role: string; content: string }>,
): Array<{ slug: string; page: number }> {
  const out = new Map<string, { slug: string; page: number }>();
  const texts = [text, ...history.filter(m => m.role === 'assistant' && m.content).map(m => m.content)];
  for (const t of texts) {
    for (const c of findCitedBookLinks(t)) {
      if (c.page !== undefined) out.set(`${c.slug}:${c.page}`, { slug: c.slug, page: c.page });
    }
  }
  return [...out.values()];
}

// ── Text primitives ───────────────────────────────────────────────────

/** Folded word sequence: case, diacritics, ligatures, long-s, line-end hyphens. */
export function foldWords(s: string): string[] {
  return normalizeNeedle(s).match(/[\p{L}\p{N}]+/gu) ?? [];
}

const STOP = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'which', 'were', 'was', 'have', 'has', 'had', 'their', 'there',
  'they', 'them', 'than', 'then', 'into', 'onto', 'upon', 'also', 'such', 'been', 'being', 'would', 'could',
  'should', 'about', 'what', 'when', 'where', 'while', 'whose', 'these', 'those', 'other', 'more', 'most', 'only',
  'very', 'some', 'many', 'much', 'each', 'every', 'over', 'under', 'between', 'through', 'after', 'before',
  'because', 'will', 'shall', 'your', 'yours', 'here', 'just', 'like', 'even', 'well', 'often', 'known',
]);

const contentWords = (s: string) => [...new Set(foldWords(s).filter(w => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)))];

/** Markdown links → their text; bare URLs, image embeds and emphasis removed. */
export function plainText(s: string): string {
  return s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_`]+/g, '');
}

const BOOK_LINK = /(?<![\w.-])sourcelibrary\.org(?:\/es)?\/book\/[a-z0-9-]+/;

function isMostlyLatin(s: string): boolean {
  const letters = s.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return false;
  const latin = letters.filter(ch => /\p{Script=Latin}/u.test(ch)).length;
  return latin / letters.length >= 0.9;
}

interface SupportIndex {
  /** ` w1 w2 … ` per page, padded so a word sequence match respects boundaries. */
  pageSeqs: string[];
  pageSets: Array<Set<string>>;
  extraSeq: string;
  extraSet: Set<string>;
}

function buildIndex(pages: GroundingPage[], extra: string): SupportIndex {
  const pageWords = pages.map(p => foldWords(p.text));
  const extraWords = foldWords(extra);
  return {
    pageSeqs: pageWords.map(w => ` ${w.join(' ')} `),
    pageSets: pageWords.map(w => new Set(w)),
    extraSeq: ` ${extraWords.join(' ')} `,
    extraSet: new Set(extraWords),
  };
}

type QuoteVerdict = 'exact' | 'near' | 'unsupported';

function checkQuote(quote: string, idx: SupportIndex): QuoteVerdict {
  const frags = quote.split(/\s*(?:\.{3,}|…|\[\s*\.\.\.\s*\])\s*/)
    .map(f => foldWords(f))
    .filter(f => f.length >= 2 || (f.length === 1 && f[0].length >= 5));
  if (frags.length === 0) return 'exact';
  const seqs = [...idx.pageSeqs, idx.extraSeq];
  if (frags.every(f => seqs.some(s => s.includes(` ${f.join(' ')} `)))) return 'exact';
  const words = [...new Set(frags.flat().filter(w => w.length >= 3))];
  if (words.length === 0) return 'exact';
  const sets = [...idx.pageSets, idx.extraSet];
  if (sets.some(set => words.filter(w => set.has(w)).length / words.length >= 0.8)) return 'near';
  return 'unsupported';
}

// ── Numbers ───────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};
const WORD_FOR: Record<number, string> = Object.fromEntries(Object.entries(NUMBER_WORDS).map(([w, n]) => [n, w]));

const UNITS = [
  'pounds?', 'lbs?', 'feet', 'foot', 'inch(?:es)?', 'ells?', 'miles?', 'leagues?', 'yards?', 'paces?', 'fathoms?',
  'ounces?', 'grains?', 'drachms?', 'drams?', 'scruples?', 'degrees?', 'times', 'hours?', 'minutes?', 'days?',
  'nights?', 'weeks?', 'months?', 'sous', 'livres?', 'florins?', 'ducats?', 'crowns?', 'guilders?', 'thalers?',
  'shillings?', 'pence', 'guineas?', 'percent', 'per cent', 'men', 'people', 'persons', 'copies', 'stages',
  'steps', 'processes', 'samskaras', 'operations', 'gallons?', 'pints?', 'quarts?', 'barrels?', 'tons?',
  'books', 'volumes', 'editions', 'works', 'treatises', 'manuscripts',
];
const NUM_TOKEN = `(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?|${Object.keys(NUMBER_WORDS).join('|')})`;
const QUANTITY = new RegExp(
  `(?:[£$€]\\s?${NUM_TOKEN})|(?:\\b${NUM_TOKEN}(?:\\s+(?:and\\s+)?(?:a\\s+)?[\\p{L}-]+){0,2}?\\s+(?:${UNITS.join('|')})\\b)|(?:\\b${NUM_TOKEN}\\s?%)`,
  'giu',
);

/** Unit-bearing numbers in a sentence (years and page references are not quantities). */
export function quantitiesIn(sentence: string): string[] {
  const plain = plainText(sentence).replace(/["“«][^"”»]*["”»]/g, ' ');
  const out: string[] = [];
  for (const m of plain.matchAll(QUANTITY)) {
    const tok = (m[1] ?? m[2] ?? m[3])?.toLowerCase();
    if (!tok) continue;
    const value = Number(tok.replace(/,/g, '')) || NUMBER_WORDS[tok];
    if (!value) continue;
    // "in 1663 days" never happens; a four-digit bare number is a year.
    if (/^\d{4}$/.test(tok) && value >= 1000 && value <= 2099) continue;
    out.push(tok);
  }
  return out;
}

function numberSupported(tok: string, idx: SupportIndex): boolean {
  const value = Number(tok.replace(/,/g, '')) || NUMBER_WORDS[tok];
  const forms = new Set<string>([tok.replace(/,/g, ''), String(value)]);
  if (WORD_FOR[value]) forms.add(WORD_FOR[value]);
  // "10,000" folds to the words "10" "000".
  if (/,/.test(tok)) forms.add(tok.split(',').join(' '));
  const seqs = [...idx.pageSeqs, idx.extraSeq];
  return [...forms].some(f => seqs.some(s => s.includes(` ${f} `)));
}

// ── Answer structure ──────────────────────────────────────────────────

interface Unit {
  kind: 'prose' | 'list' | 'blockquote' | 'image';
  start: number;
  end: number;
  raw: string;
  /** For images: the embed line, the alt, the URL and the caption line if any. */
  embed?: { line: string; alt: string; url: string; caption?: string };
}

/** Split an answer into units with exact offsets. Headings and rules are not units. */
export function answerUnits(text: string): Unit[] {
  const lines: Array<{ text: string; start: number; end: number }> = [];
  let pos = 0;
  for (const l of text.split('\n')) {
    lines.push({ text: l, start: pos, end: pos + l.length });
    pos += l.length + 1;
  }
  const units: Unit[] = [];
  const isList = (t: string) => /^(?:[*+-]|\d+\.)\s+/.test(t);
  const isSpecial = (t: string) => !t || /^#{1,6}\s|^-{3,}$|^>|^!\[/.test(t) || isList(t);
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].text.trim();
    if (!t || /^#{1,6}\s/.test(t) || /^-{3,}$/.test(t)) { i++; continue; }
    const embed = t.match(/^!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+"[^"]*")?\s*\)\s*$/);
    if (embed) {
      const next = lines[i + 1]?.text.trim();
      const hasCaption = !!next && /^[*_](?![*_\s])/.test(next) && !isList(next);
      const last = hasCaption ? i + 1 : i;
      units.push({
        kind: 'image', start: lines[i].start, end: lines[last].end, raw: text.slice(lines[i].start, lines[last].end),
        embed: { line: lines[i].text, alt: embed[1], url: embed[2], caption: hasCaption ? lines[i + 1].text : undefined },
      });
      i = last + 1;
      continue;
    }
    if (t.startsWith('>')) {
      let j = i;
      while (j + 1 < lines.length && lines[j + 1].text.trim().startsWith('>')) j++;
      // A citation line right under the quote ("— *[Title](…)*, [Page 5](…)") belongs to it.
      if (j + 1 < lines.length && /^[—–]\s/.test(lines[j + 1].text.trim())) j++;
      units.push({ kind: 'blockquote', start: lines[i].start, end: lines[j].end, raw: text.slice(lines[i].start, lines[j].end) });
      i = j + 1;
      continue;
    }
    if (isList(t)) {
      units.push({ kind: 'list', start: lines[i].start, end: lines[i].end, raw: lines[i].text });
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < lines.length && !isSpecial(lines[j + 1].text.trim())) j++;
    units.push({ kind: 'prose', start: lines[i].start, end: lines[j].end, raw: text.slice(lines[i].start, lines[j].end) });
    i = j + 1;
  }
  return units;
}

const ABBREV = /(?:\b(?:Dr|Mr|Mrs|St|Sr|Jr|Fr|Br|vol|vols|no|pp?|ca|cf|ed|eds|fol|ff|ch|fig|viz|vs|i\.e|e\.g|c)|\b\p{Lu})\.$/u;

/**
 * Sentences of a unit as exact substrings (each keeps its trailing space).
 * A markdown link is never split, and an abbreviation ("Dr.", "p.", "J.") is
 * not a sentence end.
 */
export function sentences(raw: string): string[] {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '[' || ch === '(') depth++;
    else if ((ch === ']' || ch === ')') && depth > 0) depth--;
    if (depth > 0 || !/[.!?]/.test(ch)) continue;
    let k = i + 1;
    while (k < raw.length && /["”’)*_]/.test(raw[k])) k++;
    if (k >= raw.length || !/\s/.test(raw[k])) continue;
    if (ch === '.' && ABBREV.test(raw.slice(Math.max(0, i - 5), i + 1))) continue;
    let e = k;
    while (e < raw.length && /\s/.test(raw[e])) e++;
    if (e < raw.length && !/[\p{Lu}"“(*\[_\d]/u.test(raw[e])) continue;
    out.push(raw.slice(start, e));
    start = e;
    i = e - 1;
  }
  if (start < raw.length) out.push(raw.slice(start));
  return out;
}

function hasProperName(s: string): boolean {
  for (const sent of sentences(plainText(s))) {
    const toks = sent.trim().split(/\s+/).slice(1);
    if (toks.some(t => /^[("'“]?\p{Lu}\p{Ll}{2,}/u.test(t) && !/^[("'“]?(?:The|This|These|That|English|Latin|French|German|Greek|Hebrew|Arabic|Sanskrit|Dutch|Italian|Spanish)\b/u.test(t))) return true;
  }
  return false;
}

const INLINE_QUOTE = /(["“«])([^"“”«»\n]{3,500}?)(["”»])/g;

function inlineQuotes(s: string): Array<{ full: string; inner: string }> {
  const out: Array<{ full: string; inner: string }> = [];
  // Quotes inside link text or URLs are titles, not quotations.
  const masked = s.replace(/\]\([^)]*\)/g, m => ' '.repeat(m.length));
  for (const m of masked.matchAll(INLINE_QUOTE)) {
    const full = s.slice(m.index!, m.index! + m[0].length);
    const inner = full.slice(1, -1);
    if (plainText(inner).trim().split(/\s+/).length >= 3) out.push({ full, inner });
  }
  return out;
}

const SKIP_PROSE = /^(?:Saved to your research notebook|You might|If you(?:'d| would) like|Would you like)/i;

// ── Citation attach ───────────────────────────────────────────────────

function shortTitle(t: string): string {
  const clean = t.replace(/\s+/g, ' ').trim();
  if (clean.length <= 70) return clean;
  const cut = clean.slice(0, 70);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 70)}…`;
}

const escapeMd = (s: string) => s.replace(/([[\]])/g, '\\$1');

function citationFor(p: GroundingPage, base: string): string {
  return `*[${escapeMd(shortTitle(p.bookTitle))}](${base}/book/${p.bookSlug})*, [Page ${p.page}](${base}/book/${p.bookSlug}/page-number/${p.page})`;
}

/**
 * The support page a claim most plausibly came from, or null. Requires the
 * unit's distinctive words to overlap clearly AND at least one of its proper
 * names to be on that page — a long paragraph of common words otherwise
 * "matches" any page about the same topic.
 */
function bestPage(unit: string, pages: GroundingPage[], idx: SupportIndex): GroundingPage | null {
  const words = contentWords(plainText(unit));
  if (words.length < 4) return null;
  const names = new Set(
    (plainText(unit).match(/(?<=\S\s+)\p{Lu}[\p{L}]{3,}/gu) ?? []).flatMap(n => foldWords(n)),
  );
  let best: { p: GroundingPage; score: number; hits: number } | null = null;
  pages.forEach((p, i) => {
    const set = idx.pageSets[i];
    const hits = words.filter(w => set.has(w)).length;
    const score = hits / words.length;
    if (best && score <= best.score) return;
    const nameOnPage = [...names].some(n => set.has(n) || foldWords(p.bookTitle).includes(n));
    if (!nameOnPage) return;
    best = { p, score, hits };
  });
  const b = best as { p: GroundingPage; score: number; hits: number } | null;
  return b && b.hits >= 5 && b.score >= ATTACH_MIN_SCORE ? b.p : null;
}

/** Share of a claim's distinctive words that must be on the page to attach it. */
export const ATTACH_MIN_SCORE = 0.5;

// ── Captions ──────────────────────────────────────────────────────────

function captionFor(img: GroundingImage, base: string): string {
  const desc = (img.description || '').replace(/\s+/g, ' ').trim();
  const firstSentence = (desc.split(/(?<=[.!?])\s/)[0] ?? '').replace(/[.!?]$/, '');
  const what = firstSentence
    ? (firstSentence.length <= 140 ? firstSentence : `${firstSentence.slice(0, firstSentence.lastIndexOf(' ', 130))}…`)
    : (img.type ? img.type.charAt(0).toUpperCase() + img.type.slice(1) : 'Illustration');
  const book = img.bookSlug ?? img.bookId;
  if (book && img.page) {
    return `*${what} — [${escapeMd(shortTitle(img.bookTitle))}](${base}/book/${book}), [Page ${img.page}](${base}/book/${book}/page-number/${img.page})*`;
  }
  if (book) return `*${what} — [${escapeMd(shortTitle(img.bookTitle))}](${base}/book/${book})*`;
  return `*${what} — ${shortTitle(img.bookTitle)}${img.bookAuthor ? `, by ${img.bookAuthor}` : ''}*`;
}

function captionProblem(
  caption: string,
  img: GroundingImage,
  topicNames: Set<string>,
  ownPageText: string,
): string | null {
  const linked = [...caption.matchAll(/(?<![\w.-])sourcelibrary\.org(?:\/es)?\/book\/([a-z0-9-]+)/g)].map(m => m[1]);
  const ownIds = new Set([img.bookSlug, img.bookId, ...(img.bookAliases ?? [])].filter(Boolean) as string[]);
  if (linked.some(s => !ownIds.has(s))) return 'links a different book';
  const capWords = new Set(foldWords(plainText(caption)));
  const titleWords = contentWords(img.bookTitle);
  const titleHits = titleWords.filter(w => capWords.has(w));
  const namesOwn = linked.some(s => ownIds.has(s)) || titleHits.length >= 2 || titleHits.some(w => w.length >= 6)
    || (titleWords.length > 0 && titleHits.length === titleWords.length);
  if (!namesOwn) return 'does not name its own book';
  const own = new Set(foldWords(`${img.bookTitle} ${img.bookAuthor ?? ''} ${img.description ?? ''} ${ownPageText}`));
  const strangers = [...topicNames].filter(n => capWords.has(n) && !own.has(n));
  if (strangers.length > 0) return `ties it to ${strangers.join(', ')}, which its own record never mentions`;
  return null;
}

// ── The pass ──────────────────────────────────────────────────────────

const REMOVED_QUOTE_NOTE = '*A quotation stood here that I could not find on any page I read, so I removed it.*';

export function groundAnswer(input: GroundingInput): { edits: GroundingEdit[]; report: GroundingReport } {
  const { text, pages, siteBase } = input;
  const report: GroundingReport = {
    checkable: input.supportLoaded, claimUnits: 0, attached: 0, uncitedLeft: 0, quotesChecked: 0, quotesUnquoted: 0,
    blockquotesRemoved: 0, quantitiesChecked: 0, sentencesDropped: 0, captionsChecked: 0, captionsRewritten: 0, details: [],
  };
  const edits: GroundingEdit[] = [];
  const idx = buildIndex(pages, `${input.extraSupport ?? ''}\n${input.question}`);
  const imagesByUrl = new Map(input.images.map(img => [img.url, img]));
  const pageByKey = new Map(pages.map(p => [`${p.bookId}:${p.page}`, p]));
  const topicNames = new Set((input.question.match(/(?<=\s)\p{Lu}[\p{L}]{3,}/gu) ?? []).flatMap(n => foldWords(n)));
  const units = answerUnits(text);

  units.forEach(u => {
    // Remove a whole unit together with the blank line after it.
    const removal = (): GroundingEdit['find'] => {
      const after = text.slice(u.end).match(/^\n+/)?.[0] ?? '';
      return text.slice(u.start, u.end) + after;
    };

    if (u.kind === 'image') {
      const e = u.embed!;
      const img = imagesByUrl.get(e.url);
      if (!img) return; // a prior-turn image or unknown: nothing to check it against
      report.captionsChecked++;
      const caption = `${e.alt} ${e.caption ?? ''}`;
      const own = img.bookId && img.page ? pageByKey.get(`${img.bookId}:${img.page}`)?.text ?? '' : '';
      const problem = e.caption ? captionProblem(caption, img, topicNames, own) : 'has no caption';
      if (!problem) return;
      const alt = shortTitle(img.description?.split(/(?<=[.!?])\s/)[0]?.replace(/[.!?]$/, '') || img.bookTitle).replace(/[[\]]/g, '');
      const newEmbed = e.line.replace(`![${e.alt}]`, `![${alt}]`);
      edits.push({ find: u.raw, replace: `${newEmbed}\n${captionFor(img, siteBase)}`, reasons: ['caption'] });
      report.captionsRewritten++;
      report.details.push(`caption ${problem}: ${plainText(caption).slice(0, 120)}`);
      return;
    }

    if (!report.checkable) return;

    if (u.kind === 'blockquote') {
      const body = u.raw.split('\n')
        .map(l => l.trim().replace(/^>\s?/, ''))
        .filter(l => !/^[—–]\s/.test(l.trim()))
        .join(' ');
      const quote = plainText(body).replace(/^[\s"“”«»]+|[\s"“”«»]+$/g, '').trim();
      if (quote.split(/\s+/).length < 3 || !isMostlyLatin(quote)) return;
      report.quotesChecked++;
      if (checkQuote(quote, idx) !== 'unsupported') return;
      edits.push({ find: u.raw, replace: `> ${REMOVED_QUOTE_NOTE}`, reasons: ['drop_blockquote'] });
      report.blockquotesRemoved++;
      report.details.push(`blockquote not on any page read: ${quote.slice(0, 120)}`);
      return;
    }

    // Prose paragraph or list item.
    const plainStart = plainText(u.raw).replace(/^\s*(?:[*+-]|\d+\.)\s+/, '').trim();
    if (SKIP_PROSE.test(plainStart)) return;
    let next = u.raw;
    const reasons = new Set<GroundingEditReason>();

    // 1. Quantities: drop the sentence that carries an unsupported one.
    const kept: string[] = [];
    for (const s of sentences(next)) {
      const qs = quantitiesIn(s);
      report.quantitiesChecked += qs.length;
      const bad = qs.filter(q => !numberSupported(q, idx));
      if (bad.length > 0) {
        report.sentencesDropped++;
        reasons.add('drop_sentence');
        report.details.push(`dropped (${bad.join(', ')} not on any page read): ${plainText(s).trim().slice(0, 140)}`);
        continue;
      }
      kept.push(s);
    }
    if (reasons.has('drop_sentence') && !BOOK_LINK.test(u.raw) && !bestPage(u.raw, pages, idx)) {
      // The paragraph cites nothing, no page matches it, and the number it was
      // built around came from nowhere: what is left would hang on a sentence
      // that is gone ("The first eight are…"). It goes whole.
      edits.push({ find: removal(), replace: '', reasons: ['drop_sentence'] });
      return;
    }
    if (reasons.has('drop_sentence')) {
      const marker = u.kind === 'list' ? (u.raw.match(/^\s*(?:[*+-]|\d+\.)\s+(?:\*\*[^*]+\*\*:?\s*)?/)?.[0] ?? '') : '';
      next = kept.join('').replace(/\s+$/, '');
      // Nothing left but the list marker / bold lead-in → the unit goes.
      if (!plainText(next.slice(marker.length)).trim()) {
        edits.push({ find: removal(), replace: '', reasons: ['drop_sentence'] });
        return;
      }
      if (u.kind === 'list' && marker && !next.startsWith(marker.trim().slice(0, 1))) next = marker + next.trimStart();
    }

    // 2. Inline quotes: unsupported → keep the words, lose the quotation marks.
    for (const q of inlineQuotes(next)) {
      const inner = plainText(q.inner);
      if (!isMostlyLatin(inner)) continue;
      report.quotesChecked++;
      if (checkQuote(inner, idx) !== 'unsupported') continue;
      next = next.replace(q.full, q.inner);
      reasons.add('unquote');
      report.quotesUnquoted++;
      report.details.push(`unquoted (not on any page read): ${inner.slice(0, 120)}`);
    }

    // 3. Uncited claim → attach the page it came from, when one clearly matches.
    const p = plainText(next);
    const factual = inlineQuotes(next).length > 0 || /\d/.test(p) || hasProperName(next);
    if (factual) {
      report.claimUnits++;
      // A lead-in ("He noted:") introduces what follows — a quote or a list
      // that carries its own citations. A link wedged before its colon reads
      // as noise, so it is left alone (and stays counted as uncited).
      const leadIn = /:\s*$/.test(next);
      if (!BOOK_LINK.test(next) && !leadIn) {
        const page = bestPage(next, pages, idx);
        if (page) {
          const m = next.match(/^([\s\S]*?)([.!?:;]?)(\s*)$/)!;
          next = `${m[1]} — ${citationFor(page, siteBase)}${m[2] || '.'}${m[3]}`;
          reasons.add('attach_citation');
          report.attached++;
        } else {
          report.uncitedLeft++;
        }
      }
    }

    if (next !== u.raw) edits.push({ find: u.raw, replace: next, reasons: [...reasons] });
  });

  return { edits, report };
}
