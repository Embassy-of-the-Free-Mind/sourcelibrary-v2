'use client';

import Link from 'next/link';
import { useLocalePath } from '@/lib/i18n';
import { ArrowRight } from 'lucide-react';

export interface LibrarySectionData {
  slug: string;
  name: string;
  shortName: string;
  url: string;
  description: string;
  color: 'rust' | 'sage' | 'violet' | 'gold';
  image?: string;
  logo?: string;
  stats: { books: number; languages: number; translated: number };
  covers: Array<{ slug: string; title: string; thumbnail?: string }>;
}

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * "Part of the collection" — the contributing digital library/source this book
 * came from. Light editorial layout: the library's logo + name, description and
 * stats on one side; a strip of that library's book covers on the other
 * (falling back to a single representative image).
 */
export default function BookLibrarySection({ data }: { data: LibrarySectionData }) {
  // Cover links keep the locale of the page this section is mounted on.
  const localePath = useLocalePath();
  const covers = data.covers.filter((c) => c.thumbnail).slice(0, 10);
  const hasCovers = covers.length >= 4;

  const stats = [
    { label: 'books', value: fmt(data.stats.books) },
    data.stats.translated > 0 ? { label: 'translated', value: fmt(data.stats.translated) } : null,
    data.stats.languages > 1 ? { label: 'languages', value: fmt(data.stats.languages) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

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
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_50%] gap-9 md:gap-10 items-center">
          {/* Text side */}
          <div className="min-w-0">
            <div className="uppercase text-[11px] font-medium tracking-[0.16em] mb-3" style={{ color: '#8a8170' }}>From the collection of</div>
            <h2 className="font-display font-medium text-[26px] md:text-[34px] leading-[1.08] mb-4" style={{ color: '#2b2620' }}>{data.name}</h2>
            <p className="text-[14.5px] md:text-[15.5px] leading-relaxed mb-6 max-w-[54ch]" style={{ color: '#5c5546' }}>{data.description}</p>

            {/* A small heading makes clear these counts are what Source Library
                holds from this library — not the library's total collection. */}
            <div className="mb-8">
              <div className="uppercase text-[10px] md:text-[10.5px] font-medium tracking-[0.14em] mb-2 md:mb-2.5" style={{ color: '#a89e88' }}>In the Source Library</div>
              <div className="flex flex-nowrap justify-between gap-2 md:flex-wrap md:justify-start md:gap-x-7 md:gap-y-2">
                {stats.map((s) => (
                  <span key={s.label} className="flex flex-col md:flex-row md:items-baseline md:gap-1.5 min-w-0">
                    <span className="font-display font-medium text-[15px] md:text-[24px] leading-none" style={{ color: '#2b2620' }}>{s.value}</span>
                    <span className="text-[10.5px] md:text-[13px] mt-0.5 md:mt-0 leading-tight" style={{ color: '#8a8170' }}>{s.label}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Mobile only: covers sit between the stats and the button. */}
            {hasCovers && <CoversStrip className="md:hidden mb-8" />}

            <Link
              href={`/libraries/${data.slug}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[14px] font-semibold text-white transition-colors hover:brightness-125"
              style={{ background: '#1a1612' }}
            >
              Explore the collection <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Collection side (desktop): a strip of the library's book covers. */}
          <div>
            {hasCovers ? (
              <CoversStrip className="hidden md:block" />
            ) : data.image ? (
              <div className="overflow-hidden border rounded-lg" style={{ borderColor: '#e6e0d3', background: '#fff' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.image} alt={data.name} className="w-full h-[220px] md:h-[300px] object-cover" loading="lazy" />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
