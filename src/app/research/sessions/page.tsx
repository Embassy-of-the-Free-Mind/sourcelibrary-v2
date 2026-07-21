import { Suspense } from 'react';
import { Metadata } from 'next';
import { getReadDb } from '@/lib/mongodb';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import ResearchClient from '@/components/research/ResearchClient';
import type { CuratorSessionListItem } from '@/lib/api-client/types/research';

// ISR: rebuild every hour. Must be a finite number — `false` would cache an
// empty-fallback render forever if the sessions query ever fails.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Research Sessions - Source Library',
  description:
    'Browse AI-assisted curator research sessions — conversations discovering, evaluating, and importing historical texts across alchemy, Hermetica, Kabbalah, and 30+ traditions.',
  alternates: { canonical: '/research/sessions' },
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
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

// No try/catch: a thrown error during ISR revalidation keeps serving the
// last good page, while catching it here would render (and cache) an empty
// session list for the full revalidate window. Cold failures land on
// src/app/error.tsx.
async function fetchInitialData() {
  const db = await getReadDb();
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
}
