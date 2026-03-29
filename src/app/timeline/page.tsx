import { Suspense } from 'react';
import { getDb } from '@/lib/mongodb';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import TimelineClient from './TimelineClient';
import type { Metadata } from 'next';
import type { TimelineOverview, DecadeBucket } from '@/lib/api-client/types/timeline';

export const revalidate = 3600; // ISR: rebuild every hour

export const metadata: Metadata = {
  title: 'Timeline | Source Library',
  description: 'Browse thousands of historical texts chronologically, from antiquity through the early modern period. See what was published when and explore by decade.',
  alternates: { canonical: '/timeline' },
};

async function fetchTimelineData(): Promise<TimelineOverview> {
  try {
    const db = await getDb();

    const baseMatch = {
      year: { $exists: true, $ne: null },
      hidden: { $ne: true },
    };

    // Single aggregation: group by decade+language, then reshape
    const pipeline = [
      { $match: baseMatch },
      { $project: { year: 1, language: { $ifNull: ['$language', 'Unknown'] } } },
      {
        $group: {
          _id: {
            decade: { $multiply: [{ $floor: { $divide: ['$year', 10] } }, 10] },
            language: '$language',
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.decade': 1 as const, count: -1 as const } },
      {
        $group: {
          _id: '$_id.decade',
          count: { $sum: '$count' },
          languages: { $push: { lang: '$_id.language', count: '$count' } },
        },
      },
      { $sort: { _id: 1 as const } },
    ];

    const [rawDecades, languages] = await Promise.all([
      db.collection('books').aggregate(pipeline, { maxTimeMS: 10000 }).toArray(),
      db.collection('books').distinct('language', baseMatch),
    ]);

    const decades: DecadeBucket[] = rawDecades.map(d => ({
      decade: d._id,
      count: d.count,
      languages: d.languages,
    }));

    const total = decades.reduce((sum, d) => sum + d.count, 0);
    const allYears = decades.map(d => d.decade);
    const yearRange = {
      min: allYears.length ? allYears[0] : 0,
      max: allYears.length ? allYears[allYears.length - 1] + 9 : 0,
    };

    const globalLangCounts: Record<string, number> = {};
    for (const d of decades) {
      for (const l of d.languages) {
        globalLangCounts[l.lang] = (globalLangCounts[l.lang] || 0) + l.count;
      }
    }
    const topLanguages = Object.entries(globalLangCounts)
      .map(([lang, count]) => ({ lang, count }))
      .sort((a, b) => b.count - a.count);

    return {
      decades,
      summary: { total, yearRange, topLanguages },
      filters: {
        languages: (languages.filter(Boolean) as string[]).sort(),
        collections: [],
      },
    };
  } catch (err) {
    console.error('Timeline data fetch failed:', err);
    return {
      decades: [],
      summary: { total: 0, yearRange: { min: 0, max: 0 }, topLanguages: [] },
      filters: { languages: [], collections: [] },
    };
  }
}

export default async function TimelinePage() {
  const data = await fetchTimelineData();

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Timeline"
          subtitle={`${data.summary.total.toLocaleString()} texts from antiquity to the Enlightenment — browse the tradition by era`}
        />
      }
      maxWidth="wide"
    >
      <Suspense>
        <TimelineClient initialData={data} />
      </Suspense>
    </ContentPageLayout>
  );
}
