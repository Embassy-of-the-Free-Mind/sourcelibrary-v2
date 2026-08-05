import type { Metadata } from 'next';
import SpanishCopyReview from '@/components/review/SpanishCopyReview';

export const metadata: Metadata = {
  title: 'Spanish copy — Source Library',
  description: 'Help us check the Spanish translation of the site itself.',
};

export default function SpanishCopyPage() {
  return <SpanishCopyReview />;
}
