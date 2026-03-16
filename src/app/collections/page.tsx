import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Collections | Source Library',
  description: 'Browse thousands of historical texts organized into thematic collections — Western esotericism, classical philosophy, sacred texts, and more.',
  alternates: { canonical: '/collections' },
};

interface FeaturedImage {
  id: string;
  thumbnail_url?: string;
  extracted_url?: string;
  image_url?: string;
  description?: string;
  type?: string;
  book_title?: string;
}

interface CollectionDoc {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  color: string;
  order: number;
  book_count: number;
  type?: 'category' | 'curated';
  published?: boolean;
  featured_images?: FeaturedImage[];
  languages: { lang: string; count: number }[];
}

const PINNED_SLUGS = ['natural-philosophy', 'classical-philosophy', 'renaissance-philosophy', 'sacred-texts'];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchCollections(): Promise<{ categories: CollectionDoc[]; curated: CollectionDoc[] }> {
  const db = await getDb();
  const docs = await db.collection('collections').find({
    parent: { $exists: false },
    type: { $ne: 'curated' },
  }).toArray();
  const all = docs.map(({ _id, ...rest }) => rest) as unknown as CollectionDoc[];

  // Split into category and curated (only published curated)
  const categories = all.filter(c => c.type !== 'curated');
  const curated = all.filter(c => c.type === 'curated' && c.published);

  // Pin + shuffle categories
  const pinned = PINNED_SLUGS.map(s => categories.find(c => c.slug === s)).filter(Boolean) as CollectionDoc[];
  const rest = categories.filter(c => !PINNED_SLUGS.includes(c.slug));

  return {
    categories: [...pinned, ...shuffle(rest)],
    curated: shuffle(curated),
  };
}

function CollectionCard({ col }: { col: CollectionDoc }) {
  const hero = col.featured_images?.find(
    img => img.extracted_url || img.image_url || img.thumbnail_url
  );
  const heroUrl = hero?.extracted_url || hero?.image_url || hero?.thumbnail_url;

  return (
    <Link
      key={col.slug}
      href={`/collections/${col.slug}`}
      className="group relative block overflow-hidden rounded-lg aspect-[4/3]"
    >
      {heroUrl ? (
        <Image
          src={heroUrl}
          alt={`Illustration from ${col.name}`}
          fill
          sizes="(max-width: 640px) 50vw, 25vw"
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          unoptimized
        />
      ) : (
        <div className="absolute inset-0 bg-warm" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
      <div className="absolute inset-0 flex flex-col justify-end p-3 sm:p-4">
        <p className="text-white/50 text-xs mb-1 hidden sm:block">
          {col.book_count > 0 ? `${col.book_count.toLocaleString()} books` : ''}
        </p>
        <h2 className="font-serif text-sm sm:text-base lg:text-lg text-white font-semibold leading-tight line-clamp-2 group-hover:text-accent-gold transition-colors">
          {col.name}
        </h2>
      </div>
    </Link>
  );
}

function CuratedCollectionCard({ col }: { col: CollectionDoc }) {
  return (
    <Link
      href={`/collections/${col.slug}`}
      className="group block p-5 rounded-lg border border-border-light bg-white hover:border-accent-rust/30 hover:shadow-md transition-all"
    >
      <h3 className="font-display text-lg text-primary group-hover:text-accent-rust transition-colors leading-snug mb-1">
        {col.name}
      </h3>
      <p className="text-sm text-secondary leading-relaxed line-clamp-2">
        {col.subtitle || col.description}
      </p>
      {col.book_count > 0 && (
        <p className="text-xs text-muted mt-2">{col.book_count.toLocaleString()} books</p>
      )}
    </Link>
  );
}

export default async function CollectionsPage() {
  const { categories, curated } = await fetchCollections();
  const totalBooks = categories.reduce((s, c) => s + c.book_count, 0);

  return (
    <ContentPageLayout>
      <ContentHeader
        title="Collections"
        subtitle={`${totalBooks.toLocaleString()} books organized into ${categories.length} thematic collections spanning three millennia of human knowledge.`}
      />

      {/* Curated exhibitions */}
      {curated.length > 0 && (
        <div className="mb-10">
          <h2 className="font-display text-2xl text-primary mb-1">Exhibitions</h2>
          <p className="text-sm text-muted mb-5">Curated collections that trace ideas, people, and stories across the library.</p>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {curated.map((col) => (
              <CuratedCollectionCard key={col.slug} col={col} />
            ))}
          </div>
        </div>
      )}

      {/* Category collections */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {categories.map((col) => (
          <CollectionCard key={col.slug} col={col} />
        ))}
      </div>
    </ContentPageLayout>
  );
}
