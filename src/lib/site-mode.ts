export type SiteMode = 'library' | 'society';

export interface SiteModeConfig {
  mode: SiteMode;
  isSociety: boolean;
  isLibrary: boolean;
  siteName: string;
  siteDescription: string;
}

export const SOCIETY_CONFIG: SiteModeConfig = {
  mode: 'society',
  isSociety: true,
  isLibrary: false,
  siteName: 'The Ficino Society',
  siteDescription: 'A cooperative of scholars and seekers exploring the Western esoteric tradition',
};

export const LIBRARY_CONFIG: SiteModeConfig = {
  mode: 'library',
  isSociety: false,
  isLibrary: true,
  siteName: 'Source Library',
  siteDescription: 'Digitizing and translating rare Hermetic and esoteric texts',
};

/**
 * Check site mode on the client by looking at the hostname
 * Use this in client components or for initial hydration
 */
export function getClientSiteMode(): SiteModeConfig {
  if (typeof window === 'undefined') {
    return LIBRARY_CONFIG; // SSR fallback
  }

  const host = window.location.hostname;
  const searchParams = new URLSearchParams(window.location.search);

  const isSociety =
    host.includes('ficinosociety') ||
    host.startsWith('ficino.') || // ficino.sourcelibrary.org or ficino.local
    searchParams.get('society') === 'true';

  return isSociety ? SOCIETY_CONFIG : LIBRARY_CONFIG;
}
