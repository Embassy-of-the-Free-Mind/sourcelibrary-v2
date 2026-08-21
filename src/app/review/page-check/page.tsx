import type { Metadata } from 'next';
import PageCheckReview from '@/components/review/PageCheckReview';

export const metadata: Metadata = {
  title: 'Page check — Source Library',
  description: 'Look at a page of the library and tell us if anything is wrong.',
};

export default function PageCheckPage() {
  return <PageCheckReview />;
}
