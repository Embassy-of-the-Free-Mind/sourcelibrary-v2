import { getPublishedEpisodes } from '@/lib/embassy/podcast';
import { buildPodcastFeed } from '@/lib/embassy/podcast-feed';

export const dynamic = 'force-dynamic';
export const revalidate = 3600; // 1 hour

/**
 * GET /api/podcast/feed.es.xml — Spanish-language podcast RSS 2.0 feed.
 * Only episodes tagged language === 'es', with <language>es</language> so it
 * registers as a Spanish show on Apple Podcasts / Spotify.
 */
export async function GET() {
  const episodes = (await getPublishedEpisodes(50)).filter((ep) => ep.language === 'es');
  const xml = buildPodcastFeed(episodes, 'es');

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
