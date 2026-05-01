import { connectToDatabase } from '@/lib/mongodb';
import SiteHeader from '@/components/layout/SiteHeader';
import Link from 'next/link';

export const revalidate = 3600; // 1h ISR

export const metadata = {
  title: 'Source Library Deep Dive — Podcast',
  description: 'AI-generated scholarly podcasts exploring rare books from the 15th-18th centuries. Alchemy, Hermetica, Kabbalah, and the Western esoteric tradition — grounded in primary sources.',
};

interface PodcastEpisode {
  threadId: string;
  title: string;
  format: string;
  findingCount: number;
  generatedAt: string;
  heroImageUrl: string | null;
}

async function getEpisodes(): Promise<PodcastEpisode[]> {
  try {
    const { db } = await connectToDatabase();

    const threads = await db.collection('embassy_threads')
      .find({
        $or: [
          { 'podcasts.deep-dive': { $exists: true } },
          { 'podcast': { $exists: true } },
        ],
      })
      .sort({ 'podcasts.deep-dive.generatedAt': -1, 'podcast.generatedAt': -1 })
      .limit(50)
      .project({ _id: 1, title: 1, podcasts: 1, podcast: 1, heroImage: 1 })
      .toArray();

    const episodes: PodcastEpisode[] = [];

    for (const thread of threads) {
      const heroImageUrl = thread.heroImage?.url || null;
      const formats = ['deep-dive', 'brief', 'critique', 'guided-reading'] as const;
      for (const format of formats) {
        const p = thread.podcasts?.[format];
        if (p?.audioUrl) {
          episodes.push({
            threadId: thread._id.toString(),
            title: thread.title || p.topic,
            format,
            findingCount: p.findingCount || 0,
            generatedAt: p.generatedAt,
            heroImageUrl,
          });
        }
      }
      if (thread.podcast?.audioUrl && !thread.podcasts?.['deep-dive']) {
        episodes.push({
          threadId: thread._id.toString(),
          title: thread.title || thread.podcast.topic,
          format: 'deep-dive',
          findingCount: thread.podcast.findingCount || 0,
          generatedAt: thread.podcast.generatedAt,
          heroImageUrl,
        });
      }
    }

    return episodes.sort((a, b) =>
      new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
    );
  } catch (err) {
    console.error('[podcast] Failed to load episodes:', err);
    return [];
  }
}

const FORMAT_LABELS: Record<string, string> = {
  'deep-dive': 'Deep Dive',
  'brief': 'The Brief',
  'critique': 'The Critique',
  'guided-reading': 'Guided Reading',
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default async function PodcastPage() {
  const episodes = await getEpisodes();

  return (
    <div className="min-h-screen bg-[#fdfcf9]">
      <SiteHeader variant="light" breadcrumbs={[{ label: 'Podcast', href: '/podcast' }]} />

      <div className="max-w-[720px] mx-auto px-6 py-10 md:py-16">
        {/* Header */}
        <div className="text-center mb-12">
          <h1
            className="text-3xl md:text-4xl font-serif text-[#1a1612] mb-3"
            style={{ fontWeight: 400 }}
          >
            Source Library Deep Dive
          </h1>
          <p className="text-[15px] font-body text-[#6b6560] max-w-lg mx-auto leading-relaxed">
            AI-generated scholarly podcasts grounded in primary sources from
            the 15th-18th centuries. Two hosts explore alchemy, Hermetica, death rites,
            celestial beings, and the hidden connections between ancient traditions.
          </p>
          <div className="mt-4 flex items-center justify-center gap-4 text-[12px] font-sans text-[#8a8480]">
            <a
              href="/api/podcast/feed.xml"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[#9e4a3a] hover:underline"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12.75 19.5v-.75a7.5 7.5 0 00-7.5-7.5H4.5m0-6.75h.75c7.87 0 14.25 6.38 14.25 14.25v.75M6 18.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
              RSS Feed
            </a>
            <span>{episodes.length} episode{episodes.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* Episodes */}
        {episodes.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[#8a8480] font-body">No episodes yet. Research a topic with the Librarian to generate one.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {episodes.map((ep, i) => (
              <Link
                key={`${ep.threadId}-${ep.format}-${i}`}
                href={`/podcast/${ep.threadId}`}
                className="flex group rounded-xl overflow-hidden border border-[#e8e4dc] hover:border-[#c9a86c] transition-colors bg-white"
              >
                {ep.heroImageUrl && (
                  <div className="flex-shrink-0 w-[180px] md:w-[220px] bg-[#1a1612] overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/image?url=${encodeURIComponent(ep.heroImageUrl)}&w=440&q=85`}
                      alt=""
                      className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                      loading="lazy"
                    />
                  </div>
                )}
                <div className="flex-1 p-5 flex flex-col justify-center min-w-0">
                  <h2
                    className="text-[17px] font-serif text-[#1a1612] leading-snug group-hover:text-[#9e4a3a] transition-colors"
                    style={{ fontWeight: 400 }}
                  >
                    {ep.title}
                  </h2>
                  <p className="text-[12px] text-[#8a8480] font-sans mt-1.5">
                    {FORMAT_LABELS[ep.format] || 'Deep Dive'} &middot; {ep.findingCount} sources &middot; {formatDate(ep.generatedAt)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="mt-12 pt-8 border-t border-[#e8e4dc] text-center">
          <p className="text-[#6b6560] text-sm font-body mb-3">
            Want to create your own episode?
          </p>
          <Link
            href="/librarian"
            className="inline-block px-5 py-2.5 bg-[#1a1612] text-white rounded-lg text-sm font-sans hover:bg-[#2a2622] transition-colors"
          >
            Research a topic with the Librarian
          </Link>
        </div>
      </div>
    </div>
  );
}
