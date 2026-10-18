import type { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import MayaLearn from './MayaLearn';

export const metadata: Metadata = {
  title: 'Learn to read Maya: numbers, day signs and Yucatec words - Source Library',
  description:
    'Count the bar-and-dot numbers of the Dresden Codex, name its day signs, and read Yucatec words from the Chilam Balam of Chumayel, each checked against Förstemann and the colonial dictionaries.',
  alternates: { canonical: '/learn/maya' },
};

export const revalidate = 86400;

export default function LearnMayaPage() {
  return (
    <>
      <SiteHeader variant="dark" />
      <main className="bg-cream min-h-screen">
        <MayaLearn />
      </main>
    </>
  );
}
