'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import Link from 'next/link';

/* ── Historical eras ── */
interface Era {
  name: string;
  label: string;
  from: number;
  to: number;
  color: string;
  hex: string; // needed for SVG/style where CSS vars don't work
}

const ERAS: Era[] = [
  { name: 'antiquity', label: 'Antiquity', from: -3000, to: 500, color: 'var(--accent-sage)', hex: '#8b9a7d' },
  { name: 'medieval', label: 'Medieval', from: 500, to: 1400, color: 'var(--accent-gold)', hex: '#c9a86c' },
  { name: 'renaissance', label: 'Renaissance', from: 1400, to: 1550, color: 'var(--accent-rust)', hex: '#9e4a3a' },
  { name: 'reformation', label: 'Reformation', from: 1550, to: 1650, color: 'var(--accent-violet)', hex: '#7c5db5' },
  { name: 'enlightenment', label: 'Enlightenment', from: 1650, to: 1800, color: '#6b8a9e', hex: '#6b8a9e' },
  { name: 'modern', label: 'Modern', from: 1800, to: 2100, color: '#8a8480', hex: '#8a8480' },
];

function getEra(decade: number): Era | undefined {
  return ERAS.find(e => decade >= e.from && decade < e.to);
}

/* ── Language colors (hex for dark bg) ── */
const LANG_COLORS: Record<string, string> = {
  Latin: '#c27a6a',
  German: '#a3b396',
  French: '#a08ad0',
  English: '#d4be8a',
  Italian: '#94a685',
  Hebrew: '#c9a080',
  Arabic: '#a09585',
  Greek: '#89a8bc',
};
const DEFAULT_COLOR = '#706b66';
function getLangColor(lang: string): string {
  return LANG_COLORS[lang] || DEFAULT_COLOR;
}

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
  const [hoveredDecade, setHoveredDecade] = useState<DecadeBucket | null>(null);
  const [hoveredEra, setHoveredEra] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Animate in on scroll
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true); },
      { threshold: 0.15 }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const maxCount = useMemo(() => Math.max(...decades.map(d => d.count), 1), [decades]);

  // Group decades by era
  const eraGroups = useMemo(() => {
    if (!decades.length) return [];
    const result: { era: Era; startIndex: number; span: number; count: number }[] = [];
    let currentEra = getEra(decades[0].decade);
    let startIndex = 0;
    let span = 0;
    let count = 0;

    for (let i = 0; i < decades.length; i++) {
      const era = getEra(decades[i].decade);
      if (era?.name !== currentEra?.name) {
        if (currentEra) result.push({ era: currentEra, startIndex, span, count });
        currentEra = era;
        startIndex = i;
        span = 0;
        count = 0;
      }
      span++;
      count += decades[i].count;
    }
    if (currentEra) result.push({ era: currentEra, startIndex, span, count });
    return result;
  }, [decades]);

  // Top languages for legend
  const topLangs = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of decades) {
      for (const l of d.languages) {
        counts[l.lang] = (counts[l.lang] || 0) + l.count;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [decades]);

  if (decades.length === 0) return null;

  return (
    <section
      ref={containerRef}
      className="relative -mx-6 sm:-mx-8 lg:-mx-12 mt-16 overflow-hidden"
    >
      {/* Dark background */}
      <div className="bg-gradient-to-b from-[#1e1914] via-[#1a1612] to-[#141210] px-6 sm:px-8 lg:px-12 py-12 sm:py-16">
        {/* Header */}
        <div className="max-w-5xl mx-auto mb-10 text-center">
          <h2 className="font-serif text-2xl sm:text-3xl text-stone-200 mb-3 tracking-tight">
            Three millennia of hidden knowledge
          </h2>
          <p className="text-stone-500 text-sm sm:text-base font-body max-w-xl mx-auto leading-relaxed">
            {total.toLocaleString()} texts spanning antiquity to the Enlightenment.
            Tap any era to explore its books.
          </p>
        </div>

        {/* Histogram */}
        <div className="max-w-5xl mx-auto">
          {/* Bars */}
          <div
            className={`flex items-end gap-px relative transition-all duration-1000 ease-out ${
              isVisible ? 'opacity-100' : 'opacity-0 translate-y-4'
            }`}
            style={{ height: 200 }}
          >
            {decades.map((d, i) => {
              const heightPct = Math.max(1.5, (d.count / maxCount) * 100);
              const era = getEra(d.decade);
              const isEraHovered = hoveredEra === era?.name;
              const isBarHovered = hoveredDecade?.decade === d.decade;
              const top3 = d.languages.slice(0, 3);
              const rest = d.count - top3.reduce((s, l) => s + l.count, 0);

              return (
                <Link
                  key={d.decade}
                  href={`/timeline?decade=${d.decade}`}
                  className="flex-1 relative group"
                  style={{
                    minWidth: 3,
                    height: '100%',
                    transitionDelay: isVisible ? `${i * 8}ms` : '0ms',
                  }}
                  onMouseEnter={() => { setHoveredDecade(d); setHoveredEra(era?.name || null); }}
                  onMouseLeave={() => { setHoveredDecade(null); setHoveredEra(null); }}
                >
                  {/* Tooltip */}
                  {isBarHovered && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 pointer-events-none">
                      <div className="bg-stone-900 border border-stone-700/50 text-white text-[11px] rounded-lg px-3 py-2 whitespace-nowrap shadow-xl">
                        <div className="font-serif text-sm">
                          {d.decade < 0 ? `${Math.abs(d.decade)}s BC` : `${d.decade}s`}
                        </div>
                        <div className="text-stone-400 mt-0.5">
                          {d.count} {d.count === 1 ? 'text' : 'texts'}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Bar */}
                  <div className="absolute bottom-0 left-0 right-0">
                    <div
                      className={`rounded-t-[2px] overflow-hidden transition-all duration-500 ease-out ${
                        isVisible ? '' : 'scale-y-0 origin-bottom'
                      } ${
                        isBarHovered
                          ? 'brightness-125'
                          : isEraHovered
                            ? 'opacity-90'
                            : 'opacity-50 group-hover:opacity-90'
                      }`}
                      style={{
                        height: isVisible ? `${(heightPct / 100) * 200}px` : '0px',
                        transitionDelay: isVisible ? `${i * 8}ms` : '0ms',
                      }}
                    >
                      <div className="w-full h-full flex flex-col-reverse">
                        {rest > 0 && (
                          <div style={{ height: `${(rest / d.count) * 100}%`, backgroundColor: DEFAULT_COLOR }} />
                        )}
                        {[...top3].reverse().map(l => (
                          <div
                            key={l.lang}
                            style={{ height: `${(l.count / d.count) * 100}%`, backgroundColor: getLangColor(l.lang) }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Era labels — large, serif, interactive */}
          <div
            className={`flex mt-4 pt-3 border-t border-stone-700/30 transition-all duration-700 delay-500 ${
              isVisible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {eraGroups.map(({ era, span, count }) => (
              <Link
                key={era.name}
                href={`/timeline?era=${era.name}`}
                className="text-center group"
                style={{ flex: `${span} 1 0%` }}
                onMouseEnter={() => setHoveredEra(era.name)}
                onMouseLeave={() => setHoveredEra(null)}
              >
                {/* Era color bar */}
                <div
                  className="h-0.5 mx-1 sm:mx-2 mb-2 rounded-full transition-all duration-300"
                  style={{
                    backgroundColor: era.hex,
                    opacity: hoveredEra === era.name ? 0.8 : 0.25,
                    transform: hoveredEra === era.name ? 'scaleY(2)' : 'scaleY(1)',
                  }}
                />
                <div className="flex flex-col items-center gap-0.5">
                  <span
                    className="text-[10px] sm:text-xs lg:text-sm font-serif tracking-wide transition-colors duration-300 leading-tight"
                    style={{ color: hoveredEra === era.name ? era.hex : '#78716c' }}
                  >
                    {era.label}
                  </span>
                  <span
                    className="text-[9px] sm:text-[10px] transition-colors duration-300 hidden sm:block"
                    style={{ color: hoveredEra === era.name ? '#a8a29e' : '#57534e' }}
                  >
                    {count.toLocaleString()} texts
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {/* Language legend + link */}
          <div
            className={`flex flex-wrap items-center justify-between mt-6 pt-4 border-t border-stone-800/50 transition-all duration-700 delay-700 ${
              isVisible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] sm:text-xs text-stone-600">
              {topLangs.map(([lang]) => (
                <span key={lang} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: getLangColor(lang) }} />
                  {lang}
                </span>
              ))}
            </div>
            <Link
              href="/timeline"
              className="text-xs text-stone-600 hover:text-stone-300 transition-colors group flex items-center gap-1.5"
            >
              <span>Explore the full timeline</span>
              <span className="group-hover:translate-x-0.5 transition-transform">&rarr;</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
