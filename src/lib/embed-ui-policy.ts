export interface EmbedUiPolicy {
  showTenantHeroExternalLink: boolean;
  enableBookCollectionNavigation: boolean;
  enableBookIndexNavigation: boolean;
  showBookReadCta: boolean;
  showBookRelatedBooks: boolean;
  showTranslationMethodologyLink: boolean;
  showExternalLinks: boolean;
  showGalleryImages: boolean;
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
  };
}
