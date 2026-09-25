/**
 * /book/[id]/read — the whole book as ONE reflowing document.
 *
 * Who this is for. A blind scholar with a screen reader, for whom the
 * three-pane reader is a sighted design: the scan is noise, "TRANSLATION" is
 * a label they cannot see, and each page turn is a navigation. A low-vision
 * reader at 300–400 % magnification, for whom side-by-side panes are three
 * narrow columns. A reader on a phone who wants to read, not browse. All
 * three want the same thing: the text, in order, with page boundaries
 * announced and the original one step away — never a pane to find.
 *
 * So: one <h1>, chapters as <h2> (when the book has them), every page a
 * heading of its own so heading navigation walks the book, the translation
 * as running text, the original inside a <details> per page (hidden from the
 * accessibility tree until opened, so it is opt-in rather than read twice).
 * `?text=original` flips which is primary; `?text=both` shows both. Every
 * text block carries the `lang` it is written in (#5115). Long books are cut
 * into parts of PART_SIZE pages so no single response is megabytes.
 *
 * Built on the DATABASE, not the reader routes (quote-and-snippet-integrity:
 * reader-served text is already marked). The same policies as the reader
 * and /text apply here, because this route would otherwise be the cheapest
 * way to lift a whole book: hidden books 404; untrusted bots and — when
 * METERED_READER=1 — anonymous humans get the free sample and a sign-in
 * notice; partner reading rooms are exempt; the translation carries the
 * invisible provenance mark. Notes are OFF: the book's own words, not the
 * AI's commentary (applyNotesOff, shared with the reader and the EPUB).
 *
 * PRIOR ART: /book/[id]/overview (page thumbnails, no text) and
 * /api/books/[id]/text (machine JSON, not a page). The EPUB/HTML exporter's
 * markdownToHtml is reused rather than a second text pipeline.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import { findBookForTenant } from '@/lib/tenant-catalog-books';
import { getTenantContext } from '@/lib/tenant-context';
import { isHiddenBook } from '@/lib/book-access';
import { isBot, isTrustedBot } from '@/lib/bot-gate';
import { isMeteredAnonRequest } from '@/lib/metered-gate';
import { freeMaxPage } from '@/lib/free-preview';
import { markForExport } from '@/lib/provenance';
import { markdownToHtml } from '@/lib/export-markdown-html';
import { languageToBcp47, titleLang } from '@/lib/language-code';
import { isRTLLanguage } from '@/lib/types';

// Gating depends on who is asking (session, bot, tenant), so this cannot be ISR.
export const dynamic = 'force-dynamic';
export const preferredRegion = 'fra1';

/**
 * Pages per part. Measured on the Fludd anatomy (Latin + English, both in the
 * DOM because the folded original is still markup): 120 pages was 2.1 MB of
 * HTML, so 60 keeps a part near 1 MB — still one document per sitting, but
 * one a phone on a slow connection can open.
 */
const PART_SIZE = 60;

type TextMode = 'translation' | 'original' | 'both';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface BookDoc {
  id?: string;
  _id?: { toString(): string };
  slug?: string;
  title?: string;
  display_title?: string;
  author?: string;
  published?: string | number;
  language?: string;
  pages_count?: number;
  chapters?: Array<{ title?: string; titleEn?: string; pageNumber?: number; level?: number; confidence?: string }>;
}

interface PageDoc {
  id: string;
  page_number: number;
  page_type?: string;
  ocr?: { data?: string };
  translation?: { data?: string };
  translation_withheld?: unknown;
}

const BOOK_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, published: 1,
  language: 1, pages_count: 1, chapters: 1, visible: 1, hidden_reason: 1,
};

const PAGE_PROJECTION = {
  _id: 0, id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, translation_withheld: 1,
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const ctx = await getTenantContext();
  const db = await getReadDb();
  const found = await findBookForTenant(db, id, { _id: 0, title: 1, display_title: 1, visible: 1, hidden_reason: 1 }, ctx);
  const book = found?.book as BookDoc | undefined;
  if (!book || isHiddenBook(book)) {
    return { title: 'Book Not Found - Source Library', robots: { index: false, follow: true } };
  }
  const title = book.display_title || book.title || 'Book';
  return {
    title: `${title} — read as one document - Source Library`,
    description: `${title}, the whole book as one continuous text with the original beside each page.`,
    // The per-page reader is the indexed surface; this is a reading mode of it.
    robots: { index: false, follow: true },
    alternates: { canonical: `/book/${id}/read` },
  };
}

function firstString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Page text → HTML for this document. Headings inside a page (the OCR marks
 * printed chapter titles as `# …`) are demoted below the page's own heading,
 * so the document keeps one h1 and heading navigation stays predictable.
 */
function pageHtml(raw: string | undefined, pageLevel: number): string | null {
  if (!raw || !raw.trim()) return null;
  const html = markdownToHtml(raw, { stripNotes: true });
  if (!html || html === '<p></p>') return null;
  return html.replace(/<(\/?)h([1-3])>/g, (_m, slash: string, n: string) => {
    const level = Math.min(6, pageLevel + Number(n));
    return `<${slash}h${level}>`;
  });
}

function Heading({ level, id, className, children }: { level: number; id?: string; className?: string; children: React.ReactNode }) {
  const Tag = (`h${Math.min(6, Math.max(1, level))}`) as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  return <Tag id={id} className={className}>{children}</Tag>;
}

export default async function LinearReadPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const textParam = firstString(sp.text);
  const mode: TextMode = textParam === 'original' ? 'original' : textParam === 'both' ? 'both' : 'translation';
  const part = Math.max(1, parseInt(firstString(sp.part) ?? '1', 10) || 1);

  const ctx = await getTenantContext();
  const db = await getReadDb();
  const found = await findBookForTenant(db, id, BOOK_PROJECTION, ctx);
  if (!found) notFound();
  const book = found.book as BookDoc;
  if (isHiddenBook(book)) notFound();
  const bookId = (book.id || book._id?.toString()) as string;
  const bookPath = book.slug || bookId;
  const pagesCount = book.pages_count || 0;

  // Who is asking. Same ladder as /api/books/[id]/text: partner reading rooms
  // are exempt; untrusted bots, and anonymous humans while the metered reader
  // is on, get the free sample. `isMeteredAnonRequest` is false when metering
  // is off, so this costs one env read in the common case.
  const h = await headers();
  const request = new Request(`https://sourcelibrary.org/book/${bookPath}/read`, { headers: h });
  const exempt = !!(ctx?.id || ctx?.isEmbedded);
  const untrustedBot = !exempt && isBot(request) && !(await isTrustedBot(request));
  const meteredAnon = !exempt && !untrustedBot && (await isMeteredAnonRequest(request));
  const clampAt = untrustedBot || meteredAnon ? freeMaxPage(pagesCount) : undefined;

  const pagesRaw = await db.collection('pages')
    .find({ book_id: bookId, page_number: { $gte: 0 } }, { projection: PAGE_PROJECTION, maxTimeMS: 15000 })
    .sort({ page_number: 1 })
    .toArray() as unknown as PageDoc[];
  // The same page set the reader walks — no digitiser inserts, no unsplit spreads.
  const pages = pagesRaw.filter(p => p.page_type !== 'digitizer-insert' && p.page_type !== 'archived-spread');
  if (pages.length === 0) notFound();

  const partCount = Math.max(1, Math.ceil(pages.length / PART_SIZE));
  if (part > partCount) notFound();
  const slice = pages.slice((part - 1) * PART_SIZE, part * PART_SIZE);
  const partOfPage = (pageNumber: number): number => {
    const idx = pages.findIndex(p => p.page_number >= pageNumber);
    return idx < 0 ? partCount : Math.floor(idx / PART_SIZE) + 1;
  };

  const chapters = (book.chapters || [])
    .filter(c => typeof c.pageNumber === 'number' && c.confidence !== 'low' && (c.title || c.titleEn))
    .map(c => ({ title: c.titleEn || c.title || '', original: c.titleEn && c.title && c.title !== c.titleEn ? c.title : null, pageNumber: c.pageNumber as number }));
  const chapterAt = new Map<number, typeof chapters>();
  for (const c of chapters) {
    const list = chapterAt.get(c.pageNumber) || [];
    list.push(c);
    chapterAt.set(c.pageNumber, list);
  }
  // Chapters h2, pages h3; without chapters pages are h2.
  const pageLevel = chapters.length > 0 ? 3 : 2;

  const shownTitle = book.display_title || book.title || 'Untitled';
  const originalTitle = book.title && book.title !== shownTitle ? book.title : null;
  const originalLang = languageToBcp47(book.language);
  const originalDir = isRTLLanguage(book.language) ? 'rtl' : undefined;
  const languageLabel = book.language || 'Original';

  const href = (opts: { text?: TextMode; part?: number; hash?: string }) => {
    const q = new URLSearchParams();
    const t = opts.text ?? mode;
    if (t !== 'translation') q.set('text', t);
    const p = opts.part ?? part;
    if (p !== 1) q.set('part', String(p));
    const qs = q.toString();
    return `/book/${bookPath}/read${qs ? `?${qs}` : ''}${opts.hash ? `#${opts.hash}` : ''}`;
  };

  const modeLabel: Record<TextMode, string> = { translation: 'Translation', original: `Original (${languageLabel})`, both: 'Both' };
  const first = slice[0]?.page_number;
  const last = slice[slice.length - 1]?.page_number;

  // Everything past the free sample collapses into ONE notice, not a stub per page.
  const firstGatedIdx = clampAt === undefined ? -1 : slice.findIndex(p => p.page_number > clampAt);
  const open = firstGatedIdx < 0 ? slice : slice.slice(0, firstGatedIdx);
  const gateFrom = firstGatedIdx < 0 ? null : slice[firstGatedIdx].page_number;

  return (
    <main className="max-w-[72ch] mx-auto px-4 sm:px-6 py-10 text-primary">
      <header className="mb-8">
        <p className="text-sm text-muted mb-4">
          <Link href={`/book/${bookPath}`} className="hover:text-accent-rust underline underline-offset-2">← Book page</Link>
        </p>
        <h1 className="font-display text-3xl sm:text-4xl leading-tight" lang={titleLang(shownTitle, book)}>{shownTitle}</h1>
        {originalTitle && <p className="text-lg text-muted italic mt-1" lang={originalLang}>{originalTitle}</p>}
        <p className="text-sm text-muted mt-3">
          {[book.author, book.published, book.language].filter(Boolean).join(' · ')}
        </p>
        <p className="text-sm text-muted mt-3">
          The whole book as one document, {pages.length} pages{partCount > 1 ? ` in ${partCount} parts` : ''}.
          Each page is a heading; the {mode === 'original' ? 'translation' : 'original'} sits under it, folded, and opens on request.
        </p>
      </header>

      <nav aria-label="Text shown" className="mb-4 text-sm">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {(['translation', 'original', 'both'] as TextMode[]).map(m => (
            <li key={m}>
              {m === mode
                ? <span aria-current="true" className="font-semibold">{modeLabel[m]}</span>
                : <Link href={href({ text: m })} className="underline underline-offset-2 hover:text-accent-rust">{modeLabel[m]}</Link>}
            </li>
          ))}
        </ul>
      </nav>

      {partCount > 1 && (
        <nav aria-label="Parts" className="mb-4 text-sm">
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {Array.from({ length: partCount }, (_, i) => i + 1).map(p => {
              const a = pages[(p - 1) * PART_SIZE]?.page_number;
              const b = pages[Math.min(pages.length, p * PART_SIZE) - 1]?.page_number;
              const label = `Part ${p}, pages ${a}–${b}`;
              return (
                <li key={p}>
                  {p === part
                    ? <span aria-current="page" className="font-semibold">{label}</span>
                    : <Link href={href({ part: p })} className="underline underline-offset-2 hover:text-accent-rust">{label}</Link>}
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {chapters.length > 0 && (
        <nav aria-label="Contents" className="mb-10 text-sm">
          <details>
            <summary className="cursor-pointer font-semibold">Contents ({chapters.length})</summary>
            <ol className="mt-2 space-y-1 list-none pl-0">
              {chapters.map((c, i) => (
                <li key={i}>
                  <Link href={href({ part: partOfPage(c.pageNumber), hash: `p${c.pageNumber}` })} className="underline underline-offset-2 hover:text-accent-rust">
                    {c.title}
                  </Link>
                  {c.original && <span className="text-muted" lang={originalLang}> · {c.original}</span>}
                  <span className="text-muted"> — p. {c.pageNumber}</span>
                </li>
              ))}
            </ol>
          </details>
        </nav>
      )}

      <article aria-label={`${shownTitle}${partCount > 1 ? `, part ${part} of ${partCount}` : ''}`}>
        {open.map(p => {
          const n = p.page_number;
          const translationRaw = p.translation?.data ? markForExport(p.translation.data, bookId) : undefined;
          const translationHtml = pageHtml(translationRaw, pageLevel);
          const originalHtml = pageHtml(p.ocr?.data, pageLevel);
          const withheld = !translationHtml && !!p.translation_withheld;

          const translationBlock = translationHtml
            ? <div className="prose-manuscript" lang="en" dangerouslySetInnerHTML={{ __html: translationHtml }} />
            : <p className="text-muted italic">{withheld ? 'Translation withheld: it was made from an earlier reading of this page.' : originalHtml ? 'Not yet translated.' : null}</p>;
          const originalBlock = originalHtml
            ? <div className="prose-manuscript" lang={originalLang} dir={originalDir} dangerouslySetInnerHTML={{ __html: originalHtml }} />
            : <p className="text-muted italic">Not transcribed.</p>;

          const hasAnyText = !!(translationHtml || originalHtml);
          // A page with no translation shows the ORIGINAL as its text, not a
          // "not yet translated" line with the words folded away — for an
          // English original that line is simply false, and for a Latin one
          // the reader still wants the Latin rather than nothing. Measured on
          // the preview: 79 pages of an English book hid behind that line.
          const primaryIsOriginal = mode === 'original' || !translationHtml;
          const primary = primaryIsOriginal ? originalBlock : translationBlock;
          const primaryNote = primaryIsOriginal && mode !== 'original' && originalHtml
            ? <p className="font-sans text-xs uppercase tracking-[0.15em] text-muted mb-2">{withheld ? 'Translation withheld' : 'Not yet translated'} · original ({languageLabel})</p>
            : null;
          const secondaryLabel = primaryIsOriginal ? 'Translation' : `Original (${languageLabel})`;
          const secondary = primaryIsOriginal ? translationBlock : originalBlock;
          // No point folding a "not yet translated" line under the original.
          const showSecondary = primaryIsOriginal ? !!translationHtml : !!originalHtml;

          return (
            <section key={p.id} id={`p${n}`} aria-labelledby={`h-p${n}`} className="mt-10 border-t pt-6" style={{ borderColor: 'var(--border-light)' }}>
              {chapterAt.get(n)?.map((c, i) => (
                <Heading key={i} level={2} className="font-display text-2xl mb-4">
                  {c.title}{c.original && <span className="text-muted text-lg" lang={originalLang}> · {c.original}</span>}
                </Heading>
              ))}
              <div className="flex items-baseline justify-between gap-4 mb-3">
                <Heading level={pageLevel} id={`h-p${n}`} className="font-sans text-xs uppercase tracking-[0.15em] text-muted">Page {n}</Heading>
                <Link href={`/book/${bookPath}/page/${p.id}`} className="text-xs text-muted underline underline-offset-2 hover:text-accent-rust" aria-label={`Open page ${n} in the reader, with the scan`}>
                  Scan
                </Link>
              </div>
              {!hasAnyText ? (
                <p className="text-muted italic">No transcribed text on this page.</p>
              ) : mode === 'both' ? (
                <>
                  {translationBlock}
                  <div className="mt-4 pl-4 border-l-2" style={{ borderColor: 'var(--border-light)' }}>
                    <p className="font-sans text-xs uppercase tracking-[0.15em] text-muted mb-2">Original ({languageLabel})</p>
                    {originalBlock}
                  </div>
                </>
              ) : (
                <>
                  {primaryNote}
                  {primary}
                  {showSecondary && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm text-muted hover:text-accent-rust">{secondaryLabel}</summary>
                      <div className="mt-3">{secondary}</div>
                    </details>
                  )}
                </>
              )}
            </section>
          );
        })}
        {gateFrom !== null && (
          <section aria-labelledby="gate-heading" className="mt-10 border-t pt-6" style={{ borderColor: 'var(--border-light)' }}>
            <Heading level={pageLevel} id="gate-heading" className="font-display text-xl">Pages {gateFrom}–{last} are for signed-in readers</Heading>
            <p className="mt-2">
              The first {clampAt} pages of every book are open. Reading further is free, but asks you to{' '}
              <Link href="/auth/signin" className="underline underline-offset-2 hover:text-accent-rust">sign in</Link>.
            </p>
          </section>
        )}
      </article>

      <nav aria-label="Parts" className="mt-12 pt-6 border-t text-sm flex justify-between" style={{ borderColor: 'var(--border-light)' }}>
        <span>{part > 1 ? <Link href={href({ part: part - 1 })} className="underline underline-offset-2 hover:text-accent-rust">← Part {part - 1}</Link> : null}</span>
        <span className="text-muted">Pages {first}–{last}</span>
        <span>{part < partCount ? <Link href={href({ part: part + 1 })} className="underline underline-offset-2 hover:text-accent-rust">Part {part + 1} →</Link> : null}</span>
      </nav>
    </main>
  );
}
