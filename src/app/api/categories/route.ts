import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

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
    id: 'kabbalah',
    name: 'Kabbalah',
    description: 'Jewish mysticism and esoteric interpretation',
    icon: '✡',
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
    id: 'magic',
    name: 'Magic & Theurgy',
    description: 'Ritual magic, talismans, and divine invocation',
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
];

export interface CategoryWithCount {
  id: string;
  name: string;
  description: string;
  icon: string;
  book_count: number;
}

// GET /api/categories - List all categories with book counts
export async function GET() {
  try {
    const db = await getDb();

    // Get category counts from books
    const categoryCounts = await db.collection('books').aggregate([
      { $unwind: '$categories' },
      { $group: { _id: '$categories', count: { $sum: 1 } } },
    ]).toArray();

    const countMap = new Map<string, number>();
    for (const item of categoryCounts) {
      countMap.set(item._id as string, item.count as number);
    }

    // Merge with predefined categories
    const categories: CategoryWithCount[] = LIBRARY_CATEGORIES.map(cat => ({
      ...cat,
      book_count: countMap.get(cat.id) || 0,
    }));

    // Sort by book count descending, then alphabetically
    categories.sort((a, b) => {
      if (b.book_count !== a.book_count) return b.book_count - a.book_count;
      return a.name.localeCompare(b.name);
    });

    // Also include any custom categories not in our predefined list
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

    return NextResponse.json({
      categories,
      total_categorized: categoryCounts.reduce((sum, c) => sum + (c.count as number), 0),
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}
