/**
 * Offline citation fixer (#6946, stage 1): a model reads one finished Librarian answer and the whole text of
 * every page read that turn, and says per page link `keep` / `move` / `drop`, each `keep` and `move` with a
 * VERBATIM span from the page that states the claim. Code then decides, not the model:
 *
 *  - the span is string-matched on the page (folded with foldWords: case, diacritics, ligatures, long s,
 *    every script's letters and digits; a page-break spread counts);
 *  - `keep` whose span is not on the linked page → `drop`;
 *  - `move` is applied only when the span is on the TARGET page, and not when it is also on the linked page
 *    (then the linked page says it: `keep`); a span on neither page → `drop`;
 *  - a span too short to prove anything (under 4 words, or under 6 letters in a script written without
 *    spaces) is UNJUDGEABLE, not a miss: the link stays as written (non-latin-text-operations.md);
 *  - a link whose page was not loaded, or that captions an image embed, is left alone.
 *
 * Why this shape (research report 2026-10-19, ops repo; the #6956 router): choosing among similar pages is
 * what failed — the flash-lite router made 3 of its 10 moves worse — so a link moves only on an exact
 * quotation, and a claim no page holds cannot be repaired: the link goes and the claim is marked as not
 * from the library.
 *
 * Output: grounding edits (`find`/`replace`/`at`, one per paragraph changed), the shape the clients'
 * applyGroundingEdits already applies. A dropped link becomes the marker DROP_MARK.
 *
 * PRIOR ART: src/lib/embassy/citation-pages.ts (#6956: the deterministic quotation re-pointer and the router;
 * reused here — findPageLinks, citationTail, buildPageIndex — and its one-edit-per-unit output);
 * scripts/eval/librarian-citations-6946/packet.ts (the judge packet: same whole pages, same wrapper strip,
 * so the fixer and the instrument read identical page text); src/lib/embassy/grounding.ts foldWords.
 *
 * Client-safe: no server imports.
 */
import { foldWords, isMostlyLatin, type GroundingEdit, type GroundingPage } from '@/lib/embassy/grounding';
import { buildPageIndex, citationTail, findPageLinks, type PageIndex, type PageLink } from '@/lib/embassy/citation-pages';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';

/** Whole pages, as the judge packet reads them (packet.ts). */
const PAGE_CHARS = 20000;

export const DROP_MARK = { en: "(not from the library's pages)", es: '(no procede de las páginas de la biblioteca)' } as const;

export const FIXER_PROMPT = `You are checking the page links in one answer written by a research librarian for a digital library of
historical primary sources. In the answer, every link to a specific book page is followed by a marker like ⟦L3⟧.
Below the answer: the list of links, then the full text of every page the librarian read this turn, each headed
with an id like [P7] (the English translation, then the original-language transcription when there is one).

A reader who clicks a page link expects to land on the page that says the thing the link is attached to. For each
link, decide what its CLAIM is (the quotation, sentence or list item it is cited for; a link under a blockquote is
cited for the blockquote; when a link carries several claims, take its main one), then choose ONE action:

- "keep" — the linked page itself states the claim. Small wording or translation drift is fine, and so is a
  quotation that starts on the linked page and runs over onto the next. A link that points a reader to a page for
  what the page shows or contains (a plate, a recipe, a title page, a passage worth reading) is kept when the page
  shows or contains it. Copy into "span" the words on THAT page that state it.
- "move" — the linked page does not state it, but another page below does. Give that page's id as "page" (e.g.
  "P7") and copy into "span" the words on THAT page that state it.
- "drop" — no page below states it. It is background knowledge, from somewhere you cannot see, or invented.

The span is checked by a program, letter for letter, against the page you name: copy ONE contiguous run of 6 to 40
words exactly as the page writes it (spelling, old forms and all) from the English translation or the original
transcription. No ellipsis, no paraphrase, no words added. Every "keep" and "move" needs its span. If you cannot
copy such a run from a page, that page does not state the claim.

A page about the same topic does not state the claim; it must say what the claim says. A quotation must be on the
page. Prefer "keep" when the linked page states the claim, even if another page states it too. Choose "move" only
for a page that states the claim clearly; never move a link to a page that only touches the topic. Choose "drop"
when you have read the pages and none of them states the claim.

Do not use any tools. Reply with ONLY one JSON object on a single line, no code fence, one entry per link in order:
{"links":[{"id":"L1","action":"keep|move|drop","page":"<P id, only for move>","span":"<verbatim words, for keep and move>","claim":"<the claim in a few words>"}]}
`;

export interface FixerLink { id: string; link: PageLink; pageIdx: number | null }
export interface FixerPacket { md: string; links: FixerLink[]; pages: GroundingPage[]; pageIds: string[] }

/** Page text as the judge reads it: editorial wrappers stripped, each part cut at PAGE_CHARS. */
export function readablePages(pages: GroundingPage[]): GroundingPage[] {
  return pages.map(p => {
    const parts = (p.parts ?? [p.text]).map(t => (t ? stripEditorialWrappers(t).slice(0, PAGE_CHARS) : ''));
    return { ...p, parts, text: parts.filter(Boolean).join('\n') };
  });
}

const pageHead = (p: GroundingPage) => `${p.bookSlug} p.${p.page}`;

function locate(link: PageLink, pages: GroundingPage[]): number | null {
  const i = pages.findIndex(p => p.page === link.page && (p.bookSlug === link.slug || p.bookId === link.slug));
  return i === -1 ? null : i;
}

/** One answer → the fixer's packet. Pages are the readable pages (call readablePages first). */
export function fixerPacket(question: string, text: string, pages: GroundingPage[]): FixerPacket {
  const found = findPageLinks(text);
  const links = found.map((l, i) => ({ id: `L${i + 1}`, link: l, pageIdx: locate(l, pages) }));
  let marked = text;
  for (let i = found.length - 1; i >= 0; i--) marked = `${marked.slice(0, found[i].end)} ⟦L${i + 1}⟧${marked.slice(found[i].end)}`;
  const pageIds = pages.map((_, i) => `P${i + 1}`);
  const linkList = links.map(l => `- ${l.id} → ${l.link.slug} p.${l.link.page} ${l.pageIdx === null ? '(this page was NOT loaded: answer "keep" with an empty span)' : `[${pageIds[l.pageIdx]}]`}`).join('\n');
  const blocks = pages.map((p, i) => {
    const [tr, orig] = [p.parts?.[0] ?? p.text, p.parts?.[1] ?? ''];
    return `### [${pageIds[i]}] ${pageHead(p)} — ${p.bookTitle}\n\n**English translation:**\n\n${tr || '(none)'}${orig ? `\n\n**Original transcription:**\n\n${orig}` : ''}`;
  });
  const md = `## Question\n\n${question}\n\n## Answer\n\n${marked}\n\n## Links\n\n${linkList}\n\n## Pages the librarian read (${pages.length})\n\n${blocks.join('\n\n---\n\n') || '(none)'}\n`;
  return { md, links, pages, pageIds };
}

export interface FixerVerdict { id: string; action: string; page?: string; span?: string; claim?: string }

/** The last `{"links":[…]}` object in a model reply, or null (a reply can correct itself with a second one). */
export function parseFixerReply(reply: string): FixerVerdict[] | null {
  const starts = [...reply.matchAll(/\{\s*"links"/g)].map(m => m.index!).reverse();
  for (const s of starts) {
    for (let e = reply.lastIndexOf('}'); e > s; e = reply.lastIndexOf('}', e - 1)) {
      try {
        const v = JSON.parse(reply.slice(s, e + 1)).links;
        if (Array.isArray(v)) return v;
      } catch { /* a shorter slice may parse */ }
    }
  }
  return null;
}

// ── Span on page ─────────────────────────────────────────────────────

export type SpanCheck = 'on' | 'off' | 'short';

/** A keep needs this many consecutive words of its span on the linked page. */
export const KEEP_WINDOW = 6;

function spanFragments(span: string): string[][] {
  return span.replace(/[*_`"“”„«»]/g, ' ').split(/\s*(?:\.{3,}|…|\[\s*\.\.\.\s*\])\s*/).map(f => foldWords(f)).filter(f => f.length > 0);
}

/**
 * Is the span on page i? `short` = too little to prove anything, so unjudgeable. Words in sequence on the
 * page's own readings or across its page break; for a script written without spaces (one long "word"), the
 * letters in sequence.
 */
export function spanOnPage(span: string, idx: PageIndex, i: number, window = 0): SpanCheck {
  const frags = spanFragments(span);
  if (frags.length === 0) return 'short';
  const latin = isMostlyLatin(span);
  for (const f of frags) {
    const letters = f.join('').length;
    if (latin ? f.length < 4 : letters < 6) return 'short';
  }
  const inSeqs = (seqs: string[], f: string[]) => {
    const needle = ` ${f.join(' ')} `;
    if (seqs.some(s => s.includes(needle))) return true;
    if (latin) return false;
    const solid = f.join('');
    return seqs.some(s => s.replace(/ /g, '').includes(solid));
  };
  // A spread is the end of one page joined to the start of the next, so it holds a short neighbour WHOLE: a
  // span counts for page i through a spread only when it is not wholly on the neighbour — else a span on p.22
  // would validate a link to p.23, the very error this exists to catch.
  const me = idx.pages[i];
  const neighbours = idx.pages.map((_, j) => j).filter(j => j !== i && idx.pages[j].bookId === me.bookId && Math.abs(idx.pages[j].page - me.page) === 1);
  const on = (f: string[]) => inSeqs(idx.own(i).seqs, f)
    || (inSeqs(idx.spreads(i), f) && !neighbours.some(j => inSeqs(idx.own(j).seqs, f)));
  // window > 0 (keep): any `window` consecutive words of the span will do — a copying slip elsewhere in a
  // long span is not evidence against the page. A move needs the whole span (exact-quote rule).
  if (window > 0 && latin) {
    return frags.some(f => f.length <= window ? on(f) : f.slice(0, f.length - window + 1).some((_, k) => on(f.slice(k, k + window)))) ? 'on' : 'off';
  }
  return frags.every(on) ? 'on' : 'off';
}

// ── Verdicts → outcomes ──────────────────────────────────────────────

export type FixOutcome =
  | 'keep'            // span on the linked page
  | 'move'            // span on the target page and not on the linked page
  | 'drop'            // the model said drop
  | 'drop_unverified' // keep or move whose span is on no page it names
  | 'keep_span_short' // span too short to check: left as written
  | 'not_loaded'      // the linked page was not loaded: left as written
  | 'caption'         // the link captions an image embed: left as written
  | 'no_verdict';     // the model gave nothing usable for this link: left as written

export interface LinkOutcome {
  id: string;
  link: PageLink;
  action: string | null;
  outcome: FixOutcome;
  /** For `move`: the page the link now names. */
  to?: GroundingPage;
  span?: string;
  claim?: string;
  /** For `move` asked: the target page id the model named. */
  asked?: string;
}

const CHANGES = new Set<FixOutcome>(['move', 'drop', 'drop_unverified']);
export const changesLink = (o: LinkOutcome) => CHANGES.has(o.outcome);

/** The paragraph around offset `at`. */
function paragraphAt(text: string, at: number): { start: number; end: number } {
  const s = text.lastIndexOf('\n\n', at);
  const e = text.indexOf('\n\n', at);
  return { start: s === -1 ? 0 : s + 2, end: e === -1 ? text.length : e };
}

/**
 * A caption: the link sits on an image-embed line or the line right after one. It names the image's own page,
 * which a page's TEXT need not describe (4 of the 25 wrong-page links #6956 counted were this), and the
 * image records are not reliable enough to check it against (a gallery row with page -60 for p.60). Left alone.
 */
function isCaptionLink(text: string, link: PageLink): boolean {
  const lineStart = text.lastIndexOf('\n', link.start - 1) + 1;
  const prevStart = lineStart > 0 ? text.lastIndexOf('\n', lineStart - 2) + 1 : lineStart;
  const lineEnd = text.indexOf('\n', link.start);
  return /!\[[^\]]*\]\(/.test(text.slice(prevStart, lineEnd === -1 ? text.length : lineEnd));
}

export function validateVerdicts(
  text: string, packet: FixerPacket, verdicts: FixerVerdict[] | null,
): LinkOutcome[] {
  const idx = buildPageIndex(packet.pages);
  const byId = new Map((verdicts ?? []).map(v => [v?.id, v]));
  return packet.links.map(({ id, link, pageIdx }) => {
    const v = byId.get(id);
    const base = { id, link, action: v?.action ?? null, span: v?.span, claim: v?.claim };
    if (pageIdx === null) return { ...base, outcome: 'not_loaded' as const };
    if (isCaptionLink(text, link)) return { ...base, outcome: 'caption' as const };
    if (!v || !['keep', 'move', 'drop'].includes(v.action)) return { ...base, outcome: 'no_verdict' as const };
    if (v.action === 'drop') return { ...base, outcome: 'drop' as const };
    const span = typeof v.span === 'string' ? v.span : '';
    const onLinked = spanOnPage(span, idx, pageIdx, KEEP_WINDOW);
    if (onLinked === 'short') return { ...base, outcome: 'keep_span_short' as const };
    // "keep" naming another page is read as the move it describes; it is validated the same way.
    const named = packet.pageIds.indexOf(String(v.page ?? '').replace(/[[\]\s]/g, ''));
    if (v.action === 'keep' && (named === -1 || named === pageIdx)) return { ...base, outcome: onLinked === 'on' ? 'keep' as const : 'drop_unverified' as const };
    // move
    const target = named;
    const asked = v.page;
    if (onLinked === 'on') return { ...base, asked, outcome: 'keep' as const };
    // A page numbered below 1 is a parked or broken record, never a page a reader can open.
    if (target === -1 || target === pageIdx || packet.pages[target].page < 1) return { ...base, asked, outcome: 'drop_unverified' as const };
    return spanOnPage(span, idx, target) === 'on'
      ? { ...base, asked, outcome: 'move' as const, to: packet.pages[target] }
      : { ...base, asked, outcome: 'drop_unverified' as const };
  });
}

// ── Outcomes → text edits ─────────────────────────────────────────────

const escapeMd = (s: string) => s.replace(/([[\]])/g, '\\$1');
const PAGE_LABEL = /^(?:p(?:age|ágina|agina)?s?\.?|pp\.|fol\.?|f\.)\s*\d+[a-z]?$/i;

function shortTitle(t: string): string {
  const clean = t.replace(/\s+/g, ' ').trim();
  if (clean.length <= 70) return clean;
  const cut = clean.slice(0, 70);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 70)}…`;
}

function pageUrl(link: PageLink, to: GroundingPage): string {
  return link.url.includes('?page=')
    ? `https://sourcelibrary.org${link.locale}/book/${to.bookSlug}?page=${to.page}`
    : `https://sourcelibrary.org${link.locale}/book/${to.bookSlug}/page-number/${to.page}`;
}

/** Another page link sits inside [from, link.start): its citation chain is shared, so it must not be touched. */
const sharesChain = (s: string, from: number, link: PageLink) => findPageLinks(s.slice(from, link.start)).length > 0;

/** Move `link` (offsets in `s`) to `to`. Same-book: the URL and the number in the label. Another book: its title too. */
function moveIn(s: string, link: PageLink, to: GroundingPage): string {
  let label = link.label.replace(new RegExp(`(^|\\D)${link.page}(?!\\d)`), (_m, pre: string) => `${pre}${to.page}`);
  if (label === link.label && !label.includes(String(to.page))) label = `${label}, p. ${to.page}`;
  const url = pageUrl(link, to);
  const plain = `${s.slice(0, link.start)}[${label}](${url})${s.slice(link.end)}`;
  if (to.bookSlug === link.slug) return plain;
  const tail = citationTail(s, link);
  const titled = `${s.slice(0, link.start)}[${escapeMd(shortTitle(to.bookTitle))}, ${PAGE_LABEL.test(link.label.trim()) ? label : `p. ${to.page}`}](${url})${s.slice(link.end)}`;
  if (!tail?.titleLink || sharesChain(s, tail.titleLink.end, link)) return titled;
  const t = tail.titleLink;
  const fresh = s.slice(t.start, t.end).replace(`[${t.label}]`, `[${escapeMd(shortTitle(to.bookTitle))}]`).replace(new RegExp(`/book/${t.slug}(?![a-z0-9-])`), `/book/${to.bookSlug}`);
  return `${plain.slice(0, t.start)}${fresh}${plain.slice(t.end)}`;
}

/** Drop `link`: its citation goes and the marker takes its place; a link inside a sentence keeps its words as a book link and the sentence ends with the marker. */
function dropIn(s: string, link: PageLink, mark: string): string {
  const tail = citationTail(s, link);
  if (tail) {
    // Another page link shares the chain ("[Page 5](…), [Page 6](…)"): take only this link and its separator.
    const start = sharesChain(s, tail.start, link) ? link.start - (s.slice(0, link.start).match(/\s*[,;]\s*$|\s+$/)?.[0].length ?? 0) : tail.start;
    const end = sharesChain(s, tail.start, link) ? link.end : tail.end;
    if (start !== tail.start) return `${s.slice(0, start)}${s.slice(end)}`;
    // "…beyond. — *[T](…)*, [Page 5](…)." → "…beyond (mark)."
    let before = s.slice(0, start).replace(/[ \t]+$/, '');
    const after = s.slice(end);
    if (/\.$/.test(before) && /^\./.test(after) && !/\.\.$/.test(before)) before = before.slice(0, -1);
    return `${before} ${mark}${after}`;
  }
  const bookUrl = `https://sourcelibrary.org${link.locale}/book/${link.slug}`;
  const label = link.label.replace(/,?\s*(?:p(?:age|ágina|agina)?s?\.?|pp\.)\s*\d+[a-z]?\s*$/i, '').trim() || link.label;
  const out = `${s.slice(0, link.start)}[${label}](${bookUrl})${s.slice(link.end)}`;
  const from = link.start + label.length + bookUrl.length + 4;
  const m = /[.!?](?=\s|$)|\n|$/.exec(out.slice(from));
  const at = from + (m?.index ?? out.length - from);
  return `${out.slice(0, at)} ${mark}${out.slice(at)}`;
}

/**
 * The edits that apply the outcomes: one per paragraph changed (find = the paragraph as written, replace =
 * after every change in it), in document order — what applyGroundingEdits expects.
 */
export function fixerEdits(text: string, outcomes: LinkOutcome[], lang: 'en' | 'es' = 'en'): GroundingEdit[] {
  const changing = outcomes.filter(changesLink);
  const byPara = new Map<number, { start: number; end: number; links: LinkOutcome[] }>();
  for (const o of changing) {
    const p = paragraphAt(text, o.link.start);
    const e = byPara.get(p.start) ?? { ...p, links: [] };
    e.links.push(o);
    byPara.set(p.start, e);
  }
  const edits: GroundingEdit[] = [];
  for (const { start, end, links } of [...byPara.values()].sort((a, b) => a.start - b.start)) {
    let para = text.slice(start, end);
    // Last link first, so the offsets of the earlier ones hold.
    for (const o of [...links].sort((a, b) => b.link.start - a.link.start)) {
      const link = { ...o.link, start: o.link.start - start, end: o.link.end - start };
      const mark = DROP_MARK[link.locale === '/es' || lang === 'es' ? 'es' : 'en'];
      para = o.outcome === 'move' && o.to ? moveIn(para, link, o.to) : dropIn(para, link, mark);
    }
    edits.push({ find: text.slice(start, end), replace: para, at: start, reasons: ['citation_page'] });
  }
  return edits;
}
