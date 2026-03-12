import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { readFile } from 'fs/promises';
import path from 'path';

interface CollectionEntry {
  id: string;
  title: string;
  category: string;
  books: number;
  pages: number;
  displayOrder: number;
}

interface CollectionDetail {
  id: string;
  title: string;
  shortTitle?: string;
  description: string;
  dateRange?: string;
  totalBooks: number;
  totalPages: number;
  themes?: string[];
  featured?: boolean;
}

// The custom collection page (not in curator-data)
const CUSTOM_COLLECTION = {
  id: 'contemplative-traditions',
  title: 'The Contemplative Traditions',
  shortTitle: 'Contemplative',
  description:
    'Primary sources from five wisdom traditions — Taoism, Sufism, Zen Buddhism, Advaita Vedanta, and depth psychology — in their original languages alongside English translations.',
  dateRange: '975 AD – 1936',
  totalBooks: 40,
  totalPages: 0,
  themes: ['Taoism', 'Sufism', 'Buddhism', 'Vedanta', 'Depth Psychology'],
  featured: true,
  isCustomPage: true,
};

// Pool of collections worth featuring (hand-picked for visual/editorial interest)
const FEATURED_POOL = [
  'contemplative-traditions',
  'rosicrucian-circle',
  'alchemical-emblems',
  'ficino-neoplatonic-sources',
  'medieval-western-mysticism',
  'scientific-revolution-core',
  'non-canonical-ancient-texts',
  'theosophy-modern-occultism',
  'arabic-alchemy-magic',
  'pico-della-mirandola',
  'kabbalah-jewish-mysticism',
  'rudolf-ii-prague-court',
  'byzantine-mystical-theology',
  'chinese-classics-philosophy',
  'insular-gospel-manuscripts',
  'sanskrit-tantra-yoga',
  'islamic-philosophy-sufism',
  'desert-fathers-monasticism',
  'paracelsian-medicine',
  'ancient-medieval-medicine',
];

const DISPLAY_COUNT = 6;

// Category color mapping
const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Alchemy': { bg: 'bg-accent-gold/8', text: 'text-accent-rust', border: 'border-accent-gold/20' },
  'Renaissance': { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  'Byzantine': { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  'Scientific Revolution': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  'Comparative Esoteric': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  'Ancient Texts': { bg: 'bg-stone-100', text: 'text-stone-700', border: 'border-stone-300' },
  'Medieval Mysticism': { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200' },
  'Modern Occultism': { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  'Islamic Tradition': { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
  'Court Culture': { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' },
  'Philosophy': { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' },
  'Medicine & Science': { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' },
  'Medieval Art': { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  'Contemplative': { bg: 'bg-stone-100', text: 'text-stone-700', border: 'border-stone-300' },
};

function getColors(category: string) {
  return CATEGORY_COLORS[category] || { bg: 'bg-stone-50', text: 'text-stone-600', border: 'border-stone-200' };
}

// Date-seeded shuffle — same picks all day, fresh tomorrow
function dailyShuffle<T>(arr: T[]): T[] {
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const shuffled = [...arr];
  let s = seed;
  for (let i = shuffled.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    const j = s % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function loadCollectionDetail(id: string): Promise<CollectionDetail | null> {
  if (id === 'contemplative-traditions') {
    return CUSTOM_COLLECTION;
  }
  try {
    const filePath = path.join(process.cwd(), 'curator-data', 'collections', `${id}.json`);
    const data = JSON.parse(await readFile(filePath, 'utf-8'));
    return data;
  } catch {
    return null;
  }
}

function getCollectionHref(id: string): string {
  if (id === 'contemplative-traditions') {
    return '/collections/contemplative-traditions';
  }
  return `/collections/${id}`;
}

export default async function FeaturedCollections() {
  // Pick today's 6
  const todaysPicks = dailyShuffle(FEATURED_POOL).slice(0, DISPLAY_COUNT);

  // Load details in parallel
  const details = await Promise.all(todaysPicks.map(loadCollectionDetail));
  const collections = details.filter((d): d is CollectionDetail => d !== null);

  if (collections.length === 0) return null;

  // Load index for category mapping
  let categoryMap = new Map<string, string>();
  try {
    const indexPath = path.join(process.cwd(), 'curator-data', 'index.json');
    const index = JSON.parse(await readFile(indexPath, 'utf-8'));
    for (const entry of index.collections as CollectionEntry[]) {
      categoryMap.set(entry.id, entry.category);
    }
  } catch { /* fine, just won't have categories */ }
  categoryMap.set('contemplative-traditions', 'Contemplative');

  return (
    <section className="bg-[#f6f3ee] pt-16 md:pt-24 pb-8">
      <div className="px-6 md:px-12 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2
              className="text-3xl md:text-4xl lg:text-5xl text-gray-900 italic font-display"
            >
              Collections
            </h2>
            <p className="text-stone-500 mt-2 text-sm md:text-base">
              Curated pathways through the library
            </p>
          </div>
          <Link
            href="/collections"
            className="hidden sm:inline-flex items-center gap-1.5 text-sm text-accent-rust hover:text-accent-gold-dark font-medium transition-colors"
          >
            All collections
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {collections.map(coll => {
            const category = categoryMap.get(coll.id) || '';
            const colors = getColors(category);
            const href = getCollectionHref(coll.id);

            return (
              <Link key={coll.id} href={href} className="group block">
                <div
                  className={`h-full rounded-xl border ${colors.border} ${colors.bg} p-5 hover:shadow-md transition-[box-shadow]`}
                >
                  {/* Category label */}
                  {category && (
                    <span
                      className={`inline-block text-[10px] font-semibold uppercase tracking-wider ${colors.text} mb-2`}
                    >
                      {category}
                    </span>
                  )}

                  {/* Title */}
                  <h3
                    className="text-base font-bold text-stone-900 group-hover:text-accent-gold-dark transition-colors leading-snug mb-2 font-display"
                  >
                    {coll.shortTitle || coll.title.split(':')[0]}
                  </h3>

                  {/* Description (truncated) */}
                  <p className="text-xs text-stone-500 leading-relaxed line-clamp-2 mb-3">
                    {coll.description}
                  </p>

                  {/* Meta */}
                  <div className="flex items-center gap-3 text-[11px] text-stone-400">
                    <span>{coll.totalBooks} texts</span>
                    {coll.dateRange && (
                      <>
                        <span>&middot;</span>
                        <span>{coll.dateRange}</span>
                      </>
                    )}
                  </div>

                  {/* Theme pills (first 3) */}
                  {coll.themes && coll.themes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {coll.themes.slice(0, 3).map(theme => (
                        <span
                          key={theme}
                          className="px-2 py-0.5 bg-white/60 text-stone-500 text-[10px] rounded-full border border-stone-200/60"
                        >
                          {theme}
                        </span>
                      ))}
                      {coll.themes.length > 3 && (
                        <span className="px-2 py-0.5 text-stone-400 text-[10px]">
                          +{coll.themes.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>

        {/* Mobile "all collections" link */}
        <div className="sm:hidden mt-6 text-center">
          <Link
            href="/collections"
            className="inline-flex items-center gap-1.5 text-sm text-accent-rust hover:text-accent-gold-dark font-medium transition-colors"
          >
            All collections
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
