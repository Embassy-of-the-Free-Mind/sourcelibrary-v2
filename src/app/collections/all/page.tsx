import { getReadDb } from '@/lib/mongodb';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import type { Metadata } from 'next';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'All Collections | Source Library',
  description: 'Browse every collection and sub-collection in Source Library, organized by wing.',
  alternates: { canonical: '/collections/all' },
};

interface FeaturedImage {
  thumbnail_url?: string;
  extracted_url?: string;
  image_url?: string;
}

interface SubCollection {
  slug: string;
  name: string;
  book_count: number;
  visible: boolean;
  type?: string;
  image?: string;
}

interface Wing {
  slug: string;
  name: string;
  book_count: number;
  image?: string;
  children: SubCollection[];
}

function pickImage(images?: FeaturedImage[]): string | undefined {
  if (!images?.length) return undefined;
  const img = images[0];
  return img.extracted_url || img.thumbnail_url || img.image_url;
}

async function fetchWings(): Promise<Wing[]> {
  const db = await getReadDb();

  // Get the 18 top-level wings
  const wings = await db.collection('collections').find({
    parent: { $exists: false },
    type: { $ne: 'curated' },
    collection_type: { $ne: 'visual_art' },
    visible: true,
  }).project({ slug: 1, name: 1, book_count: 1, featured_images: { $slice: 1 }, _id: 0 }).sort({ name: 1 }).toArray();

  // Get all subcollections with their first featured image
  const subs = await db.collection('collections').find({
    parent: { $exists: true },
  }).project({
    slug: 1, name: 1, book_count: 1, parent: 1, visible: 1, type: 1,
    featured_images: { $slice: 1 }, _id: 0,
  }).toArray();

  // Build parent → children map
  const childMap = new Map<string, SubCollection[]>();
  for (const sub of subs) {
    const parents = Array.isArray(sub.parent) ? sub.parent : [sub.parent];
    for (const p of parents) {
      if (!childMap.has(p)) childMap.set(p, []);
      childMap.get(p)!.push({
        slug: sub.slug,
        name: sub.name || sub.slug,
        book_count: sub.book_count || 0,
        visible: sub.visible !== false,
        type: sub.type,
        image: pickImage(sub.featured_images),
      });
    }
  }

  // Sort children by book count descending
  for (const kids of childMap.values()) {
    kids.sort((a, b) => b.book_count - a.book_count);
  }

  return wings.map(w => ({
    slug: w.slug,
    name: w.name,
    book_count: w.book_count || 0,
    image: pickImage(w.featured_images),
    children: childMap.get(w.slug) || [],
  }));
}

export default async function AllCollectionsPage() {
  const wings = await fetchWings();

  return (
    <ContentPageLayout
      maxWidth="wide"
      header={
        <ContentHeader
          title="All Collections"
          subtitle="Every wing and sub-collection in the library."
        />
      }
    >
      <div className="mb-4">
        <Link
          href="/collections"
          className="text-sm text-accent-rust hover:text-accent-rust/80 transition-colors"
        >
          &larr; Back to collections
        </Link>
      </div>

      <div className="grid gap-8 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {wings.map(wing => (
          <div key={wing.slug} className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            {/* Wing header with image */}
            <Link
              href={`/collections/${wing.slug}`}
              className="group relative block h-28 overflow-hidden"
            >
              {wing.image ? (
                <Image
                  src={wing.image}
                  alt={wing.name}
                  fill
                  sizes="(max-width: 768px) 100vw, 33vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  unoptimized
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-r from-[#2a1f17] to-[#3d2e22]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.9)] via-[rgba(26,22,18,0.4)] to-transparent" />
              <div className="absolute inset-0 flex flex-col justify-end p-4">
                <h2 className="font-serif text-lg text-white font-semibold group-hover:text-accent-gold transition-colors">
                  {wing.name}
                </h2>
                <p className="text-white/50 text-xs mt-0.5">
                  {wing.book_count.toLocaleString()} books · {wing.children.length} sub-collections
                </p>
              </div>
            </Link>

            {/* Subcollections */}
            {wing.children.length > 0 ? (
              <ul className="divide-y divide-stone-100">
                {wing.children.map(sub => (
                  <li key={sub.slug}>
                    <Link
                      href={`/collections/${sub.slug}`}
                      className={`flex items-center gap-3 px-4 py-2 hover:bg-stone-50 transition-colors ${
                        !sub.visible ? 'opacity-40' : ''
                      }`}
                    >
                      {/* Thumbnail */}
                      <div className="w-8 h-8 rounded overflow-hidden flex-shrink-0 bg-stone-100">
                        {sub.image ? (
                          <Image
                            src={sub.image}
                            alt=""
                            width={32}
                            height={32}
                            className="w-full h-full object-cover"
                            unoptimized
                          />
                        ) : (
                          <div className="w-full h-full bg-stone-200" />
                        )}
                      </div>
                      <span className="text-sm text-stone-700 truncate flex-1">
                        {sub.name}
                        {sub.type === 'curated' && (
                          <span className="ml-1.5 text-[10px] text-accent-rust font-medium uppercase tracking-wider">
                            curated
                          </span>
                        )}
                        {!sub.visible && (
                          <span className="ml-1.5 text-[10px] text-stone-400 font-medium uppercase tracking-wider">
                            hidden
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-stone-400 tabular-nums flex-shrink-0">
                        {sub.book_count.toLocaleString()}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-stone-400 italic">No sub-collections yet</p>
            )}
          </div>
        ))}
      </div>
    </ContentPageLayout>
  );
}
