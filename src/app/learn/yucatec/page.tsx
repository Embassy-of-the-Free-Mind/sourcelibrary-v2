import type { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import YucatecCourse from './YucatecCourse';

export const metadata: Metadata = {
  title: 'Learn Yucatec Maya: short daily lessons from real sentences - Source Library',
  description:
    'Five-minute lessons in Yucatec Maya built from sentences in the primers of Ruz (1845) and Berendt (1871) and Beltrán\'s catechism, each linked to its page, each meaning quoted from Pío Pérez and the colonial dictionaries.',
  alternates: { canonical: '/learn/yucatec' },
};

export const revalidate = 86400;

export default function LearnYucatecPage() {
  return (
    <>
      <SiteHeader variant="dark" />
      <main className="bg-cream min-h-screen">
        <YucatecCourse />
      </main>
    </>
  );
}
