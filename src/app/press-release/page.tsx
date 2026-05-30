import { redirect } from 'next/navigation';
import { latestPublishedRelease } from '@/lib/press-releases';

/**
 * Legacy single-release URL. The press room now lives at /press-releases with
 * one page per release. Redirect /press-release to the newest published release
 * (or the index if none) so externally-shared links keep working.
 */
export default function LegacyPressReleaseRedirect() {
  const latest = latestPublishedRelease();
  redirect(latest ? `/press-releases/${latest.slug}` : '/press-releases');
}
