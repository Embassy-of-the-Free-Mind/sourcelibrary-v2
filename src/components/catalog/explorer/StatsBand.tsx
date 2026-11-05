'use client';

import type { CatalogStats } from '@/lib/catalog/query';
import { useCountUp, fmt, yearLabel, statBox, PrintedBars, PrintedBox, ShareBox } from '@/components/search-kit/StatParts';

/** The band's numbers: the server's exact stats, or counts over an asked result list. */
export interface BandStats extends Omit<CatalogStats, 'languages'> {
  languages: { value: string; count: number }[];
  /** Set when the numbers come from the first N works of a longer list. */
  sample?: number;
}

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
 * Four boxes on desktop, two by two on a tablet; on a phone, one line of
 * numbers and a slim printed chart, so the books start near the top.
 */
export default function StatsBand({ stats, libraryTotal, searched, loading, stale, selectedLanguages, yearMin, yearMax, hasTranslation, onYears, onLanguage, onTranslated }: Props) {
  // Everything the JSX shows is worked out here, as plain values: the React
  // Compiler hoists member access above conditional guards (ui-navigation.md).
  // No numbers (the count failed): dashes, never a previous search's figures.
  const total = stats?.total ?? 0;
  const translated = stats?.translated ?? 0;
  const totalShown = useCountUp(total);
  const translatedShown = useCountUp(translated);
  const totalText = stats ? fmt(totalShown) : '–';
  const translatedText = stats ? `${stats.sample ? '~' : ''}${fmt(translatedShown)}` : '–';
  const printed = stats?.printed ?? [];
  const langs = (stats?.languages ?? []).filter((l) => l.count > 0);
  const languageTitle = `${fmt(searched ? langs.length : (stats?.languageCount ?? langs.length))} ${langs.length === 1 && searched ? 'language' : 'languages'}`;
  const worksLabel = searched ? `${total === 1 ? 'work' : 'works'} found, of ${fmt(libraryTotal)}` : 'works in the library';
  const firstYear = yearLabel(stats?.yearFirst ?? null);
  const lastYear = yearLabel(stats?.yearLast ?? null);
  const sampleNote = stats?.sample ? `Charts from the first ${fmt(stats.sample)}` : '';
  const showTranslatedLink = searched || hasTranslation;
  const translatedLink = hasTranslation ? 'Show all' : 'Only translated';

  const muted = stale || loading ? 'opacity-40 transition-opacity' : 'transition-opacity';
  const languageCount = fmt(searched ? langs.length : (stats?.languageCount ?? langs.length));
  const worksWord = searched ? (total === 1 ? 'work found' : 'works found') : 'works';

  return (
    <>
    {/* Phones: one line of numbers and a slim printed chart, so the books start high. */}
    <section aria-label="What is in view" data-band="line" className={`sm:hidden mt-4 pt-2.5 border-t border-border-light ${muted}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px] text-secondary">
        <span><b className="font-semibold text-primary tabular-nums">{totalText}</b> {worksWord}</span>
        <span aria-hidden className="text-border-medium">·</span>
        {showTranslatedLink ? (
          <button type="button" onClick={onTranslated} aria-pressed={hasTranslation} className="p-0 border-0 bg-transparent text-[13px] text-secondary underline decoration-border-medium underline-offset-[3px]">
            <b className="font-semibold text-primary tabular-nums">{translatedText}</b> translated
          </button>
        ) : (
          <span><b className="font-semibold text-primary tabular-nums">{translatedText}</b> translated</span>
        )}
        <span aria-hidden className="text-border-medium">·</span>
        <span><b className="font-semibold text-primary tabular-nums">{languageCount}</b> {langs.length === 1 && searched ? 'language' : 'languages'}</span>
      </div>
      {sampleNote && <div className="text-[11px] text-muted mt-0.5">{sampleNote}</div>}
      <div className="mt-2"><PrintedBars printed={printed} yearMin={yearMin} yearMax={yearMax} onYears={onYears} what="Works" className="h-[18px]" /></div>
      <div className="flex justify-between text-[10.5px] text-muted mt-0.5 tabular-nums">
        <span>{firstYear}</span>
        <span>{lastYear}</span>
      </div>
    </section>

    {/* Tablet and desktop: four boxes. */}
    <section
      aria-label="What is in view"
      data-band="boxes"
      className={`hidden sm:grid mt-7 gap-3 grid-cols-2 lg:[grid-template-columns:1fr_1fr_1.6fr_1.6fr] ${muted}`}
    >
      <div className={statBox}>
        <div className="text-[28px] font-medium leading-tight tabular-nums text-primary">{totalText}</div>
        <div className="text-[13px] text-muted mt-0.5 leading-snug">{worksLabel}</div>
        {sampleNote && <div className="text-[11.5px] text-muted mt-1">{sampleNote}</div>}
      </div>

      <div className={statBox}>
        <div className="text-[28px] font-medium leading-tight tabular-nums text-primary">{translatedText}</div>
        <div className="text-[13px] text-muted mt-0.5 leading-snug">translated into English</div>
        {showTranslatedLink && (
          <button type="button" onClick={onTranslated} className="mt-2 text-[12.5px] text-secondary underline underline-offset-[3px] hover:text-primary">
            {translatedLink}
          </button>
        )}
      </div>

      <PrintedBox printed={printed} yearMin={yearMin} yearMax={yearMax} onYears={onYears} what="Works" first={firstYear} last={lastYear} />

      <ShareBox title={languageTitle} parts={langs} selected={selectedLanguages} onPick={onLanguage} />
    </section>
    </>
  );
}
