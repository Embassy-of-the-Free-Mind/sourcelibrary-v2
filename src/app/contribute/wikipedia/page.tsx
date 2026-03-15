import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { WikipediaPlaybook } from './WikipediaPlaybook';

export const metadata: Metadata = {
  title: 'Wikipedia Contributions - Source Library',
  description: 'Help add Source Library translations to Wikipedia, Wikidata, and Wikimedia Commons. Step-by-step guide for volunteers.',
  alternates: {
    canonical: '/contribute/wikipedia',
  },
};

export default function WikipediaContributePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Wikipedia Contributions"
          subtitle="Help readers discover 1,100+ translated historical texts"
        />
      }
      bg="bg-cream"
    >
      <WikipediaPlaybook />
    </ContentPageLayout>
  );
}
