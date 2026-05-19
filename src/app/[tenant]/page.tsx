import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import SharedLibraryView, { type SharedLibraryViewProps } from '@/components/libraries/SharedLibraryView';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import {
  fetchTenantLibraryData,
  getTenantDominantProvider,
  fetchTenantBphDigitizedMap,
  fetchTenantBphCatalogTotal,
  fetchTenantCatalogDigitizedMap,
  fetchTenantCatalogTotal,
} from '@/lib/tenant-library-loaders';
import { getDb } from '@/lib/mongodb';
import EmbedNavigationReporter from '@/components/embed/EmbedNavigationReporter';
import { getPartnerByProvider, getPartnerBySlug } from '@/lib/library-partners';

interface Props {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TenantRoot({ params, searchParams }: Props) {
  const { tenant } = await params;
  const { id: tenantId, slug: tenantSlug } = getTenantContextFromRequest(await headers());

  // Validate tenant exists and we have proper context
  if (!tenantId || !tenantSlug) {
    redirect('/');
  }

  // Resolve search parameters
  const sp = await searchParams;
  const sort = (typeof sp.sort === 'string' ? sp.sort : '') || 'popular';
  const language = typeof sp.language === 'string' ? sp.language : '';
  const q = typeof sp.q === 'string' ? sp.q : '';
  const offset = parseInt(typeof sp.offset === 'string' ? sp.offset : '0') || 0;
  const rawView = typeof sp.view === 'string' ? sp.view : '';
  const view = rawView === 'catalogue' ? 'catalog' : rawView;
  const displayParam = typeof sp.display === 'string' ? sp.display : '';
  const display: 'list' | 'grid' | undefined =
    displayParam === 'list' || displayParam === 'grid' ? displayParam : undefined;

  // Fetch tenant data
  const db = await getDb();
  const tenantDoc = await db.collection('tenants').findOne({ id: tenantId });

  if (!tenantDoc) {
    redirect('/');
  }

  // Fetch library data for this tenant
  const [libraryData, dominantProvider] = await Promise.all([
    fetchTenantLibraryData(tenantId, sort, language, offset, q || undefined),
    getTenantDominantProvider(tenantId),
  ]);

  const { books, total, topBooks, languages, galleryImages, contributingLibraries } = libraryData;

  // Reuse the same partner metadata source as /libraries/[slug] when possible.
  const canonicalPartner = getPartnerBySlug(tenant) || (dominantProvider ? getPartnerByProvider(dominantProvider) : undefined);
  const tenantExternalUrl =
    (typeof (tenantDoc as any).url === 'string' && (tenantDoc as any).url) ||
    (typeof (tenantDoc as any).website === 'string' && (tenantDoc as any).website) ||
    (typeof (tenantDoc as any).homepage === 'string' && (tenantDoc as any).homepage) ||
    '';

  // Check if this tenant is primarily BPH-based
  const isBph = canonicalPartner?.providerKey === 'bph' || dominantProvider === 'bph';
  // Other tenants with a BPH-parity unified Books|Catalogue structure (kloss
  // today; future tenants set the flag in library-partners.ts). Reads from
  // library_catalog_records via /api/catalog/[tenant].
  const hasUnifiedCatalogue = !isBph && !!canonicalPartner?.hasUnifiedCatalogue;

  // Fetch catalogue data — BPH uses its bespoke bph_works pipeline; other
  // unified-catalogue tenants read the generic library_catalog_records table.
  const [digitizedUbns, catalogTotal] = isBph
    ? await Promise.all([
      fetchTenantBphDigitizedMap(tenantId),
      fetchTenantBphCatalogTotal(tenantId),
    ])
    : hasUnifiedCatalogue
      ? await Promise.all([
        fetchTenantCatalogDigitizedMap(tenantId, canonicalPartner!.providerKey),
        fetchTenantCatalogTotal(tenant),
      ])
      : [{} as Record<string, { id: string; slug: string }>, 0];

  const basePath = `/${tenant}`;

  // Construct props for shared view
  const viewProps: SharedLibraryViewProps = {
    partner: {
      name: canonicalPartner?.name || tenantDoc.name,
      description: canonicalPartner?.description || tenantDoc.name,
      url: canonicalPartner?.url || tenantExternalUrl,
      providerKey: canonicalPartner?.providerKey,
      slug: tenant,
    },
    books,
    total,
    topBooks,
    languages,
    galleryImages,
    contributingLibraries,
    basePath,
    sort,
    language,
    q,
    offset,
    view,
    display,
    isBph,
    hasUnifiedCatalogue,
    digitizedUbns,
    catalogTotal,
    tenantSlug,
  };

  return (
    <>
      <EmbedNavigationReporter />
      <SharedLibraryView {...viewProps} />
    </>
  );
}
