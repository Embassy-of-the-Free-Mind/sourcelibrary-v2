import { connectToDatabase } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import SiteHeader from '@/components/layout/SiteHeader';
import Link from 'next/link';
import TranscriptToggle from './TranscriptToggle';

export const revalidate = 3600; // 1h ISR

export const metadata = {
  title: 'Source Library Deep Dive — Podcast',
  description: 'AI-generated scholarly podcasts exploring rare books from the 15th-18th centuries. Alchemy, Hermetica, Kabbalah, and the Western esoteric tradition — grounded in primary sources.',
};

interface BookThumb {
  id: string;
  thumbnail: string | null;
}

interface PodcastEpisode {
  threadId: string;
  title: string;
  topic: string;
  creatorName: string;
  audioUrl: string;
  format: string;
  findingCount: number;
  generatedAt: string;
  bookIds: string[];
  bookThumbs: BookThumb[];
  script: string | null;
}

async function getEpisodes(): Promise<PodcastEpisode[]> {
  try {
    const { db } = await connectToDatabase();

    // Find all threads with podcasts
    const threads = await db.collection('embassy_threads')
      .find({
        $or: [
          { 'podcasts.deep-dive': { $exists: true } },
          { 'podcast': { $exists: true } },
        ],
      })
      .sort({ 'podcasts.deep-dive.generatedAt': -1, 'podcast.generatedAt': -1 })
      .limit(50)
      .project({ _id: 1, title: 1, creatorName: 1, podcasts: 1, podcast: 1 })
      .toArray();

    const episodes: PodcastEpisode[] = [];

    for (const thread of threads) {
      const formats = ['deep-dive', 'brief', 'critique', 'guided-reading'];
      for (const format of formats) {
        const p = thread.podcasts?.[format];
        if (p?.audioUrl) {
          episodes.push({
            threadId: thread._id.toString(),
            title: thread.title || p.topic,
            topic: p.topic,
            creatorName: thread.creatorName || 'Anonymous',
            audioUrl: p.audioUrl,
            format,
            findingCount: p.findingCount || 0,
            generatedAt: p.generatedAt,
            bookIds: [],
            bookThumbs: [],
            script: p.script || null,
          });
        }
      }
      // Legacy single podcast
      if (thread.podcast?.audioUrl && !thread.podcasts?.['deep-dive']) {
        episodes.push({
          threadId: thread._id.toString(),
          title: thread.title || thread.podcast.topic,
          topic: thread.podcast.topic,
          creatorName: thread.creatorName || 'Anonymous',
          audioUrl: thread.podcast.audioUrl,
          format: 'deep-dive',
          findingCount: thread.podcast.findingCount || 0,
          generatedAt: thread.podcast.generatedAt,
          bookIds: [],
          bookThumbs: [],
          script: thread.podcast.script || null,
        });
      }
    }

    // Load notebook finding counts for book thumbnails
    const threadIds = [...new Set(episodes.map(e => e.threadId))];
    const notebooks = await db.collection('research_notebooks')
      .find({ threadId: { $in: threadIds.map(id => new ObjectId(id)) } })
      .project({ threadId: 1, findings: 1 })
      .toArray();

    const notebookMap = new Map(notebooks.map(n => [
      n.threadId.toString(),
      [...new Set((n.findings || []).map((f: { source: { bookId: string } }) => f.source.bookId))],
    ]));

    for (const ep of episodes) {
      ep.bookIds = (notebookMap.get(ep.threadId) || []) as string[];
    }

    // Load actual thumbnail URLs for referenced books
    const allBookIds = [...new Set(episodes.flatMap(e => e.bookIds))];
    if (allBookIds.length > 0) {
      const bookDocs = await db.collection('books')
        .find({ id: { $in: allBookIds } })
        .project({ id: 1, thumbnail: 1, thumbnail_blob: 1 })
        .toArray();
      const thumbMap = new Map(bookDocs.map(b => [
        b.id,
        (b.thumbnail_blob || b.thumbnail || null) as string | null,
      ]));
      for (const ep of episodes) {
        ep.bookThumbs = ep.bookIds.map(bid => ({
          id: bid,
          thumbnail: thumbMap.get(bid) || null,
        }));
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
          <div className="space-y-6">
            {episodes.map((ep, i) => (
              <article
                key={`${ep.threadId}-${ep.format}-${i}`}
                className="p-5 bg-white rounded-xl border border-[#e8e4dc] hover:border-[#c9a86c] transition-colors"
              >
                {/* Book cover thumbnails */}
                {ep.bookThumbs.filter(b => b.thumbnail).length > 0 && (
                  <div className="flex gap-1.5 mb-3 overflow-hidden">
                    {ep.bookThumbs.filter(b => b.thumbnail).slice(0, 5).map(b => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={b.id}
                        src={`/api/image?url=${encodeURIComponent(b.thumbnail!)}&w=60&q=75`}
                        alt=""
                        className="w-8 h-12 object-cover rounded flex-shrink-0 bg-[#f0ece4]"
                        loading="lazy"
                      />
                    ))}
                    {ep.bookThumbs.filter(b => b.thumbnail).length > 5 && (
                      <span className="text-[10px] text-[#8a8480] font-sans self-end mb-1">+{ep.bookThumbs.filter(b => b.thumbnail).length - 5}</span>
                    )}
                  </div>
                )}

                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <Link
                      href={`/librarian/thread/${ep.threadId}`}
                      className="text-[16px] font-serif text-[#1a1612] leading-snug hover:text-[#9e4a3a] transition-colors"
                      style={{ fontWeight: 400 }}
                    >
                      {ep.title}
                    </Link>
                    <p className="text-[11px] text-[#8a8480] font-sans mt-1">
                      {FORMAT_LABELS[ep.format] || 'Deep Dive'} &middot; {ep.findingCount} sources &middot; {formatDate(ep.generatedAt)}
                    </p>
                  </div>
                </div>

                <audio
                  controls
                  src={ep.audioUrl}
                  className="w-full"
                  preload="metadata"
                />

                <div className="mt-2 flex items-center justify-between">
                  <Link
                    href={`/librarian/thread/${ep.threadId}`}
                    className="text-[11px] text-[#9e4a3a] font-sans hover:underline"
                  >
                    View research &amp; sources
                  </Link>
                  {ep.script && <TranscriptToggle script={ep.script} />}
                </div>
              </article>
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
