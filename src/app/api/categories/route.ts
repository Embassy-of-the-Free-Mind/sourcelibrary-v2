import { NextResponse } from 'next/server';
import { getCategoryCounts } from '@/lib/books-catalog';

// Predefined categories for the library's focus areas
export const LIBRARY_CATEGORIES = [
  {
    id: 'alchemy',
    name: 'Alchemy',
    description: 'Transmutation, the Philosophers\' Stone, and the Great Work',
    icon: '⚗️',
  },
  {
    id: 'hermeticism',
    name: 'Hermeticism',
    description: 'Teachings attributed to Hermes Trismegistus',
    icon: '☿',
  },
  {
    id: 'jewish-kabbalah',
    name: 'Jewish Kabbalah',
    description: 'Zohar, Sefer Yetzirah, and traditional Jewish mysticism',
    icon: '✡',
  },
  {
    id: 'christian-cabala',
    name: 'Christian Cabala',
    description: 'Reuchlin, Pico, and Christian adaptations of Kabbalah',
    icon: '✝✡',
  },
  {
    id: 'neoplatonism',
    name: 'Neoplatonism',
    description: 'Platonic philosophy and the emanation of reality',
    icon: '◯',
  },
  {
    id: 'rosicrucianism',
    name: 'Rosicrucianism',
    description: 'The Rosicrucian manifestos and their influence',
    icon: '🌹',
  },
  {
    id: 'freemasonry',
    name: 'Freemasonry',
    description: 'Masonic texts and rituals',
    icon: '📐',
  },
  {
    id: 'natural-philosophy',
    name: 'Natural Philosophy',
    description: 'Early modern science and nature\'s secrets',
    icon: '🔬',
  },
  {
    id: 'astrology',
    name: 'Astrology',
    description: 'Celestial influences and astrological practice',
    icon: '★',
  },
  {
    id: 'natural-magic',
    name: 'Natural Magic',
    description: 'Sympathies, talismans, and occult properties of nature (Ficino, Della Porta)',
    icon: '🌿',
  },
  {
    id: 'ritual-magic',
    name: 'Ritual Magic',
    description: 'Ceremonial magic, grimoires, and conjuration',
    icon: '🔯',
  },
  {
    id: 'theurgy',
    name: 'Theurgy',
    description: 'Divine invocation and ascent of the soul (Iamblichus, Proclus)',
    icon: '✦',
  },
  {
    id: 'mysticism',
    name: 'Mysticism',
    description: 'Direct experience of the divine',
    icon: '◈',
  },
  {
    id: 'theology',
    name: 'Theology',
    description: 'Religious and theological texts',
    icon: '✝',
  },
  {
    id: 'medicine',
    name: 'Medicine & Healing',
    description: 'Paracelsian medicine, herbalism, and healing arts',
    icon: '⚕',
  },
  // New expanded tags
  {
    id: 'gnosticism',
    name: 'Gnosticism',
    description: 'Ancient and revival texts on gnosis, the demiurge, and divine knowledge',
    icon: '☯',
  },
  {
    id: 'theosophy',
    name: 'Theosophy',
    description: 'Blavatsky, Besant, Leadbeater, and the Theosophical Society',
    icon: '⊛',
  },
  {
    id: 'pythagoreanism',
    name: 'Pythagoreanism',
    description: 'Number mysticism, sacred geometry, and harmonic philosophy',
    icon: '△',
  },
  {
    id: 'divination',
    name: 'Divination',
    description: 'Geomancy, prophecy, oracles, and divinatory arts',
    icon: '🔮',
  },
  {
    id: 'ars-notoria',
    name: 'Ars Notoria',
    description: 'Angelic arts, memory systems, and notory art tradition',
    icon: '👁',
  },
  {
    id: 'paracelsian',
    name: 'Paracelsian',
    description: 'Works by and influenced by Paracelsus',
    icon: '🜍',
  },
  {
    id: 'spiritual-alchemy',
    name: 'Spiritual Alchemy',
    description: 'Inner transformation and symbolic interpretation of alchemy',
    icon: '🜂',
  },
  {
    id: 'christian-mysticism',
    name: 'Christian Mysticism',
    description: 'Böhme, Eckhart, Tauler, and contemplative Christianity',
    icon: '✟',
  },
  {
    id: 'prisca-theologia',
    name: 'Prisca Theologia',
    description: 'Ancient theology tradition: Moses, Orpheus, Zoroaster as sources of wisdom',
    icon: '📿',
  },
  {
    id: 'florentine-platonism',
    name: 'Florentine Platonism',
    description: 'Ficino, Pico, and the Florentine Academy',
    icon: '🏛',
  },
  {
    id: 'renaissance',
    name: 'Renaissance',
    description: 'Works from 1450-1600, the rebirth of ancient wisdom',
    icon: '🎨',
  },
  {
    id: 'reformation',
    name: 'Reformation Era',
    description: 'Works from 1517-1648, religious and esoteric upheaval',
    icon: '📜',
  },
  {
    id: 'enlightenment',
    name: 'Enlightenment',
    description: 'Works from 1650-1800, reason meets esotericism',
    icon: '💡',
  },
  {
    id: '19th-century-revival',
    name: '19th Century Revival',
    description: 'Theosophy, spiritualism, and occult revival movements',
    icon: '🌙',
  },
];

export interface CategoryWithCount {
  id: string;
  name: string;
  description: string;
  icon: string;
  book_count: number;
}

// In-memory cache for categories (refreshed every 30 minutes)
const CACHE_TTL_MS = 30 * 60 * 1000;
let cachedResult: { data: unknown; timestamp: number } | null = null;

// GET /api/categories — powered by Supabase books_catalog
export async function GET() {
  const headers = { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' };

  try {
    // Return in-memory cached result if fresh
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(cachedResult.data, { headers });
    }

    const countMap = await getCategoryCounts();

    // Merge with predefined categories
    const categories: CategoryWithCount[] = LIBRARY_CATEGORIES.map(cat => ({
      ...cat,
      book_count: countMap.get(cat.id) || 0,
    }));

    categories.sort((a, b) => {
      if (b.book_count !== a.book_count) return b.book_count - a.book_count;
      return a.name.localeCompare(b.name);
    });

    // Include custom categories not in predefined list
    const predefinedIds = new Set(LIBRARY_CATEGORIES.map(c => c.id));
    for (const [categoryId, count] of countMap) {
      if (!predefinedIds.has(categoryId)) {
        categories.push({
          id: categoryId,
          name: categoryId.charAt(0).toUpperCase() + categoryId.slice(1).replace(/-/g, ' '),
          description: '',
          icon: '📚',
          book_count: count,
        });
      }
    }

    const data = {
      categories,
      total_categorized: [...countMap.values()].reduce((sum, c) => sum + c, 0),
    };

    cachedResult = { data, timestamp: Date.now() };
    return NextResponse.json(data, { headers });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
  }
}
