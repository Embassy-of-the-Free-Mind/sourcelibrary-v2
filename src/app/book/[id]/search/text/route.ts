/**
 * /book/<slug>/search/text?q=…: one book's matching passages, for an assistant (#8161).
 *
 * Someone asks their assistant what a historical book says about something, and the
 * assistant opens our book page. Its fetch tool answers from that one page, and the
 * landing page has the catalogue, overview and index but not the passages. In the
 * citation baseline (#8268) that was where every run stopped: "the page doesn't
 * include the passages". This page puts them in the HTML: page number, a short
 * snippet labelled as translation or transcription, the reader link and the quote URL.
 *
 * PRIOR ART: src/app/search/text/route.ts is the same page for the whole library, and
 * this copies it: an in-process call to the API handler, so the API's own checks (a
 * hidden book is a 404) and search log apply, through the gate /api/search uses.
 * /book/<slug>/search is the person's version, a client page that is empty without
 * JavaScript; the proxy sends named assistant fetchers from it to here.
 *
 * A discovery surface, not a reading one: the top passages /api/books/<id>/search
 * already returns, with no paging, short snippets, never the book's text (that is
 * /api/books/<id>/text, which stays out). Declared training crawlers are refused. It is
 * noindex and disallowed for the default robots group, and refused on partner
 * subdomains (src/lib/tenant-global-paths.ts), where a reading room's links must stay
 * on the room's host.
 */
import { NextRequest, NextResponse } from 'next/server';
import { GET as bookSearchHandler } from '@/app/api/books/[id]/search/route';
import { withApiAuth } from '@/lib/api-auth';
import { isBot, isTrustedBot } from '@/lib/bot-gate';
import { getReadDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';

export const preferredRegion = 'fra1';

const BASE = 'https://sourcelibrary.org';

// /api/books/<id>/search is limited at the edge (the proxy's bot limiter on /api/),
// which a page outside /api/ never meets. So this caller goes through the same
// per-address gate as /api/search, and therefore as /search/text: the same anon and
// assistant allowances, and the same api_usage log.
const bookSearchApi = withApiAuth(bookSearchHandler, { route: 'book_search_text' });

/** Passages shown. The API caps at 50; a better query beats a longer list. */
const PASSAGES_SHOWN = 20;
/** Snippets per passage. The API returns up to three, each about 160 characters. */
const SNIPPETS_PER_PASSAGE = 2;

interface Match { field?: 'ocr' | 'translation'; snippet?: string }
interface Result { pageId?: string; pageNumber?: number; matches?: Match[]; is_front_matter?: boolean }
interface BookDoc {
  id?: string;
  slug?: string;
  title?: string;
  display_title?: string;
  author?: string;
  published?: string;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/** Say what kind of words these are, in terms a model will repeat. */
function snippetLabel(field: Match['field']): string {
  return field === 'translation' ? 'machine translation' : 'transcription of the original';
}

function page(status: number, title: string, body: string): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${esc(title)}</title></head><body>${body}</body></html>`;
  return new NextResponse(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Answers depend on who asks and on their limits, so nothing keeps a copy.
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

function notFound(): NextResponse {
  return page(404, 'Source Library', `<p>No such book. Search the library at <a href="${BASE}/search/text?q=YOUR+WORDS">${BASE}/search/text?q=YOUR+WORDS</a>.</p>`);
}

function renderResult(r: Result, bookPath: string, bookId: string, bookTitle: string): string {
  const pageUrl = `${BASE}/book/${bookPath}/page/${encodeURIComponent(String(r.pageId))}`;
  const quoteUrl = `${BASE}/api/books/${encodeURIComponent(bookId)}/quote?page=${encodeURIComponent(String(r.pageNumber))}`;
  const front = r.is_front_matter ? ' <small>[front matter]</small>' : '';
  const snippets = (r.matches ?? [])
    .filter((m) => m.snippet)
    .slice(0, SNIPPETS_PER_PASSAGE)
    .map((m) => `<br>${esc(m.snippet)} <small>[${snippetLabel(m.field)}]</small>`)
    .join('');
  return `<li><a href="${pageUrl}">${esc(bookTitle)}, page ${esc(r.pageNumber)}</a>${front}${snippets}`
    + `<br>Text and citation: <a href="${quoteUrl}">${esc(quoteUrl)}</a></li>`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isBot(request) && !(await isTrustedBot(request))) {
    return page(403, 'Source Library', `<p>Bulk and training use is licensed: <a href="${BASE}/licensing">${BASE}/licensing</a>.</p>`);
  }
  // The proxy refuses this path on a partner host; this is the second lock.
  if (getTenantContextFromRequest(request.headers).slug) return notFound();

  const { id: segment } = await params;
  const db = await getReadDb();
  const book = await db.collection('books').findOne(
    { $or: [{ id: segment }, { slug: segment }] },
    { projection: { _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, published: 1 } },
  ) as BookDoc | null;
  if (!book?.id) return notFound();

  const bookPath = encodeURIComponent(book.slug || book.id);
  const bookUrl = `${BASE}/book/${bookPath}`;
  const title = book.display_title || book.title || 'Untitled';
  const original = book.display_title && book.title && book.title !== book.display_title ? ` (${esc(book.title)})` : '';
  const byline = [book.author, book.published].filter(Boolean).map(esc).join(', ');
  const heading = `<p><a href="${bookUrl}">${esc(title)}</a>${original}${byline ? `, ${byline}` : ''}</p>`;

  const q = (request.nextUrl.searchParams.get('q') || '').trim().slice(0, 200);
  if (q.length < 2) {
    return page(400, `Search ${title}`, `<h1>Search this book</h1>${heading}<p>Add your words to this address: <code>${bookUrl}/search/text?q=YOUR+WORDS</code>. Words in the original language find the transcription, English words find the translation.</p>`);
  }

  // The book's own id, never the slug: the API finds the book by either, but filters
  // its pages by the value it was given, and pages carry the id.
  const apiUrl = `${BASE}/api/books/${encodeURIComponent(book.id)}/search?q=${encodeURIComponent(q)}`;
  const res = await bookSearchApi(
    new NextRequest(apiUrl, { headers: request.headers }),
    { params: Promise.resolve({ id: book.id }) },
  );
  if (res.status === 404) return notFound();
  if (!res.ok) {
    const limited = res.status === 429 || res.status === 401;
    return page(limited ? 429 : 502, `Search ${title}`, limited
      ? `<p>Search limit reached for this address. Try again in a while, or read the book at <a href="${bookUrl}">${bookUrl}</a>.</p>`
      : `<p>Search did not answer. Try again, or read the book at <a href="${bookUrl}">${bookUrl}</a>.</p>`);
  }

  const data = await res.json() as { total?: number; results?: Result[] };
  const results = (data.results ?? []).filter((r) => r.pageId && r.pageNumber != null).slice(0, PASSAGES_SHOWN);
  const total = typeof data.total === 'number' ? data.total : results.length;

  const body = [
    `<h1>Passages matching “${esc(q)}”</h1>`,
    heading,
    results.length
      ? `<p>${results.length === total ? `${total} matching pages.` : `The top ${results.length} of ${total} matching pages.`}</p><ol>${results.map((r) => renderResult(r, bookPath, book.id!, title)).join('')}</ol>`
      : '<p>No passages matched. Empty results mean try other words, not that the book does not discuss it: try the period’s own vocabulary and the original language.</p>',
    results.length ? `<h2>Using these</h2><p>Open a page to read it beside its scan. Quote only text you received, word for word, and give the author, the date, the page and the link. Most English here is machine translation, so say so. More: <a href="${BASE}/llms.txt">${BASE}/llms.txt</a></p>` : '',
    `<p>To go further, change the words. To search the whole library: <a href="${BASE}/search/text?q=${encodeURIComponent(q)}">${BASE}/search/text?q=${esc(encodeURIComponent(q))}</a></p>`,
  ].filter(Boolean).join('');

  return page(200, `${q} in ${title} - Source Library`, body);
}
