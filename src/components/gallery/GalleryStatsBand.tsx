'use client';

import type { GalleryStats } from '@/lib/gallery-stats';
import { useCountUp, fmt, yearLabel, statBox, PrintedBars, PrintedBox, ShareBox } from '@/components/search-kit/StatParts';

interface Props {
  stats: GalleryStats | null;
  /** The grid's own total: shown only until the band's exact count arrives (for plates-only it is a whole-collection estimate). */
  total: number | null;
  /** Images in the whole gallery, for "of N". */
  galleryTotal: number | null;
  /** Artworks a search found by title, which the stats route does not count. */
  titleArtworks: number;
  searched: boolean;
  stale: boolean;
  source: string;
  type: string;
  yearMin?: number;
  yearMax?: number;
  onYears: (from: number | null, to: number | null) => void;
  onType: (type: string) => void;
  onSource: (source: string) => void;
}

/** "woodcut" → "Woodcut"; the API's kinds are lower-case ids. */
const kindLabel = (k: string) => k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');

/**
 * The gallery in numbers, the Library's band for images: how many, the books
 * they come from (and standalone artworks), when they were printed, and what
 * kind of image they are. Every mark narrows the gallery. Four boxes on
 * desktop, two by two on a tablet, one line and a slim chart on a phone.
 */
export default function GalleryStatsBand({ stats, total, galleryTotal, titleArtworks, searched, stale, source, type, yearMin, yearMax, onYears, onType, onSource }: Props) {
  // Plain values for the JSX: the React Compiler hoists member access above conditional guards (ui-navigation.md).
  const images = stats ? stats.total + titleArtworks : (total ?? 0);
  const known = stats != null || total != null;
  const imagesShown = useCountUp(images);
  const books = stats?.books ?? 0;
  const artworks = (stats?.artworks ?? 0) + titleArtworks;
  const artworksOnly = source === 'artwork';
  const second = artworksOnly ? artworks : books;
  const secondShown = useCountUp(second);
  const imagesText = known ? fmt(imagesShown) : '—';
  const secondText = stats ? fmt(secondShown) : '—';
  const imagesLabel = searched
    ? `${images === 1 ? 'image' : 'images'} found${galleryTotal ? `, of ${fmt(galleryTotal)}` : ''}`
    : 'images in the gallery';
  const secondLabel = artworksOnly ? (artworks === 1 ? 'artwork' : 'artworks') : (books === 1 ? 'book illustrated' : 'books illustrated');
  const artworksText = `plus ${fmt(artworks)} ${artworks === 1 ? 'artwork' : 'artworks'}`;
  // Switching to artworks only is a browse filter; a search's title artworks are only described.
  const sourceLink = artworksOnly ? 'Show everything' : (stats?.artworks ?? 0) > 0 ? artworksText : '';
  const artworksNote = !sourceLink && titleArtworks > 0 ? artworksText : '';
  const printed = stats?.printed ?? [];
  const firstYear = yearLabel(stats?.yearFirst ?? null);
  const lastYear = yearLabel(stats?.yearLast ?? null);
  const kinds = (stats?.kinds ?? []).map((k) => ({ value: kindLabel(k.value), count: k.count, id: k.value }));
  const kindTitle = `${fmt(kinds.length)} ${kinds.length === 1 ? 'kind' : 'kinds'} of image`;
  const pickKind = (label: string) => {
    const id = kinds.find((k) => k.value === label)?.id ?? label;
    onType(type === id ? '' : id);
  };
  const selectedKinds = type ? [kindLabel(type)] : [];
  const muted = stale ? 'opacity-40 transition-opacity' : 'transition-opacity';
  const imagesWord = searched ? (images === 1 ? 'image found' : 'images found') : 'images';

  return (
    <>
    {/* Phones: one line of numbers and a slim printed chart, so the images start high. */}
    <section aria-label="What is in view" data-band="line" className={`sm:hidden mt-4 pt-2.5 border-t border-border-light ${muted}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px] text-secondary">
        <span><b className="font-semibold text-primary tabular-nums">{imagesText}</b> {imagesWord}</span>
        <span aria-hidden className="text-border-medium">·</span>
        <span><b className="font-semibold text-primary tabular-nums">{secondText}</b> {artworksOnly ? secondLabel : (books === 1 ? 'book' : 'books')}</span>
        <span aria-hidden className="text-border-medium">·</span>
        <span><b className="font-semibold text-primary tabular-nums">{fmt(kinds.length)}</b> {kinds.length === 1 ? 'kind' : 'kinds'}</span>
      </div>
      <div className="mt-2"><PrintedBars printed={printed} yearMin={yearMin} yearMax={yearMax} onYears={onYears} what="Images" className="h-[18px]" /></div>
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
        <div className="text-[28px] font-medium leading-tight tabular-nums text-primary">{imagesText}</div>
        <div className="text-[13px] text-muted mt-0.5 leading-snug">{imagesLabel}</div>
      </div>

      <div className={statBox}>
        <div className="text-[28px] font-medium leading-tight tabular-nums text-primary">{secondText}</div>
        <div className="text-[13px] text-muted mt-0.5 leading-snug">{secondLabel}</div>
        {artworksNote && <div className="mt-2 text-[12.5px] text-secondary">{artworksNote}</div>}
        {sourceLink && (
          <button type="button" onClick={() => onSource(artworksOnly ? '' : 'artwork')} className="mt-2 text-[12.5px] text-secondary underline underline-offset-[3px] hover:text-primary">
            {sourceLink}
          </button>
        )}
      </div>

      <PrintedBox printed={printed} yearMin={yearMin} yearMax={yearMax} onYears={onYears} what="Images" first={firstYear} last={lastYear} />

      <ShareBox title={kindTitle} parts={kinds} selected={selectedKinds} onPick={pickKind} />
    </section>
    </>
  );
}
