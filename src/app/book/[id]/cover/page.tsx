import type { Metadata } from 'next';
import CoverMaker from '@/components/cover-maker/CoverMaker';

export const metadata: Metadata = {
  title: 'Cover maker',
  robots: { index: false, follow: false },
};

export default async function CoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CoverMaker bookId={id} />;
}
