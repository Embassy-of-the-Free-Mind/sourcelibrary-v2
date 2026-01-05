import { headers } from 'next/headers';
import { SiteMode, SiteModeConfig, SOCIETY_CONFIG, LIBRARY_CONFIG } from './site-mode';

/**
 * Get site mode in server components
 * Reads the x-site-mode header set by middleware
 */
export async function getSiteMode(): Promise<SiteModeConfig> {
  const headersList = await headers();
  const mode = headersList.get('x-site-mode') as SiteMode | null;
  return mode === 'society' ? SOCIETY_CONFIG : LIBRARY_CONFIG;
}
