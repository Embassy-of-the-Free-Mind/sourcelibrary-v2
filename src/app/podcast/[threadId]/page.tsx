import { connectToDatabase } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notFound } from 'next/navigation';
import SiteHeader from '@/components/layout/SiteHeader';
import Link from 'next/link';
import TranscriptToggle from '../TranscriptToggle';

export const revalidate = 3600;

interface Props {
  params: Promise<{ threadId: string }>;
}

interface EpisodeData {
  threadId: string;
  title: string;
  topic: string;
  creatorName: string;
  audioUrl: string;
  format: string;
  formatLabel: string;
  findingCount: number;
  generatedAt: string;
  script: string | null;
  bookIds: string[];
  heroImage: {
    url: string;
    description: string;
    bookId: string;
    bookTitle: string;
  } | null;
}

const FORMAT_LABELS: Record<string, string> = {
  'deep-dive': 'Deep Dive',
  'brief': 'The Brief',
  'critique': 'The Critique',
  'guided-reading': 'Guided Reading',
};

async function getEpisode(threadId: string): Promise<EpisodeData | null> {
  try {
    if (!ObjectId.isValid(threadId)) return null;
    const { db } = await connectToDatabase();

    const thread = await db.collection('embassy_threads').findOne(
      { _id: new ObjectId(threadId) },
      { projection: { title: 1, creatorName: 1, podcasts: 1, podcast: 1 } },
    );
    if (!thread) return null;

    // Find the best podcast format available
    let podcast: { topic: string; audioUrl: string; findingCount?: number; generatedAt: string; script?: string } | null = null;
    let format = 'deep-dive';
    const formats = ['deep-dive', 'brief', 'critique', 'guided-reading'];
    for (const f of formats) {
      const p = thread.podcasts?.[f];
      if (p?.audioUrl) {
        podcast = p;
        format = f;
        break;
      }
    }
    if (!podcast && thread.podcast?.audioUrl) {
      podcast = thread.podcast;
    }
    if (!podcast) return null;

    // Get book IDs from research notebook
    const notebook = await db.collection('research_notebooks').findOne(
      { threadId: new ObjectId(threadId) },
      { projection: { findings: 1 } },
    );
    const bookIds = [...new Set(
      (notebook?.findings || [])
        .map((f: { source: { bookId: string } }) => f.source?.bookId)
        .filter(Boolean),
    )] as string[];

    // Find best gallery image from referenced books
    let heroImage: EpisodeData['heroImage'] = null;
    if (bookIds.length > 0) {
      const bestImage = await db.collection('gallery_images')
        .findOne(
          { book_id: { $in: bookIds }, gallery_quality: { $gte: 0.7 } },
          { sort: { gallery_quality: -1 }, projection: { thumbnail_url: 1, image_url: 1, description: 1, book_id: 1 } },
        );
      if (bestImage) {
        const imageUrl = bestImage.thumbnail_url || bestImage.image_url;
        if (imageUrl) {
          const book = await db.collection('books').findOne(
            { id: bestImage.book_id },
            { projection: { title: 1 } },
          );
          heroImage = {
            url: imageUrl,
            description: bestImage.description || '',
            bookId: bestImage.book_id,
            bookTitle: book?.title || 'Unknown',
          };
        }
      }
    }

    return {
      threadId,
      title: thread.title || podcast.topic,
      topic: podcast.topic,
      creatorName: thread.creatorName || 'Anonymous',
      audioUrl: podcast.audioUrl,
      format,
      formatLabel: FORMAT_LABELS[format] || 'Deep Dive',
      findingCount: podcast.findingCount || 0,
      generatedAt: podcast.generatedAt,
      script: podcast.script || null,
      bookIds,
      heroImage,
    };
  } catch (err) {
    console.error('[podcast] Failed to load episode:', err);
    return null;
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export async function generateMetadata({ params }: Props) {
  const { threadId } = await params;
  const episode = await getEpisode(threadId);
  if (!episode) return { title: 'Episode Not Found' };
  return {
    title: `${episode.title} — Source Library Deep Dive`,
    description: `${episode.formatLabel}: ${episode.topic}. AI-generated scholarly podcast grounded in primary sources.`,
  };
}

export default async function EpisodePage({ params }: Props) {
  const { threadId } = await params;
  const episode = await getEpisode(threadId);
  if (!episode) notFound();

  return (
    <div className="min-h-screen bg-[#fdfcf9]">
      <SiteHeader variant="light" breadcrumbs={[
        { label: 'Podcast', href: '/podcast' },
        { label: episode.title, href: '#' },
      ]} />

      {/* Hero image */}
      {episode.heroImage && (
        <div className="relative w-full max-w-[960px] mx-auto mt-6 px-6">
          <div className="relative rounded-xl overflow-hidden bg-[#1a1612]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/image?url=${encodeURIComponent(episode.heroImage.url)}&w=960&q=85`}
              alt={episode.heroImage.description}
              className="w-full max-h-[480px] object-contain"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-5 pb-4 pt-10">
              <p className="text-white/80 text-[11px] font-sans">
                {episode.heroImage.description}
                {' — '}
                <Link
                  href={`/book/${episode.heroImage.bookId}`}
                  className="text-white/90 underline hover:text-white"
                >
                  {episode.heroImage.bookTitle}
                </Link>
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-[720px] mx-auto px-6 py-10 md:py-16">
        {/* Title & meta */}
        <div className="mb-8">
          <h1
            className="text-2xl md:text-3xl font-serif text-[#1a1612] mb-2"
            style={{ fontWeight: 400 }}
          >
            {episode.title}
          </h1>
          <p className="text-[13px] text-[#8a8480] font-sans">
            {episode.formatLabel} &middot; {episode.findingCount} sources &middot; {formatDate(episode.generatedAt)}
          </p>
        </div>

        {/* Audio player */}
        <audio
          controls
          src={episode.audioUrl}
          className="w-full mb-6"
          preload="metadata"
        />

        {/* Actions */}
        <div className="flex items-center gap-4 mb-8 pb-8 border-b border-[#e8e4dc]">
          <Link
            href={`/librarian/thread/${episode.threadId}`}
            className="text-[13px] text-[#9e4a3a] font-sans hover:underline"
          >
            View research &amp; sources
          </Link>
          {episode.script && <TranscriptToggle script={episode.script} />}
        </div>

        {/* Back link */}
        <Link
          href="/podcast"
          className="text-[13px] text-[#6b6560] font-sans hover:text-[#1a1612] transition-colors"
        >
          &larr; All episodes
        </Link>
      </div>
    </div>
  );
}
