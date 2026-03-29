import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, BookOpen, ChevronRight } from 'lucide-react';
import { getDb } from '@/lib/mongodb';
import { LIBRARY_CATEGORIES, CategoryWithCount } from '@/app/api/categories/route';

// ISR: rebuild every 6 hours. Allow 60s for first-hit generation.
export const revalidate = 21600;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Browse by Category — Source Library',
  description: 'Explore rare esoteric, alchemical, and philosophical texts organized by tradition: alchemy, Hermeticism, Kabbalah, Neoplatonism, Rosicrucianism, astrology, and more.',
  alternates: { canonical: '/categories' },
  openGraph: {
    title: 'Browse by Category — Source Library',
    description: 'Explore rare esoteric texts organized by tradition and subject.',
  },
};

async function getCategoriesWithCounts(): Promise<CategoryWithCount[]> {
  let countMap = new Map<string, number>();

  try {
    const db = await getDb();
    const categoryCounts = await db.collection('books').aggregate([
      { $match: { hidden: { $ne: true }, categories: { $exists: true } } },
      { $unwind: '$categories' },
      { $group: { _id: '$categories', count: { $sum: 1 } } },
    ], { maxTimeMS: 45000 }).toArray();

    for (const item of categoryCounts) {
      countMap.set(item._id as string, item.count as number);
    }
  } catch {
    // DB unavailable (e.g. build time) — render with zero counts
  }

  const categories: CategoryWithCount[] = LIBRARY_CATEGORIES.map(cat => ({
    ...cat,
    book_count: countMap.get(cat.id) || 0,
  }));

  categories.sort((a, b) => {
    if (b.book_count !== a.book_count) return b.book_count - a.book_count;
    return a.name.localeCompare(b.name);
  });

  return categories;
}

export default async function CategoriesPage() {
  const categories = await getCategoriesWithCounts();

  const activeCategories = categories.filter(c => c.book_count > 0);
  const emptyCategories = categories.filter(c => c.book_count === 0);

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Library
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-5xl mx-auto px-4 py-12 text-center">
          <h1 className="text-3xl sm:text-4xl font-serif font-bold">
            Browse by Category
          </h1>
          <p className="text-stone-300 mt-3 max-w-2xl mx-auto">
            Explore our collection of esoteric, alchemical, and early modern philosophical texts
            organized by tradition and subject.
          </p>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Categories with books */}
        {activeCategories.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeCategories.map(category => (
              <Link
                key={category.id}
                href={`/categories/${category.id}`}
                className="group bg-white rounded-xl border border-stone-200 p-5 hover:border-accent-gold/20 hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{category.icon}</span>
                    <div>
                      <h2 className="font-semibold text-stone-900 group-hover:text-accent-rust transition-colors">
                        {category.name}
                      </h2>
                      <p className="text-sm text-accent-rust font-medium">
                        {category.book_count} book{category.book_count !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-stone-400 group-hover:text-accent-rust transition-colors" />
                </div>
                {category.description && (
                  <p className="text-sm text-stone-600 mt-3 line-clamp-2">
                    {category.description}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}

        {/* Empty categories */}
        {emptyCategories.length > 0 && (
          <div className="mt-12">
            <h3 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-4">
              Coming Soon
            </h3>
            <div className="flex flex-wrap gap-3">
              {emptyCategories.map(category => (
                <div
                  key={category.id}
                  className="flex items-center gap-2 px-4 py-2 bg-stone-100 text-stone-500 rounded-lg"
                >
                  <span>{category.icon}</span>
                  <span className="text-sm">{category.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No categories */}
        {categories.length === 0 && (
          <div className="text-center py-16">
            <BookOpen className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-stone-700 mb-2">
              No categories yet
            </h2>
            <p className="text-stone-500">
              Books will be organized into categories as they are processed.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
