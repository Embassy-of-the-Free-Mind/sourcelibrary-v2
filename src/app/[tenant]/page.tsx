import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import SharedLibraryView, { type SharedLibraryViewProps } from '@/components/libraries/SharedLibraryView';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import {
  fetchTenantLibraryData,
  getTenantDominantProvider,
  fetchTenantBphDigitizedMap,
  fetchTenantBphCatalogTotal,
} from '@/lib/tenant-library-loaders';
import { getDb } from '@/lib/mongodb';

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
  const view = typeof sp.view === 'string' ? sp.view : '';

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

  // Check if this tenant is primarily BPH-based
  const isBph = dominantProvider === 'bph';

  // Fetch BPH-specific data if applicable
  const [digitizedUbns, catalogTotal] = isBph
    ? await Promise.all([
      fetchTenantBphDigitizedMap(tenantId),
      fetchTenantBphCatalogTotal(tenantId),
    ])
    : [{} as Record<string, { id: string; slug: string }>, 0];

  const basePath = `/${tenant}`;

  // Construct props for shared view
  const viewProps: SharedLibraryViewProps = {
    partner: {
      name: tenantDoc.name,
      description: tenantDoc.name, // Use tenant name; could extend with description field if added
      url: '', // Tenant doesn't have an external URL like library partners
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
    isBph,
    digitizedUbns,
    catalogTotal,
    tenantSlug,
  };

  return <SharedLibraryView {...viewProps} />;
}
