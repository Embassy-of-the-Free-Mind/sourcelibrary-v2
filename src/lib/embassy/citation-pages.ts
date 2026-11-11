/**
 * Page links point at the page that says it (#6946).
 *
 * src/lib/embassy/grounding.ts checks that a quotation is on SOME page the
 * Librarian read. It never checked that the page a link names is that page:
 * measured on the #6904 replay, a third of answers sent a reader who clicked
 * "p.323" to a page that does not say the quoted thing (the line was on
 * p.177). This pass runs after groundAnswer, over the same units, and moves or
 * drops page links — never the words of a claim:
 *
 *  (a) Quotations, deterministically. Each quotation or blockquote with a page
 *      link is looked up page by page (the same folding and page-break spreads
 *      as groundAnswer). On the linked page: kept. Not there but on exactly one
 *      other page read (same book, nearest first; another book only for a
 *      long quotation that one book alone holds): the link is re-pointed
 *      there. On no page: groundAnswer already unquoted or removed it. Found
 *      only in pieces across books: reported and left as written — on the
 *      replay that was one text printed in two books, not a stitched quote.
 *  (b) Paraphrased claims, by a router the caller supplies (gemini-3.1-flash-lite,
 *      citation-router.ts, fed while the answer streams by citation-routing.ts;
 *      OFF in production by default, see librarian.ts): for each claim it
 *      names the page read that states it and the words there that do, or
 *      none. Another page → re-pointed, only when those words are on it and
 *      not on the linked page; none → the link is dropped (the sentence stays
 *      as unlinked background), only when the linked page shares little of
 *      the claim. The router only routes links; no model rewrites a claim.
 *  (c) Captions. An image caption that numbers an emblem, figure or plate
 *      ("Emblem XI") loses the number when the image's own record never
 *      carries it.
 *
 * Uncheckable is not unsupported (measurement-instruments.md): a link to a page
 * whose text was not loaded, a non-Latin quotation, and a router that failed or
 * ran out of time all leave the link as it is.
 *
 * Output: the grounding edits, with every unit this pass changed folded into
 * ONE edit over that unit (find = the raw unit, replace = the unit after both
 * passes), so the clients' applyGroundingEdits needs nothing new.
 *
 * PRIOR ART: src/lib/embassy/grounding.ts (quote folding, page readings and
 * spreads, units, sentences — reused, not copied; it answers "is this quote on
 * any page read", not "on the page linked"); src/lib/embassy/citation-fixes.ts
 * (rewrites a bad book SLUG and drops the page — the edition is wrong there,
 * not the page); scripts/lib/page-terms-parse.mjs verifyQuote (one page, no
 * re-pointing).
 *
 * Client-safe: no server imports.
 */
import {
  answerUnits, foldWords, pageReadings, plainText, sentences, inlineQuotes, isMostlyLatin, blockquoteWords,
  type GroundingEdit, type GroundingImage, type GroundingPage,
} from '@/lib/embassy/grounding';
import { englishFraction, ENGLISH_SOURCE_THRESHOLD } from '@/lib/english-page-language';

// ── Page links ────────────────────────────────────────────────────────

export interface PageLink {
  /** Offsets of the whole `[label](url)` in the text searched. */
  start: number;
  end: number;
  label: string;
  url: string;
  slug: string;
  page: number;
  /** `/es` or ''. */
  locale: string;
}

const PAGE_LINK = /\[((?:[^[\]\\\n]|\\.)*)\]\((https:\/\/sourcelibrary\.org(\/es)?\/book\/([a-z0-9-]+)(?:\/page-number\/|\?page=)(\d+))\)/g;

/** Markdown links to a specific book page (`/page-number/N` or `?page=N`). */
export function findPageLinks(text: string): PageLink[] {
  return [...text.matchAll(PAGE_LINK)].map(m => ({
    start: m.index!, end: m.index! + m[0].length, label: m[1], url: m[2], locale: m[3] ?? '', slug: m[4], page: Number(m[5]),
  }));
}

/**
 * The citation a page link ends: `— *[Title](…/book/x)* by [Author](…), [Page 5](…)`,
 * or `([Page 5](…))`. Returns the span to remove when the link is dropped and
 * the title link inside it, if any. Null when the link sits inside a sentence
 * ("as [De Vita, p. 12](…) says") — that one is unlinked instead.
 */
export function citationTail(s: string, link: PageLink): { start: number; end: number; titleLink?: { start: number; end: number; label: string; slug: string } } | null {
  const before = s.slice(0, link.start);
  const m = before.match(/(\s*[—–]\s*|\s*\(\s*|,\s*|\s+)?((?:\*?\[(?:[^[\]\\\n]|\\.)*\]\([^)\s]*\)\*?(?:\s+(?:by|de|por)\s+(?:\[(?:[^[\]\\\n]|\\.)*\]\([^)\s]*\)|[^,\n[\]()]{1,60}))?,?\s*)*)$/);
  const lead = m?.[1] ?? '';
  const chain = m?.[2] ?? '';
  const labelIsPage = /^(?:p(?:age|ágina|agina)?s?\.?|pp\.|fol\.?|f\.)\s*\d+[a-z]?$/i.test(link.label.trim());
  // A page-only label ("Page 5") is a citation by construction; a title-shaped
  // label is one only when it comes after a dash or opens a parenthesis.
  if (!labelIsPage && !/[—–(]/.test(lead)) return null;
  if (!labelIsPage && !lead && !chain) return null;
  let start = link.start - chain.length - lead.length;
  let end = link.end;
  if (/\(/.test(lead) && s[end] === ')') end++;
  else if (/\(/.test(lead)) start = link.start - chain.length - lead.length + lead.indexOf('(') ; // unbalanced: keep "(" out
  // "…, [Page 5](…)" with nothing before the comma but prose: keep the prose.
  const title = chain ? [...chain.matchAll(/\*?\[((?:[^[\]\\\n]|\\.)*)\]\((https:\/\/sourcelibrary\.org(?:\/es)?\/book\/([a-z0-9-]+))\)\*?/g)][0] : undefined;
  const chainStart = link.start - chain.length;
  if (!labelIsPage && !lead) start = chainStart;
  return {
    start, end,
    titleLink: title ? { start: chainStart + title.index!, end: chainStart + title.index! + title[0].length, label: title[1], slug: title[3] } : undefined,
  };
}

const escapeMd = (s: string) => s.replace(/([[\]])/g, '\\$1');

function shortTitle(t: string): string {
  const clean = t.replace(/\s+/g, ' ').trim();
  if (clean.length <= 70) return clean;
  const cut = clean.slice(0, 70);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 70)}…`;
}

/** The link moved to `to`: same URL shape and locale, the page number in its label updated. */
export function repointLink(s: string, link: PageLink, to: GroundingPage): string {
  const sameBook = to.bookSlug === link.slug;
  const url = link.url.includes('?page=')
    ? `https://sourcelibrary.org${link.locale}/book/${to.bookSlug}?page=${to.page}`
    : `https://sourcelibrary.org${link.locale}/book/${to.bookSlug}/page-number/${to.page}`;
  let label = link.label.replace(new RegExp(`(^|\\D)${link.page}(?!\\d)`), `$1${to.page}`);
  if (label === link.label && !label.includes(String(to.page))) label = `${label}, p. ${to.page}`;
  let out = `${s.slice(0, link.start)}[${label}](${url})${s.slice(link.end)}`;
  if (!sameBook) {
    // The title link in the same citation names the old book: it names the new one now.
    const tail = citationTail(s, link);
    if (tail?.titleLink) {
      const t = tail.titleLink;
      const old = s.slice(t.start, t.end);
      const fresh = old.replace(`[${t.label}]`, `[${escapeMd(shortTitle(to.bookTitle))}]`).replace(new RegExp(`/book/${t.slug}(?![a-z0-9-])`), `/book/${to.bookSlug}`);
      out = `${out.slice(0, t.start)}${fresh}${out.slice(t.end)}`;
    } else if (/^(?:p(?:age|ágina|agina)?s?\.?|pp\.)\s*\d+$/i.test(link.label.trim())) {
      // "Page 5" alone would now name a page of a book the sentence never mentions.
      out = `${s.slice(0, link.start)}[${escapeMd(shortTitle(to.bookTitle))}, ${label}](${url})${s.slice(link.end)}`;
    }
  }
  return out;
}

/** The link dropped: a citation tail goes whole; a link inside a sentence keeps its words and loses the page. */
export function dropLink(s: string, link: PageLink): string {
  const tail = citationTail(s, link);
  if (tail) {
    let out = s.slice(0, tail.start) + s.slice(tail.end);
    // "word ." → "word."; "( )" leftovers; doubled spaces.
    out = out.replace(/\s+([.,;:!?])/g, (m, p, off) => (off === tail.start ? p : m)).replace(/ {2,}/g, ' ');
    return out;
  }
  // Inside a sentence: point at the book, not the page (the book is still what the sentence names).
  const bookUrl = `https://sourcelibrary.org${link.locale}/book/${link.slug}`;
  return `${s.slice(0, link.start)}[${link.label}](${bookUrl})${s.slice(link.end)}`;
}

// ── Locating a quotation page by page ─────────────────────────────────

export interface PageIndex {
  pages: GroundingPage[];
  /** Per page, built on first use: its readings as ` w1 w2 … `, and its word set. */
  own(i: number): { seqs: string[]; set: Set<string> };
  /** Per page, built on first use: the page-break spreads with the pages either side. */
  spreads(i: number): string[];
}

const SPREAD_CHARS = 2000;
const pad = (w: string[]) => ` ${w.join(' ')} `;

/**
 * Lazy: an answer cites a handful of the pages read, and folding all of them
 * (three readings each, plus spreads) cost 60–450 ms per answer when built up
 * front. A page is folded the first time a quotation is looked for on it.
 */
export function buildPageIndex(pages: GroundingPage[]): PageIndex {
  const byKey = new Map(pages.map((p, i) => [`${p.bookId}:${p.page}`, i]));
  const ownCache = new Map<number, { seqs: string[]; set: Set<string> }>();
  const spreadCache = new Map<number, string[]>();
  const spread = (a: GroundingPage, b: GroundingPage) => {
    const out: string[] = [];
    (a.parts ?? []).forEach((x, k) => {
      const y = b.parts?.[k];
      if (x && y) out.push(...pageReadings(`${x.slice(-SPREAD_CHARS)}\n${y.slice(0, SPREAD_CHARS)}`).map(r => pad(foldWords(r))));
    });
    return out;
  };
  return {
    pages,
    own(i) {
      let o = ownCache.get(i);
      if (!o) {
        const rs = pageReadings(pages[i].text).map(foldWords);
        o = { seqs: rs.map(pad), set: new Set(rs.flat()) };
        ownCache.set(i, o);
      }
      return o;
    },
    spreads(i) {
      let o = spreadCache.get(i);
      if (!o) {
        const p = pages[i];
        const next = byKey.get(`${p.bookId}:${p.page + 1}`);
        const prev = byKey.get(`${p.bookId}:${p.page - 1}`);
        o = [...(next !== undefined ? spread(p, pages[next]) : []), ...(prev !== undefined ? spread(pages[prev], p) : [])];
        spreadCache.set(i, o);
      }
      return o;
    },
  };
}

/** Same fragment rule as groundAnswer's checkQuote, per page. */
function fragments(quote: string): string[][] {
  return quote.split(/\s*(?:\.{3,}|…|\[\s*\.\.\.\s*\])\s*/)
    .map(f => foldWords(f.replace(/\[[^\]]*\]/g, ' ')))
    .filter(f => f.length >= 2 || (f.length === 1 && f[0].length >= 5));
}

function fragmentOnPage(f: string[], idx: PageIndex, i: number): boolean {
  const own = idx.own(i);
  const needle = ` ${f.join(' ')} `;
  if (own.seqs.some(s => s.includes(needle))) return true;
  const words = [...new Set(f.filter(w => w.length >= 3))];
  if (words.length >= 6 && words.filter(w => own.set.has(w)).length / words.length >= 0.8) return true;
  // Across the page break the fragment starts or ends on this page.
  if (!own.set.has(f[0]) && !own.set.has(f[f.length - 1])) return false;
  return idx.spreads(i).some(s => s.includes(needle));
}

/** True when page i holds every fragment of the quote (a page-break spread counts). */
export function quoteOnPage(quote: string, idx: PageIndex, i: number): boolean {
  const frags = fragments(quote);
  return frags.length > 0 && frags.every(f => fragmentOnPage(f, idx, i));
}

/** Indices of the pages that hold every fragment of the quote (a page-break spread counts for both its pages). */
export function pagesHoldingQuote(quote: string, idx: PageIndex): { whole: number[]; perFragment: number[][] } {
  const frags = fragments(quote);
  if (frags.length === 0) return { whole: [], perFragment: [] };
  const perFragment = frags.map(f => idx.pages.map((_, i) => i).filter(i => fragmentOnPage(f, idx, i)));
  const whole = idx.pages.map((_, i) => i).filter(i => perFragment.every(list => list.includes(i)));
  return { whole, perFragment };
}

// ── Claims a link is cited for ────────────────────────────────────────

export interface LinkedClaim {
  /** The link, offsets within the unit text. */
  link: PageLink;
  /** The words the link is cited for, as plain text (no links, no citation). */
  claim: string;
  /** Quotations inside the claim (inline quotes of 3+ words, or the blockquote body). */
  quotes: string[];
  blockquote: boolean;
}

/** Plain claim text without the citation tails it carries. */
function claimText(s: string): string {
  let out = s;
  for (const l of findPageLinks(s).reverse()) {
    const t = citationTail(out, l);
    out = t ? out.slice(0, t.start) + out.slice(t.end) : out;
  }
  return plainText(out).replace(/^\s*(?:[*+-]|\d+\.)\s+/, '').replace(/\s+/g, ' ').trim();
}

const contentCount = (s: string) => foldWords(s).filter(w => w.length >= 4).length;

/** Every page link in a unit with the claim it is cited for. */
export function linkedClaims(unit: string, kind: 'prose' | 'list' | 'blockquote'): LinkedClaim[] {
  const links = findPageLinks(unit);
  if (links.length === 0) return [];
  if (kind === 'blockquote') {
    const body = unit.split('\n').map(l => l.trim().replace(/^>\s?/, '')).filter(l => !/^[—–]\s/.test(l.trim())).join(' ');
    const quote = plainText(blockquoteWords(body)).replace(/^[\s"“”«»]+|[\s"“”«»]+$/g, '').trim();
    return links.map(link => ({ link, claim: quote, quotes: quote.split(/\s+/).length >= 3 ? [quote] : [], blockquote: true }));
  }
  const sents = sentences(unit);
  const out: LinkedClaim[] = [];
  let off = 0;
  const spans = sents.map(s => { const r = { s, start: off, end: off + s.length }; off += s.length; return r; });
  for (const link of links) {
    const k = spans.findIndex(sp => link.start >= sp.start && link.start < sp.end);
    if (k < 0) continue;
    let claimRaw = spans[k].s;
    // A citation that stands alone ("— [Page 15](…).") is cited for what came before it.
    let j = k;
    while (contentCount(claimText(claimRaw)) < 4 && j > 0) { j--; claimRaw = spans[j].s + claimRaw; }
    const quotes = inlineQuotes(claimRaw).map(q => plainText(q.inner)).filter(q => q.split(/\s+/).length >= 3);
    out.push({ link: { ...link }, claim: claimText(claimRaw), quotes, blockquote: false });
  }
  return out;
}

// ── Captions ──────────────────────────────────────────────────────────

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
function romanValue(s: string): number | null {
  const t = s.toLowerCase();
  if (!/^[ivxlc]+$/.test(t)) return null;
  let v = 0;
  for (let i = 0; i < t.length; i++) {
    const a = ROMAN[t[i]];
    const b = ROMAN[t[i + 1]] ?? 0;
    v += a < b ? -a : a;
  }
  return v > 0 ? v : null;
}
const toRoman = (n: number) => {
  const m: Array<[number, string]> = [[100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, r] of m) while (n >= v) { out += r; n -= v; }
  return out;
};

const NUMBERED_FIGURE = /\b(Emblem(?:a|e)?|Figure|Fig\.|Plate|Tab(?:ula|le)?\.?|Tafel|L[aá]mina|Grabado|Plancha)\s+(?:(?:No\.?|Nr\.?|n[º°]\.?)\s*)?(\d{1,3}|[IVXLC]{1,7})\b/g;

/** Numbers a record carries, as values: arabic, roman (word-bounded), from its text and its URL. */
function numbersIn(record: string): Set<number> {
  const out = new Set<number>();
  for (const m of record.matchAll(/(?<![\p{L}\d])(\d{1,3}|[ivxlc]{1,7})(?![\p{L}\d])/giu)) {
    const v = /^\d+$/.test(m[1]) ? Number(m[1]) : romanValue(m[1]);
    if (v) out.add(v);
  }
  return out;
}

/**
 * A caption's figure number checked against the image's own record. Returns
 * the caption with each unmatched number dropped ("Emblem XI from …" →
 * "Emblem from …"), or null when nothing changes. A record with no numbers at
 * all is still a record: a number it never carries came from the model.
 */
export function captionNumberFix(caption: string, img: GroundingImage, ownPageText = ''): string | null {
  const urlName = (() => { try { return decodeURIComponent(new URL(img.url).pathname.split('/').pop() ?? ''); } catch { return ''; } })();
  const record = `${img.bookTitle} ${img.description ?? ''} ${urlName.replace(/[-_.]/g, ' ')} ${ownPageText.slice(0, 3000)}`;
  const have = numbersIn(record);
  let changed = false;
  const out = caption.replace(NUMBERED_FIGURE, (m, word: string, num: string) => {
    const v = /^\d+$/.test(num) ? Number(num) : romanValue(num);
    if (v && have.has(v)) return m;
    changed = true;
    return word;
  });
  return changed ? out : null;
}

// ── The pass ──────────────────────────────────────────────────────────

/** The router's answer for one claim: the page that states it (null: none), and the words on it that do. */
export type RouteVerdict = { claim: number; page: number | null; evidence?: string };

/** A paraphrased claim with a page link. `cited` indexes the pages passed with it. */
export interface RoutingClaim { key: string; claim: string; cited: number }

/**
 * Routes paraphrased claims to the page read that states them. `pages` are the
 * support pages (indexes into the list passed); answers `page: null` for a claim
 * no page states. Must not throw for a bad model reply — return [] instead.
 */
export type CitationRouter = (claims: RoutingClaim[], pages: GroundingPage[]) => Promise<RouteVerdict[]>;

/** Claim key → `${bookId}:${page}` of the page that states it (null: none), with the router's evidence. */
export type RoutedClaims = Map<string, { to: string | null; evidence?: string }>;

/** Same link, same words: survives groundAnswer unquoting the claim or shifting it in the text. */
export const claimKey = (link: PageLink, claim: string) => `${link.url}|${foldWords(claim).join(' ')}`;

export interface CitationPassReport {
  linksChecked: number;
  quotesOnCitedPage: number;
  quotesRepointed: number;
  quotesStitched: number;
  claimsRouted: number;
  claimsRepointed: number;
  linksDropped: number;
  uncheckable: number;
  captionNumbersDropped: number;
  routerMs: number | null;
  routerError?: string;
  /** Every link moved, with the words it is cited for: what an Opus check reads (#6946). */
  moves: Array<{ by: 'quote' | 'router'; claim: string; from: string; to: string }>;
  /** What happened to each link, by URL (for tuning and the monitoring trace). */
  paths: Array<{ url: string; path: string }>;
  /** Every routed claim: its link, the router's page (null = none) and the claim's word overlap with each page. */
  routes: Array<{ key: string; from: string; to: string | null; citedOverlap: number; toOverlap: number | null; evidenceOnTo: boolean | null; evidenceOnCited: boolean | null; applied: string }>;
  details: string[];
}

export interface CitationPassInput {
  /** The raw streamed text. */
  text: string;
  /** groundAnswer's edits (and notebook-claim edits), in document order. */
  edits: GroundingEdit[];
  pages: GroundingPage[];
  supportLoaded: boolean;
  images: GroundingImage[];
  /** Route the paraphrased claims now, with these pages (the simple, sequential form). */
  router?: CitationRouter;
  /**
   * Or: verdicts already on their way (CitationRoutingStream, fired paragraph
   * by paragraph while the answer streamed). Waited for at most `routedWaitMs`;
   * a claim it has no verdict for keeps its link.
   */
  routed?: Promise<RoutedClaims | null>;
  routedWaitMs?: number;
}

const QUOTE_DETAIL = 140;

/**
 * Run the citation-page pass and return the merged edits. Never throws for
 * data it cannot judge; a router failure leaves paraphrased links alone.
 */
export async function checkCitationPages(input: CitationPassInput): Promise<{ edits: GroundingEdit[]; report: CitationPassReport }> {
  const report: CitationPassReport = {
    linksChecked: 0, quotesOnCitedPage: 0, quotesRepointed: 0, quotesStitched: 0, claimsRouted: 0, claimsRepointed: 0,
    linksDropped: 0, uncheckable: 0, captionNumbersDropped: 0, routerMs: null, moves: [], paths: [], routes: [], details: [],
  };
  const { text } = input;
  const units = answerUnits(text);
  if (!input.supportLoaded) return { edits: input.edits, report };
  const idx = buildPageIndex(input.pages);
  const pageAt = (slug: string, page: number) => input.pages.findIndex(p => (p.bookSlug === slug || p.bookId === slug) && p.page === page);
  const imagesByUrl = new Map(input.images.map(i => [i.url, i]));

  // Each unit's text after the grounding edits that fall inside it.
  type Work = { u: (typeof units)[number]; span: [number, number]; before: string; grounded: string; current: string; covered: GroundingEdit[] };
  const work: Work[] = units.map(u => {
    const trail = text.slice(u.end).match(/^\n*/)?.[0] ?? '';
    const span: [number, number] = [u.start, u.end + trail.length];
    const covered = input.edits.filter(e => e.at >= span[0] && e.at + e.find.length <= span[1]);
    let current = text.slice(span[0], span[1]);
    let shift = 0;
    for (const e of covered) {
      const at = e.at - span[0] + shift;
      if (current.slice(at, at + e.find.length) !== e.find) continue;
      current = current.slice(0, at) + e.replace + current.slice(at + e.find.length);
      shift += e.replace.length - e.find.length;
    }
    return { u, span, before: text.slice(span[0], span[1]), grounded: current, current, covered };
  });
  // An edit that crosses units is left alone, and so are the units it touches.
  const crossing = input.edits.filter(e => !work.some(w => e.at >= w.span[0] && e.at + e.find.length <= w.span[1]));
  const touched = (w: Work) => crossing.some(e => e.at < w.span[1] && w.span[0] < e.at + e.find.length);

  // Pending router work: (unit, link start in current text, claim).
  const pending: Array<{ w: Work; key: string; link: PageLink; claim: string; cited: number }> = [];

  for (const w of work) {
    if (touched(w) || !w.current.trim()) continue;
    if (w.u.kind === 'image') {
      const e = w.u.embed!;
      const img = imagesByUrl.get(e.url);
      if (!img) continue;
      const own = img.bookId && img.page ? input.pages.find(p => p.bookId === img.bookId && p.page === img.page)?.text ?? '' : '';
      // The caption line as it stands after groundAnswer (it may have rebuilt it from the record).
      const lines = w.current.split('\n');
      let changed = false;
      const fixed = lines.map((l, i) => {
        if (i > 1) return l;
        const f = captionNumberFix(l, img, own);
        if (f === null) return l;
        changed = true;
        return f;
      });
      if (changed) {
        report.captionNumbersDropped++;
        report.details.push(`caption number not in the image's record: ${plainText(lines.slice(0, 2).join(' ')).slice(0, QUOTE_DETAIL)}`);
        w.current = fixed.join('\n');
      }
      continue;
    }
    const kind = w.u.kind;
    const claims = linkedClaims(w.current, kind);
    // Work from the last link back, so earlier offsets hold.
    for (const c of [...claims].reverse()) {
      report.linksChecked++;
      const cited = pageAt(c.link.slug, c.link.page);
      if (c.quotes.some(q => !isMostlyLatin(q))) { report.uncheckable++; report.paths.push({ url: c.link.url, path: 'non-latin' }); continue; }
      const v = quoteVerdict(c, cited, idx);
      report.paths.push({ url: c.link.url, path: cited < 0 ? `${v.kind}/unloaded` : contentCount(c.claim) < 4 && (v.kind === 'paraphrase' || v.kind === 'uncheckable') ? `${v.kind}/short` : v.kind });
      if (v.kind === 'ok') { report.quotesOnCitedPage++; continue; }
      if (v.kind === 'move') {
        const to = idx.pages[v.target];
        w.current = repointLink(w.current, c.link, to);
        report.quotesRepointed++;
        report.moves.push({ by: 'quote', claim: c.claim, from: cited >= 0 ? `${idx.pages[cited].bookId}:${idx.pages[cited].page}` : `${c.link.slug}:${c.link.page}`, to: `${to.bookId}:${to.page}` });
        report.details.push(`quote re-pointed ${c.link.slug} p.${c.link.page} → ${to.bookSlug} p.${to.page}: ${v.quote.slice(0, QUOTE_DETAIL)}`);
        continue;
      }
      if (v.kind === 'stitched') {
        // Reported, not removed: on the replay both hits were one text printed
        // in two books (two editions of Atalanta; Kircher retelling his own
        // anecdote), not a quotation pieced together.
        report.quotesStitched++;
        report.details.push(`quotation found only in pieces across books (left as written): ${v.quote.slice(0, QUOTE_DETAIL)}`);
        continue;
      }
      // Not settled by the quotation alone (a paraphrase, a short or ambiguous
      // quotation, one on no page): the router reads the claim against the
      // pages. A link to a page that was not loaded cannot be judged.
      if (cited < 0) { report.uncheckable++; continue; }
      if (contentCount(c.claim) < 4) continue;
      pending.push({ w, key: claimKey(c.link, c.claim), link: c.link, claim: c.claim, cited });
    }
  }

  if (pending.length > 0 && (input.router || input.routed)) {
    const t0 = Date.now();
    let routed: RoutedClaims | null = null;
    try {
      if (input.routed) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        routed = await Promise.race([
          input.routed,
          new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), input.routedWaitMs ?? 0); }),
        ]);
        if (timer) clearTimeout(timer);
        if (!routed) report.routerError = 'no verdicts in time';
      } else if (input.router) {
        routed = routesToKeys(await input.router(pending.map(p => ({ key: p.key, claim: p.claim, cited: p.cited })), idx.pages), pending, idx.pages);
      }
    } catch (err) {
      report.routerError = err instanceof Error ? err.message : String(err);
    }
    report.routerMs = Date.now() - t0;
    const indexOf = new Map(idx.pages.map((pg, i) => [`${pg.bookId}:${pg.page}`, i]));
    // pending was collected last link first within each unit; relocate() finds each link again anyway.
    for (const p of pending) {
      const v = routed?.get(p.key);
      if (!v) continue;
      const page = v.to === null ? null : indexOf.get(v.to);
      if (page === undefined) continue; // routed to a page this pass did not load: leave it
      report.claimsRouted++;
      const citedOverlap = overlap(p.claim, idx, p.cited);
      const evidenceOn = (i: number) => (v.evidence && fragments(v.evidence).flat().length >= EVIDENCE_MIN_WORDS ? quoteOnPage(v.evidence, idx, i) : null);
      const route = {
        key: p.key, from: `${idx.pages[p.cited].bookId}:${idx.pages[p.cited].page}`, to: v.to, citedOverlap,
        toOverlap: page === null ? null : overlap(p.claim, idx, page),
        evidenceOnTo: page === null ? null : evidenceOn(page), evidenceOnCited: evidenceOn(p.cited), applied: 'kept',
      };
      report.routes.push(route);
      if (page === p.cited) continue;
      const act = page === null ? shouldDrop(route, p.claim) : shouldMove(route);
      if (!act) { route.applied = 'guarded'; continue; }
      const link = relocate(p.w.current, p.link);
      if (!link) continue;
      if (page === null) {
        p.w.current = dropLink(p.w.current, link);
        route.applied = 'dropped';
        report.linksDropped++;
        report.details.push(`link dropped (no page read states it) ${p.link.slug} p.${p.link.page}: ${p.claim.slice(0, QUOTE_DETAIL)}`);
        continue;
      }
      p.w.current = repointLink(p.w.current, link, idx.pages[page]);
      route.applied = 'moved';
      report.moves.push({ by: 'router', claim: p.claim, from: route.from, to: v.to as string });
      report.claimsRepointed++;
      report.details.push(`claim re-pointed ${p.link.slug} p.${p.link.page} → ${idx.pages[page].bookSlug} p.${idx.pages[page].page}: ${p.claim.slice(0, QUOTE_DETAIL)}`);
    }
  }

  const changed = work.filter(w => w.current !== w.grounded);
  const out: GroundingEdit[] = input.edits.filter(e => !changed.some(w => w.covered.includes(e)));
  for (const w of changed) {
    const reasons = new Set(w.covered.flatMap(e => e.reasons));
    reasons.add('citation_page');
    out.push({ find: w.before, replace: w.current, at: w.span[0], reasons: [...reasons] });
  }
  out.sort((a, b) => a.at - b.at);
  return { edits: out, report };
}

function routesToKeys(verdicts: RouteVerdict[], claims: Array<{ key: string }>, pages: GroundingPage[]): RoutedClaims {
  const out: RoutedClaims = new Map();
  for (const v of verdicts) {
    const c = claims[v.claim];
    if (!c) continue;
    if (v.page !== null && !pages[v.page]) continue;
    out.set(c.key, { to: v.page === null ? null : `${pages[v.page].bookId}:${pages[v.page].page}`, evidence: v.evidence });
  }
  return out;
}

/**
 * The claims in one unit the router should read: page-linked, on a loaded
 * page, not settled by a quotation (on the linked page, movable, or stitched),
 * and long enough to state something. The same test the pass applies, so a
 * claim routed while the answer streams is the claim the pass looks up.
 */
export function routableClaims(unit: string, kind: 'prose' | 'list' | 'blockquote', idx: PageIndex): RoutingClaim[] {
  const out: RoutingClaim[] = [];
  for (const c of linkedClaims(unit, kind)) {
    const cited = idx.pages.findIndex(p => (p.bookSlug === c.link.slug || p.bookId === c.link.slug) && p.page === c.link.page);
    if (cited < 0 || c.quotes.some(q => !isMostlyLatin(q)) || contentCount(c.claim) < 4) continue;
    if (quoteVerdict(c, cited, idx).kind !== 'paraphrase') continue;
    out.push({ key: claimKey(c.link, c.claim), claim: c.claim, cited });
  }
  return out;
}

/** Words the router's evidence needs before it can be checked on a page. */
const EVIDENCE_MIN_WORDS = 4;
/**
 * A drop needs the router's "no page states it" AND a linked page that shares
 * at most this share of the claim's words: lite's "none" alone took good links
 * away. Tuned on the A arm of the #6904 replay (dev), reported on the B arm.
 */
export const DROP_MAX_OVERLAP = 0.7;

type RouteTrace = CitationPassReport['routes'][number];

/** Move only on evidence: the words the router quoted are on the new page, and not on the linked one. */
function shouldMove(r: RouteTrace): boolean {
  return r.evidenceOnTo === true && r.evidenceOnCited !== true;
}

/** The overlap is only a measure when claim and page share a language: the pages are English translations. */
function shouldDrop(r: RouteTrace, claim: string): boolean {
  const english = englishFraction(claim, 8);
  if (english === null || english < ENGLISH_SOURCE_THRESHOLD) return false;
  return r.citedOverlap <= DROP_MAX_OVERLAP;
}

/** Share of a claim's distinctive words (4+ letters) found on page i. */
function overlap(claim: string, idx: PageIndex, i: number): number {
  const words = [...new Set(foldWords(claim).filter(w => w.length >= 4 && !/^\d+$/.test(w)))];
  if (words.length === 0) return 0;
  const set = idx.own(i).set;
  return Math.round((words.filter(w => set.has(w)).length / words.length) * 100) / 100;
}

/** Folded words a quotation needs before it can place a link: "Secrets of Music" is on many pages. */
const PLACE_MIN_WORDS = 5;
/** A shorter quotation still places a link within its own book, when exactly one page of that book holds it. */
const SAME_BOOK_MIN_WORDS = 3;
/** Moving a link to ANOTHER book needs the quotation in that one book alone. */
const CROSS_BOOK_MIN_WORDS = 6;

type QuoteVerdict =
  | { kind: 'ok' | 'uncheckable' | 'paraphrase' }
  | { kind: 'move'; target: number; quote: string }
  | { kind: 'stitched'; quote: string };

/**
 * Where a quoted claim's link should point. The linked page holding any of
 * its quotations is enough (a sentence can quote two pages; the link names
 * one). Otherwise the link moves to a page holding all of them — same book,
 * nearest page first; another book only for a long quotation found in that
 * one book alone.
 */
/**
 * A quoted Title-Case phrase ("Secret Alphabet of Honorius of Thebes") is a
 * name or a title, not a quotation: it is on every page that discusses the
 * thing. On the replay it moved a correct link to the page that merely named it.
 */
function isTitlePhrase(q: string): boolean {
  const words = q.match(/\p{L}{4,}/gu) ?? [];
  return words.length > 0 && words.filter(w => /^\p{Lu}/u.test(w)).length / words.length >= 0.6;
}

function quoteVerdict(c: LinkedClaim, cited: number, idx: PageIndex): QuoteVerdict {
  const words = (q: string) => fragments(q).flat().length;
  const placeable = c.quotes.filter(q => words(q) >= SAME_BOOK_MIN_WORDS && !isTitlePhrase(q));
  if (placeable.length === 0) return { kind: 'paraphrase' };
  if (cited >= 0 && placeable.some(q => quoteOnPage(q, idx, cited))) return { kind: 'ok' };
  const found = placeable.map(q => ({ q, ...pagesHoldingQuote(q, idx) }));
  const longest = [...found].sort((x, y) => words(y.q) - words(x.q))[0];
  const all = idx.pages.map((_, i) => i).filter(i => found.every(f => f.whole.includes(i)));
  const candidates = all.length > 0 ? all : longest.whole;
  if (candidates.length > 0) {
    // Its own book: nearest page; a short quotation only when one page of the book holds it.
    const same = candidates.filter(i => idx.pages[i].bookSlug === c.link.slug);
    if (same.length > 0 && (words(longest.q) >= PLACE_MIN_WORDS || same.length === 1)) {
      const target = same.sort((a, b) => Math.abs(idx.pages[a].page - c.link.page) - Math.abs(idx.pages[b].page - c.link.page))[0];
      return { kind: 'move', target, quote: longest.q };
    }
    // Another book: the linked page must have been loaded (else it may hold the
    // quotation after all), the quotation long, and only one book may hold it.
    const books = new Set(candidates.map(i => idx.pages[i].bookId));
    if (same.length === 0 && cited >= 0 && books.size === 1 && words(longest.q) >= CROSS_BOOK_MIN_WORDS) {
      const target = [...candidates].sort((a, b) => idx.pages[a].page - idx.pages[b].page)[0];
      return { kind: 'move', target, quote: longest.q };
    }
    return { kind: 'paraphrase' };
  }
  if (cited < 0) return { kind: 'uncheckable' };
  // On no single page. One quotation whose pieces (between ellipses) are each
  // found word for word, but only in different books, was pieced together.
  for (const f of found) {
    if (f.perFragment.length < 2 || f.perFragment.some(l => l.length === 0)) continue;
    const books = [...new Set(f.perFragment.flat().map(i => idx.pages[i].bookId))];
    if (!books.some(b => f.perFragment.every(l => l.some(i => idx.pages[i].bookId === b)))) return { kind: 'stitched', quote: f.q };
  }
  return { kind: 'paraphrase' };
}

/** The same link in a unit that earlier edits may have shifted: same URL and label, nearest offset. */
function relocate(s: string, link: PageLink): PageLink | null {
  const same = findPageLinks(s).filter(l => l.url === link.url && l.label === link.label);
  return same.sort((a, b) => Math.abs(a.start - link.start) - Math.abs(b.start - link.start))[0] ?? null;
}

/** Same book first, nearest page; otherwise the first page read that holds it. */
function pickTarget(candidates: number[], link: PageLink, pages: GroundingPage[]): number {
  const same = candidates.filter(i => pages[i].bookSlug === link.slug);
  if (same.length) return same.sort((a, b) => Math.abs(pages[a].page - link.page) - Math.abs(pages[b].page - link.page))[0];
  return candidates[0];
}
