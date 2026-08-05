import type { Metadata } from 'next';
import { getReaderV2Data } from '../reader-v2-data';
import Reader2A from '@/components/reader-v2/Reader2A';

// Design preview route for reader redesign variant 2a "Quiet Desk".
// Additive and noindex — the production reader at /book/[id]/page/[pageId]
// is untouched. See design_handoff_reader_page README (2026-08).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string; pageId: string }>;
}

export default async function ReaderV2APage({ params }: PageProps) {
  const { id, pageId } = await params;
  const data = await getReaderV2Data(id, pageId);
  return (
    <Reader2A
      initialBook={data.book}
      initialPage={data.page}
      initialPageList={data.pageList}
    />
  );
}
