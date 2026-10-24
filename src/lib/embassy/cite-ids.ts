/**
 * Cite by ID (#6946). Every page a tool shows the Librarian carries a short ID
 * (`[P7]`); the model writes the ID where a page link goes, and the server turns
 * it into today's link markup while the text streams. The reader's client, the
 * grounding pass and the citation-page pass see the same `[Page N](…)` shapes
 * they see now; the model never types a page number or a page URL.
 *
 * Why: the weekly gauge found 19 of 105 page links on the wrong page or on none.
 * A model copying "p.323" by hand across a dozen passages from the same books
 * mixes the numbers up.
 *
 * PRIOR ART: citation-pages.ts `findPageLinks` / `citationTail` (they parse the
 * shapes rendered here) and grounding.ts's attribution tail
 * (`*[Title](book)*, [Page N](page)`, copied as the title-and-page form). Neither
 * assigns IDs; citation-fixes.ts repairs links after the turn, while this has to
 * act inside the stream, before the text leaves the server.
 */

export interface CitePage {
  /** Resolved book id (the support-set key). */
  bookId: string;
  /** Slug for the URL; the book id when there is none. */
  slug: string;
  title: string;
  page: number;
}

const escapeMd = (s: string) => s.replace(/([[\]])/g, '\\$1');

function shortTitle(t: string): string {
  const clean = t.replace(/\s+/g, ' ').trim();
  if (clean.length <= 70) return clean;
  const cut = clean.slice(0, 70);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40))}…`;
}

/** The pages of one turn, each with its ID. The same page keeps the same ID across tool calls. */
export class CiteIds {
  private byKey = new Map<string, string>();
  private byId = new Map<string, CitePage>();

  constructor(readonly base: string, readonly pageWord = 'Page') {}

  /** `[P7]` for this page, minted the first time the page is shown. */
  tag(p: CitePage): string {
    const key = `${p.bookId}:${p.page}`;
    let id = this.byKey.get(key);
    if (!id) {
      id = `P${this.byKey.size + 1}`;
      this.byKey.set(key, id);
      this.byId.set(id, p);
    }
    return `[${id}]`;
  }

  get(id: string): CitePage | undefined {
    return this.byId.get(id.toUpperCase());
  }

  get size(): number {
    return this.byId.size;
  }

  pageUrl(p: CitePage): string {
    return `${this.base}/book/${p.slug}?page=${p.page}`;
  }

  /**
   * The link for one page. `context` is the text before it in the same
   * paragraph: unless the book is linked since the last page link there, the
   * short title goes first, so a bare `[P7]` still tells the reader which book
   * (often which of several editions) it is.
   */
  render(p: CitePage, context: string): string {
    const page = `[${this.pageWord} ${p.page}](${this.pageUrl(p)})`;
    const book = `${this.base}/book/${p.slug}`;
    const last = lastPageLink(context);
    // Named when the book is linked after the last page link, or that link was to this same book.
    const named = context.slice(last.end).includes(`${book})`) || last.url.startsWith(`${book}?`) || last.url.startsWith(`${book}/`);
    return named ? page : `*[${escapeMd(shortTitle(p.title))}](${book})*, ${page}`;
  }
}

/** The last page link in `s`: where it ends and its URL (0 and '' when there is none). */
function lastPageLink(s: string): { end: number; url: string } {
  let last = { end: 0, url: '' };
  for (const m of s.matchAll(/\]\(([^)\s]*(?:\?page=|\/page-number\/)\d+)\)/g)) last = { end: m.index! + m[0].length, url: m[1] };
  return last;
}

/** `[P7]`, `[P3, P7]`, `[P3; P7]`, optionally followed by a stray `(url)` the model added. */
const TOKEN = /(\s*)\[\s*(P\d+(?:\s*[,;]\s*P\d+)*)\s*\](\([^)\s]*\))?/gi;
/** A tail that may still become a token when the next chunk arrives. */
const PARTIAL = /\s*(?:\[\s*(?:P\d*(?:\s*[,;]\s*)?)*(?:\s*\](?:\([^)\s]*)?)?)?$/i;

export interface CiteIdStats {
  /** IDs turned into links. */
  rendered: number;
  /** IDs the model wrote that no tool gave this turn: dropped, the claim kept as plain text. */
  dropped: number;
}

/**
 * Rewrites IDs to links across streamed chunks. A chunk boundary can split a
 * token (`[P1` | `2]`), so a tail that could still be one is held back until
 * the next chunk or `flush()`.
 */
export class CiteIdStream {
  private buf = '';
  private emitted = '';
  private lastRenderedEnd = -1;
  private lastBook: string | undefined;
  readonly stats: CiteIdStats = { rendered: 0, dropped: 0 };

  constructor(private ids: CiteIds) {}

  push(chunk: string): string {
    this.buf += chunk;
    return this.drain(false);
  }

  flush(): string {
    return this.drain(true);
  }

  private drain(final: boolean): string {
    const hold = final ? 0 : (this.buf.match(PARTIAL)?.[0].length ?? 0);
    const ready = this.buf.slice(0, this.buf.length - hold);
    this.buf = this.buf.slice(this.buf.length - hold);
    const out = this.rewrite(ready);
    this.emitted += out;
    return out;
  }

  private rewrite(s: string): string {
    let out = '';
    let last = 0;
    for (const m of s.matchAll(TOKEN)) {
      const at = m.index!;
      out += s.slice(last, at);
      last = at + m[0].length;
      const lead = m[1];
      const pages = m[2].split(/\s*[,;]\s*/).map(id => this.ids.get(id));
      const known = pages.filter((p): p is CitePage => !!p);
      this.stats.dropped += pages.length - known.length;
      if (known.length === 0) {
        // Dropped: keep a word break only where one is needed ("claim [P99] and" → "claim and").
        const next = s[last] ?? '';
        out += lead.includes('\n') ? lead.slice(lead.indexOf('\n')) : lead && /[\p{L}\p{N}*_[(]/u.test(next) ? ' ' : '';
        continue;
      }
      const before = this.emitted + out;
      const para = before.slice(before.lastIndexOf('\n\n') + 1);
      // `[P3][P7]`: the second token follows the first's link directly.
      const follows = !lead && this.lastRenderedEnd === before.length && before.length > 0;
      let prevBook: string | undefined;
      let rendered = '';
      for (const p of known) {
        const sep = prevBook === undefined ? '' : prevBook === p.bookId ? ', ' : '; ';
        rendered += sep + this.ids.render(p, para + rendered);
        prevBook = p.bookId;
        this.stats.rendered++;
      }
      const prev = before.slice(-1);
      out += (follows ? (this.lastBook === known[0].bookId ? ', ' : '; ') : lead || (prev && !/[\s(]/.test(prev) ? ' ' : '')) + rendered;
      this.lastRenderedEnd = this.emitted.length + out.length;
      this.lastBook = prevBook;
    }
    return out + s.slice(last);
  }
}
