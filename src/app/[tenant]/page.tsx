import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
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
import { getRequestBaseUrl } from '@/lib/shortlinks';

interface Props {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tenant } = await params;
  const h = await headers();
  const { id: tenantId } = getTenantContextFromRequest(h);

  // Default-tenant root (sourcelibrary.org) is handled by src/app/page.tsx, but
  // ISR-safety / route precedence means this generateMetadata may also fire for
  // it. Fall back to the root layout's metadata in that case.
  if (!tenantId || tenant === 'default') {
    return {};
  }

  let tenantName = tenant;
  let tenantDescription = '';
  try {
    const db = await getDb();
    const tenantDoc = await db.collection('tenants').findOne(
      { id: tenantId },
      { projection: { _id: 0, name: 1, description: 1 } }
    );
    if (tenantDoc) {
      if (typeof tenantDoc.name === 'string' && tenantDoc.name) tenantName = tenantDoc.name;
      if (typeof tenantDoc.description === 'string') tenantDescription = tenantDoc.description;
    }
  } catch {
    // Fall through with slug-based fallback if Mongo is unreachable.
  }

  const canonicalPartner = getPartnerBySlug(tenant);
  if (!tenantDescription && canonicalPartner?.description) {
    tenantDescription = canonicalPartner.description;
  }
  if (!tenantDescription) {
    tenantDescription = `Browse the ${tenantName} reading room on Source Library — digitized, OCR'd, and translated rare texts curated for this collection.`;
  }
  if (tenantDescription.length > 200) {
    tenantDescription = tenantDescription.slice(0, 197) + '...';
  }

  const title = `${tenantName} — Source Library`;

  // Canonical must be absolute and host-aware. metadataBase is fixed to
  // https://sourcelibrary.org, so a relative '/bph' would 308-canonical the
  // bph subdomain to the main site — a tenant-lockdown leak (CLAUDE.md
  // invariant #5: "Share/quote URLs use the request host"). On
  // bph.sourcelibrary.org the canonical resolves to https://bph.sourcelibrary.org/;
  // on path-based access (sourcelibrary.org/bph) or preview deploys
  // (sourcelibrary-v2-git-*.vercel.app/bph) it stays at /bph on that host.
  //
  // Detection is "does the leftmost label of the host equal the tenant slug?"
  // — anything else (main host, preview host, IP) is path-based.
  const host = getRequestBaseUrl(h);
  const hostname = host.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  const leftmostLabel = hostname.split('.')[0];
  const isTenantSubdomain = leftmostLabel === tenant;
  const canonical = isTenantSubdomain ? `${host}/` : `${host}/${tenant}`;

  return {
    title,
    description: tenantDescription,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description: tenantDescription,
      type: 'website',
      siteName: 'Source Library',
      locale: 'en_US',
      url: canonical,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: tenantDescription,
    },
  };
}

export default async function TenantRoot({ params, searchParams }: Props) {
  const { tenant } = await params;
  const { id: tenantId, slug: tenantSlug } = getTenantContextFromRequest(await headers());

  // After Phase Final, the proxy resolves tenant context from subdomain or
  // first-segment match against TENANT_ROOT_PATHS. Anything else lands here
  // with no headers — return a real 404 (Google reads it as "URL never
  // existed" and drops the entry, vs. the soft-404 a redirect to / triggers).
  if (!tenantId || !tenantSlug) {
    notFound();
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
    notFound();
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

  // Tenant doc copy wins over partner-derived copy (see /embed/[tenant]/page.tsx
  // for the rationale — Bhutan etc. would otherwise show "British Library").
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantDescription = typeof (tenantDoc as any).description === 'string' ? (tenantDoc as any).description : '';
  const viewProps: SharedLibraryViewProps = {
    partner: {
      name: tenantDoc.name || canonicalPartner?.name || tenant,
      description: tenantDescription || canonicalPartner?.description || tenantDoc.name,
      url: tenantExternalUrl || canonicalPartner?.url || '',
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
