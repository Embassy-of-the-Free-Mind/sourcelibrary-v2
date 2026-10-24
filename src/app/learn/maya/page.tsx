import type { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import MayaCourse from './MayaCourse';

export const metadata: Metadata = {
  title: 'Learn to read Maya: a short course from the Dresden Codex and Landa - Source Library',
  description:
    'Six short lessons: count the bar-and-dot numbers of the Dresden Codex, read its days, and read the syllables a Maya scribe wrote for Diego de Landa in 1566. Every lesson ends on a real page.',
  alternates: { canonical: '/learn/maya' },
};

export const revalidate = 86400;

export default function LearnMayaPage() {
  return (
    <>
      <SiteHeader variant="dark" />
      <main className="bg-cream min-h-screen">
        <MayaCourse />
      </main>
    </>
  );
}
