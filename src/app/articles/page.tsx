import { Metadata } from 'next';
import ArticlesPage from './ArticlesPage';

export const metadata: Metadata = {
  title: 'Articles - Source Library',
  description: 'Stories, reading tours, research notes and interactive pieces on the history and translation of rare philosophical, esoteric and scientific texts.',
  alternates: {
    canonical: '/articles',
  },
};

export default function ArticlesIndexPage() {
  return <ArticlesPage />;
}
