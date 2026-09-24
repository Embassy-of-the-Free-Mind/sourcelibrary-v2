import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import SiteHeader from '@/components/layout/SiteHeader';
import { getReadDb } from '@/lib/mongodb';
import { topicHref } from '@/lib/image-subjects';

// The index is rebuilt nightly; a few hours of lag is fine.
export const revalidate = 21600;

export const metadata: Metadata = {
  title: 'Browse by Subject | Source Library',
  description: 'Explore the illustrations in Source Library books by what they show — plants and herbals, geometry, astronomy, alchemy, emblems, anatomy, music, maps and more.',
  alternates: { canonical: '/browse/subjects' },
};

interface TopicStats {
  id: string;
  label: string;
  count: number;
  book_count: number;
  thumbnail: string | null;
}

interface CategoryStats extends TopicStats {
  terms: TopicStats[];
}

interface SubjectIndex {
  categories: CategoryStats[];
  total_images: number;
  covered_images: number;
}

/**
 * The illustrations, grouped by what they show (#4856).
 *
 * The categories and terms are a fixed vocabulary in a reader's words
 * (`src/data/image-subjects.json`); the extractor's free-text subjects are mapped onto
 * it by `src/data/image-subject-map.json`, so "botany", "herbalism" and "flora" land in
 * one place. Counts and thumbnails are precomputed nightly by
 * `scripts/maintenance/build-gallery-subject-index.mjs`. Every link is a gallery filter
 * (`/gallery?topic=`).
 *
 * A failed read throws rather than rendering a fallback: ISR then keeps serving the
 * last good page instead of caching an error state for the whole revalidate window
 * (see .claude/docs/invariants/rendering-and-seo.md).
 */
async function getSubjectIndex(): Promise<SubjectIndex | null> {
  const db = await getReadDb();
  // `system_config` keys its documents by string id, which the driver's default
  // `_id: ObjectId` typing does not express.
  const doc = await db.collection('system_config')
    .findOne({ _id: 'gallery_subject_index' as unknown as import('mongodb').ObjectId });
  if (!doc?.categories?.length) return null;
  return {
    categories: doc.categories as CategoryStats[],
    total_images: (doc.total_images as number) ?? 0,
    covered_images: (doc.covered_images as number) ?? 0,
  };
}

const n = (x: number) => x.toLocaleString('en-US');

export default async function SubjectsPage() {
  const index = await getSubjectIndex();

  return (
    <>
      <SiteHeader variant="light" />
      <div className="max-w-6xl mx-auto px-6 md:px-12 py-12 md:py-20">
        <div className="mb-12">
          <h1 className="text-3xl md:text-4xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
            Browse by Subject
          </h1>
          <p className="text-lg" style={{ color: 'var(--text-muted)' }}>
            The illustrations in our books, grouped by what they show.
          </p>
        </div>

        {!index ? (
          <p style={{ color: 'var(--text-muted)' }}>
            Subject index is being computed. Check back shortly.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {index.categories.map((cat) => (
              <section
                key={cat.id}
                className="rounded-xl overflow-hidden flex flex-col"
                style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
              >
                <Link href={topicHref(cat.id)} className="group relative block aspect-[16/9]">
                  {cat.thumbnail ? (
                    <Image
                      src={cat.thumbnail}
                      alt={cat.label}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl opacity-30">◈</div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <h2 className="text-white font-display text-lg leading-tight">{cat.label}</h2>
                    <p className="text-white/75 text-xs mt-0.5">
                      {n(cat.count)} images · {n(cat.book_count)} books
                    </p>
                  </div>
                </Link>
                <ul className="flex flex-wrap gap-1.5 p-4">
                  {cat.terms.map((t) => (
                    <li key={t.id}>
                      <Link
                        href={topicHref(t.id)}
                        className="inline-block px-2.5 py-1 text-xs rounded-full border transition-colors hover:border-accent-rust/40"
                        style={{ borderColor: 'var(--border-light)', color: 'var(--text-secondary)' }}
                      >
                        {t.label} <span style={{ color: 'var(--text-muted)' }}>{n(t.count)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {index && (
          <p className="text-xs mt-12" style={{ color: 'var(--text-muted)' }}>
            Subjects are drawn from the descriptions written for each illustration and grouped
            into these categories; {n(index.covered_images)} of {n(index.total_images)} illustrations
            appear here. An illustration can sit in more than one category.
          </p>
        )}
      </div>
    </>
  );
}
