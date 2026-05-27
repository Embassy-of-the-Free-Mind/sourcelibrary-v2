import type { Metadata } from 'next';
import HallucinationReview from '@/components/review/HallucinationReview';

export const metadata: Metadata = {
  title: 'OCR hallucination check — Source Library',
  description: 'Spot AI hallucinations in our image descriptions.',
};

export default function HallucinationReviewPage() {
  return <HallucinationReview />;
}
