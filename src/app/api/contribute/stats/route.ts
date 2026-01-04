import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

interface Contribution {
  contributor_name: string;
  pages_processed: number;
  created_at: Date;
}

export async function GET() {
  try {
    const db = await getDb();

    // Get aggregated contributor stats
    const stats = await db.collection('contributions').aggregate([
      {
        $group: {
          _id: null,
          totalPagesProcessed: { $sum: '$pages_processed' },
          uniqueContributors: { $addToSet: '$contributor_name' },
        },
      },
    ]).toArray();

    // Get recent contributors
    const recentContributions = await db.collection('contributions')
      .find({})
      .sort({ created_at: -1 })
      .limit(10)
      .toArray() as unknown as Contribution[];

    const totalContributors = stats[0]?.uniqueContributors?.length || 0;
    const totalPagesProcessed = stats[0]?.totalPagesProcessed || 0;

    const recentContributors = recentContributions.map((c) => ({
      name: c.contributor_name || 'Anonymous',
      pages: c.pages_processed,
      date: c.created_at,
    }));

    return NextResponse.json({
      totalContributors,
      totalPagesProcessed,
      recentContributors,
    });
  } catch (error) {
    console.error('Error fetching contributor stats:', error);
    return NextResponse.json({
      totalContributors: 0,
      totalPagesProcessed: 0,
      recentContributors: [],
    });
  }
}
