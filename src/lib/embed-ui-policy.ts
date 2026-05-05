export interface EmbedUiPolicy {
  showTenantHeroExternalLink: boolean;
  enableBookCollectionNavigation: boolean;
  enableBookIndexNavigation: boolean;
  showBookReadCta: boolean;
  showBookRelatedBooks: boolean;
  showTranslationMethodologyLink: boolean;
  showExternalLinks: boolean;
  showGalleryImages: boolean;
  // BPH lockdown: these widgets render data from across the global library
  // (RelatedEditions queries every book with the same work_id; AuthorCrossReference
  // renders pre-computed artwork/book lists that are not tenant-filtered). Hiding
  // them in embed mode is the simplest way to guarantee no non-tenant content leaks.
  showRelatedEditions: boolean;
  showAuthorCrossReference: boolean;
}

export function getEmbedUiPolicy(isEmbedded: boolean): EmbedUiPolicy {
  if (!isEmbedded) {
    return {
      showTenantHeroExternalLink: true,
      enableBookCollectionNavigation: true,
      enableBookIndexNavigation: true,
      showBookReadCta: true,
      showBookRelatedBooks: true,
      showTranslationMethodologyLink: true,
      showExternalLinks: true,
      showGalleryImages: true,
      showRelatedEditions: true,
      showAuthorCrossReference: true,
    };
  }

  return {
    showTenantHeroExternalLink: false,
    enableBookCollectionNavigation: false,
    enableBookIndexNavigation: false,
    showBookReadCta: false,
    showBookRelatedBooks: false,
    showTranslationMethodologyLink: false,
    showExternalLinks: false,
    showGalleryImages: false,
    showRelatedEditions: false,
    showAuthorCrossReference: false,
  };
}
