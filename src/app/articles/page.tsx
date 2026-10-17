import ArticlesPage from './ArticlesPage';
import { listingMetadata } from './listing';

export const metadata = listingMetadata('all');

export default function ArticlesIndexPage() {
  return <ArticlesPage />;
}
