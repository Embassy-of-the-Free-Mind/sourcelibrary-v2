import { notFound, redirect } from 'next/navigation';
import SharedLibraryView, { type SharedLibraryViewProps } from '@/components/libraries/SharedLibraryView';
import {
    fetchTenantLibraryData,
    getTenantDominantProvider,
    fetchTenantBphDigitizedMap,
    fetchTenantBphCatalogTotal,
} from '@/lib/tenant-library-loaders';
import { getDb } from '@/lib/mongodb';
import { resolveTenantId } from '@/lib/tenant-context';
import EmbedNavigationReporter from '@/components/embed/EmbedNavigationReporter';
import { getPartnerByProvider, getPartnerBySlug } from '@/lib/library-partners';

interface Props {
    params: Promise<{ tenant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getOptionalStringField(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

// Catalog browser owns these (`c`-prefixed) param keys. They're meaningless on
// any other view and only serve to confuse users when they leak through
// navigation, so strip them server-side before render.
const CATALOG_PARAM_KEYS = [
    'cq', 'csort', 'ckeyword', 'coffset',
    'cauthor', 'ctitle', 'ceditor', 'cplace', 'cprinter', 'cpublisher',
    'cshelf', 'clang', 'cyfrom', 'cyto', 'cdig',
];

// Books-grid owns these. Catalog view ignores them; strip on /catalog so the
// URL bar doesn't look filtered when it isn't.
const BOOKS_PARAM_KEYS = ['q', 'sort', 'language', 'offset'];

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
    const view = typeof sp.view === 'string' ? sp.view : 'books';
    // Display dimension is independent of the view filter. When unset, default
    // matches what the partner mockup leads with: catalog→list, books→grid.
    // Once the user picks an icon, their choice persists across filter switches.
    const displayParam = typeof sp.display === 'string' ? sp.display : '';
    const display: 'list' | 'grid' = displayParam === 'list' || displayParam === 'grid'
        ? displayParam
        : (view === 'catalog' ? 'list' : 'grid');

    // Strip the inactive display's params so a user landing here from a
    // previous list/grid choice doesn't see a URL that looks filtered when
    // nothing is being applied. The list view (BphCatalogBrowser) owns the
    // c-prefixed keys; the grid view (CollectionFilters/books grid) owns
    // q/sort/language/offset. Stripping is keyed off the active display, not
    // the view filter, since either filter can be paired with either display.
    const stripKeys = display === 'list' ? BOOKS_PARAM_KEYS : CATALOG_PARAM_KEYS;
    const orphans = stripKeys.filter(k => typeof sp[k] === 'string' && sp[k] !== '');
    if (orphans.length > 0) {
        const next = new URLSearchParams();
        for (const [k, v] of Object.entries(sp)) {
            if (orphans.includes(k)) continue;
            if (typeof v === 'string' && v !== '') next.set(k, v);
        }
        const qs = next.toString();
        redirect(`/embed/${tenant}${qs ? `?${qs}` : ''}`);
    }

    const db = await getDb();
    const tenantDoc = await db.collection('tenants').findOne({ id: tenantId });
    if (!tenantDoc) notFound();

    const [libraryData, dominantProvider] = await Promise.all([
        fetchTenantLibraryData(tenantId, sort, language, offset, q || undefined),
        getTenantDominantProvider(tenantId),
    ]);

    const { books, total, topBooks, languages, galleryImages, contributingLibraries } = libraryData;

    const canonicalPartner = getPartnerBySlug(tenant) || (dominantProvider ? getPartnerByProvider(dominantProvider) : undefined);
    const tenantRecord = tenantDoc as Record<string, unknown>;
    const tenantExternalUrl =
        getOptionalStringField(tenantRecord.url) ||
        getOptionalStringField(tenantRecord.website) ||
        getOptionalStringField(tenantRecord.homepage) ||
        '';

    const isBph = canonicalPartner?.providerKey === 'bph' || dominantProvider === 'bph';
    const [digitizedUbns, catalogTotal] = isBph
        ? await Promise.all([
            fetchTenantBphDigitizedMap(tenantId),
            fetchTenantBphCatalogTotal(tenantId),
        ])
        : [{} as Record<string, { id: string; slug: string }>, 0];

    const basePath = `/embed/${tenant}`;

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
