'use client';

import Link from 'next/link';
import { useLocalePath } from '@/lib/i18n';
import { ArrowRight } from 'lucide-react';

export interface LibrarySectionData {
  /** The holding institution, or "From the scans on Internet Archive" when no holder is recorded. */
  heading: string;
  /** One short line about the institution (its Wikidata description). */
  description?: string;
  /** Who holds it, who digitised it, what Source Library did. See src/lib/book-provenance.ts. */
  sentence: string;
  covers: Array<{ slug: string; title: string; thumbnail?: string }>;
  /** Only where a page lists exactly these books (a partner library page). */
  explore?: { href: string; label: string };
  /** "Scans from Internet Archive ↗", to this book's original record. */
  via?: { label: string; host: string; href: string };
  /** This book's own scan, shown when there are too few covers for a strip. */
  ownImage?: string;
}

/**
 * Where this book comes from: the institution that holds it (never a
 * platform; see the book page), what Source Library did, and where the scans
 * came from. The holder's other books sit on the right; with too few of them,
 * this book's own page instead.
 */
export default function BookLibrarySection({ data }: { data: LibrarySectionData }) {
  // Cover links keep the locale of the page this section is mounted on.
  const localePath = useLocalePath();
  const covers = data.covers.filter((c) => c.thumbnail).slice(0, 10);
  const hasCovers = covers.length >= 4;

  const CoversStrip = ({ className = '' }: { className?: string }) => (
    <div className={`-mx-6 px-6 md:mx-0 md:px-0 overflow-x-auto md:overflow-visible snap-x snap-mandatory scroll-px-6 [scrollbar-width:none] [-webkit-overflow-scrolling:touch] ${className}`}>
      <div className="flex gap-3 md:grid md:grid-cols-5">
        {covers.map((c) => (
          <Link key={c.slug} href={localePath(`/book/${c.slug}`)} className="block flex-shrink-0 w-[104px] md:w-auto snap-start group">
            <div className="aspect-[3/4] overflow-hidden border transition-shadow group-hover:shadow-md" style={{ borderColor: '#e6e0d3', background: '#fff' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.thumbnail} alt={c.title} className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105" loading="lazy" />
            </div>
            <div className="mt-1.5 text-[11.5px] leading-snug line-clamp-2 transition-colors group-hover:text-[#a5503d]" style={{ color: '#6b6456' }}>{c.title}</div>
          </Link>
        ))}
      </div>
    </div>
  );

  return (
    <section id="library-source" className="py-14 border-t scroll-mt-4" style={{ borderColor: '#e6e0d3', background: 'linear-gradient(180deg, #fdfcf9 0%, #f8f2ea 100%)' }}>
      <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12">
        <div className={`grid grid-cols-1 gap-9 md:gap-10 items-center ${hasCovers || data.ownImage ? 'md:grid-cols-[minmax(0,1fr)_50%]' : ''}`}>
          {/* Text side */}
          <div className="min-w-0">
            <h2 className="font-display font-medium text-[26px] md:text-[34px] leading-[1.08] mb-1.5" style={{ color: '#2b2620' }}>{data.heading}</h2>
            {data.description && (
              <p className="text-[14px] mb-4" style={{ color: '#8a8170' }}>{data.description}</p>
            )}
            {data.sentence && (
              <p className="text-[14.5px] md:text-[15.5px] leading-relaxed mt-3 mb-7 max-w-[52ch]" style={{ color: '#5c5546' }}>{data.sentence}</p>
            )}

            {/* Mobile only: covers sit between the sentence and the button. */}
            {hasCovers && <CoversStrip className="md:hidden mb-8" />}

            {data.explore && (
              <Link
                href={data.explore.href}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[14px] font-semibold text-white transition-colors hover:brightness-125"
                style={{ background: '#1a1612' }}
              >
                {data.explore.label} <ArrowRight className="w-4 h-4" />
              </Link>
            )}
            {data.via && (
              <p className={`text-[13.5px] ${data.explore ? 'mt-3.5' : ''}`} style={{ color: '#8a8170' }}>
                {data.via.label}{' '}
                <a
                  href={data.via.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline underline-offset-[3px] decoration-[#e6e0d3] hover:decoration-[#2b2620] transition-colors"
                  style={{ color: '#2b2620' }}
                >
                  {data.via.host} ↗
                </a>
              </p>
            )}
          </div>

          {/* Right side (desktop): the holder's other books, or this book's own page. */}
          {hasCovers ? (
            <div><CoversStrip className="hidden md:block" /></div>
          ) : data.ownImage ? (
            <div className="flex justify-center">
              {/* Whole page at its own proportions, never cropped. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.ownImage} alt="" className="max-w-full max-h-[340px] w-auto h-auto border" style={{ borderColor: '#e6e0d3', background: '#fff' }} loading="lazy" />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
