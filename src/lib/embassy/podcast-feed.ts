import { PODCAST_FORMATS, type PodcastMetadata } from './podcast';

// Shared RSS 2.0 builder for the podcast feeds. We serve one feed per language
// (English at /api/podcast/feed.xml, Spanish at /api/podcast/feed.es.xml) so
// Apple/Spotify label each show with the correct <language> and Spanish-
// speaking listeners can find a Spanish show. Episode `topic` text is already
// in the episode's own language; only the channel chrome differs per locale.

export type FeedEpisode = {
  threadId: string;
  threadTitle: string;
  creatorName: string;
  language: string;
  podcast: PodcastMetadata;
};

type Locale = 'en' | 'es';

const CHANNEL: Record<Locale, {
  title: string;
  description: string;
  language: string;
  self: string;
  formatPrefix: (label: string, topic: string) => string;
  itemDescription: (label: string, topic: string, findings: number, creator: string) => string;
}> = {
  en: {
    title: 'Source Library Deep Dive',
    description:
      "AI-generated scholarly podcasts from the Embassy of the Free Mind's rare book collection. Explore alchemy, Hermetica, Kabbalah, and the Western esoteric tradition through primary sources from the 15th-18th centuries.",
    language: 'en',
    self: 'https://sourcelibrary.org/api/podcast/feed.xml',
    formatPrefix: (label, topic) => `${label}: ${topic}`,
    itemDescription: (label, topic, findings, creator) =>
      `${label} episode exploring "${topic}" — generated from ${findings} research findings in Source Library. By ${creator}.`,
  },
  es: {
    title: 'Source Library — Deep Dive en español',
    description:
      'Pódcast académico generado con IA a partir de las fuentes primarias de Source Library: alquimia, hermética, astrología, filosofía y ciencia del mundo antiguo y moderno temprano, narrado en español.',
    language: 'es',
    self: 'https://sourcelibrary.org/api/podcast/feed.es.xml',
    formatPrefix: (_label, topic) => topic,
    itemDescription: (_label, topic, _findings, creator) =>
      `Un episodio que explora «${topic}», a partir de fuentes primarias en Source Library. Por ${creator}.`,
  },
};

export function buildPodcastFeed(episodes: FeedEpisode[], locale: Locale): string {
  const ch = CHANNEL[locale];

  const lastBuildDate = episodes.length > 0
    ? new Date(episodes[0].podcast.generatedAt).toUTCString()
    : new Date().toUTCString();

  const items = episodes.map((ep) => {
    const pubDate = new Date(ep.podcast.generatedAt).toUTCString();
    const formatLabel = PODCAST_FORMATS[ep.podcast.format]?.label || 'Deep Dive';
    const title = escapeXml(ch.formatPrefix(formatLabel, ep.podcast.topic));
    const description = escapeXml(ch.itemDescription(formatLabel, ep.podcast.topic, ep.podcast.findingCount, ep.creatorName));
    // Link to the public episode page (not the auth-gated thread view).
    const episodeUrl = `https://sourcelibrary.org/podcast/${ep.threadId}`;
    const guid = `sourcelibrary-podcast-${ep.threadId}-${ep.podcast.format}`;

    return `    <item>
      <title>${title}</title>
      <description>${description}</description>
      <enclosure url="${escapeXml(ep.podcast.audioUrl)}" type="${ep.podcast.audioUrl.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg'}" />
      <guid isPermaLink="false">${guid}</guid>
      <pubDate>${pubDate}</pubDate>
      <link>${episodeUrl}</link>
      <itunes:author>${escapeXml(ep.creatorName)}</itunes:author>
      <itunes:subtitle>${escapeXml(ep.podcast.topic)}</itunes:subtitle>
      <itunes:summary>${description}</itunes:summary>
      <podcast:transcript url="${episodeUrl}" type="text/html" />
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:podcast="https://podcastindex.org/namespace/1.0"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(ch.title)}</title>
    <link>https://sourcelibrary.org/podcast</link>
    <description>${escapeXml(ch.description)}</description>
    <language>${ch.language}</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${ch.self}" rel="self" type="application/rss+xml" />
    <itunes:author>Source Library</itunes:author>
    <itunes:owner>
      <itunes:name>Source Library</itunes:name>
      <itunes:email>team@sourcelibrary.org</itunes:email>
    </itunes:owner>
    <itunes:image href="https://sourcelibrary.org/brand/png/podcast-cover--1400.png" />
    <itunes:category text="Education">
      <itunes:category text="Higher Education" />
    </itunes:category>
    <itunes:category text="History" />
    <itunes:explicit>false</itunes:explicit>
${items}
  </channel>
</rss>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
