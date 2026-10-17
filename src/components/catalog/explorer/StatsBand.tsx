'use client';

import type { CatalogStats } from '@/lib/catalog/query';

/** The band's numbers: the server's exact stats, or counts over an asked result list. */
export interface BandStats extends Omit<CatalogStats, 'languages'> {
  languages: { value: string; count: number }[];
  /** Set when the numbers come from the first N works of a longer list. */
  sample?: number;
}

const SWATCHES = ['var(--text-primary)', 'var(--text-secondary)', 'var(--text-muted)'];
const OTHERS = 'var(--border-medium)';
const fmt = (n: number) => n.toLocaleString('en-GB');
const yearLabel = (y: number | null) => (y == null ? '' : y < 0 ? `${-y} BCE` : String(y));
const bucketLabel = (from: number | null, to: number | null) =>
  from == null ? `before ${(to ?? 0) + 1}` : to == null ? `${from} and after` : `${from}–${String(to).slice(2)}`;

interface Props {
  stats: BandStats | null;
  /** Works in the whole library, for "of N". */
  libraryTotal: number;
  searched: boolean;
  loading: boolean;
  stale: boolean;
  selectedLanguages: string[];
  yearMin?: number;
  yearMax?: number;
  hasTranslation: boolean;
  onYears: (from: number | null, to: number | null) => void;
  onLanguage: (lang: string) => void;
  onTranslated: () => void;
}

/**
 * The library in numbers under the search bars: the whole library before a
 * search, then whatever the search found. Every mark narrows the search.
 * Four boxes on desktop, two by two on a tablet, one swipeable row on a phone
 * so the results stay near the top.
 */
export default function StatsBand({ stats, libraryTotal, searched, loading, stale, selectedLanguages, yearMin, yearMax, hasTranslation, onYears, onLanguage, onTranslated }: Props) {
  // Everything the JSX shows is worked out here, as plain values: the React
  // Compiler hoists member access above conditional guards (ui-navigation.md).
  // No numbers (the count failed): dashes, never a previous search's figures.
  const total = stats?.total ?? 0;
  const translated = stats?.translated ?? 0;
  const totalText = stats ? fmt(total) : '—';
  const translatedText = stats ? `${stats.sample ? '~' : ''}${fmt(translated)}` : '—';
  const printed = stats?.printed ?? [];
  const maxBucket = Math.max(1, ...printed.map((p) => p.count));
  const bars = printed.map((p, i) => ({
    key: i,
    from: p.from,
    to: p.to,
    height: p.count ? Math.max(2, Math.round((40 * p.count) / maxBucket)) : 1,
    label: `${bucketLabel(p.from, p.to)}: ${fmt(p.count)}`,
    on: (yearMin != null || yearMax != null)
      && (yearMin == null || (p.to ?? 9999) >= yearMin)
      && (yearMax == null || (p.from ?? -9999) <= yearMax),
  }));
  const langs = (stats?.languages ?? []).filter((l) => l.count > 0);
  const top = langs.slice(0, 3);
  const rest = langs.slice(3).reduce((a, l) => a + l.count, 0);
  const langSum = top.reduce((a, l) => a + l.count, 0) + rest || 1;
  const languageTitle = `${fmt(searched ? langs.length : (stats?.languageCount ?? langs.length))} ${langs.length === 1 && searched ? 'language' : 'languages'}`;
  const topLangs = top.map((l, i) => ({ value: l.value, pct: Math.round((100 * l.count) / langSum), color: SWATCHES[i], flex: l.count, on: selectedLanguages.includes(l.value) }));
  const restPct = Math.round((100 * rest) / langSum);
  const worksLabel = searched ? `${total === 1 ? 'work' : 'works'} found, of ${fmt(libraryTotal)}` : 'works in the library';
  const firstYear = yearLabel(stats?.yearFirst ?? null);
  const lastYear = yearLabel(stats?.yearLast ?? null);
  const sampleNote = stats?.sample ? `Charts from the first ${fmt(stats.sample)}` : '';
  const showTranslatedLink = searched || hasTranslation;
  const translatedLink = hasTranslation ? 'Show all' : 'Only translated';

  const box = 'bg-warm border border-border-light px-3 pt-2.5 pb-2 sm:px-[18px] sm:pt-4 sm:pb-3.5 min-w-0 snap-start';
  const muted = stale || loading ? 'opacity-40 transition-opacity' : 'transition-opacity';

  return (
    <section
      aria-label="What is in view"
      className={`mt-4 sm:mt-7 flex gap-1.5 sm:gap-2 overflow-x-auto -mx-4 px-4 pb-1 snap-x snap-mandatory [scrollbar-width:none] sm:mx-0 sm:px-0 sm:grid sm:gap-3 sm:overflow-visible sm:grid-cols-2 lg:[grid-template-columns:1fr_1fr_1.6fr_1.6fr] ${muted}`}
    >
      <div className={`${box} flex-[0_0_34%] sm:flex-auto`}>
        <div className="text-[17px] sm:text-[28px] font-medium leading-tight tabular-nums text-primary">{totalText}</div>
        <div className="text-[11.5px] sm:text-[13px] text-muted sm:mt-0.5 leading-snug">{worksLabel}</div>
        {sampleNote && <div className="text-[11.5px] text-muted mt-1">{sampleNote}</div>}
      </div>

      <div className={`${box} flex-[0_0_34%] sm:flex-auto`}>
        <div className="text-[17px] sm:text-[28px] font-medium leading-tight tabular-nums text-primary">{translatedText}</div>
        <div className="text-[11.5px] sm:text-[13px] text-muted sm:mt-0.5 leading-snug">translated into English</div>
        {showTranslatedLink && (
          <button type="button" onClick={onTranslated} className="mt-1 sm:mt-2 text-[11.5px] sm:text-[12.5px] text-secondary underline underline-offset-[3px] hover:text-primary">
            {translatedLink}
          </button>
        )}
      </div>

      <div className={`${box} flex-[0_0_62%] sm:flex-auto`}>
        <div className="text-[11.5px] sm:text-[13px] text-muted mb-1 sm:mb-2">Printed</div>
        <div className="flex items-end gap-0.5 h-6 sm:h-10" role="group" aria-label="Works by half-century printed">
          {bars.map((b) => (
            <button
              key={b.key}
              type="button"
              title={b.label}
              aria-label={b.label}
              aria-pressed={b.on}
              onClick={() => onYears(b.from, b.to)}
              className={`flex-1 min-w-0 p-0 border-0 ${b.on ? 'bg-primary' : 'bg-border-medium'} hover:bg-accent-rust`}
              style={{ height: `${(100 * b.height) / 40}%` }}
            />
          ))}
        </div>
        <div className="flex justify-between text-[10.5px] sm:text-[11px] text-muted mt-0.5 sm:mt-1 tabular-nums">
          <span>{firstYear}</span>
          <span>{lastYear}</span>
        </div>
      </div>

      <div className={`${box} flex-[0_0_62%] sm:flex-auto`}>
        <div className="text-[11.5px] sm:text-[13px] text-muted mb-1 sm:mb-2">{languageTitle}</div>
        <div className="flex h-1.5 sm:h-2.5 gap-0.5" aria-hidden>
          {topLangs.map((l) => <i key={l.value} className="block h-full" style={{ flex: l.flex, background: l.color }} />)}
          {rest > 0 && <i className="block h-full" style={{ flex: rest, background: OTHERS }} />}
        </div>
        <div className="flex flex-wrap gap-x-2.5 sm:gap-x-3 gap-y-0.5 mt-1.5 sm:mt-2.5 text-[11px] sm:text-[12px] text-secondary">
          {topLangs.map((l) => (
            <button key={l.value} type="button" onClick={() => onLanguage(l.value)} aria-pressed={l.on} className="inline-flex items-center gap-1 sm:gap-1.5 p-0 border-0 bg-transparent text-[11px] sm:text-[12px] text-inherit group">
              <span className="w-2 h-2" style={{ background: l.color }} aria-hidden />
              <span className={`group-hover:underline underline-offset-2 ${l.on ? 'font-semibold' : ''}`}>{l.value}</span>
              <span className="text-muted tabular-nums">{l.pct}%</span>
            </button>
          ))}
          {rest > 0 && (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span className="w-2 h-2" style={{ background: OTHERS }} aria-hidden />others {restPct}%
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
