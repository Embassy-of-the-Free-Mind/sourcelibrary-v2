/**
 * /search/text?q=…: search results an assistant can read (#8161).
 *
 * Someone asks their assistant about a historical source, and the assistant fetches
 * our search page. /search is a client page, so without JavaScript it is an empty
 * shell. Rendering results into it for everyone would turn a page served from cache
 * into a function call on every human search, so the proxy sends only named
 * assistant fetchers here, and other tools can ask for it by address.
 *
 * PRIOR ART: src/lib/mcp-inprocess.ts runs /api/search in-process too, but it skips
 * the gate because its caller already passed one. This caller has not, so it goes
 * through the gated handler and keeps the same limits and log as /api/search.
 *
 * A discovery surface, not a reading one: titles, links and the short snippets
 * /api/search already returns, with no paging. Going deeper means a better query or
 * opening a page, and pages have their own limits. Declared training crawlers are
 * refused, and it is noindex and disallowed for the default robots group.
 *
 * `&pictures=1` is the same page for illustrations, and the proxy sends fetchers from
 * /gallery?q=… here: /gallery ignores `q` until JavaScript runs and /api/gallery is
 * disallowed for them. It is a link off the results and not a third lane, so a search
 * for words does not pay for a gallery lookup. Each picture gets its link and the
 * book it came from; the file itself sits on images.sourcelibrary.org. Same PRIOR ART
 * as src/app/book/[id]/search/text/route.ts for the gate, and the fields follow
 * search_images in src/app/api/mcp/route.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { GET as galleryHandler } from '@/app/api/gallery/route';
import { GET as searchApi } from '@/app/api/search/route';
import { withApiAuth } from '@/lib/api-auth';
import { isBot, isTrustedBot } from '@/lib/bot-gate';

export const preferredRegion = 'fra1';

const BASE = 'https://sourcelibrary.org';
const RESULTS_PER_LANE = 10;
/** Pictures shown, and from one book, so one illustrated book does not fill the page. */
const PICTURES_SHOWN = 12;
const PICTURES_PER_BOOK = 2;

// /api/gallery is limited at the edge (the proxy's bot limiter on /api/), which a page
// outside /api/ never meets, so this caller carries the same per-address gate.
const galleryApi = withApiAuth(galleryHandler, { route: 'search_text_pictures' });

interface Hit {
  id?: string;
  type?: string;
  book_id?: string;
  slug?: string;
  title?: string;
  display_title?: string;
  author?: string;
  published?: string;
  language?: string;
  page_id?: string;
  page_number?: number;
  snippet?: string;
  snippet_type?: string;
}

interface Picture {
  source?: string;
  link?: string;
  pageId?: string;
  bookId?: string;
  pageNumber?: number;
  detectionIndex?: number;
  bookTitle?: string;
  author?: string;
  year?: string | number;
  description?: string;
  type?: string;
  extractedUrl?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/** Say what kind of words these are, in terms a model will repeat. */
function snippetLabel(type: string | undefined): string {
  if (type === 'summary') return 'AI description, not the author’s words';
  if (type === 'translation') return 'machine translation';
  if (type === 'ocr' || type === 'original') return 'transcription of the original';
  return 'excerpt';
}

function renderHit(hit: Hit): string {
  const book = hit.slug || hit.book_id || hit.id;
  const title = hit.display_title || hit.title || 'Untitled';
  const original = hit.display_title && hit.title && hit.title !== hit.display_title ? ` (${esc(hit.title)})` : '';
  const byline = [hit.author, hit.published, hit.language].filter(Boolean).map(esc).join(', ');
  const isPage = hit.page_number != null;
  const url = isPage
    ? `${BASE}/book/${encodeURIComponent(String(book))}/page/${encodeURIComponent(String(hit.page_id ?? hit.page_number))}`
    : `${BASE}/book/${encodeURIComponent(String(book))}`;
  const heading = isPage ? `${esc(title)}, page ${esc(hit.page_number)}` : esc(title);
  const quote = isPage && hit.book_id
    ? `<br>Text and citation: <a href="${BASE}/api/books/${encodeURIComponent(hit.book_id)}/quote?page=${esc(hit.page_number)}">${BASE}/api/books/${esc(hit.book_id)}/quote?page=${esc(hit.page_number)}</a>`
    : '';
  const snippet = hit.snippet ? `<br>${esc(hit.snippet)} <small>[${snippetLabel(hit.snippet_type)}]</small>` : '';
  return `<li><a href="${url}">${heading}</a>${original}${byline ? `<br>${byline}` : ''}${snippet}${quote}</li>`;
}

function renderPicture(p: Picture): string {
  const isArtwork = p.source === 'artwork';
  const url = isArtwork
    ? `${BASE}${p.link || `/book/${encodeURIComponent(String(p.bookId))}`}`
    : `${BASE}/gallery/image/${encodeURIComponent(String(p.pageId))}-${esc(p.detectionIndex ?? 0)}`;
  const file = p.extractedUrl || p.imageUrl;
  const title = esc(p.bookTitle || 'Untitled');
  const byline = [p.author, p.year].filter(Boolean).map(esc).join(', ');
  const where = isArtwork
    ? 'museum artwork'
    : `illustration on page ${esc(p.pageNumber)} of the book: <a href="${BASE}/book/${encodeURIComponent(String(p.bookId))}?page=${esc(p.pageNumber)}">${BASE}/book/${esc(p.bookId)}?page=${esc(p.pageNumber)}</a>`;
  const img = p.thumbnailUrl || file;
  return `<li>${img ? `<img src="${esc(img)}" alt="${esc(p.description || p.bookTitle)}" width="240" loading="lazy"><br>` : ''}`
    + `<a href="${esc(url)}">${title}</a>${byline ? `, ${byline}` : ''}`
    + `${p.description ? `<br>${esc(p.description)} <small>[AI description]</small>` : ''}`
    + `<br>${where}${file ? `<br>Image file: ${esc(file)}` : ''}</li>`;
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

async function lane(request: NextRequest, q: string, extra: string): Promise<{ status: number; results: Hit[] }> {
  const url = `${BASE}/api/search?q=${encodeURIComponent(q)}&limit=${RESULTS_PER_LANE}${extra}`;
  const res = await searchApi(new NextRequest(url, { headers: request.headers }), undefined as never);
  if (!res.ok) return { status: res.status, results: [] };
  const body = await res.json() as { results?: Hit[] };
  return { status: res.status, results: body.results ?? [] };
}

async function picturePage(request: NextRequest, q: string): Promise<NextResponse> {
  const url = `${BASE}/api/gallery?q=${encodeURIComponent(q)}&limit=${PICTURES_SHOWN}&maxPerBook=${PICTURES_PER_BOOK}`;
  const res = await galleryApi(new NextRequest(url, { headers: request.headers }), undefined as never);
  if (!res.ok) {
    const limited = res.status === 429 || res.status === 401;
    return page(limited ? 429 : 502, 'Search Source Library', limited
      ? `<p>Search limit reached for this address. Try again in a while. A person can browse at <a href="${BASE}/gallery">${BASE}/gallery</a>.</p>`
      : `<p>Search did not answer. Try again, or browse at <a href="${BASE}/gallery">${BASE}/gallery</a>.</p>`);
  }
  const data = await res.json() as { items?: Picture[]; total?: number };
  const items = (data.items ?? []).slice(0, PICTURES_SHOWN);
  const textUrl = `${BASE}/search/text?q=${encodeURIComponent(q)}`;
  const body = [
    `<h1>Pictures matching “${esc(q)}”</h1>`,
    items.length
      ? `<ol>${items.map(renderPicture).join('')}</ol><h2>Using these</h2><p>Open a picture’s link to see it with its source. Credit the book or artwork, the date and the link. The descriptions are AI-written, so check them against the picture.</p>`
      : '<p>No pictures matched. Try a plainer word for what is shown, in English.</p>',
    `<p>Books and passages for the same words: <a href="${esc(textUrl)}">${esc(textUrl)}</a></p>`,
  ].filter(Boolean).join('');
  return page(200, `${q} - Source Library pictures`, body);
}

export async function GET(request: NextRequest) {
  if (isBot(request) && !(await isTrustedBot(request))) {
    return page(403, 'Source Library', `<p>Bulk and training use is licensed: <a href="${BASE}/licensing">${BASE}/licensing</a>.</p>`);
  }

  const q = (request.nextUrl.searchParams.get('q') || '').trim().slice(0, 200);
  if (q.length < 2) {
    return page(400, 'Search Source Library', `<h1>Search Source Library</h1><p>Add your words to this address: <code>${BASE}/search/text?q=YOUR+WORDS</code>. Try the author’s name, the period’s own vocabulary and the original language.</p>`);
  }

  if (request.nextUrl.searchParams.get('pictures')) return picturePage(request, q);

  const [books, passages] = await Promise.all([
    lane(request, q, ''),
    lane(request, q, '&pages_only=true'),
  ]);

  if (books.status >= 400 && passages.status >= 400) {
    const limited = books.status === 429 || books.status === 401 || passages.status === 429 || passages.status === 401;
    return page(limited ? 429 : 502, 'Search Source Library', limited
      ? `<p>Search limit reached for this address. Try again in a while. A person can search at <a href="${BASE}/search">${BASE}/search</a>.</p>`
      : `<p>Search did not answer. Try again, or search at <a href="${BASE}/search">${BASE}/search</a>.</p>`);
  }

  const bookHits = books.results.filter((h) => h.page_number == null);
  const pageHits = passages.results;
  const found = bookHits.length + pageHits.length > 0;

  const body = [
    `<h1>Search results for “${esc(q)}”</h1>`,
    found ? '' : '<p>No results. Empty results mean try other words, not that the book does not exist: try the author’s name, the period’s own vocabulary and the original language.</p>',
    bookHits.length ? `<h2>Books</h2><ol>${bookHits.map(renderHit).join('')}</ol>` : '',
    pageHits.length ? `<h2>Passages</h2><ol>${pageHits.map(renderHit).join('')}</ol>` : '',
    found ? `<h2>Using these</h2><p>Open a passage to read the page beside its scan. Quote only text you received, word for word, and give the author, the date, the page and the link. Most English here is machine translation, so say so. More: <a href="${BASE}/llms.txt">${BASE}/llms.txt</a></p>` : '',
    `<p>These are the top results. To go further, change the words.</p>`,
    `<p>Pictures for the same words: <a href="${BASE}/search/text?q=${encodeURIComponent(q)}&amp;pictures=1">${BASE}/search/text?q=${esc(encodeURIComponent(q))}&amp;pictures=1</a></p>`,
  ].filter(Boolean).join('');

  return page(200, `${q} - Source Library search`, body);
}
