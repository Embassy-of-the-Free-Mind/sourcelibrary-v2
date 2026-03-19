'use client';

import { useMemo, useRef, useEffect, useState } from 'react';
import Link from 'next/link';

/* ── Historical eras ── */
interface Era {
  name: string;
  label: string;
  from: number;
  to: number;
  color: string;
  tagline: string;
}

const ERAS: Era[] = [
  {
    name: 'antiquity',
    label: 'Antiquity',
    from: -3000,
    to: 500,
    color: '#8b9a7d',
    tagline: 'Hermes, Plato, and the Neoplatonists',
  },
  {
    name: 'medieval',
    label: 'Medieval',
    from: 500,
    to: 1400,
    color: '#c9a86c',
    tagline: 'Alchemy enters the Latin West',
  },
  {
    name: 'renaissance',
    label: 'Renaissance',
    from: 1400,
    to: 1550,
    color: '#9e4a3a',
    tagline: 'Ficino, Pico, and the prisca theologia',
  },
  {
    name: 'reformation',
    label: 'Reformation',
    from: 1550,
    to: 1650,
    color: '#7c5db5',
    tagline: 'Paracelsus, Dee, Fludd, and the Rosicrucians',
  },
  {
    name: 'enlightenment',
    label: 'Enlightenment',
    from: 1650,
    to: 1800,
    color: '#6b8a9e',
    tagline: 'Freemasonry and the occult underground',
  },
  {
    name: 'modern',
    label: 'Modern',
    from: 1800,
    to: 2100,
    color: '#8a8480',
    tagline: 'Revival, Theosophy, and scholarship',
  },
];

export interface DecadeBucket {
  decade: number;
  count: number;
  languages: { lang: string; count: number }[];
}

interface Props {
  decades: DecadeBucket[];
  total: number;
}

export default function EraTimeline({ decades, total }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true); },
      { threshold: 0.1 }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Compute era-level stats
  const eraStats = useMemo(() => {
    return ERAS.map(era => {
      const eraDecades = decades.filter(d => d.decade >= era.from && d.decade < era.to);
      const count = eraDecades.reduce((sum, d) => sum + d.count, 0);

      // Top languages for this era
      const langCounts: Record<string, number> = {};
      for (const d of eraDecades) {
        for (const l of d.languages) {
          langCounts[l.lang] = (langCounts[l.lang] || 0) + l.count;
        }
      }
      const topLangs = Object.entries(langCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([lang]) => lang);

      return { era, count, topLangs, decades: eraDecades };
    }).filter(e => e.count > 0);
  }, [decades]);

  const maxCount = useMemo(
    () => Math.max(...eraStats.map(e => e.count), 1),
    [eraStats]
  );

  if (eraStats.length === 0) return null;

  return (
    <section
      ref={containerRef}
      className="relative -mx-6 sm:-mx-8 lg:-mx-12 mt-16 overflow-hidden"
    >
      <div className="bg-gradient-to-b from-[#1e1914] via-[#1a1612] to-[#141210] px-6 sm:px-8 lg:px-12 py-12 sm:py-16">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <h2 className="font-serif text-2xl sm:text-3xl text-stone-200 mb-3 tracking-tight">
              Browse by era
            </h2>
            <p className="text-stone-500 text-sm font-body">
              {total.toLocaleString()} texts across three millennia
            </p>
          </div>

          {/* Vertical era list */}
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[23px] sm:left-[31px] top-0 bottom-0 w-px bg-stone-700/40" />

            <div className="space-y-1">
              {eraStats.map(({ era, count, topLangs }, i) => {
                const barWidth = Math.max(8, (count / maxCount) * 100);

                return (
                  <Link
                    key={era.name}
                    href={`/timeline?era=${era.name}`}
                    className={`group relative flex items-center gap-4 sm:gap-6 py-4 sm:py-5 pl-2 pr-4 rounded-xl transition-all duration-500 ease-out hover:bg-white/[0.03] ${
                      isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'
                    }`}
                    style={{ transitionDelay: isVisible ? `${i * 120}ms` : '0ms' }}
                  >
                    {/* Era dot on the timeline */}
                    <div className="relative z-10 shrink-0">
                      <div
                        className="w-[12px] h-[12px] sm:w-[14px] sm:h-[14px] rounded-full border-2 transition-all duration-300 group-hover:scale-125"
                        style={{
                          borderColor: era.color,
                          backgroundColor: 'transparent',
                        }}
                      />
                      {/* Glow on hover */}
                      <div
                        className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-40 transition-opacity duration-300 blur-sm"
                        style={{ backgroundColor: era.color }}
                      />
                    </div>

                    {/* Era info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-3 mb-1.5">
                        <h3
                          className="font-serif text-lg sm:text-xl transition-colors duration-300 leading-none"
                          style={{ color: era.color }}
                        >
                          {era.label}
                        </h3>
                        <span className="text-[11px] text-stone-600 font-sans tabular-nums shrink-0">
                          {era.from < 0 ? `${Math.abs(era.from)} BC` : era.from}&ndash;{era.to}
                        </span>
                      </div>

                      {/* Bar */}
                      <div className="relative h-2 rounded-full bg-white/[0.04] overflow-hidden mb-2">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ease-out ${
                            isVisible ? '' : 'scale-x-0 origin-left'
                          }`}
                          style={{
                            width: `${barWidth}%`,
                            backgroundColor: era.color,
                            opacity: 0.6,
                            transitionDelay: isVisible ? `${i * 120 + 200}ms` : '0ms',
                          }}
                        />
                      </div>

                      {/* Tagline + meta */}
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-xs text-stone-500 font-body truncate group-hover:text-stone-400 transition-colors">
                          {era.tagline}
                        </p>
                        <span className="text-xs text-stone-600 shrink-0 tabular-nums">
                          {count.toLocaleString()} texts
                        </span>
                      </div>

                      {/* Language tags */}
                      {topLangs.length > 0 && (
                        <div className="flex gap-1.5 mt-2">
                          {topLangs.map(lang => (
                            <span
                              key={lang}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-stone-500"
                            >
                              {lang}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Arrow */}
                    <span className="text-stone-600 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0">
                      &rarr;
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Footer link */}
          <div className="text-center mt-10 pt-6 border-t border-stone-800/40">
            <Link
              href="/timeline"
              className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-stone-300 transition-colors group"
            >
              <span className="font-serif">Explore the full timeline</span>
              <span className="group-hover:translate-x-0.5 transition-transform">&rarr;</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
