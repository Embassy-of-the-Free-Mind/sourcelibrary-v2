'use client';

import Link from 'next/link';
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
  const covers = data.covers.filter((c) => c.thumbnail).slice(0, 10);
  const hasCovers = covers.length >= 4;

  const stats = [
    { label: 'books on Source Library', value: fmt(data.stats.books) },
    data.stats.translated > 0 ? { label: 'translated', value: fmt(data.stats.translated) } : null,
    data.stats.languages > 1 ? { label: 'languages', value: fmt(data.stats.languages) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const CoversStrip = ({ className = '' }: { className?: string }) => (
    <div className={`-mx-6 px-6 md:mx-0 md:px-0 overflow-x-auto md:overflow-visible ${className}`}>
      <div className="flex gap-3 md:grid md:grid-cols-5">
        {covers.map((c) => (
          <Link key={c.slug} href={`/book/${c.slug}`} className="block flex-shrink-0 w-[84px] md:w-auto group">
            <div className="aspect-[3/4] overflow-hidden rounded border transition-shadow group-hover:shadow-md" style={{ borderColor: '#e6e0d3', background: '#fff' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.thumbnail} alt={c.title} className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105" loading="lazy" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );

  return (
    <section id="library-source" className="py-14 border-t scroll-mt-4" style={{ borderColor: '#e6e0d3', background: 'linear-gradient(180deg, #fdfcf9 0%, #f0e8db 100%)' }}>
      <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12">
        <div className="grid md:grid-cols-2 gap-9 md:gap-14 items-center">
          {/* Text side */}
          <div>
            <div className="uppercase text-[11px] font-medium tracking-[0.16em] mb-3" style={{ color: '#8a8170' }}>From the collection of</div>
            {data.logo && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={data.logo} alt="" className="h-8 md:h-10 w-auto max-w-[260px] object-contain object-left mb-3" loading="lazy" />
            )}
            <h2 className="font-display font-medium text-[26px] md:text-[34px] leading-[1.08] mb-4" style={{ color: '#2b2620' }}>{data.name}</h2>
            <p className="text-[14.5px] md:text-[15.5px] leading-relaxed mb-6 max-w-[54ch]" style={{ color: '#5c5546' }}>{data.description}</p>

            <div className="flex flex-wrap gap-x-7 gap-y-2 mb-8">
              {stats.map((s) => (
                <span key={s.label} className="inline-flex items-baseline gap-1.5">
                  <span className="font-display font-medium text-[21px] md:text-[24px]" style={{ color: '#2b2620' }}>{s.value}</span>
                  <span className="text-[12.5px] md:text-[13px]" style={{ color: '#8a8170' }}>{s.label}</span>
                </span>
              ))}
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
