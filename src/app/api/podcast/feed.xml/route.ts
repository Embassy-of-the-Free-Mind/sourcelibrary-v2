import { getPublishedEpisodes, PODCAST_FORMATS } from '@/lib/embassy/podcast';

export const dynamic = 'force-dynamic';
export const revalidate = 3600; // 1 hour

/**
 * GET /api/podcast/feed.xml — Podcast RSS 2.0 feed for published episodes.
 * Compatible with Apple Podcasts, Spotify, Overcast, etc.
 */
export async function GET() {
  const episodes = await getPublishedEpisodes(50);

  const lastBuildDate = episodes.length > 0
    ? new Date(episodes[0].podcast.generatedAt).toUTCString()
    : new Date().toUTCString();

  const items = episodes.map(ep => {
    const pubDate = new Date(ep.podcast.generatedAt).toUTCString();
    const formatLabel = PODCAST_FORMATS[ep.podcast.format]?.label || 'Deep Dive';
    const title = escapeXml(`${formatLabel}: ${ep.podcast.topic}`);
    const description = escapeXml(
      `${formatLabel} episode exploring "${ep.podcast.topic}" — generated from ${ep.podcast.findingCount} research findings in the Source Library Reading Room. By ${ep.creatorName}.`,
    );
    const threadUrl = `https://sourcelibrary.org/reading-room/thread/${ep.threadId}`;
    const guid = `sourcelibrary-podcast-${ep.threadId}-${ep.podcast.format}`;

    return `    <item>
      <title>${title}</title>
      <description>${description}</description>
      <enclosure url="${escapeXml(ep.podcast.audioUrl)}" type="audio/wav" />
      <guid isPermaLink="false">${guid}</guid>
      <pubDate>${pubDate}</pubDate>
      <link>${threadUrl}</link>
      <itunes:author>${escapeXml(ep.creatorName)}</itunes:author>
      <itunes:subtitle>${escapeXml(ep.podcast.topic)}</itunes:subtitle>
      <itunes:summary>${description}</itunes:summary>
      <podcast:transcript url="${threadUrl}" type="text/html" />
    </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:podcast="https://podcastindex.org/namespace/1.0"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Source Library Deep Dive</title>
    <link>https://sourcelibrary.org/reading-room</link>
    <description>AI-generated scholarly podcasts from the Embassy of the Free Mind's rare book collection. Explore alchemy, Hermetica, Kabbalah, and the Western esoteric tradition through primary sources from the 15th-18th centuries.</description>
    <language>en</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="https://sourcelibrary.org/api/podcast/feed.xml" rel="self" type="application/rss+xml" />
    <itunes:author>Source Library</itunes:author>
    <itunes:owner>
      <itunes:name>Source Library</itunes:name>
      <itunes:email>hello@sourcelibrary.org</itunes:email>
    </itunes:owner>
    <itunes:image href="https://sourcelibrary.org/brand/png/logo-dark--512.png" />
    <itunes:category text="Education">
      <itunes:category text="Higher Education" />
    </itunes:category>
    <itunes:category text="History" />
    <itunes:explicit>false</itunes:explicit>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
