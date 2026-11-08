import { NextRequest, NextResponse } from 'next/server';
import { NOT_REPEAT_CAPTURE, isReaderListedPage } from '@/lib/reader-pages';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { isBot, isTrustedBot, botMaxPage, botGateResponse } from '@/lib/bot-gate';
import { logBotRead } from '@/lib/bot-reads';
import { getChapterTexts, CHAPTER_TEXT_FIELDS_TRANSLATION } from '@/lib/chapter-text';
import { withApiAuth, isSiteBrowserRequest, type ApiIdentity } from '@/lib/api-auth';
import { inProcessCaller } from '@/lib/inprocess-caller';
import { resolveKeptEdition } from '@/lib/kept-edition';
import { checkPageBudget, bulkBudgetExceededBody } from '@/lib/api-budget';
import { isBookReadable, canReadHiddenBook, hasCronAuth } from '@/lib/book-access';
import { isProtectedPartnerBook, partnerTextAccess } from '@/lib/partner-access';
import { PARTNER_TERMS_URL } from '@/lib/partner-terms-version';
import { CONTENT_LICENSE, AI_TRAINING_NOTICE } from '@/lib/license-info';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { markForExport } from '@/lib/provenance';
import { attributionBlock, attributionMeta, clientKeyFor, extractionRef, keyRef } from '@/lib/bot-attribution';
import { poolRefFor } from '@/lib/suspected-pool';
import { traceRefFor } from '@/lib/trace-ref';
import { getTranslation } from '@/lib/page-translations';
import { isMeteredAnonRequest } from '@/lib/metered-gate';
import { serveEnglishOriginalPage, isEnglishOriginalBook, ENGLISH_ORIGINAL_BOOK_PROJECTION } from '@/lib/english-original-text';
import { facingTranslationLabel, hasPublishedFacingTranslation } from '@/lib/facing-translation';

// This route serves quotable page text (get_book_text tells agents to "copy
// verbatim from the translation field"), so it MUST strip the AI editorial
// wrapper blocks (<meta>/<summary>/<keywords>/<vocab> + the OCR page envelope)
// before output — they describe the page and routinely name adjacent-page
// content, so serving them produces fabricated quotes. Same read-time strip
// the quote API uses; the materialized chapter text has wrappers baked in, so
// stripping must happen here at read time. See CLAUDE.md "Quote & snippet
// integrity" (#2232) and #2822 audit.
// `keepTables` because this route serves a page's WHOLE text for reuse, not an
// excerpt: flattening a GFM table keeps every cell value but discards the column
// it belonged to, so a wide calendar/abjad table (40% of pages in some
// manuscripts) arrives as unrecoverable runs of bare digits. Snippet surfaces
// still flatten — see stripEditorialWrappers' options doc.
function cleanText(text: string | undefined | null): string {
  return text ? stripEditorialWrappers(text, { keepTables: true }).trim() : '';
}

export const maxDuration = 30;

// A body here depends on who asked (the clamp, the budget, the caller's ref), and
// a shared-cache hit never reaches this route, so it would skip the clamp and the
// budget for whoever came next (#8098). No answer from this route may be stored by
// a shared cache.
const NO_SHARED_CACHE = 'private, no-store';

/**
 * Said once per English-edition response (#7100): the reading text is the
 * transcription, and a page with no `translation` is not missing one.
 */
const ENGLISH_EDITION_TEXT_NOTE =
  'English edition: the text printed on its English leaves is the reading text, served as `ocr` '
  + '(an AI transcription of the scan, period spelling kept). Those leaves carry no `translation`; '
  + 'quote the `ocr` text as the author\'s own words. Leaves in another language keep their translation.';

/**
 * Said once per response on a facing-page edition (a Loeb, #8321): its English
 * leaves print the published translation, which is served as `ocr`; the stored
 * text over them was a model's rewording and is never served.
 */
function facingEditionTextNote(book: object): string {
  return `Facing-page edition (${facingTranslationLabel(book)}): its English leaves print the published `
    + 'translation opposite the original, served as `ocr` (an AI transcription of the scan) with no `translation`; '
    + 'request content=both or content=ocr to read it, and attribute those words to the translator. '
    + 'The original-language leaves carry Source Library\'s own AI translation.';
}

/**
 * GET /api/books/[id]/text
 *
 * Returns all page text for a book in a single response.
 * Designed for machine consumption (MCP servers, Claude Code, research scripts).
 *
 * Query params:
 *   content=ocr|translation|both (default: both)
 *   from=N  — start page number (inclusive)
 *   to=N    — end page number (inclusive)
 *   chapter=N — return chapter N (0-indexed). Overrides from/to.
 *   format=json|plain (default: json)
 *   include_metadata=true — include page-level OCR/translation metadata
 */
export const GET = withApiAuth(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  identity: ApiIdentity
) => {
  try {
    const { id: bookId } = await params;
    const { searchParams } = new URL(request.url);

    const content = searchParams.get('content') || 'both';
    const fromPage = searchParams.get('from') ? parseInt(searchParams.get('from')!) : undefined;
    const toPage = searchParams.get('to') ? parseInt(searchParams.get('to')!) : undefined;
    const chapterParam = searchParams.get('chapter');
    const partParam = searchParams.get('part');
    const format = searchParams.get('format') || 'json';
    const includeMetadata = searchParams.get('include_metadata') === 'true';
    // Which EDITION of the translation to export (#4095). Per PAGE, not per
    // book: ~30 pages across 17 Spanish books were skipped by the translation
    // worker's length guard and still read English, so a book-level claim would
    // be wrong on exactly the pages a reader would notice.
    const langParam = (searchParams.get('lang') || '').trim().toLowerCase();
    const requestedLang = /^[a-z]{2,3}$/.test(langParam) ? langParam : 'en';
    const isLocalized = requestedLang !== 'en';
    /** The translation of one page in the requested language, or English, saying which. */
    const translationFor = (p: Record<string, unknown>): { data: string; lang: string } | null => {
      if (isLocalized) {
        const localized = getTranslation(p as never, requestedLang)?.data;
        if (localized) return { data: localized, lang: requestedLang };
      }
      const en = (p.translation as { data?: string } | undefined)?.data;
      return en ? { data: en, lang: 'en' } : null;
    };

    if (!['ocr', 'translation', 'both'].includes(content)) {
      return NextResponse.json({ error: 'content must be ocr, translation, or both' }, { status: 400 });
    }

    // Whole-book text needs an identity (#8235, Derek 2026-11-08): a free key or a
    // signed-in session, both of which carry an email and the terms. Search, quotes
    // and single pages stay open to anyone. Exempt: the site's own pages (the
    // compare view fetches ranges from the browser), our cron, verified crawlers.
    // The MCP connector's get_book_text runs this handler in-process (#4307) and
    // is exempt by that marker, which no client can forge: a claude.ai connector
    // cannot send a key, so it keeps its own page budget in src/app/api/mcp/route.ts.
    // An assistant reading for a person, PROVEN by name and published address
    // (identity.assistantFetcher, #8161), is exempt too: it reads a partner book a
    // window at a time (#8098). A bare "Claude-User" name proves nothing and is refused.
    if (identity.kind === 'anon' && !identity.assistantFetcher && !inProcessCaller(request)
      && !hasCronAuth(request) && !isSiteBrowserRequest(request)) {
      return NextResponse.json(
        {
          error: 'key_required',
          message: 'Whole-book text needs a free API key (an email and a minute) or a signed-in session. '
            + 'Get a key at https://sourcelibrary.org/developers#get-key and send it as "Authorization: Bearer sl_data_...". '
            + `Search, quotes and single pages need no key, and the book reads free at https://sourcelibrary.org/book/${encodeURIComponent(bookId)}.`,
          get_key: 'https://sourcelibrary.org/developers#get-key',
          terms_url: 'https://sourcelibrary.org/terms#api-terms',
        },
        {
          status: 401,
          headers: {
            'WWW-Authenticate': 'Bearer realm="sourcelibrary.org", get_key="https://sourcelibrary.org/developers#get-key"',
            // Who-is-asking decides this answer, so no shared cache may keep it.
            'Cache-Control': 'private, no-store',
          },
        },
      );
    }

    // Bulk-page budget: defends the paid-tier business model. Key holders pass
    // through; everyone else has a rolling 24h cap on /text page-equivalents.
    // Honors API_AUTH_ENFORCE so log-only mode doesn't break anything yet.
    const enforce = process.env.API_AUTH_ENFORCE === '1';
    const budget = await checkPageBudget({ identity, request });
    if (enforce && !budget.allowed) {
      return NextResponse.json(bulkBudgetExceededBody(budget, `https://sourcelibrary.org/book/${encodeURIComponent(bookId)}`), {
        status: 429,
        headers: { 'Retry-After': '3600' },
      });
    }

    const db = await getDb();

    // Find book by id or _id. `translation_state.english_original`: on an
    // English edition an English leaf serves its transcription, never a stored
    // English-to-English rewording (#7100).
    const TEXT_BOOK_PROJECTION = { id: 1, title: 1, display_title: 1, author: 1, published: 1, year: 1, pages_count: 1, visible: 1, tenantId: 1, hidden_reason: 1, duplicate_of: 1, ...ENGLISH_ORIGINAL_BOOK_PROJECTION };
    let book = await db.collection('books').findOne(
      { id: bookId },
      { projection: TEXT_BOOK_PROJECTION }
    );
    if (!book && ObjectId.isValid(bookId)) {
      book = await db.collection('books').findOne(
        { _id: new ObjectId(bookId) },
        { projection: TEXT_BOOK_PROJECTION }
      );
    }
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Hidden (visible:false) books are not public — 404 unless editor session
    // or CRON_SECRET (pipeline / Claude Code).
    if (!(await isBookReadable(book, request))) {
      // A copy hidden as a duplicate of an edition we kept: name the kept copy, so a
      // client holding the old id can switch instead of retrying a bare 404 (#8235).
      const kept = book.hidden_reason === 'same_edition_duplicate' ? await resolveKeptEdition(db, book.duplicate_of) : null;
      return NextResponse.json(
        kept
          ? { error: 'Book not found', reason: 'duplicate_edition', message: `This copy was hidden as a duplicate of an edition we kept. Read that one instead: ${kept.text_api}`, kept_edition: kept }
          : { error: 'Book not found' },
        { status: 404 },
      );
    }

    const resolvedBookId = book.id || bookId;
    const englishEdition = isEnglishOriginalBook(book);
    const facingEdition = hasPublishedFacingTranslation(book);

    // Bot gating: non-trusted bots get the first 20% of pages from any book.
    // When METERED_READER=1 the same clamp applies to anonymous humans
    // (#4357) — this route is the highest-volume text egress and would
    // otherwise hand the reader wall's content out the side door.
    const isBotRequest = isBot(request) && !(await isTrustedBot(request));
    const meteredAnon = !isBotRequest && (await isMeteredAnonRequest(request));
    // A protected partner's book (#8098): what is not a browser, a credential or
    // a proven crawler gets the same first 20%; a client that says it reads for
    // a person gets its next stretch per call instead.
    const partnerAccess = !hasCronAuth(request) && (await isProtectedPartnerBook(book))
      ? partnerTextAccess(request, identity, isBotRequest)
      : { kind: 'full' as const };
    const partnerPreview = partnerAccess.kind === 'preview';
    const partnerWindow = partnerAccess.kind === 'window' ? partnerAccess.pages : undefined;
    const clampedCaller = isBotRequest || partnerPreview;
    const botPageLimit = clampedCaller || meteredAnon ? botMaxPage(book.pages_count || 0) : undefined;
    if (isBot(request)) {
      // Chapter mode resolves its span later; the log keeps the requested span,
      // and an unbounded request is clamped whenever the book exceeds the ceiling.
      const requestedTo = toPage ?? (book.pages_count || 0);
      logBotRead(request, {
        route: 'text', book: resolvedBookId, trusted: !isBotRequest,
        pageFrom: fromPage ?? 1, pageTo: requestedTo,
        maxPage: isBotRequest ? botPageLimit : undefined,
        clamped: isBotRequest && botPageLimit !== undefined && requestedTo > botPageLimit,
      });
    }

    // Provenance. Two layers, deliberately different in reach:
    //   - the INVISIBLE imprimatur goes on every page of every response (this
    //     route is the highest-volume text egress we have and carried no mark
    //     at all before), so any passage that later surfaces elsewhere is
    //     attributable;
    //   - the VISIBLE notice is added only for bot-classified, untrusted
    //     callers. Verified search crawlers, user-initiated assistant fetches,
    //     signed-in readers and key holders never see it, so indexing and
    //     ordinary reading are untouched.
    // The ref ties a recovered passage to its puller. Two flavors:
    //   - bots get a pseudonymous monthly campaign ref (recomputable from
    //     api_usage, see bot-attribution.ts);
    //   - API-keyed callers get a STABLE key-derived ref (#4491): a key is
    //     attribution by design, so keyed egress carries it in the invisible
    //     colophon — identity upgrades the marking, it never adds visible
    //     marks. Any response carrying a ref is served private/no-store
    //     below, so one caller's ref can never be shared-cached to another.
    //   - a flagged residential proxy pool (classified human, rotating its
    //     address per request) gets a per-pool ref keyed on its user-agent
    //     string (#6950). Invisible only: the string is byte-identical to a
    //     real browser, so a real reader sharing it must not see a notice.
    const pool = !clampedCaller && !(identity.kind === 'apikey' && identity.apiKeyId)
      ? await poolRefFor(request) : undefined;
    const baseRef = clampedCaller ? extractionRef(clientKeyFor(request), new Date())
      : identity.kind === 'apikey' && identity.apiKeyId ? keyRef(identity.apiKeyId)
      : pool;
    // Visible notice: unchanged for bots and key holders; never for a pool.
    const noticeRef = pool ? undefined : baseRef;
    // Traced bulk copies (#8150 slice 8, dark unless TRACED_COPIES=on): a key
    // or signed-in account gets the opaque SLA- ref in the invisible colophon
    // instead. Never a bot (it keeps its campaign ref) and never the visible
    // notice. This response is always private, no-store.
    const traced = clampedCaller ? undefined : traceRefFor({
      apiKeyId: identity.kind === 'apikey' ? identity.apiKeyId : null,
      userId: identity.kind === 'session' ? identity.userId : null,
    });
    const ref = traced ?? baseRef;
    const mark = (text: string) => (text ? markForExport(text, resolvedBookId, { ref }) : text);
    const bookSubject = {
      title: book.display_title || book.title,
      author: book.author,
      url: `https://sourcelibrary.org/book/${resolvedBookId}`,
    };

    // Budget visibility headers: consumers pacing themselves need the numbers,
    // not just the 429 (#4491 polish). `used` is the prior-24h count at check
    // time — it does not include this request. limit -1 = unlimited tier, no
    // headers.
    const budgetHdrs: Record<string, string> =
      budget.limit > 0
        ? { 'X-Daily-Pages-Limit': String(budget.limit), 'X-Daily-Pages-Used': String(budget.used) }
        : {};

    // Per-request page cap. The daily budget check above only sees the PRIOR 24h
    // total, so a single large from/to range (or an unbounded request) could serve
    // far past the cap in ONE call. Clamp this request to the remaining budget for
    // limited tiers; apikey/bot are unlimited (limit < 0 → no cap).
    const budgetPageCap = (enforce && budget.limit > 0) ? Math.max(1, budget.remaining) : undefined;

    // Chapter mode: return pre-materialized chapter text
    //
    // Materialized chapter text exists only in English — it is stitched by the
    // enrichment pipeline from `translation.data`. For a localized request we
    // therefore resolve the chapter to its PAGE RANGE and serve those pages in
    // the requested language, rather than handing back English under a `lang=es`
    // request or refusing outright.
    //
    // An English edition takes the same page-range route (#7100): its
    // materialized chapter text was stitched from `translation.data`, which on
    // an English leaf is a model's rewording, so the chapter is served from its
    // pages, each resolved to the transcription. So does a facing-page edition
    // (#8321): 8 Loebs' stored chapters carry the rewording of their English leaves.
    let localizedChapterRange: { from: number; to: number; title?: string } | null = null;
    //
    // A clamped or windowed caller takes it too: a stored chapter can run past its
    // limit (a one-chapter book is the whole book), and pages can be cut (#8098).
    if (chapterParam !== null && (isLocalized || englishEdition || facingEdition || botPageLimit !== undefined || partnerWindow !== undefined)) {
      const chapterIndex = parseInt(chapterParam);
      const withChapters = await db.collection('books').findOne(
        { id: resolvedBookId }, { projection: { chapters: 1, reading_summary: 1, pages_count: 1 } });
      const ch = withChapters?.chapters?.[chapterIndex];
      if (!ch) return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
      // `books.chapters` stores `pageNumber`/`endPage` (24,582 books, none with
      // `pageStart`, 2026-11-07); `pageStart`/`pageEnd` are chapter_texts' names.
      // Reading only the latter left the range open: the whole book was served.
      const chStart: number | undefined = ch.pageStart ?? ch.pageNumber;
      const chEnd: number | undefined = ch.pageEnd ?? ch.endPage ?? chStart;
      if (typeof chStart !== 'number') return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
      // Bot page limit: block chapters that start beyond the accessible range
      if (botPageLimit !== undefined && chStart > botPageLimit) {
        return NextResponse.json(
          botGateResponse({ ...book, ...withChapters, id: resolvedBookId }),
          { status: 200, headers: { 'Cache-Control': NO_SHARED_CACHE } }
        );
      }
      localizedChapterRange = { from: chStart, to: chEnd ?? chStart, title: ch.titleEn || ch.title };
    }

    if (chapterParam !== null && !localizedChapterRange) {
      const chapterIndex = parseInt(chapterParam);
      if (isNaN(chapterIndex) || chapterIndex < 0) {
        return NextResponse.json({ error: 'chapter must be a non-negative integer' }, { status: 400 });
      }

      // `both` and `ocr` read `ocr_text` (ocr falls back to `text`); only a
      // translation-only request can leave the ~half-row original behind (#5184).
      const allParts = await getChapterTexts(
        db, resolvedBookId, chapterIndex,
        content === 'translation' ? CHAPTER_TEXT_FIELDS_TRANSLATION : undefined,
      );

      if (allParts.length === 0) {
        // Fall back: check if chapters exist but aren't materialized yet
        const bookWithChapters = await db.collection('books').findOne(
          { id: resolvedBookId },
          { projection: { chapters: 1 } },
        );
        if (bookWithChapters?.chapters?.[chapterIndex]) {
          return NextResponse.json({
            error: 'Chapter exists but text not yet materialized. Run POST /api/books/{id}/materialize-chapters first.',
            chapter: bookWithChapters.chapters[chapterIndex],
          }, { status: 404 });
        }
        return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
      }

      // Select the right part (default: part 1 or the only part)
      const requestedPart = partParam ? parseInt(partParam) : 1;
      const ct = allParts.length === 1
        ? allParts[0]
        : allParts.find(p => p.part === requestedPart) || allParts[0];

      // Page-equivalent count for the budget: number of underlying pages in this chapter.
      const chapterPageCount = Math.max(1, (ct.pageEnd ?? ct.pageStart) - ct.pageStart + 1);

      if (format === 'plain') {
        const partLabel = ct.parts_total ? ` (part ${ct.part} of ${ct.parts_total})` : '';
        const header = [
          `# ${book.display_title || book.title}`,
          `# ${book.author} (${book.published || 'n.d.'})`,
          `# Chapter ${chapterIndex}: ${ct.titleEn || ct.title}${partLabel}`,
          `# Pages ${ct.pageStart}–${ct.pageEnd}`,
          `# Source: https://sourcelibrary.org/book/${resolvedBookId}`,
          '',
          ...(noticeRef ? [attributionBlock(noticeRef, bookSubject)] : []),
          mark(cleanText(content === 'ocr' ? (ct.ocr_text || ct.text) : ct.text)),
        ].join('\n');

        return new Response(header, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': NO_SHARED_CACHE,
            'X-Pages-Served': String(chapterPageCount),
            ...budgetHdrs,
          },
        });
      }

      return NextResponse.json({
        book: {
          id: resolvedBookId,
          title: book.display_title || book.title,
          author: book.author,
          url: `https://sourcelibrary.org/book/${resolvedBookId}`,
        },
        chapter: {
          index: ct.chapter_index,
          title: ct.title,
          titleEn: ct.titleEn,
          level: ct.level,
          pageStart: ct.pageStart,
          pageEnd: ct.pageEnd,
          token_estimate: ct.token_estimate,
          ...(ct.parts_total ? { part: ct.part, parts_total: ct.parts_total } : {}),
          text: mark(cleanText(content === 'ocr' ? (ct.ocr_text || ct.text) : ct.text)),
          ...(content === 'both' && ct.ocr_text ? { ocr_text: mark(cleanText(ct.ocr_text)) } : {}),
        },
        ...(noticeRef ? { attribution: attributionMeta(noticeRef) } : {}),
      }, {
        headers: {
          'Cache-Control': NO_SHARED_CACHE,
          'X-Pages-Served': String(chapterPageCount),
            ...budgetHdrs,
        },
      });
    }

    // Build page query. The max page number this request may reach is the
    // tightest of: requested `to`, the bot 20% limit, and the per-request budget
    // cap (counted from the start page). budgetMaxPage closes the granularity gap
    // where one big range would otherwise serve past the daily cap in a single call.
    const startPage = localizedChapterRange?.from ?? fromPage ?? 1;
    const budgetMaxPage = budgetPageCap !== undefined ? startPage + budgetPageCap - 1 : undefined;
    const windowMaxPage = partnerWindow !== undefined ? Math.max(startPage, 1) + partnerWindow - 1 : undefined;
    const pageCaps = [localizedChapterRange?.to ?? toPage, botPageLimit, budgetMaxPage, windowMaxPage].filter((v): v is number => v !== undefined);
    const effectiveToPage = pageCaps.length ? Math.min(...pageCaps) : undefined;

    const effectiveFromPage = localizedChapterRange?.from ?? fromPage;
    // A repeat capture (#5056) is a second copy of a leaf already served; leave it out.
    // The reader's list is the public book: a negative number is a soft-hidden
    // duplicate or split parent, and only the pipeline and editors see those (#8098).
    const seesHiddenRows = hasCronAuth(request) || (identity.kind === 'session' && await canReadHiddenBook(request));
    const pageFloor = seesHiddenRows ? effectiveFromPage : Math.max(effectiveFromPage ?? 0, 0);
    const pageFilter: Record<string, unknown> = { book_id: resolvedBookId, ...NOT_REPEAT_CAPTURE };
    if (pageFloor !== undefined || effectiveToPage !== undefined) {
      pageFilter.page_number = {};
      if (pageFloor !== undefined) (pageFilter.page_number as Record<string, number>).$gte = pageFloor;
      if (effectiveToPage !== undefined) (pageFilter.page_number as Record<string, number>).$lte = effectiveToPage;
    }

    // Did the budget cap (not the bot limit / requested range) truncate the result?
    const requestedEnd = toPage ?? (book.pages_count || Number.MAX_SAFE_INTEGER);
    const budgetTruncated = budgetMaxPage !== undefined
      && effectiveToPage === budgetMaxPage
      && requestedEnd > budgetMaxPage;

    // Build projection — only fetch what's needed
    const projection: Record<string, number> = { page_number: 1, page_type: 1, _id: 0 };
    if (content === 'ocr' || content === 'both') {
      projection['ocr.data'] = 1;
      if (includeMetadata) {
        projection['ocr.language'] = 1;
        projection['ocr.model'] = 1;
        projection['ocr.source'] = 1;
      }
    }
    if (content === 'translation' || content === 'both') {
      projection['translation.data'] = 1;
      if (isLocalized) {
        projection[`translations.${requestedLang}.data`] = 1;
        if (requestedLang === 'es') projection['translation_es.data'] = 1;
      }
      if (includeMetadata) {
        projection['translation.language'] = 1;
        projection['translation.model'] = 1;
        projection['translation.source'] = 1;
        if (isLocalized) {
          projection[`translations.${requestedLang}.language`] = 1;
          projection[`translations.${requestedLang}.model`] = 1;
          projection[`translations.${requestedLang}.source`] = 1;
        }
      }
    }
    if (includeMetadata) projection.columns = 1;
    // The per-page English-original test reads the OCR, so a translation-only
    // export of an English edition or a Loeb still needs it (it is not emitted).
    if (englishEdition || facingEdition) projection['ocr.data'] = 1;

    const pages = (await db.collection('pages')
      .find(pageFilter)
      .project(projection)
      .sort({ page_number: 1 })
      .toArray())
      .filter((p) => seesHiddenRows || isReaderListedPage(p))
      .map((p) => serveEnglishOriginalPage(p, book, { modernized: false }));

    // The window cut this call short: say where the next one starts, so a reader's
    // assistant carries on and nobody takes the cut for the end of the book.
    const windowTruncated = windowMaxPage !== undefined
      && effectiveToPage === windowMaxPage
      && (localizedChapterRange?.to ?? requestedEnd) > windowMaxPage;
    const windowNote = windowTruncated
      ? `Served up to p.${windowMaxPage}: this collection is served ${partnerWindow} pages per call. Ask again with from=${windowMaxPage! + 1} to continue.`
      : undefined;

    // A program reading a protected partner's book is told the terms in the response itself.
    const partnerTermsNote = partnerAccess.kind !== 'full'
      ? `This book is from the Embassy of the Free Mind's collection. Terms of use: ${PARTNER_TERMS_URL}`
      : undefined;

    // Plain text format — concatenated text with page markers
    if (format === 'plain') {
      const lines: string[] = [];
      lines.push(`# ${book.display_title || book.title}`);
      lines.push(`# ${book.author} (${book.published || 'n.d.'})`);
      lines.push(`# Language: ${book.language}`);
      if (englishEdition) lines.push(`# ${ENGLISH_EDITION_TEXT_NOTE}`);
      if (facingEdition) lines.push(`# ${facingEditionTextNote(book)}`);
      if (isLocalized) lines.push(`# Translation edition requested: ${requestedLang} (pages without one are marked [Translation — en])`);
      if (localizedChapterRange) lines.push(`# Chapter: ${localizedChapterRange.title ?? chapterParam} (pages ${localizedChapterRange.from}–${localizedChapterRange.to})`);
      lines.push(`# Produced by SourceLibrary.org in Amsterdam, 2026`);
      lines.push(`# Source: https://sourcelibrary.org/book/${resolvedBookId}`);
      lines.push(`# License: CC BY-NC-SA 4.0 (https://sourcelibrary.org/terms)`);
      lines.push(`# ${AI_TRAINING_NOTICE}`);
      if (windowNote) lines.push(`# ${windowNote}`);
      if (partnerTermsNote) lines.push(`# ${partnerTermsNote}`);
      lines.push('');

      // Notice once at the head, fenced so it can never read as page text.
      if (noticeRef) lines.push(attributionBlock(noticeRef, bookSubject));

      for (const page of pages) {
        const ocr = mark(cleanText(page.ocr?.data));
        const resolved = translationFor(page);
        const translation = mark(cleanText(resolved?.data));
        // The label carries the language whenever it is not what was asked for,
        // so a fallback page cannot be read as part of the Spanish edition.
        const tLabel = resolved && resolved.lang !== requestedLang
          ? `[Translation — ${resolved.lang}]`
          : '[Translation]';

        if (content === 'both' && (ocr || translation)) {
          lines.push(`--- Page ${page.page_number} ---`);
          if (ocr) {
            lines.push(`[Original]`);
            lines.push(ocr);
            lines.push('');
          }
          if (translation) {
            lines.push(tLabel);
            lines.push(translation);
            lines.push('');
          }
        } else if (content === 'ocr' && ocr) {
          lines.push(`--- Page ${page.page_number} ---`);
          lines.push(ocr);
          lines.push('');
        } else if (content === 'translation' && translation) {
          lines.push(`--- Page ${page.page_number} ---`);
          if (resolved && resolved.lang !== requestedLang) lines.push(tLabel);
          lines.push(translation);
          lines.push('');
        }
      }

      return new Response(lines.join('\n'), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': NO_SHARED_CACHE,
          'X-Pages-Served': String(pages.length),
          ...budgetHdrs,
        },
      });
    }

    // JSON format — structured response
    const pagesWithContent = pages.filter(p => {
      if (content === 'ocr') return p.ocr?.data;
      if (content === 'translation') return !!translationFor(p);
      return p.ocr?.data || !!translationFor(p);
    });

    const result = {
      book: {
        id: resolvedBookId,
        title: book.display_title || book.title,
        original_title: book.title !== (book.display_title || book.title) ? book.title : undefined,
        author: book.author,
        language: book.language,
        published: book.published,
        year: book.year,
        url: `https://sourcelibrary.org/book/${resolvedBookId}`,
      },
      license: CONTENT_LICENSE,
      // Present only for bot-classified, untrusted callers. The page text in
      // this payload is unmodified apart from the invisible imprimatur — the
      // notice is a sibling field rather than injected prose precisely so a
      // consumer quoting `pages[].ocr` never picks up words we wrote.
      ...(noticeRef ? { attribution: attributionMeta(noticeRef) } : {}),
      content_type: content,
      ...(englishEdition ? { english_edition_note: ENGLISH_EDITION_TEXT_NOTE } : {}),
      ...(facingEdition ? { facing_translation_note: facingEditionTextNote(book) } : {}),
      // What was asked for, and what the pages actually carry. A caller that
      // requested `es` and got 40 English pages back must be able to see it
      // without diffing the text.
      lang: requestedLang,
      ...(isLocalized ? {
        lang_coverage: {
          [requestedLang]: pagesWithContent.filter(p => translationFor(p)?.lang === requestedLang).length,
          en_fallback: pagesWithContent.filter(p => translationFor(p)?.lang === 'en').length,
        },
      } : {}),
      ...(localizedChapterRange ? {
        chapter: {
          index: Number(chapterParam),
          title: localizedChapterRange.title,
          pageStart: localizedChapterRange.from,
          pageEnd: localizedChapterRange.to,
          note: isLocalized
            ? `Chapter text is materialized in English only; this "${requestedLang}" response is assembled from the chapter's page range.`
            : englishEdition || facingEdition
              ? `${englishEdition ? 'English edition' : 'Facing-page edition'}: this chapter is assembled from its pages\' transcriptions, not the materialized chapter text.`
              : 'This chapter is assembled from the pages of its range that this call may read.',
        },
      } : {}),
      total_pages: book.pages_count || pages.length,
      pages_returned: pagesWithContent.length,
      ...(botPageLimit !== undefined ? {
        bot_access: {
          truncated: true,
          pages_accessible: botPageLimit,
          pages_total: book.pages_count || pages.length,
          full_access: 'Install the MCP server for full access: claude mcp add source-library -- npx -y @source-library/mcp-server',
          partnership: 'https://sourcelibrary.org/llms.txt',
        },
      } : {}),
      ...(partnerTermsNote ? { terms_of_use: partnerTermsNote } : {}),
      ...(windowTruncated ? {
        reading_window: {
          truncated: true,
          last_page_served: windowMaxPage,
          next_from: windowMaxPage! + 1,
          note: windowNote,
        },
      } : {}),
      ...(budgetTruncated ? {
        budget: {
          truncated: true,
          reason: 'daily_page_budget',
          last_page_served: budgetMaxPage,
          used_24h: budget.used,
          limit_24h: budget.limit,
          note: budget.tier === 'apikey'
            ? `Served up to p.${budgetMaxPage}; the rest of this range is beyond your Explorer key's daily page budget (${budget.used}/${budget.limit} used in 24h). Upgrade for uncapped /text access (https://sourcelibrary.org/licensing) or bulk-export instead.`
            : `Served up to p.${budgetMaxPage}; the rest of this range is beyond your remaining daily page budget (${budget.used}/${budget.limit} used in 24h). Retrying immediately will be rate-limited. Sign in or use an API key for a higher limit, or bulk-export instead.`,
          next_steps: budget.tier === 'apikey'
            ? {
                upgrade: 'https://sourcelibrary.org/licensing',
                bulk_export: 'https://sourcelibrary.org/api/dataset/v1/pages',
              }
            : {
                sign_in: 'https://sourcelibrary.org/auth/signin',
                get_api_key: 'https://sourcelibrary.org/developers',
                bulk_export: 'https://sourcelibrary.org/api/dataset/v1/pages',
              },
        },
      } : {}),
      pages: pagesWithContent.map(p => {
        const entry: Record<string, unknown> = { page_number: p.page_number };

        if ((content === 'ocr' || content === 'both') && p.ocr?.data) {
          entry.ocr = mark(cleanText(p.ocr.data));
          if (includeMetadata) {
            entry.ocr_metadata = {
              language: p.ocr.language,
              model: p.ocr.model,
              source: p.ocr.source,
            };
          }
        }
        const resolved = (content === 'translation' || content === 'both') ? translationFor(p) : null;
        if (resolved) {
          entry.translation = mark(cleanText(resolved.data));
          // Always present, so a consumer branches on it instead of assuming
          // every page in a `lang=es` response is Spanish.
          entry.translation_lang = resolved.lang;
          if (includeMetadata) {
            const meta = resolved.lang === 'en' ? p.translation : (p.translations?.[resolved.lang] ?? p.translation_es);
            entry.translation_metadata = {
              language: meta?.language,
              model: meta?.model,
              source: meta?.source,
            };
          }
        }
        if (includeMetadata) {
          if (p.page_type) entry.page_type = p.page_type;
          if (p.columns) entry.columns = p.columns;
        }

        return entry;
      }),
    };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': NO_SHARED_CACHE,
        'X-Pages-Served': String(pagesWithContent.length),
        ...budgetHdrs,
      },
    });
  } catch (error) {
    console.error('Bulk text error:', error);
    return NextResponse.json({ error: 'Failed to fetch text' }, { status: 500 });
  }
}, { route: 'books.text' });
