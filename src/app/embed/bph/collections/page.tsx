import CollectionsPage from '@/app/collections/page';

export const revalidate = 86400;

export const metadata = {
  title: 'Collection Areas — Bibliotheca Philosophica Hermetica',
  robots: { index: false, follow: false },
};

/**
 * BPH embed collections — renders the same collections page.
 * Chrome hidden by embed layout CSS.
 * TODO: filter to BPH-only collections once CollectionsPage accepts a provider prop.
 */
export default function EmbedCollectionsPage() {
  return <CollectionsPage />;
}
