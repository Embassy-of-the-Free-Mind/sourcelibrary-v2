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

interface Finding {
  quote: string;
  note: string;
  source: {
    bookId: string;
    bookTitle: string;
    bookAuthor: string;
    bookSlug?: string;
    pageNumber?: number;
  };
}

interface SourceBook {
  id: string;
  title: string;
  author: string;
  slug?: string;
  thumbnail: string | null;
  findingCount: number;
}

interface EpisodeData {
  threadId: string;
  title: string;
  topic: string;
  audioUrl: string;
  formatLabel: string;
  findingCount: number;
  generatedAt: string;
  script: string | null;
  heroImage: {
    url: string;
    description: string;
    bookId: string;
    bookTitle: string;
  } | null;
  findings: Finding[];
  sourceBooks: SourceBook[];
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
      { projection: { title: 1, podcasts: 1, podcast: 1, heroImage: 1 } },
    );
    if (!thread) return null;

    let podcast: { topic: string; audioUrl: string; findingCount?: number; generatedAt: string; script?: string } | null = null;
    let format = 'deep-dive';
    for (const f of ['deep-dive', 'brief', 'critique', 'guided-reading']) {
      const p = thread.podcasts?.[f];
      if (p?.audioUrl) { podcast = p; format = f; break; }
    }
    if (!podcast && thread.podcast?.audioUrl) podcast = thread.podcast;
    if (!podcast) return null;

    // Load findings from research notebook
    const notebook = await db.collection('research_notebooks').findOne(
      { threadId: new ObjectId(threadId) },
      { projection: { findings: 1 } },
    );
    const findings: Finding[] = (notebook?.findings || []).map((f: Finding) => ({
      quote: f.quote,
      note: f.note,
      source: f.source,
    }));

    // Build source books list with thumbnails
    const bookIds = [...new Set(findings.map(f => f.source?.bookId).filter(Boolean))];
    let sourceBooks: SourceBook[] = [];
    if (bookIds.length > 0) {
      const bookDocs = await db.collection('books')
        .find({ id: { $in: bookIds } })
        .project({ id: 1, title: 1, author: 1, slug: 1, thumbnail: 1, thumbnail_blob: 1 })
        .toArray();
      const bookMap = new Map(bookDocs.map(b => [b.id, b]));
      sourceBooks = bookIds.map(bid => {
        const b = bookMap.get(bid);
        return {
          id: bid,
          title: b?.title || 'Unknown',
          author: b?.author || '',
          slug: b?.slug,
          thumbnail: b?.thumbnail_blob || b?.thumbnail || null,
          findingCount: findings.filter(f => f.source?.bookId === bid).length,
        };
      }).sort((a, b) => b.findingCount - a.findingCount);
    }

    // Hero image
    let heroImage: EpisodeData['heroImage'] = null;
    if (thread.heroImage?.url) {
      const book = thread.heroImage.bookId
        ? await db.collection('books').findOne({ id: thread.heroImage.bookId }, { projection: { title: 1 } })
        : null;
      heroImage = {
        url: thread.heroImage.url,
        description: thread.heroImage.description || '',
        bookId: thread.heroImage.bookId || '',
        bookTitle: book?.title || '',
      };
    }
    if (!heroImage && bookIds.length > 0) {
      const bestImage = await db.collection('gallery_images')
        .findOne(
          { book_id: { $in: bookIds }, thumbnail_url: { $exists: true, $ne: null }, gallery_quality: { $gte: 0.7 } },
          { sort: { gallery_quality: -1 }, projection: { thumbnail_url: 1, description: 1, book_id: 1 } },
        );
      if (bestImage?.thumbnail_url) {
        const book = await db.collection('books').findOne({ id: bestImage.book_id }, { projection: { title: 1 } });
        heroImage = {
          url: bestImage.thumbnail_url,
          description: bestImage.description || '',
          bookId: bestImage.book_id,
          bookTitle: book?.title || 'Unknown',
        };
      }
    }

    return {
      threadId,
      title: thread.title || podcast.topic,
      topic: podcast.topic,
      audioUrl: podcast.audioUrl,
      formatLabel: FORMAT_LABELS[format] || 'Deep Dive',
      findingCount: podcast.findingCount || 0,
      generatedAt: podcast.generatedAt,
      script: podcast.script || null,
      heroImage,
      findings,
      sourceBooks,
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
              src={`/api/image?url=${encodeURIComponent(episode.heroImage.url)}&w=1440&q=85`}
              alt={episode.heroImage.description}
              className="w-full max-h-[480px] object-contain"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-5 pb-4 pt-10">
              <p className="text-white/80 text-[11px] font-sans">
                {episode.heroImage.description}
                {episode.heroImage.bookTitle && (
                  <>
                    {' — '}
                    <Link
                      href={`/book/${episode.heroImage.bookId}`}
                      className="text-white/90 underline hover:text-white"
                    >
                      {episode.heroImage.bookTitle}
                    </Link>
                  </>
                )}
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

        {/* Transcript */}
        {episode.script && (
          <div className="mb-8">
            <TranscriptToggle script={episode.script} />
          </div>
        )}

        {/* Source books */}
        {episode.sourceBooks.length > 0 && (
          <div className="mb-8 pt-8 border-t border-[#e8e4dc]">
            <h2 className="text-[15px] font-serif text-[#1a1612] mb-4" style={{ fontWeight: 400 }}>
              Sources ({episode.sourceBooks.length} book{episode.sourceBooks.length !== 1 ? 's' : ''})
            </h2>
            <div className="space-y-3">
              {episode.sourceBooks.map(book => (
                <Link
                  key={book.id}
                  href={`/book/${book.slug || book.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-[#f5f2ec] transition-colors group"
                >
                  {book.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/image?url=${encodeURIComponent(book.thumbnail)}&w=80&q=75`}
                      alt=""
                      className="w-10 h-14 object-cover rounded flex-shrink-0 bg-[#f0ece4]"
                    />
                  ) : (
                    <div className="w-10 h-14 rounded flex-shrink-0 bg-[#e8e4dc]" />
                  )}
                  <div className="min-w-0">
                    <p className="text-[14px] font-serif text-[#1a1612] leading-snug group-hover:text-[#9e4a3a] transition-colors truncate">
                      {book.title}
                    </p>
                    <p className="text-[11px] text-[#8a8480] font-sans mt-0.5 truncate">
                      {book.author}
                      {book.findingCount > 1 && ` — ${book.findingCount} passages cited`}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Key findings / evidence */}
        {episode.findings.length > 0 && (
          <div className="mb-8 pt-8 border-t border-[#e8e4dc]">
            <h2 className="text-[15px] font-serif text-[#1a1612] mb-4" style={{ fontWeight: 400 }}>
              Key Evidence ({episode.findings.length} passage{episode.findings.length !== 1 ? 's' : ''})
            </h2>
            <div className="space-y-6">
              {episode.findings.map((finding, i) => (
                <div key={i} className="pl-4 border-l-2 border-[#c9a86c]/40">
                  <blockquote className="text-[14px] font-body text-[#333] leading-relaxed italic">
                    &ldquo;{finding.quote}&rdquo;
                  </blockquote>
                  <p className="text-[12px] text-[#6b6560] font-body mt-2 leading-relaxed">
                    {finding.note}
                  </p>
                  <p className="text-[11px] text-[#8a8480] font-sans mt-1.5">
                    <Link
                      href={`/book/${finding.source.bookSlug || finding.source.bookId}${finding.source.pageNumber ? `?page=${finding.source.pageNumber}` : ''}`}
                      className="text-[#9e4a3a] hover:underline"
                    >
                      {finding.source.bookTitle}
                      {finding.source.pageNumber && `, p. ${finding.source.pageNumber}`}
                    </Link>
                    {finding.source.bookAuthor && ` — ${finding.source.bookAuthor}`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Back link */}
        <div className="pt-8 border-t border-[#e8e4dc]">
          <Link
            href="/podcast"
            className="text-[13px] text-[#6b6560] font-sans hover:text-[#1a1612] transition-colors"
          >
            &larr; All episodes
          </Link>
        </div>
      </div>
    </div>
  );
}
