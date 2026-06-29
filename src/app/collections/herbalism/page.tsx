import { Metadata } from 'next';
import CollectionTemplate from '@/components/collections/CollectionTemplate';
import { COLLECTION_TEMPLATES } from '@/lib/collection-templates';

// Herbalism & Botany — rendered by the shared, approved collection template.
// All content/config lives in src/lib/collection-templates.ts.
const CFG = COLLECTION_TEMPLATES.herbalism;

export const revalidate = 86400;
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: CFG.meta.title,
  description: CFG.meta.description,
  alternates: { canonical: `/collections/${CFG.slug}` },
  openGraph: {
    title: CFG.meta.title,
    description: CFG.meta.description,
    url: `/collections/${CFG.slug}`,
    siteName: 'Source Library',
    type: 'website',
    ...(CFG.meta.ogImage ? { images: [{ url: CFG.meta.ogImage, width: 1200, height: 800, alt: CFG.meta.title }] } : {}),
  },
  twitter: { card: 'summary_large_image', title: CFG.meta.title, description: CFG.meta.description, ...(CFG.meta.ogImage ? { images: [CFG.meta.ogImage] } : {}) },
};

export default function HerbalismCollectionPage() {
  return <CollectionTemplate config={CFG} />;
}
