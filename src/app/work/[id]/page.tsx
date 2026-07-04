import { Metadata } from 'next';
import { getReadDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Book } from '@/lib/types';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { getBookThumbnailUrl } from '@/lib/utils';

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

async function getWorkEditions(idOrSlug: string) {
  const db = await getReadDb();
  // resolve by the clean work_slug first, fall back to the raw work_id (back-compat)
  const editions = await db.collection('books').find(
    { $or: [{ work_slug: idOrSlug }, { work_id: idOrSlug }], visible: true },
    {
      projection: {
        id: 1, slug: 1, title: 1, display_title: 1, author: 1, published: 1,
        language: 1, original_language: 1, 'image_source.provider_name': 1,
        thumbnail_blob: 1, thumbnail: 1, image_display: 1, image_thumb: 1, pages_count: 1, pages_ocr: 1,
        pages_translated: 1, resource_type: 1, work_title: 1, work_slug: 1,
      },
      sort: { published: 1 },
    }
  ).toArray();
  return editions as unknown as (Book & { image_source?: { provider_name?: string } })[];
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

  const title = workTitleFromEditions(editions as { work_title?: string | null }[], id);
  const libraries = new Set(editions.map(e => (e as unknown as { image_source?: { provider_name?: string } }).image_source?.provider_name).filter(Boolean));

  return {
    title: `${title} — ${editions.length} Editions | Source Library`,
    description: `${editions.length} editions and manuscripts of ${title} across ${libraries.size} libraries. Browse, compare, and read translations.`,
    alternates: { canonical: `/work/${(editions.find(e => (e as { work_slug?: string }).work_slug) as { work_slug?: string } | undefined)?.work_slug || id}` },
  };
}

export default async function WorkPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const editions = await getWorkEditions(id);
  if (editions.length === 0) notFound();

  const title = workTitleFromEditions(editions as { work_title?: string | null }[], id);
  const workSlug = (editions.find(e => (e as { work_slug?: string }).work_slug) as { work_slug?: string })?.work_slug || id;
  const libraries = [...new Set(
    editions.map(e => (e as unknown as { image_source?: { provider_name?: string } }).image_source?.provider_name).filter(Boolean)
  )];
  const languages = [...new Set(editions.map(e => e.language || (e as unknown as { original_language?: string }).original_language).filter(Boolean).filter(l => l !== 'Unknown'))];
  const dateRange = editions
    .map(e => parseInt(e.published || '0'))
    .filter(y => y > 0);
  const earliest = dateRange.length ? Math.min(...dateRange) : null;
  const latest = dateRange.length ? Math.max(...dateRange) : null;
  const totalPages = editions.reduce((s, e) => s + (e.pages_count || 0), 0);

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title={title}
          subtitle={`${editions.length} editions across ${libraries.length} ${libraries.length === 1 ? 'library' : 'libraries'}`}
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none">
        {/* Stats bar */}
        <div className="flex flex-wrap items-center gap-6 text-sm text-stone-500 mb-10">
          {earliest && latest && earliest !== latest && (
            <span>{earliest} &ndash; {latest}</span>
          )}
          {earliest && earliest === latest && <span>{earliest}</span>}
          {languages.length > 0 && <span>{languages.join(', ')}</span>}
          <span>{totalPages.toLocaleString('en-US')} pages</span>
          <span>{editions.length} editions</span>
          {editions.filter(e => (e.pages_translated || 0) > 0).length >= 2 && (
            <Link
              href={`/work/${workSlug}/compare`}
              className="ml-auto text-xs border border-stone-300 hover:border-stone-400 rounded-full px-3 py-1 text-stone-600 hover:text-stone-800 transition-colors"
            >
              Compare translations
            </Link>
          )}
        </div>

        {/* Editions grid */}
        <div className="grid gap-4">
          {editions.map((book) => {
            const provider = (book as unknown as { image_source?: { provider_name?: string } }).image_source?.provider_name;
            const thumb = getBookThumbnailUrl(book);
            const displayTitle = book.display_title || book.title;
            const pagesOcr = book.pages_ocr || 0;
            const pagesTranslated = book.pages_translated || 0;
            const pagesCount = book.pages_count || 0;

            return (
              <Link
                key={book.id}
                href={`/book/${book.slug || book.id}`}
                className="flex items-start gap-4 p-4 rounded-xl border border-stone-200 hover:border-stone-300 hover:bg-stone-50/50 transition-all group"
              >
                {thumb ? (
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
                    {book.published && book.published !== 'Unknown' ? ` · ${book.published}` : ''}
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
                    {provider && <span>{provider}</span>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

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
