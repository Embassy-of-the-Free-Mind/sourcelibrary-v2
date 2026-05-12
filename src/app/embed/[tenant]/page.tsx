import { notFound, redirect } from 'next/navigation';
import SharedLibraryView, { type SharedLibraryViewProps } from '@/components/libraries/SharedLibraryView';
import {
    fetchTenantLibraryData,
    getTenantDominantProvider,
    fetchTenantBphDigitizedMap,
    fetchTenantBphCatalogTotal,
    fetchTenantBphCataloguedBookIds,
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
    const rawView = typeof sp.view === 'string' ? sp.view : 'books';
    const view = rawView === 'catalogue' ? 'catalog' : rawView;
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

    // Cheap pre-check so the Supabase catalogue-id fetch can run in parallel
    // with the main library fetch. dominantProvider is the canonical isBph
    // signal (`canonicalPartner?.providerKey === 'bph'` below) but it
    // resolves only after the main loaders run; for parallelism we fall back
    // to the tenant slug here, which matches the current BPH tenant 1:1.
    const probablyBph = tenant === 'bph';

    // The BPH catalogue + books views render only <BphUnifiedCatalogue>,
    // which sources its own data via /api/catalog/bph. The hero, gallery,
    // Selected Books row, and contributing-libraries panel are all hidden,
    // so the heavy upstream loaders (Mongo + Supabase) are pure dead weight
    // on those URLs — and `view=catalog&display=list` was timing out in the
    // browser before render finished. Skip them and pass empty placeholders.
    const skipHeavyLoaders = probablyBph && (view === 'catalog' || view === 'books');

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
        getTenantDominantProvider(tenantId),
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
