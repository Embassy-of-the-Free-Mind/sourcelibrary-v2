import { Suspense } from 'react';
import FavoritesPage from '../[tenant]/favorites/page';

export default function RootFavoritesPage() {
  return (
    <Suspense>
      <FavoritesPage />
    </Suspense>
  );
}
