import type { Metadata } from 'next';
import TranslationCheckReview from '@/components/review/TranslationCheckReview';

export const metadata: Metadata = {
  title: 'Translation check — Source Library',
  description:
    'Read the original? Tell us whether our English says what it says — and whether our transcription got the page right in the first place.',
};

export default function TranslationCheckPage() {
  return <TranslationCheckReview />;
}
