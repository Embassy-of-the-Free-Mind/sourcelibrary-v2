import { Suspense } from 'react';
import CatalogPage from '../[tenant]/catalog/page';

export { metadata } from '../[tenant]/catalog/page';

export const revalidate = 86400;
export const maxDuration = 30;

export default function RootCatalogPage() {
  return (
    <Suspense>
      <CatalogPage />
    </Suspense>
  );
}
