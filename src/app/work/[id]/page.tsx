import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Book } from '@/lib/types';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const revalidate = 3600;
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getWorkEditions(workId: string) {
  const db = await getDb();
  const editions = await db.collection('books').find(
    { work_id: workId, hidden: { $ne: true } },
    {
      projection: {
        id: 1, slug: 1, title: 1, display_title: 1, author: 1, published: 1,
        language: 1, original_language: 1, 'image_source.provider_name': 1,
        thumbnail_blob: 1, thumbnail: 1, pages_count: 1, pages_ocr: 1,
        pages_translated: 1, resource_type: 1,
      },
      sort: { published: 1 },
    }
  ).toArray();
  return editions as unknown as (Book & { image_source?: { provider_name?: string } })[];
}

// Derive a human-readable title from the work_id slug
function workTitle(workId: string): string {
  return workId
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  let editions: Awaited<ReturnType<typeof getWorkEditions>>;
  try {
    editions = await getWorkEditions(id);
  } catch {
    return { title: 'Source Library', robots: { index: false, follow: false } };
  }
  if (editions.length === 0) return { title: 'Work Not Found', robots: { index: false, follow: true } };

  const title = workTitle(id);
  const libraries = new Set(editions.map(e => (e as unknown as { image_source?: { provider_name?: string } }).image_source?.provider_name).filter(Boolean));

  return {
    title: `${title} — ${editions.length} Editions | Source Library`,
    description: `${editions.length} editions and manuscripts of ${title} across ${libraries.size} libraries. Browse, compare, and read translations.`,
    alternates: { canonical: `/work/${id}` },
  };
}

export default async function WorkPage({ params }: PageProps) {
  const { id } = await params;
  const editions = await getWorkEditions(id);
  if (editions.length === 0) notFound();

  const title = workTitle(id);
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
        <div className="flex flex-wrap gap-6 text-sm text-stone-500 mb-10">
          {earliest && latest && earliest !== latest && (
            <span>{earliest} &ndash; {latest}</span>
          )}
          {earliest && earliest === latest && <span>{earliest}</span>}
          {languages.length > 0 && <span>{languages.join(', ')}</span>}
          <span>{totalPages.toLocaleString()} pages</span>
          <span>{editions.length} editions</span>
        </div>

        {/* Editions grid */}
        <div className="grid gap-4">
          {editions.map((book) => {
            const provider = (book as unknown as { image_source?: { provider_name?: string } }).image_source?.provider_name;
            const thumb = book.thumbnail_blob || book.thumbnail;
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
