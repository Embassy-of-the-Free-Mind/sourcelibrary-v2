import { Metadata } from 'next';
import { getReadDb } from '@/lib/mongodb';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Book } from '@/lib/types';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { getBookThumbnailUrl } from '@/lib/utils';
import { editionYear } from '@/lib/dedup';
import { formatYear, formatYearSpan } from '@/lib/format-year';
import { canonWork, canonWorkForWorkId, workEditionsFilter, type CanonWork } from '@/lib/canon-works';
import { workAliasTarget } from '@/lib/work-alias';
import { authorUrl, bookUrl } from '@/lib/slugify';
import { locusEdition } from '@/lib/locus-editions';
import { jsonLdHtml } from '@/lib/json-ld';
import LocusJumpBox from '@/components/work/LocusJumpBox';
import { isPublishedFirstTranslation } from '@/lib/book';

// Must be a finite number — `false` would cache a bad-render fallback forever
// (e.g. the noindex metadata below) until the next deploy.
export const revalidate = 21600;
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

interface PageProps {
  params: Promise<{ id: string }>;
}

type WorkEdition = Book & {
  image_source?: { provider_name?: string };
  work_slug?: string;
};

const EDITION_PROJECTION = {
  // `year` is the numeric date; `published` is free text ("12th century",
  // "MDXLIX. [1549]"). Both are needed: year to sort and range by, published to
  // display, since "12th century" is more honest than the point estimate 1150.
  id: 1, slug: 1, title: 1, display_title: 1, author: 1, published: 1, year: 1,
  language: 1, original_language: 1, 'image_source.provider_name': 1,
  thumbnail_blob: 1, thumbnail: 1, image_display: 1, image_thumb: 1, pages_count: 1, pages_ocr: 1,
  pages_translated: 1, resource_type: 1, work_title: 1, work_slug: 1,
  is_first_translation: 1,
};

async function getWorkEditions(idOrSlug: string) {
  const db = await getReadDb();
  // canon slugs expand to their verified work_id set; anything else resolves by
  // work_slug first, then raw work_id (back-compat)
  const editions = await db.collection('books').find(
    workEditionsFilter(idOrSlug),
    { projection: EDITION_PROJECTION }
  ).toArray();
  return byChronology(editions as unknown as WorkEdition[]);
}

/**
 * Chronological order, replacing the old `sort: { published: 1 }`. `published`
 * is free text ("12th century", "MDXLIX. [1549]", "[18--]"), so sorting it
 * lexically put "550" after "1750" and buried the oldest witness — exactly the
 * thing a transmission list exists to show. Sort on the parsed year instead;
 * undated editions sink to the end rather than leading with a bogus 0.
 */
function byChronology(editions: WorkEdition[]): WorkEdition[] {
  return editions.sort((a, b) => {
    const ya = editionYear(a), yb = editionYear(b);
    if (ya === null && yb === null) return 0;
    if (ya === null) return 1;
    if (yb === null) return -1;
    return ya - yb;
  });
}

async function getCollectedEditions(canon: CanonWork) {
  const ids = canon.collectedWorkIds || [];
  if (ids.length === 0) return [];
  const db = await getReadDb();
  const editions = await db.collection('books').find(
    { $or: [{ work_id: { $in: ids } }, { work_slug: { $in: ids } }], visible: true },
    { projection: EDITION_PROJECTION }
  ).toArray();
  return byChronology(editions as unknown as WorkEdition[]);
}

// Derive a human-readable work title. Prefer the curated `work_title` carried on
// the editions (set by the mint + merge writers — clean uniform titles like
// "De occulta philosophia libri tres"); fall back to prettifying a legacy
// clean-slug work_id. The new `local:{author_id}:{slug}` ids are NOT readable as
// slugs, so the curated title is what makes the page presentable.
function workTitleFromEditions(editions: { work_title?: string | null }[], workId: string): string {
  const counts = new Map<string, number>();
  for (const e of editions) {
    const t = (e.work_title || '').trim();
    if (t) counts.set(t, (counts.get(t) || 0) + 1);
  }
  if (counts.size) return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
  // legacy clean-slug fallback (e.g. "turba-philosophorum"); never prettify a "local:…" id
  const tail = workId.includes(':') ? workId.split(':').pop()! : workId;
  return tail.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Catalogue no-date markers. These are real values in `published` and must not
// be printed at a reader ("n.d", "[18--]" is fine to show, "Unknown" is not).
const NO_DATE = /^(unknown|undated|n\.?d\.?\]?|\[n\.?d\.?\]|\[?date of publication not identified\]?)$/i;

/**
 * Date to show on an edition card. Prefers the catalogue's own `published`
 * string, because for a manuscript "12th century" is more honest than the
 * point estimate 1150 that `year` carries. Falls back to the numeric year so
 * a book with a junk or missing `published` still shows a date.
 */
function bookYearLabel(book: { published?: string | null; year?: number | null }): string | null {
  const published = (book.published || '').trim();
  if (published && !NO_DATE.test(published)) return published;
  const y = editionYear(book);
  return y === null ? null : formatYear(y);
}

/* ── Read-now selection (canon pages) ──
 * Two lanes: the original language, and English. The English lane prefers a
 * printed English edition with OCR; when none exists, the best-translated
 * original serves both lanes — the reader shows our page-level English
 * translation beside the facsimile, so a fully-translated Greek edition IS
 * readable in English. Deterministic; no hand-picking. */
function translatedRatio(b: WorkEdition): number {
  return b.pages_count ? (b.pages_translated || 0) / b.pages_count : 0;
}
function ocrRatio(b: WorkEdition): number {
  return b.pages_count ? (b.pages_ocr || 0) / b.pages_count : 0;
}
function pickReadNow(canon: CanonWork, editions: WorkEdition[]) {
  const readable = editions.filter(b => (b.pages_count || 0) > 0);
  const score = (b: WorkEdition) =>
    translatedRatio(b) * 2 + ocrRatio(b) + (locusEdition(b.id) ? 0.5 : 0) +
    Math.min((b.pages_count || 0) / 1000, 0.3); // nudge complete copies over 1-page fragments
  const inLang = (b: WorkEdition, lang: string) => (b.language || '').includes(lang);

  const original = readable
    .filter(b => inLang(b, canon.originalLanguage))
    .sort((a, b) => score(b) - score(a))[0];
  const printedEnglish = readable
    .filter(b => inLang(b, 'English') && ocrRatio(b) > 0)
    .sort((a, b) => ocrRatio(b) - ocrRatio(a) + (score(b) - score(a)) * 0.001)[0];
  // fall back to the best-translated original (≥50% translated reads fine)
  const english = printedEnglish
    || (original && translatedRatio(original) >= 0.5 ? original : undefined);
  return { original, english };
}

function ReadNowCard({ book, lane, sameBook }: { book: WorkEdition; lane: string; sameBook?: boolean }) {
  const thumb = getBookThumbnailUrl(book);
  return (
    <Link
      href={bookUrl(book)}
      className="flex items-center gap-4 p-5 border border-stone-300 hover:border-stone-400 bg-white hover:bg-stone-50/50 rounded-xl transition-all group"
    >
      {thumb ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={thumb} alt="" className="w-14 h-20 object-cover rounded shadow-sm flex-shrink-0" loading="lazy" />
      ) : (
        <div className="w-14 h-20 bg-stone-100 rounded flex-shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wide text-stone-500 mb-1">
          {lane}{sameBook ? ' · with English translation' : ''}
        </p>
        <h3 className="text-base font-medium text-stone-800 group-hover:text-stone-900 leading-snug line-clamp-2">
          {book.display_title || book.title}
        </h3>
        <p className="text-sm text-stone-500 mt-1">
          {book.published && book.published !== 'Unknown' ? `${book.published} · ` : ''}
          {(book.pages_count || 0).toLocaleString('en-US')} pages
        </p>
      </div>
      <span className="text-stone-400 group-hover:text-stone-600 transition-colors" aria-hidden>→</span>
    </Link>
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id: rawId } = await params;
  // work_id values include non-ASCII (CJK, accented Latin); the route param
  // arrives percent-encoded, so decode before matching against Mongo — otherwise
  // the query silently finds 0 editions and 404s. Same pattern as /author/[name].
  const id = decodeURIComponent(rawId);
  // No try/catch: letting a fetch failure throw here keeps ISR serving the
  // last good page instead of permanently caching noindex fallback metadata.
  const editions = await getWorkEditions(id);
  if (editions.length === 0) return { title: 'Work Not Found', robots: { index: false, follow: true } };

  const canon = canonWork(id);
  if (canon) {
    return {
      title: `${canon.title} — ${canon.author} | Source Library`,
      description: `Read the ${canon.title} (${canon.originalTitle}) of ${canon.author} in ${canon.originalLanguage} and English: ${editions.length} editions and manuscripts with page-level translations of the original scans.`,
      alternates: { canonical: `/work/${canon.slug}` },
    };
  }

  const title = workTitleFromEditions(editions as { work_title?: string | null }[], id);
  const libraries = new Set(editions.map(e => e.image_source?.provider_name).filter(Boolean));

  return {
    title: `${title} — ${editions.length} Editions | Source Library`,
    description: `${editions.length} editions and manuscripts of ${title} across ${libraries.size} libraries. Browse, compare, and read translations.`,
    alternates: { canonical: `/work/${editions.find(e => e.work_slug)?.work_slug || id}` },
  };
}

function EditionRow({ book }: { book: WorkEdition }) {
  const provider = book.image_source?.provider_name;
  const thumb = getBookThumbnailUrl(book);
  const displayTitle = book.display_title || book.title;
  const pagesOcr = book.pages_ocr || 0;
  const pagesTranslated = book.pages_translated || 0;
  const pagesCount = book.pages_count || 0;
  const locus = locusEdition(book.id);

  return (
    <Link
      href={bookUrl(book)}
      className="flex items-start gap-4 p-4 rounded-xl border border-stone-200 hover:border-stone-300 hover:bg-stone-50/50 transition-all group"
    >
      {thumb ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={thumb}
          alt=""
          className="w-16 h-22 object-cover rounded shadow-sm flex-shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="w-16 h-22 bg-stone-100 rounded flex-shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-medium text-stone-800 group-hover:text-stone-900 leading-snug">
          {displayTitle}
        </h3>
        <p className="text-sm text-stone-500 mt-1">
          {book.author}
          {bookYearLabel(book) ? ` · ${bookYearLabel(book)}` : ''}
        </p>
        <div className="flex flex-wrap gap-3 mt-2 text-xs text-stone-400">
          {book.language && book.language !== 'Unknown' && (
            <span>{book.language}</span>
          )}
          {pagesCount > 0 && <span>{pagesCount} pp</span>}
          {pagesOcr > 0 && (
            <span className="text-emerald-600">
              {pagesTranslated > 0
                ? `${Math.round((pagesTranslated / pagesOcr) * 100)}% translated`
                : 'OCR done'}
            </span>
          )}
          {locus && (
            <span className="text-amber-700">
              {locus.system === 'bekker' ? 'Bekker' : 'Stephanus'} reference edition
            </span>
          )}
          {isPublishedFirstTranslation(book) && (
            <span className="text-amber-700">First translation</span>
          )}
          {provider && <span>{provider}</span>}
        </div>
      </div>
    </Link>
  );
}

export default async function WorkPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);

  const canon = canonWork(id);
  if (!canon) {
    // a raw work_id that belongs to a canon entry gets one stable address
    const owner = canonWorkForWorkId(id);
    if (owner) redirect(`/work/${owner.slug}`);
    // a retired work_id (merged into another cluster, #3759) redirects to the
    // survivor — old URLs stay citable. Checked BEFORE the editions query:
    // a legacy work_slug equal to the retired id would otherwise keep
    // rendering a fragment page. Indexed lookup (work_id_aliases_1).
    const target = await workAliasTarget(await getReadDb(), id);
    if (target) redirect(`/work/${encodeURIComponent(target)}`);
  }

  const editions = await getWorkEditions(id);
  if (editions.length === 0) notFound();
  const collected = canon ? await getCollectedEditions(canon) : [];

  const title = canon ? canon.title : workTitleFromEditions(editions as { work_title?: string | null }[], id);
  const workSlug = canon ? canon.slug : (editions.find(e => e.work_slug)?.work_slug || id);
  const libraries = [...new Set(
    [...editions, ...collected].map(e => e.image_source?.provider_name).filter(Boolean)
  )] as string[];
  const languages = [...new Set(editions.map(e => e.language || (e as unknown as { original_language?: string }).original_language).filter(Boolean).filter(l => l !== 'Unknown'))];
  // `parseInt(published)` read "12th century" as the year 12, so this work's
  // span rendered as "12 – 1900" (Boethius) and "18 – 1100" (the Four Gospels,
  // whose real span is 550–1750). editionYear prefers the numeric `year` field,
  // which is populated on ~98% of live books.
  const dateRange = editions
    .map(e => editionYear(e as { year?: number | null; published?: string | null }))
    .filter((y): y is number => y !== null);
  const earliest = dateRange.length ? Math.min(...dateRange) : null;
  const latest = dateRange.length ? Math.max(...dateRange) : null;
  const totalPages = editions.reduce((s, e) => s + (e.pages_count || 0), 0);
  const canonAuthorUrl = canon ? authorUrl(canon.author) : null;
  const readNow = canon ? pickReadNow(canon, editions) : null;
  const sameBook = !!(readNow?.original && readNow.original === readNow.english);

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title={title}
          subtitle={canon
            ? `${canon.originalTitle} · ${canon.author} · ${canon.era}`
            : `${editions.length} editions across ${libraries.length} ${libraries.length === 1 ? 'library' : 'libraries'}`}
        />
      }
      bg="bg-cream"
    >
      {canon && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdHtml({
              '@context': 'https://schema.org',
              '@type': 'CreativeWork',
              name: canon.title,
              alternateName: canon.originalTitle,
              author: { '@type': 'Person', name: canon.author },
              inLanguage: canon.originalLanguage,
              workExample: editions.slice(0, 10).map(b => ({
                '@type': 'Book',
                name: b.display_title || b.title,
                datePublished: b.published !== 'Unknown' ? b.published : undefined,
                url: `https://sourcelibrary.org${bookUrl(b)}`,
              })),
            }),
          }}
        />
      )}
      <div className="prose-content max-w-none">
        {/* Stats bar */}
        <div className="flex flex-wrap items-center gap-6 text-sm text-stone-500 mb-10">
          {formatYearSpan(earliest, latest) && <span>{formatYearSpan(earliest, latest)}</span>}
          {languages.length > 0 && <span>{languages.join(', ')}</span>}
          <span>{totalPages.toLocaleString('en-US')} pages</span>
          <span>{editions.length} editions</span>
          {canonAuthorUrl && (
            <Link href={canonAuthorUrl} className="text-stone-600 hover:text-stone-800 underline underline-offset-2">
              More by {canon!.author}
            </Link>
          )}
          {editions.filter(e => (e.pages_translated || 0) > 0).length >= 2 && (
            <Link
              href={`/work/${workSlug}/compare`}
              className="ml-auto text-xs border border-stone-300 hover:border-stone-400 rounded-full px-3 py-1 text-stone-600 hover:text-stone-800 transition-colors"
            >
              Compare translations
            </Link>
          )}
        </div>

        {/* Read now (canon works) */}
        {readNow && (readNow.original || readNow.english) && (
          <div className="mb-12">
            <h2 className="text-lg font-medium text-stone-700 mb-4">Start reading</h2>
            <div className={`grid gap-4 ${!sameBook && readNow.original && readNow.english ? 'sm:grid-cols-2' : ''}`}>
              {readNow.original && (
                <ReadNowCard
                  book={readNow.original}
                  lane={`Read in ${canon!.originalLanguage}`}
                  sameBook={sameBook}
                />
              )}
              {readNow.english && !sameBook && (
                <ReadNowCard book={readNow.english} lane="Read in English" />
              )}
            </div>
            {canon?.locus && (
              <div className="mt-4">
                <LocusJumpBox
                  workSlug={canon.slug}
                  systemLabel={canon.locus.system === 'bekker' ? 'Bekker' : 'Stephanus'}
                  example={canon.locus.example}
                />
              </div>
            )}
          </div>
        )}

        {/* Editions grid. Canon pages group originals first, then translations
            by language — what we HOLD, never a claim about what exists (an
            absence claim needs evidence this page does not have; see
            first-translation-claims.md). Non-canon pages keep the flat list. */}
        {canon ? (() => {
          const isOriginal = (b: WorkEdition) =>
            !b.language || b.language === 'Unknown' || b.language.includes(canon.originalLanguage);
          const originals = editions.filter(isOriginal);
          const translationsByLang = new Map<string, WorkEdition[]>();
          for (const b of editions) {
            if (isOriginal(b)) continue;
            const lang = b.language as string;
            translationsByLang.set(lang, [...(translationsByLang.get(lang) || []), b]);
          }
          return (
            <>
              {originals.length > 0 && (
                <>
                  <h2 className="text-lg font-medium text-stone-700 mb-4">
                    Editions &amp; manuscripts in {canon.originalLanguage}
                  </h2>
                  <div className="grid gap-4">
                    {originals.map((book) => <EditionRow key={book.id} book={book} />)}
                  </div>
                </>
              )}
              {translationsByLang.size > 0 && (
                <div className={originals.length > 0 ? 'mt-12 pt-8 border-t border-border-light' : ''}>
                  <h2 className="text-lg font-medium text-stone-700 mb-4">Translations we hold</h2>
                  {[...translationsByLang.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([lang, books]) => (
                    <div key={lang} className="mb-6">
                      <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide mb-3">{lang}</h3>
                      <div className="grid gap-4">
                        {books.map((book) => <EditionRow key={book.id} book={book} />)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        })() : (
          <div className="grid gap-4">
            {editions.map((book) => <EditionRow key={book.id} book={book} />)}
          </div>
        )}

        {/* Collected editions containing this work */}
        {collected.length > 0 && (
          <div className="mt-12 pt-8 border-t border-border-light">
            <h2 className="text-lg font-medium text-stone-700 mb-1">Collected editions containing this work</h2>
            <p className="text-sm text-stone-500 mb-4">
              Opera and complete-works editions that include the {canon!.title} alongside other works.
            </p>
            <div className="grid gap-4">
              {collected.map((book) => <EditionRow key={book.id} book={book} />)}
            </div>
          </div>
        )}

        {/* Libraries section */}
        {libraries.length > 1 && (
          <div className="mt-12 pt-8 border-t border-border-light">
            <h2 className="text-lg font-medium text-stone-700 mb-3">
              Held at {libraries.length} libraries
            </h2>
            <div className="flex flex-wrap gap-2">
              {libraries.map((lib) => (
                <span key={lib} className="px-3 py-1.5 bg-stone-100 rounded-full text-xs text-stone-600">
                  {lib}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </ContentPageLayout>
  );
}
