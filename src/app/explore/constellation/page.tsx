import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import ExploreTabBar from '@/components/explore/ExploreTabBar';
import ConstellationLoader from '@/components/explore/ConstellationLoader';

export const revalidate = false;

export const metadata: Metadata = {
  title: 'Constellation — Explore — Source Library',
  description:
    'Interactive semantic map of 33,000+ books and artworks. Explore how texts cluster by meaning, discover edition families, and navigate the knowledge landscape.',
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'Constellation — Explore — Source Library',
    description:
      'A UMAP projection of the entire Source Library — 33,000 books plotted by semantic similarity.',
    url: 'https://sourcelibrary.org/explore/constellation',
    siteName: 'Source Library',
    type: 'website',
  },
};

export default function ConstellationPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Constellation"
          subtitle="33,000 books and artworks plotted by semantic similarity — clusters reveal edition families, thematic neighborhoods, and the shape of the collection"
        >
          <div className="mt-5">
            <ExploreTabBar />
          </div>
        </ContentHeader>
      }
      maxWidth="full"
      noPadding
    >
      <ConstellationLoader />
    </ContentPageLayout>
  );
}
