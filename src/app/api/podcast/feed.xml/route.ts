import { getPublishedEpisodes } from '@/lib/embassy/podcast';
import { buildPodcastFeed } from '@/lib/embassy/podcast-feed';

export const dynamic = 'force-dynamic';
export const revalidate = 3600; // 1 hour

/**
 * GET /api/podcast/feed.xml — English podcast RSS 2.0 feed.
 * Spanish episodes are served separately at /api/podcast/feed.es.xml so each
 * show is labeled with the correct <language> for Apple/Spotify.
 */
export async function GET() {
  const episodes = (await getPublishedEpisodes(50)).filter((ep) => ep.language !== 'es');
  const xml = buildPodcastFeed(episodes, 'en');

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
