import type { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import { requireInnerCircle } from '@/lib/auth-helpers';
import ExpertQueue from './ExpertQueue';

export const metadata: Metadata = {
  title: 'Maya expert queue - Source Library',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function LearnMayaExpertPage() {
  await requireInnerCircle('/auth/signin?callbackUrl=/learn/maya/expert');
  return (
    <>
      <SiteHeader variant="dark" />
      <main className="bg-cream min-h-screen">
        <ExpertQueue />
      </main>
    </>
  );
}
