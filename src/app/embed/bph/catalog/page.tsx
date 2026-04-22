import { Suspense } from 'react';
import { getReadDb } from '@/lib/mongodb';
import BphCatalogBrowser from '@/components/libraries/BphCatalogBrowser';

export const revalidate = 86400;
export const preferredRegion = 'fra1';

export const metadata = {
  title: 'Full Catalog — Bibliotheca Philosophica Hermetica',
  robots: { index: false, follow: false },
};

/** Build a UBN → { id, slug } map for BPH books on Source Library */
async function fetchBphDigitizedMap(): Promise<Record<string, { id: string; slug: string }>> {
  try {
    const db = await getReadDb();
    const bphBooks = await db.collection('books').find(
      { 'image_source.provider': 'bph', 'dublin_core.dc_identifier': { $exists: true } },
      { projection: { id: 1, slug: 1, 'dublin_core.dc_identifier': 1 }, maxTimeMS: 15_000 }
    ).toArray();

    const map: Record<string, { id: string; slug: string }> = {};
    for (const b of bphBooks) {
      const ubn = b.dublin_core?.dc_identifier;
      if (ubn) {
        map[ubn] = { id: b.id, slug: b.slug || b.id };
      }
    }
    return map;
  } catch {
    return {};
  }
}

export default async function EmbedCatalogPage() {
  const digitizedUbns = await fetchBphDigitizedMap();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-display text-primary mb-1">
          Full Catalog
        </h1>
        <p className="text-sm text-secondary">
          Browse all 27,000+ works in the Bibliotheca Philosophica Hermetica collection.
          Works available to read online are marked with a <span className="text-accent-rust">book icon</span>.
        </p>
      </div>
      <Suspense fallback={<div className="text-muted py-12 text-center">Loading catalog...</div>}>
        <BphCatalogBrowser basePath="/catalog" digitizedUbns={digitizedUbns} />
      </Suspense>
    </div>
  );
}
