import { notFound } from 'next/navigation';
import SharedLibraryView, { type SharedLibraryViewProps } from '@/components/libraries/SharedLibraryView';
import {
    fetchTenantLibraryData,
    getTenantDominantProvider,
    fetchTenantBphDigitizedMap,
    fetchTenantBphCatalogTotal,
    fetchTenantBphCataloguedBookIds,
    fetchTenantCatalogDigitizedMap,
    fetchTenantCatalogTotal,
} from '@/lib/tenant-library-loaders';
import { getDb } from '@/lib/mongodb';
import { resolveTenantId } from '@/lib/tenant-context';
import EmbedNavigationReporter from '@/components/embed/EmbedNavigationReporter';
import { getPartnerByProvider, getPartnerBySlug } from '@/lib/library-partners';

// Cold-start with several BPH-only Supabase/Mongo loaders can exceed the
// Vercel default function budget (10s) under Atlas load, surfacing as
// "Something went wrong" inside EFM's iframe at /digital-collection-search.
// Loader-level caching/timeouts in tenant-library-loaders.ts should keep us
// well under this; the bump is a safety net for cold lambdas.
export const maxDuration = 30;

interface Props {
    params: Promise<{ tenant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getOptionalStringField(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export default async function EmbedTenantRoot({ params, searchParams }: Props) {
    const { tenant } = await params;
    const tenantId = await resolveTenantId(tenant);
    if (!tenantId) notFound();

    const sp = await searchParams;
    // BPH partner prefers Oldest first so a fresh visit lands on the
    // earliest-printed works — relevance/popularity isn't meaningful for an
    // early-modern catalogue. Other tenants keep the legacy 'popular' default.
    const sortDefault = tenant === 'bph' ? 'year_asc' : 'popular';
    const sort = (typeof sp.sort === 'string' ? sp.sort : '') || sortDefault;
    const language = typeof sp.language === 'string' ? sp.language : '';
    const q = typeof sp.q === 'string' ? sp.q : '';
    const offset = parseInt(typeof sp.offset === 'string' ? sp.offset : '0', 10) || 0;
    // Default landing view for unified-catalogue tenants (BPH, Kloss, …):
    // show the full library catalogue rather than just the digitised subset.
    // Per Paul Dijstelberge's BPH feedback — a visitor to a library's home
    // page expects to see the whole collection, with digitised as a filter
    // they can opt into. Non-unified tenants keep the legacy 'books' default.
    //
    // Exception: when the URL already carries a books-grid search (`?q=…`),
    // honour that by defaulting to 'books' so the strip-redirect below
    // doesn't silently drop the query.
    const tenantIsUnified = tenant === 'bph' || !!getPartnerBySlug(tenant)?.hasUnifiedCatalogue;
    const hasBooksGridQuery = typeof sp.q === 'string' && sp.q !== '';
    const defaultView = tenantIsUnified && !hasBooksGridQuery ? 'catalog' : 'books';
    const rawView = typeof sp.view === 'string' ? sp.view : defaultView;
    const view = rawView === 'catalogue' ? 'catalog' : rawView;
    // Display dimension is independent of the view filter. When unset, default
    // matches what the partner mockup leads with: catalog→list, books→grid.
    // Once the user picks an icon, their choice persists across filter switches.
    const displayParam = typeof sp.display === 'string' ? sp.display : '';
    const display: 'list' | 'grid' = displayParam === 'list' || displayParam === 'grid'
        ? displayParam
        : (view === 'catalog' ? 'list' : 'grid');

    // Don't strip inactive-view params here. The embed mirrors the iframe URL
    // to the parent host (embed/v1.js → sl-navigate → replaceState), so any
    // server-side redirect that drops params kills external deep links —
    // ?view=books&display=grid&cq=jacob&cdig=sl on a partner site briefly
    // loads and then gets scrubbed to ?view=books&display=grid. The active
    // view ignores inactive params functionally; the toggle hrefs in
    // UnifiedCatalogue emit clean per-view URLs, so stale params don't
    // accumulate from in-app navigation either.

    const db = await getDb();
    const tenantDoc = await db.collection('tenants').findOne({ id: tenantId });
    if (!tenantDoc) notFound();

    // Cheap pre-check so the Supabase catalogue-id fetch can run in parallel
    // with the main library fetch. dominantProvider is the canonical isBph
    // signal (`canonicalPartner?.providerKey === 'bph'` below) but it
    // resolves only after the main loaders run; for parallelism we fall back
    // to the tenant slug here, which matches the current BPH tenant 1:1.
    const probablyBph = tenant === 'bph';
    // Tenants opted into the generic unified-catalogue path (Phase 2/3 of
    // Kloss BPH-parity work). Mirrors the BPH fast path: pre-resolve via slug
    // so loaders can run in parallel.
    const knownPartnerEarly = getPartnerBySlug(tenant);
    const probablyHasUnified = !probablyBph && !!knownPartnerEarly?.hasUnifiedCatalogue;

    // The unified-catalogue views render only <UnifiedCatalogue> /
    // <BphUnifiedCatalogue>, which source their own data. The hero, gallery,
    // Selected Books row, and contributing-libraries panel are all hidden,
    // so the heavy upstream loaders (Mongo + Supabase) are pure dead weight
    // on those URLs — and `view=catalog&display=list` was timing out in the
    // browser before render finished. Skip them and pass empty placeholders.
    const skipHeavyLoaders = (probablyBph || probablyHasUnified) && (view === 'catalog' || view === 'books');

    // dominantProvider is only consulted as a fallback when the tenant slug
    // doesn't map to a known partner — for known slugs (bph, ficino, bhutan,
    // …) `getPartnerBySlug` already wins. For BPH specifically this
    // aggregation is a `$group` over ~17K books and was the 4–8s warm SSR
    // bottleneck on cold lambdas (cache is per-instance and misses often).
    // Skip the query when we already know the partner from the slug.
    const knownPartner = getPartnerBySlug(tenant);

    const [libraryData, dominantProvider, cataloguedBookIds] = await Promise.all([
        skipHeavyLoaders
            ? Promise.resolve({
                books: [],
                total: 0,
                topBooks: [],
                languages: [],
                galleryImages: [],
                contributingLibraries: [],
            } as Awaited<ReturnType<typeof fetchTenantLibraryData>>)
            : fetchTenantLibraryData(tenantId, sort, language, offset, q || undefined),
        knownPartner ? Promise.resolve(null) : getTenantDominantProvider(tenantId),
        probablyBph && !skipHeavyLoaders ? fetchTenantBphCataloguedBookIds() : Promise.resolve(null),
    ]);

    // Filter the Selected Books row to books that exist in the Supabase
    // catalogue (bph_works.sl_book_id). Consistent with the catalogue list
    // view, which is the source of truth. No-op today (all top-popular books
    // are already linked) but prevents future divergence (#1715 follow-up).
    const topBooks = cataloguedBookIds
        ? libraryData.topBooks.filter(b => cataloguedBookIds.has(b.id))
        : libraryData.topBooks;
    const { books, total, languages, galleryImages, contributingLibraries } = libraryData;

    const canonicalPartner = knownPartner || (dominantProvider ? getPartnerByProvider(dominantProvider) : undefined);
    const tenantRecord = tenantDoc as Record<string, unknown>;
    const tenantExternalUrl =
        getOptionalStringField(tenantRecord.url) ||
        getOptionalStringField(tenantRecord.website) ||
        getOptionalStringField(tenantRecord.homepage) ||
        '';

    const isBph = canonicalPartner?.providerKey === 'bph' || dominantProvider === 'bph';
    const hasUnifiedCatalogue = !isBph && !!canonicalPartner?.hasUnifiedCatalogue;
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

    const basePath = `/embed/${tenant}`;

    // Tenant doc copy wins over partner-derived copy. Otherwise a tenant like
    // Bhutan (whose contributing_library is "British Library" for every book)
    // gets the BL partner's name/description rendered as the hero — the page
    // ends up titled "British Library" with UK-specific copy instead of its
    // own identity.
    const tenantDescription = getOptionalStringField(tenantRecord.description);
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
        tenantSlug: tenant,
        forceEmbedded: true,
    };

    return (
        <>
            <EmbedNavigationReporter />
            <SharedLibraryView {...viewProps} />
        </>
    );
}
