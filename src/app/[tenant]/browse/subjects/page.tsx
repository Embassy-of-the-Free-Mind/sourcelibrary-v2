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

export default async function SubjectsPage() {
  const tree = await getIconclassTree();

  return (
    <>
      <SiteHeader variant="light" />
      <div className="max-w-6xl mx-auto px-6 md:px-12 py-12 md:py-20">
        <div className="mb-12">
          <h1 className="text-3xl md:text-4xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
            Browse by Subject
          </h1>
          <p className="text-lg" style={{ color: 'var(--text-muted)' }}>
            Explore {tree ? tree.total_items.toLocaleString() : ''} classified images through the{' '}
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
                      {node.count.toLocaleString()} images
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
