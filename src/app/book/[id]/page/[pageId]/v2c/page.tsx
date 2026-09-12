import type { Metadata } from 'next';
import { getReaderV2Data } from '../reader-v2-data';
import Reader2C from '@/components/reader-v2/Reader2C';

// Design preview route for reader redesign variant 2c "Study Desk".
// Additive and noindex — the production reader at /book/[id]/page/[pageId]
// is untouched. See design_handoff_reader_page README (2026-08).
// No force-dynamic: /book/:path* is CDN-cached 24h, which would silently
// override it (see tests/unit/dynamic-routes-not-edge-cached.test.ts).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string; pageId: string }>;
}

export default async function ReaderV2CPage({ params }: PageProps) {
  const { id, pageId } = await params;
  const data = await getReaderV2Data(id, pageId);
  return (
    <Reader2C
      initialBook={data.book}
      initialPage={data.page}
      initialPageList={data.pageList}
    />
  );
}
