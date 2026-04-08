import { Suspense } from 'react';
import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import ResearchClient from '@/components/research/ResearchClient';
import type { CuratorSessionListItem } from '@/lib/api-client/types/research';

export const revalidate = false;

export const metadata: Metadata = {
  title: 'Research Sessions - Source Library',
  description:
    'Browse AI-assisted curator research sessions — conversations discovering, evaluating, and importing historical texts across alchemy, Hermetica, Kabbalah, and 30+ traditions.',
  alternates: { canonical: '/research' },
  openGraph: {
    title: 'Research Sessions - Source Library',
    description:
      'Browse AI-assisted curator research sessions — conversations discovering, evaluating, and importing historical texts.',
  },
};

export default async function ResearchPage() {
  const initialData = await fetchInitialData();

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Research Sessions"
          subtitle="Browse AI-assisted curator conversations — discovering, evaluating, and importing historical texts across 30+ traditions."
        />
      }
    >
      <Suspense>
        <ResearchClient initialData={initialData} />
      </Suspense>
    </ContentPageLayout>
  );
}

async function fetchInitialData() {
  try {
    const db = await getDb();
    const collection = db.collection('curator_sessions');

    const [sessions, total, themesAgg, typesAgg] = await Promise.all([
      collection
        .find({}, { projection: { messages: 0 } })
        .sort({ date: -1 })
        .limit(20)
        .toArray(),
      collection.countDocuments(),
      collection.aggregate([
        { $unwind: '$themes' },
        { $group: { _id: '$themes', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      collection.aggregate([
        { $group: { _id: '$session_type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
    ]);

    const cleaned = sessions.map(({ _id, ...rest }) => rest) as unknown as CuratorSessionListItem[];

    return {
      sessions: cleaned,
      total,
      themes: themesAgg.map(t => t._id as string),
      types: typesAgg.map(t => t._id as string),
    };
  } catch (error) {
    console.error('Failed to fetch research sessions:', error);
    return { sessions: [], total: 0, themes: [], types: [] };
  }
}
