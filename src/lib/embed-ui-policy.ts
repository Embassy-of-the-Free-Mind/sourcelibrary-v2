import type { TenantContext } from './tenant-context';

/**
 * Single source of truth for UI variations between the global Source Library
 * and tenant-embedded views (partner subdomains, `/embed/*` routes).
 *
 * The platform used to scatter `if (isEmbedded)` checks across components.
 * Each new BPH-lockdown invariant (no external links, no cross-tenant gallery
 * leaks, no related-edition lookups across the global library) required
 * patching multiple files. This policy file collapses those decisions into
 * one boolean table indexed by `TenantContext` — every component reads its
 * flag from here, never from raw context fields.
 *
 * Why some flags hide ostensibly-useful UI (related editions, author cross-
 * references): those widgets render data that the proxy does not
 * tenant-filter. They are pre-computed across the whole library and would
 * leak non-tenant content into an embed if rendered. Hiding them is the
 * simplest way to honor the Tenant Subdomain Lockdown invariant — see
 * CLAUDE.md "Tenant Subdomain Lockdown".
 */
export interface EmbedUiPolicy {
  showTenantHeroExternalLink: boolean;
  enableBookCollectionNavigation: boolean;
  enableBookIndexNavigation: boolean;
  showBookReadCta: boolean;
  showBookRelatedBooks: boolean;
  // The Overview link points at the tenant-agnostic `/book/<slug>/overview`
  // route — there is no `/embed/<tenant>/book/<slug>/overview` counterpart.
  // Following it from inside a partner iframe navigates the frame to the
  // global site (no tenant resolves there, so X-Frame-Options: DENY kicks
  // in and the iframe goes blank). Hide it in embed mode rather than ship a
  // link that breaks the iframe. See CLAUDE.md "Tenant Subdomain Lockdown".
  showBookOverviewLink: boolean;
  showTranslationMethodologyLink: boolean;
  showExternalLinks: boolean;
  showGalleryImages: boolean;
  // BPH lockdown: these widgets render data from across the global library
  // (RelatedEditions queries every book with the same work_id; AuthorCrossReference
  // renders pre-computed artwork/book lists that are not tenant-filtered). Hiding
  // them in embed mode is the simplest way to guarantee no non-tenant content leaks.
  showRelatedEditions: boolean;
  showAuthorCrossReference: boolean;
  // "Banned by the Index" chip links to the GLOBAL index-librorum-prohibitorum
  // collection and reads cross-library catalog data — hide in embed/tenant views.
  showIndexCatalogStatus: boolean;
  // Gallery rendering pulls images keyed off `held_by` / provider, not the
  // active tenant. Disabling cross-tenant images keeps embed gallery views
  // strictly within the tenant's holdings.
  showGalleryCrossTenantImages: boolean;
}

export function getEmbedUiPolicy(ctx: TenantContext | null): EmbedUiPolicy {
  const isEmbedded = ctx?.isEmbedded ?? false;

  if (!isEmbedded) {
    return {
      showTenantHeroExternalLink: true,
      enableBookCollectionNavigation: true,
      enableBookIndexNavigation: true,
      showBookReadCta: true,
      showBookRelatedBooks: true,
      showBookOverviewLink: true,
      showTranslationMethodologyLink: true,
      showExternalLinks: true,
      showGalleryImages: true,
      showRelatedEditions: true,
      showAuthorCrossReference: true,
      showIndexCatalogStatus: true,
      showGalleryCrossTenantImages: true,
    };
  }

  return {
    showTenantHeroExternalLink: false,
    enableBookCollectionNavigation: false,
    enableBookIndexNavigation: false,
    showBookReadCta: false,
    showBookRelatedBooks: false,
    showBookOverviewLink: false,
    showTranslationMethodologyLink: false,
    showExternalLinks: false,
    showGalleryImages: false,
    showRelatedEditions: false,
    showAuthorCrossReference: false,
    showIndexCatalogStatus: false,
    showGalleryCrossTenantImages: false,
  };
}

/**
 * Construct a minimal TenantContext for callers that only know whether they
 * are embedded but don't yet have a full context. Migration aid — once a
 * callsite has access to `getTenantContext()`, pass that directly.
 */
export function embeddedContext(isEmbedded: boolean): TenantContext {
  return { id: null, slug: null, isEmbedded, source: null };
}
