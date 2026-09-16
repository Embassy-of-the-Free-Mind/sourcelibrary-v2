import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import SiteHeader from '@/components/layout/SiteHeader';
import { getReadDb } from '@/lib/mongodb';
import { ICONCLASS_DIVISIONS, subjectUrl } from '@/lib/iconclass-categories';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Browse by Subject | Source Library',
  description: 'Explore illustrations and artworks through the Iconclass visual classification system — from alchemy and mythology to natural history and sacred texts.',
  alternates: { canonical: '/browse/subjects' },
};

interface CategoryNode {
  label: string;
  count: number;
  gallery_count: number;
  artwork_count: number;
  thumbnail: string | null;
  children: string[];
}

interface SubjectTerm {
  term: string;
  label: string;
  count: number;
  book_count: number;
  thumbnail: string | null;
  href: string;
}

/**
 * What the pictures themselves say they show (#4856).
 *
 * The Iconclass tree below indexes 2,210 of 190,169 visible images (1.2%), which is
 * why the divisions read as undifferentiated walls — not because a visual taxonomy is
 * the wrong idea, but because almost nothing is in it. `metadata.subjects` reaches
 * 97.2%, in words a reader would use. Precomputed by
 * `scripts/maintenance/build-gallery-subject-index.mjs`; each tile is an existing
 * gallery filter (`/gallery?subject=`), so this adds a door, not a query path.
 */
async function getSubjectIndex(): Promise<{ terms: SubjectTerm[]; indexed: number } | null> {
  try {
    const db = await getReadDb();
    // `system_config` keys its documents by string id, which the driver's default
    // `_id: ObjectId` typing does not express (same cast as the Iconclass loader below).
    const doc = await db.collection('system_config')
      .findOne({ _id: 'gallery_subject_index' as unknown as import('mongodb').ObjectId });
    if (!doc?.terms?.length) return null;
    return { terms: doc.terms as SubjectTerm[], indexed: (doc.indexed_images as number) ?? 0 };
  } catch {
    return null;
  }
}

async function getIconclassTree(): Promise<{ nodes: Record<string, CategoryNode>; total_items: number } | null> {
  try {
    const db = await getReadDb();
    const doc = await db.collection('system_config').findOne({ _id: 'iconclass_tree' as any });
    if (!doc) return null;
    return { nodes: doc.nodes as Record<string, CategoryNode>, total_items: doc.total_items as number };
  } catch {
    return null;
  }
}

const SUBJECT_TILES = 40;

export default async function SubjectsPage() {
  const [tree, subjects] = await Promise.all([getIconclassTree(), getSubjectIndex()]);

  return (
    <>
      <SiteHeader variant="light" />
      <div className="max-w-6xl mx-auto px-6 md:px-12 py-12 md:py-20">
        <div className="mb-12">
          <h1 className="text-3xl md:text-4xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
            Browse by Subject
          </h1>
          <p className="text-lg" style={{ color: 'var(--text-muted)' }}>
            Two ways in: what the pictures show, or the{' '}
            <a
              href="https://iconclass.org"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
              style={{ color: 'var(--text-muted)' }}
            >
              Iconclass
            </a>{' '}
            visual classification system.
          </p>
        </div>

        {subjects && (
          <section className="mb-16">
            <h2 className="text-xl font-display mb-1" style={{ color: 'var(--text-primary)' }}>
              What the pictures show
            </h2>
            <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
              Drawn from the descriptions written for each illustration, so a subject here is
              named the way a reader would name it.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {subjects.terms.slice(0, SUBJECT_TILES).map(t => (
                <Link
                  key={t.term}
                  href={t.href}
                  className="group relative rounded-xl overflow-hidden transition-shadow hover:shadow-lg"
                  style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
                >
                  <div className="aspect-[4/3] relative">
                    {t.thumbnail ? (
                      <Image
                        src={t.thumbnail}
                        alt={t.label}
                        fill
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl opacity-30">◈</div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <p className="text-white font-display text-sm leading-tight">{t.label}</p>
                    <p className="text-white/70 text-xs mt-0.5">
                      {t.count.toLocaleString('en-US')} images · {t.book_count.toLocaleString('en-US')} books
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <h2 className="text-xl font-display mb-6" style={{ color: 'var(--text-primary)' }}>
          Iconclass divisions
        </h2>

        {!tree ? (
          <p style={{ color: 'var(--text-muted)' }}>
            Subject index is being computed. Check back shortly.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {ICONCLASS_DIVISIONS.map(div => {
              const node = tree.nodes[div.code];
              if (!node || node.count === 0) return null;

              return (
                <Link
                  key={div.code}
                  href={subjectUrl(div.code, node.label || div.label)}
                  className="group relative rounded-xl overflow-hidden transition-shadow hover:shadow-lg"
                  style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
                >
                  <div className="aspect-[4/3] relative">
                    {node.thumbnail ? (
                      <Image
                        src={node.thumbnail}
                        alt={div.label}
                        fill
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl opacity-30">
                        {div.icon}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <p className="text-white font-display text-sm leading-tight">{div.label}</p>
                    <p className="text-white/70 text-xs mt-0.5">
                      {node.count.toLocaleString('en-US')} images
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <div className="mt-16 pt-8" style={{ borderTop: '1px solid var(--border-light)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Classification powered by{' '}
            <a href="https://iconclass.org" target="_blank" rel="noopener noreferrer" className="underline">
              Iconclass
            </a>
            , the international standard for describing visual subjects in art.
            Codes assigned by Gemini AI during image extraction.
          </p>
        </div>
      </div>
    </>
  );
}
