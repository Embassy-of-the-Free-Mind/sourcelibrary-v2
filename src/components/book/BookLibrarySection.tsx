'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Library, Globe, BookOpen, Languages } from 'lucide-react';

export interface LibrarySectionData {
  slug: string;
  name: string;
  shortName: string;
  url: string;
  description: string;
  color: 'rust' | 'sage' | 'violet' | 'gold';
  image?: string;
  stats: { books: number; languages: number; translated: number };
  covers: Array<{ slug: string; title: string; thumbnail?: string }>;
}

// Accent hexes tuned to the cream palette.
const ACCENT: Record<LibrarySectionData['color'], { fg: string; soft: string; line: string }> = {
  rust: { fg: '#a5503d', soft: '#f7ece8', line: '#e6d7d1' },
  gold: { fg: '#9a7526', soft: '#f7f1e2', line: '#e8ddc4' },
  sage: { fg: '#5f6f4e', soft: '#eef1e8', line: '#d9e0cd' },
  violet: { fg: '#6a5b8a', soft: '#f0edf5', line: '#ddd5e8' },
};

const fmt = (n: number) => n.toLocaleString('en-US');

function StatRow({ d, className = '' }: { d: LibrarySectionData; className?: string }) {
  const items = [
    { icon: BookOpen, label: 'books here', value: fmt(d.stats.books) },
    d.stats.languages > 1 ? { icon: Languages, label: d.stats.languages === 1 ? 'language' : 'languages', value: fmt(d.stats.languages) } : null,
    d.stats.translated > 0 ? { icon: Globe, label: 'translated', value: fmt(d.stats.translated) } : null,
  ].filter(Boolean) as Array<{ icon: typeof BookOpen; label: string; value: string }>;
  return (
    <div className={`flex flex-wrap gap-x-6 gap-y-2 ${className}`}>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-baseline gap-1.5">
          <span className="font-display font-medium text-[19px] md:text-[22px]" style={{ color: '#2b2620' }}>{it.value}</span>
          <span className="text-[12.5px] md:text-[13px]" style={{ color: '#8a8170' }}>{it.label}</span>
        </span>
      ))}
    </div>
  );
}

/* ============================ Variant A — Editorial split ============================ */
function VariantA({ d, a }: { d: LibrarySectionData; a: (typeof ACCENT)[keyof typeof ACCENT] }) {
  return (
    <div className="grid md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-8 md:gap-12 items-center">
      <div className="order-2 md:order-1">
        <div className="font-mono uppercase text-[11px] tracking-[0.16em] mb-3" style={{ color: a.fg }}>From the collection of</div>
        <h2 className="font-display font-medium text-[26px] md:text-[34px] leading-[1.08] mb-3" style={{ color: '#2b2620' }}>{d.name}</h2>
        <p className="text-[14.5px] md:text-[15.5px] leading-relaxed mb-6 max-w-[52ch]" style={{ color: '#5c5546' }}>{d.description}</p>
        <StatRow d={d} className="mb-7" />
        <Link href={`/libraries/${d.slug}`} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[14px] font-semibold text-white transition-colors hover:brightness-110" style={{ background: a.fg }}>
          Explore the collection <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      {d.image && (
        <div className="order-1 md:order-2">
          <div className="overflow-hidden border rounded-lg" style={{ borderColor: a.line, background: '#fff' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.image} alt={d.name} className="w-full h-[220px] md:h-[300px] object-cover" loading="lazy" />
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================ Variant B — Banner strip ============================ */
function VariantB({ d, a }: { d: LibrarySectionData; a: (typeof ACCENT)[keyof typeof ACCENT] }) {
  return (
    <div className="rounded-xl border p-5 md:p-7 flex flex-col md:flex-row md:items-center gap-5 md:gap-7" style={{ borderColor: a.line, background: a.soft }}>
      {d.image && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={d.image} alt={d.name} className="w-16 h-16 md:w-24 md:h-24 rounded-lg object-cover flex-shrink-0 border" style={{ borderColor: a.line }} loading="lazy" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-mono uppercase text-[10.5px] tracking-[0.16em] mb-1.5" style={{ color: a.fg }}>Part of this collection</div>
        <h2 className="font-display font-medium text-[21px] md:text-[26px] leading-tight mb-1.5" style={{ color: '#2b2620' }}>{d.name}</h2>
        <p className="text-[13.5px] md:text-[14.5px] leading-snug line-clamp-2 md:line-clamp-none max-w-[64ch]" style={{ color: '#6b6456' }}>{d.description}</p>
        <StatRow d={d} className="mt-4" />
      </div>
      <Link href={`/libraries/${d.slug}`} className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-[14px] font-semibold whitespace-nowrap self-start md:self-center transition-colors hover:brightness-110" style={{ background: a.fg, color: '#fff' }}>
        View all <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

/* ============================ Variant C — Crest / centered ============================ */
function VariantC({ d, a }: { d: LibrarySectionData; a: (typeof ACCENT)[keyof typeof ACCENT] }) {
  const tiles = [
    { label: 'in Source Library', value: fmt(d.stats.books) },
    d.stats.translated > 0 ? { label: 'translated to English', value: fmt(d.stats.translated) } : null,
    d.stats.languages > 1 ? { label: 'languages', value: fmt(d.stats.languages) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  return (
    <div className="max-w-[720px] mx-auto text-center">
      {d.image ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={d.image} alt={d.name} className="w-20 h-20 md:w-24 md:h-24 rounded-full object-cover mx-auto mb-5 border-2" style={{ borderColor: a.line }} loading="lazy" />
      ) : (
        <div className="w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center" style={{ background: a.soft }}><Library className="w-8 h-8" style={{ color: a.fg }} /></div>
      )}
      <div className="font-mono uppercase text-[11px] tracking-[0.16em] mb-2" style={{ color: a.fg }}>Part of the collection</div>
      <h2 className="font-display font-medium text-[26px] md:text-[32px] leading-tight mb-3" style={{ color: '#2b2620' }}>{d.name}</h2>
      <p className="text-[14.5px] md:text-[15.5px] leading-relaxed mb-7 mx-auto max-w-[56ch]" style={{ color: '#5c5546' }}>{d.description}</p>
      <div className="flex flex-wrap justify-center gap-3 md:gap-4 mb-7">
        {tiles.map((t) => (
          <div key={t.label} className="flex-1 min-w-[130px] max-w-[190px] rounded-lg border px-4 py-3" style={{ borderColor: a.line, background: '#fff' }}>
            <div className="font-display font-medium text-[24px] md:text-[27px]" style={{ color: a.fg }}>{t.value}</div>
            <div className="text-[12px] mt-0.5" style={{ color: '#8a8170' }}>{t.label}</div>
          </div>
        ))}
      </div>
      <Link href={`/libraries/${d.slug}`} className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-[14px] font-semibold text-white transition-colors hover:brightness-110" style={{ background: a.fg }}>
        Browse the collection <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

/* ============================ Variant D — Dark band + cover strip ============================ */
function VariantD({ d, a }: { d: LibrarySectionData; a: (typeof ACCENT)[keyof typeof ACCENT] }) {
  const covers = d.covers.filter((c) => c.thumbnail).slice(0, 12);
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#1a1612' }}>
      <div className="p-6 md:p-9 grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-7 md:gap-10 items-center">
        <div>
          <div className="font-mono uppercase text-[11px] tracking-[0.16em] mb-3" style={{ color: a.fg === '#a5503d' ? '#d98a72' : a.fg }}>Part of the collection</div>
          <h2 className="font-display font-medium text-[25px] md:text-[31px] leading-tight mb-3" style={{ color: '#f7f2ea' }}>{d.name}</h2>
          <p className="text-[13.5px] md:text-[14.5px] leading-relaxed mb-6 max-w-[46ch]" style={{ color: 'rgba(245,240,232,0.72)' }}>{d.description}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mb-6">
            {[
              { label: 'books here', value: fmt(d.stats.books) },
              d.stats.translated > 0 ? { label: 'translated', value: fmt(d.stats.translated) } : null,
              d.stats.languages > 1 ? { label: 'languages', value: fmt(d.stats.languages) } : null,
            ].filter(Boolean).map((it) => {
              const x = it as { label: string; value: string };
              return (
                <span key={x.label} className="inline-flex items-baseline gap-1.5">
                  <span className="font-display font-medium text-[20px] md:text-[22px]" style={{ color: '#f7f2ea' }}>{x.value}</span>
                  <span className="text-[12.5px]" style={{ color: 'rgba(245,240,232,0.6)' }}>{x.label}</span>
                </span>
              );
            })}
          </div>
          <Link href={`/libraries/${d.slug}`} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[14px] font-semibold text-white transition-colors hover:brightness-110" style={{ background: a.fg }}>
            Explore the collection <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        {covers.length > 0 && (
          <div className="-mx-6 md:mx-0 px-6 md:px-0 overflow-x-auto">
            <div className="flex gap-2.5 md:gap-3 md:grid md:grid-cols-6">
              {covers.map((c) => (
                <Link key={c.slug} href={`/book/${c.slug}`} className="block flex-shrink-0 w-[68px] md:w-auto">
                  <div className="aspect-[3/4] overflow-hidden rounded bg-black/30 border border-white/10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.thumbnail} alt={c.title} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const VARIANTS = ['A', 'B', 'C', 'D'] as const;
type Variant = (typeof VARIANTS)[number];
const LABEL: Record<Variant, string> = { A: 'Editorial', B: 'Banner', C: 'Crest', D: 'Dark strip' };

export default function BookLibrarySection({ data, showSwitcher = true }: { data: LibrarySectionData; showSwitcher?: boolean }) {
  const [v, setV] = useState<Variant>('A');
  const a = ACCENT[data.color];
  return (
    <section id="library-source" className="py-14 border-t scroll-mt-4" style={{ background: '#fdfcf9', borderColor: '#e6e0d3' }}>
      <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12">
        {showSwitcher && (
          <div className="flex flex-wrap items-center gap-2 mb-8">
            <span className="text-[11px] uppercase tracking-[0.12em] mr-1" style={{ color: '#a09884' }}>Design</span>
            {VARIANTS.map((key) => (
              <button
                key={key}
                onClick={() => setV(key)}
                className={`px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors border ${v === key ? 'text-white' : ''}`}
                style={v === key ? { background: a.fg, borderColor: a.fg } : { background: '#fff', borderColor: '#e0d9c9', color: '#6b6456' }}
              >
                {key} · {LABEL[key]}
              </button>
            ))}
          </div>
        )}
        {v === 'A' && <VariantA d={data} a={a} />}
        {v === 'B' && <VariantB d={data} a={a} />}
        {v === 'C' && <VariantC d={data} a={a} />}
        {v === 'D' && <VariantD d={data} a={a} />}
      </div>
    </section>
  );
}
