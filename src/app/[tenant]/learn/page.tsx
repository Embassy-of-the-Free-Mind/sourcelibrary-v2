import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import LearnQuiz from './LearnQuiz';

export const metadata: Metadata = {
  title: 'Learn - Source Library',
  description: 'Test your knowledge of historical terminology from Renaissance, Hermetic, and alchemical texts.',
  alternates: { canonical: '/learn' },
};

export const revalidate = 86400;

export default function LearnPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Learn"
          subtitle="Vocabulary from the Western esoteric tradition"
        />
      }
      bg="bg-cream"
    >
      <LearnQuiz />
    </ContentPageLayout>
  );
}
