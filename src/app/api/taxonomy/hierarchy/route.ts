import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 30;

export async function GET() {
  try {
    const db = await getDb();
    const books = db.collection('books');

    // Aggregate: group by cluster + subcluster, get counts and sample books
    const groups = await books.aggregate([
      { $match: { taxonomy: { $exists: true }, hidden: { $ne: true } } },
      { $sort: { year: 1 } },
      {
        $group: {
          _id: {
            cluster: '$taxonomy.cluster',
            subcluster: { $ifNull: ['$taxonomy.subcluster', '__none__'] },
          },
          count: { $sum: 1 },
          cluster_id: { $first: '$taxonomy.cluster_id' },
          books: {
            $push: {
              id: '$id',
              title: '$title',
              author: '$author',
              year: '$year',
              language: '$language',
              slug: '$slug',
            },
          },
        },
      },
    ]).toArray();

    // Build hierarchy
    const clusterMap = new Map<string, {
      name: string;
      cluster_id: number;
      count: number;
      subclusters: Array<{
        name: string | null;
        count: number;
        books: Array<{ id: string; title: string; author: string; year: number; language: string; slug: string }>;
      }>;
    }>();

    for (const g of groups) {
      const clusterName = g._id.cluster as string;
      const subName = g._id.subcluster as string;

      if (!clusterMap.has(clusterName)) {
        clusterMap.set(clusterName, {
          name: clusterName,
          cluster_id: g.cluster_id,
          count: 0,
          subclusters: [],
        });
      }

      const cluster = clusterMap.get(clusterName)!;
      cluster.count += g.count;

      // Keep up to 8 sample books per subcluster
      const sampleBooks = (g.books as Array<Record<string, unknown>>).slice(0, 8).map((b) => ({
        id: b.id as string,
        title: ((b.title as string) || '?').slice(0, 90),
        author: ((b.author as string) || '').slice(0, 60),
        year: b.year as number,
        language: b.language as string,
        slug: b.slug as string,
      }));

      cluster.subclusters.push({
        name: subName === '__none__' ? null : subName,
        count: g.count,
        books: sampleBooks,
      });
    }

    // Sort clusters by count desc, subclusters by count desc within each
    const clusters = Array.from(clusterMap.values())
      .sort((a, b) => b.count - a.count)
      .map((c) => ({
        ...c,
        subclusters: c.subclusters.sort((a, b) => {
          // Null (noise) always last
          if (!a.name) return 1;
          if (!b.name) return -1;
          return b.count - a.count;
        }),
      }));

    return NextResponse.json({
      total_clusters: clusters.length,
      total_books: clusters.reduce((s, c) => s + c.count, 0),
      total_subclusters: clusters.reduce(
        (s, c) => s + c.subclusters.filter((sc) => sc.name).length,
        0
      ),
      clusters,
    });
  } catch (error) {
    console.error('Taxonomy hierarchy error:', error);
    return NextResponse.json({ error: 'Failed to fetch taxonomy' }, { status: 500 });
  }
}
