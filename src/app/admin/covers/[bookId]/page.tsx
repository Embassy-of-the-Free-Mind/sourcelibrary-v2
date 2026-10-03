import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth-helpers';
import CoverMaker from '@/components/cover-maker/CoverMaker';

export const metadata: Metadata = { title: 'Cover maker', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function CoverMakerPage({ params, searchParams }: {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<{ design?: string }>;
}) {
  await requireAdmin();
  const { bookId } = await params;
  const { design } = await searchParams;
  return <CoverMaker bookId={bookId} openDesign={design} />;
}
