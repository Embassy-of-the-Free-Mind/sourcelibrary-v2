import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import SiteHeader from '@/components/layout/SiteHeader';
import { getReadDb } from '@/lib/mongodb';
import {
  ICONCLASS_DIVISIONS,
  getIconclassLabel,
  buildIconclassPath,
  subjectUrl,
  parseSubjectSlug,
} from '@/lib/iconclass-categories';

export const revalidate = 86400;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

interface CategoryNode {
  label?: string;
  count: number;
  gallery_count: number;
  artwork_count: number;
  thumbnail: string | null;
  children: string[];
}

interface GalleryImage {
  id: string;
  href: string;
  extracted_url?: string;
  thumbnail_url?: string;
  description?: string;
  book_title?: string;
  book_author?: string;
  book_id?: string;
  book_slug?: string;
}

interface Props {
  params: Promise<{ code: string[] }>;
}

async function getIconclassTree(db: any) {
  const doc = await db.collection('system_config').findOne({ _id: 'iconclass_tree' as any });
  return doc?.nodes as Record<string, CategoryNode> | undefined;
}

async function getImagesForCode(db: any, code: string, limit = 48): Promise<GalleryImage[]> {
  const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Fetch gallery illustrations
  const galleryImages = await db.collection('gallery_images')
    .find(
      { 'metadata.iconclass': { $regex: `^${escapedCode}` } },
      {
        projection: {
          id: 1, extracted_url: 1, thumbnail_url: 1, description: 1,
          book_title: 1, book_author: 1, book_id: 1, book_slug: 1,
        },
      },
    )
    .sort({ gallery_quality: -1 })
    .limit(limit)
    .toArray();

  const results: GalleryImage[] = galleryImages.map((img: any) => ({
    id: img.id || img._id?.toString(),
    // Gallery rows carry the canonical viewer id (`${page_id}-${detection_index}`),
    // so send readers to the image itself, not the bare book page. Rows without
    // that id (legacy) fall back to the book.
    href: img.id
      ? `/gallery/image/${img.id}`
      : `/book/${img.book_slug || img.book_id}`,
    extracted_url: img.extracted_url,
    thumbnail_url: img.thumbnail_url,
    description: img.description,
    book_title: img.book_title,
    book_author: img.book_author,
    book_id: img.book_id,
    book_slug: img.book_slug,
  }));

  // Fill remaining slots with artworks
  const remaining = limit - results.length;
  if (remaining > 0) {
    const artworks = await db.collection('books')
      .find(
        {
          'enrichment.iconclass': { $regex: `^${escapedCode}` },
          content_type: 'artwork',
          thumbnail: { $ne: null },
        },
        {
          projection: {
            id: 1, slug: 1, title: 1, author: 1, thumbnail: 1, image_display: 1,
            'enrichment.description': 1,
          },
        },
      )
      .limit(remaining)
      .toArray();

    for (const art of artworks) {
      const artId = art.id || art._id?.toString();
      results.push({
        id: artId,
        // Artwork docs live at /artwork/[slug]; /book/[id] only gets there via a
        // redirect, so link straight when we have the slug.
        href: art.slug ? `/artwork/${art.slug}` : `/book/${artId}`,
        extracted_url: art.thumbnail,
        thumbnail_url: art.thumbnail,
        description: art.enrichment?.description || art.title,
        book_title: art.title,
        book_author: art.author,
        book_id: artId,
        book_slug: art.slug,
      });
    }
  }

  return results;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code: codeSegments } = await params;
  const code = parseSubjectSlug(codeSegments);
  const label = getIconclassLabel(code) || `Iconclass ${code}`;
  return {
    title: `${label} | Browse by Subject | Source Library`,
    description: `Browse ${label} illustrations and artworks in the Source Library collection, classified with Iconclass code ${code}.`,
    alternates: { canonical: subjectUrl(code, label) },
  };
}

export default async function SubjectCategoryPage({ params }: Props) {
  const { code: codeSegments } = await params;
  const code = parseSubjectSlug(codeSegments);

  let db;
  try {
    db = await getReadDb();
  } catch {
    notFound();
  }

  const nodes = await getIconclassTree(db);
  if (!nodes) notFound();

  const node = nodes[code];
  const label = getIconclassLabel(code) || node?.label || `Iconclass ${code}`;

  // Redirect bare codes to slugified URL (e.g. /26 → /26-meteorological-phenomena)
  const rawPath = codeSegments.join('/');
  const expectedSlug = subjectUrl(code, label).replace('/browse/subjects/', '');
  if (rawPath !== expectedSlug && label !== `Iconclass ${code}`) {
    redirect(subjectUrl(code, label));
  }

  // Build breadcrumb path
  const path = buildIconclassPath(code);

  // For category nodes, get child data (only show children with gallery images)
  const children = (node && node.children.length > 0)
    ? node.children
        .map(childCode => ({
          code: childCode,
          label: getIconclassLabel(childCode) || nodes[childCode]?.label || childCode,
          count: nodes[childCode]?.count || 0,
          thumbnail: nodes[childCode]?.thumbnail || null,
        }))
        .filter(c => c.count > 0)
        .sort((a, b) => b.count - a.count)
    : [];

  // Show images if leaf node, few children, or all children were filtered out
  const isLeaf = children.length === 0 || (node && node.children.length <= 2 && node.count < 200);
  const images = isLeaf ? await getImagesForCode(db, code) : [];

  return (
    <>
      <SiteHeader variant="light" />
      <div className="max-w-6xl mx-auto px-6 md:px-12 py-12 md:py-20">
        {/* Breadcrumb */}
        <nav className="flex flex-wrap items-center gap-1.5 text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
          <Link href="/browse/subjects" className="hover:underline">Subjects</Link>
          {path.map(p => (
            <span key={p.code} className="flex items-center gap-1.5">
              <span style={{ color: 'var(--border-medium)' }}>/</span>
              {p.code === code ? (
                <span style={{ color: 'var(--text-primary)' }}>{p.label}</span>
              ) : (
                <Link href={subjectUrl(p.code, p.label)} className="hover:underline">{p.label}</Link>
              )}
            </span>
          ))}
          {!path.some(p => p.code === code) && (
            <span className="flex items-center gap-1.5">
              <span style={{ color: 'var(--border-medium)' }}>/</span>
              <span style={{ color: 'var(--text-primary)' }}>{label}</span>
            </span>
          )}
        </nav>

        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl md:text-4xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
            {label}
          </h1>
          <div className="flex items-center gap-4">
            <p style={{ color: 'var(--text-muted)' }}>
              {node ? `${node.count.toLocaleString('en-US')} images` : 'No indexed images'}
            </p>
            <a
              href={`https://iconclass.org/${encodeURIComponent(code)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono px-2 py-0.5 rounded"
              style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)', border: '1px solid var(--border-light)' }}
            >
              {code} ↗
            </a>
          </div>
        </div>

        {/* Sub-categories grid */}
        {children.length > 0 && (
          <section className="mb-12">
            <h2 className="text-lg font-display mb-4" style={{ color: 'var(--text-primary)' }}>
              Sub-categories
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {children.map(child => (
                <Link
                  key={child.code}
                  href={subjectUrl(child.code, child.label)}
                  className="group relative rounded-xl overflow-hidden transition-shadow hover:shadow-lg"
                  style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
                >
                  <div className="aspect-[4/3] relative">
                    {child.thumbnail ? (
                      <Image
                        src={child.thumbnail}
                        alt={child.label}
                        fill
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-2xl opacity-20" style={{ color: 'var(--text-muted)' }}>
                        {child.code}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <p className="text-white font-display text-sm leading-tight">{child.label}</p>
                    <p className="text-white/70 text-xs mt-0.5">
                      <span className="font-mono">{child.code}</span> · {child.count.toLocaleString('en-US')}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Image grid for leaf nodes */}
        {images.length > 0 && (
          <section>
            {children.length > 0 && (
              <h2 className="text-lg font-display mb-4" style={{ color: 'var(--text-primary)' }}>
                Images
              </h2>
            )}
            <div className="columns-2 sm:columns-3 lg:columns-4 gap-4">
              {images.map(img => (
                <div key={img.id} className="break-inside-avoid mb-4">
                  <Link
                    href={img.href}
                    className="block group rounded-lg overflow-hidden transition-shadow hover:shadow-lg"
                    style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
                  >
                    <div className="relative">
                      <Image
                        src={img.extracted_url || img.thumbnail_url || ''}
                        alt={img.description || `Image from ${img.book_title || 'unknown book'}`}
                        width={400}
                        height={400}
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                        className="w-full h-auto group-hover:opacity-90 transition-opacity"
                      />
                    </div>
                    {(img.book_title || img.description) && (
                      <div className="p-2">
                        {img.description && (
                          <p className="text-xs leading-snug line-clamp-2" style={{ color: 'var(--text-primary)' }}>
                            {img.description}
                          </p>
                        )}
                        {img.book_title && (
                          <p className="text-xs mt-1 italic line-clamp-1" style={{ color: 'var(--text-muted)' }}>
                            {img.book_title}
                          </p>
                        )}
                      </div>
                    )}
                  </Link>
                </div>
              ))}
            </div>
          </section>
        )}

        {!node && images.length === 0 && (
          <p style={{ color: 'var(--text-muted)' }}>
            No images found for this Iconclass code. Try browsing a{' '}
            <Link href="/browse/subjects" className="underline">broader category</Link>.
          </p>
        )}
      </div>
    </>
  );
}
