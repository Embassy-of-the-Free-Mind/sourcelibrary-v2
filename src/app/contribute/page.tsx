import { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Participate - Source Library',
  description: 'Join the Embassy of the Free Mind. Help digitize, translate, and study rare texts from the Western esoteric tradition.',
  alternates: {
    canonical: '/contribute',
  },
};

async function getStats() {
  try {
    const db = await getDb();
    const [totalBooks, translatedCount, totalPages, galleryCount, languageResult] = await Promise.all([
      db.collection('books').countDocuments({ pages_translated: { $gt: 0 } }),
      db.collection('books').countDocuments({ pages_translated: { $gt: 0 } }),
      db.collection('pages').estimatedDocumentCount(),
      db.collection('gallery_images').estimatedDocumentCount(),
      db.collection('books').distinct('language'),
    ]);
    return {
      totalBooks,
      translatedCount,
      totalPages,
      galleryCount,
      languageCount: languageResult.filter(Boolean).length,
    };
  } catch {
    return { totalBooks: 0, translatedCount: 0, totalPages: 0, galleryCount: 0, languageCount: 0 };
  }
}

async function getGalleryImages() {
  try {
    const db = await getDb();
    const images = await db.collection('gallery_images')
      .find(
        { gallery_quality: { $gte: 0.8 }, book_rank: { $lte: 1 } },
        { projection: { _id: 0, image_url: 1, thumbnail_url: 1, book_title: 1, book_author: 1, book_year: 1, type: 1, description: 1 } }
      )
      .sort({ gallery_quality: -1 })
      .limit(6)
      .toArray();
    return JSON.parse(JSON.stringify(images));
  } catch {
    return [];
  }
}

function formatNumber(n: number): string {
  if (n >= 1000) return `${Math.floor(n / 100) / 10}k`;
  return n.toString();
}

export default async function ParticipatePage() {
  const [stats, galleryImages] = await Promise.all([getStats(), getGalleryImages()]);

  return (
    <div className="min-h-screen bg-cream">
      {/* Nav */}
      <header className="bg-white border-b border-border-light">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-secondary hover:text-primary transition-colors"
          >
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1" />
            </svg>
            <span className="font-medium">Source Library</span>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-20 md:py-28">
        <div className="max-w-5xl mx-auto px-6">
          <h1 className="font-serif text-4xl md:text-6xl mb-6 leading-tight">
            Help translate the<br />
            world&apos;s rarest books
          </h1>
          <p className="text-lg md:text-xl text-stone-300 max-w-2xl mb-10 leading-relaxed">
            {stats.totalBooks.toLocaleString()} texts from {stats.languageCount} languages, scanned from {' '}
            13 digital archives. Open, translated by AI, and free forever.
            We need human eyes to make the translations good.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 bg-white text-stone-900 px-6 py-3 rounded-full font-medium hover:bg-stone-100 transition-colors"
            >
              Browse the library
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
            <Link
              href="/contribute/process"
              className="inline-flex items-center gap-2 border border-stone-500 text-white px-6 py-3 rounded-full font-medium hover:bg-white/10 transition-colors"
            >
              Process pages with your API key
            </Link>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section className="border-b border-border-light bg-white">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            <div>
              <div className="text-2xl md:text-3xl font-semibold text-primary">{stats.totalBooks.toLocaleString()}</div>
              <div className="text-sm text-muted mt-0.5">rare books</div>
            </div>
            <div>
              <div className="text-2xl md:text-3xl font-semibold text-primary">{formatNumber(stats.totalPages)}+</div>
              <div className="text-sm text-muted mt-0.5">manuscript pages</div>
            </div>
            <div>
              <div className="text-2xl md:text-3xl font-semibold text-primary">{stats.translatedCount.toLocaleString()}</div>
              <div className="text-sm text-muted mt-0.5">books with translations</div>
            </div>
            <div>
              <div className="text-2xl md:text-3xl font-semibold text-primary">{formatNumber(stats.galleryCount)}+</div>
              <div className="text-sm text-muted mt-0.5">historical illustrations</div>
            </div>
          </div>
        </div>
      </section>

      {/* The simplest way to start */}
      <section className="max-w-5xl mx-auto px-6 pt-16 pb-12">
        <h2 className="font-serif text-2xl md:text-3xl text-primary mb-4">
          The easiest way to start
        </h2>
        <div className="max-w-3xl">
          <p className="text-lg text-secondary leading-relaxed mb-4">
            Open any book. Read the AI translation next to the original page image. If something is wrong, click edit and fix it. That&apos;s it.
          </p>
          <p className="text-secondary leading-relaxed mb-6">
            Every book has an edit button on every page. No account needed. The languages we most need help with:{' '}
            <span className="text-primary font-medium">Latin</span>,{' '}
            <span className="text-primary font-medium">German</span>,{' '}
            <span className="text-primary font-medium">Arabic</span>,{' '}
            <span className="text-primary font-medium">Hebrew</span>, and{' '}
            <span className="text-primary font-medium">Ancient Greek</span>.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-accent-rust font-medium hover:underline"
          >
            Browse the library
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      </section>

      {/* Gallery strip */}
      {galleryImages.length > 0 && (
        <section className="max-w-5xl mx-auto px-6 pb-16">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {galleryImages.map((img: { image_url: string; thumbnail_url?: string; book_title: string; book_year: number; description: string }, i: number) => (
              <Link
                key={i}
                href="/gallery"
                className="aspect-square rounded-lg overflow-hidden bg-warm group"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.thumbnail_url || img.image_url}
                  alt={img.description || img.book_title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              </Link>
            ))}
          </div>
          <div className="mt-3 text-right">
            <Link href="/gallery" className="text-sm text-muted hover:text-secondary transition-colors">
              {formatNumber(stats.galleryCount)}+ illustrations in the gallery &rarr;
            </Link>
          </div>
        </section>
      )}

      {/* Ways to engage — light spectrum */}
      <section className="max-w-5xl mx-auto px-6 pb-16">
        <h2 className="font-serif text-2xl md:text-3xl text-primary mb-3">
          Every reader makes the library better
        </h2>
        <p className="text-secondary leading-relaxed max-w-3xl mb-8">
          You don&apos;t need to know Latin. Just reading and reacting helps us understand what matters.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link href="/gallery" className="group p-4 rounded-xl bg-white border border-border-light hover:border-accent-gold/40 hover:shadow-sm transition-all text-center">
            <div className="w-9 h-9 mx-auto mb-2 rounded-lg bg-accent-gold/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-accent-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-primary mb-0.5 group-hover:text-accent-gold transition-colors">Like what moves you</h3>
            <p className="text-xs text-muted leading-snug">
              Heart a page, image, or book. It helps surface the best material.
            </p>
          </Link>

          <Link href="/gallery" className="group p-4 rounded-xl bg-white border border-border-light hover:border-accent-rust/40 hover:shadow-sm transition-all text-center">
            <div className="w-9 h-9 mx-auto mb-2 rounded-lg bg-accent-rust/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-accent-rust" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-primary mb-0.5 group-hover:text-accent-rust transition-colors">Rate illustrations</h3>
            <p className="text-xs text-muted leading-snug">
              Browse the gallery and rate image quality. Your ratings help curate the collection.
            </p>
          </Link>

          <Link href="/" className="group p-4 rounded-xl bg-white border border-border-light hover:border-accent-sage/40 hover:shadow-sm transition-all text-center">
            <div className="w-9 h-9 mx-auto mb-2 rounded-lg bg-accent-sage/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-accent-sage" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-primary mb-0.5 group-hover:text-accent-sage transition-colors">Leave notes</h3>
            <p className="text-xs text-muted leading-snug">
              Add context, corrections, or cross-references on any page. Start a conversation.
            </p>
          </Link>

          <a href="mailto:derek@ancientwisdomtrust.org?subject=Study group idea" className="group p-4 rounded-xl bg-white border border-border-light hover:border-accent-violet/40 hover:shadow-sm transition-all text-center">
            <div className="w-9 h-9 mx-auto mb-2 rounded-lg bg-accent-violet/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-accent-violet" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-primary mb-0.5 group-hover:text-accent-violet transition-colors">Form a study group</h3>
            <p className="text-xs text-muted leading-snug">
              Organize a reading group around a text. We&apos;ll help you get started.
            </p>
          </a>
        </div>
      </section>

      {/* Deeper ways to help */}
      <section className="bg-white border-y border-border-light">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-8">
            Go deeper
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Link
              href="/contribute/process"
              className="group p-6 rounded-xl border border-border-light hover:border-accent-sage/40 hover:shadow-sm transition-all"
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-accent-sage/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-accent-sage" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-primary mb-1 group-hover:text-accent-sage transition-colors">Process pages</h3>
                  <p className="text-sm text-secondary leading-relaxed">
                    Use your own free Gemini API key to OCR or translate pages.
                    Set your budget, pick a book, watch it come to life. Every page you process is permanently free for the world.
                  </p>
                </div>
              </div>
            </Link>

            <div className="p-6 rounded-xl border border-border-light">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-accent-gold/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-accent-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-primary mb-1">Suggest books</h3>
                  <p className="text-sm text-secondary leading-relaxed">
                    We import from 13 digital archives &mdash; Internet Archive, Gallica, the Bodleian, the Vatican, and more.
                    If you know of a text that belongs here, tell us and we&apos;ll add it.
                  </p>
                </div>
              </div>
            </div>

            <Link
              href="/blog"
              className="group p-6 rounded-xl border border-border-light hover:border-accent-rust/40 hover:shadow-sm transition-all"
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-accent-rust/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-accent-rust" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-primary mb-1 group-hover:text-accent-rust transition-colors">Write about the texts</h3>
                  <p className="text-sm text-secondary leading-relaxed">
                    Our blog features essays on the collection. A close reading, a thematic exploration, a translation commentary &mdash;
                    it doesn&apos;t need to be formal, just thoughtful.
                  </p>
                </div>
              </div>
            </Link>

            <Link
              href="/developers"
              className="group p-6 rounded-xl border border-border-light hover:border-accent-violet/40 hover:shadow-sm transition-all"
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-accent-violet/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-accent-violet" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-primary mb-1 group-hover:text-accent-violet transition-colors">Build with the API</h3>
                  <p className="text-sm text-secondary leading-relaxed">
                    REST API and MCP server for AI assistants. Search the collection, fetch translations, build tools on top of 2,500 years of primary sources.
                  </p>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="max-w-2xl">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-4">
            Get in touch
          </h2>
          <p className="text-secondary leading-relaxed mb-6">
            Want to help with translations? Have a text to suggest? Working on something related?
            I respond to everything.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <a
              href="mailto:derek@ancientwisdomtrust.org"
              className="inline-flex items-center gap-2 text-lg text-primary font-medium hover:text-accent-rust transition-colors"
            >
              derek@ancientwisdomtrust.org
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
            <Link
              href="/contribute/volunteer"
              className="inline-flex items-center gap-2 text-secondary hover:text-primary transition-colors"
            >
              or fill out the volunteer survey
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* Principles */}
      <footer className="border-t border-border-light">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <p className="text-muted text-sm leading-relaxed">
            Everything here is CC0 public domain. No paywalls, no login walls. AI translations are first drafts &mdash; the originals are always preserved alongside them. Published editions carry DOIs via Zenodo, so your contributions become citable scholarship.
          </p>
        </div>
      </footer>
    </div>
  );
}
