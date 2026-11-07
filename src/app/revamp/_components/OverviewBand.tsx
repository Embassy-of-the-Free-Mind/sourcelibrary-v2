'use client';

import { fmt, statBox, useCountUp, yearLabel, PrintedBox, ShareBox, type PrintedBucket } from '@/components/search-kit/StatParts';

export interface Overview {
  books: { total: number; translated: number; languages: { value: string; count: number }[]; languageCount: number; printed: PrintedBucket[]; yearFirst: number | null; yearLast: number | null } | null;
  images: { total: number; books: number; artworks: number; kinds: { value: string; count: number }[]; printed: PrintedBucket[]; yearFirst: number | null; yearLast: number | null } | null;
}

const nothing = () => {};
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Number_({ value, word, note }: { value: number; word: string; note?: string }) {
  const shown = useCountUp(value);
  return (
    <div className={statBox}>
      <div className="text-[32px] leading-none font-medium text-primary tabular-nums">{fmt(shown)}</div>
      <div className="text-[13.5px] text-muted mt-1.5">{word}</div>
      {note && <div className="text-[13px] text-secondary mt-1.5">{note}</div>}
    </div>
  );
}

/** The Library and Gallery stats band, for one collection or subject. */
export default function OverviewBand({ o }: { o: Overview }) {
  const b = o.books; const im = o.images;
  const hasBooks = !!b && b.total > 0;
  const hasImages = !!im && im.total > 0;
  if (!hasBooks && !hasImages) return null;
  const printed = hasBooks ? b : im!;
  const kinds = (im?.kinds ?? []).map((k) => ({ ...k, value: label(k.value) }));
  return (
    <div className="grid grid-cols-2 lg:grid-cols-[1fr_1fr_1.6fr_1.6fr] gap-2.5 sm:gap-3">
      {hasBooks && <Number_ value={b.total} word={b.total === 1 ? 'work' : 'works'} note={b.translated ? `${fmt(b.translated)} translated into English` : undefined} />}
      {hasImages && <Number_ value={im.total} word="images" note={im.artworks ? `plus ${fmt(im.artworks)} artworks` : `from ${fmt(im.books)} books`} />}
      {!hasBooks && hasImages && <Number_ value={im.books} word="books illustrated" />}
      {!hasImages && hasBooks && <Number_ value={b.languageCount} word={b.languageCount === 1 ? 'language' : 'languages'} />}
      <PrintedBox printed={printed.printed} onYears={nothing} what={hasBooks ? 'works' : 'images'} first={yearLabel(printed.yearFirst)} last={yearLabel(printed.yearLast)} />
      {hasBooks
        ? <ShareBox title={`${fmt(b.languageCount)} ${b.languageCount === 1 ? 'language' : 'languages'}`} parts={b.languages} selected={[]} onPick={nothing} />
        : <ShareBox title={`${kinds.length} kinds of image`} parts={kinds} selected={[]} onPick={nothing} />}
    </div>
  );
}
