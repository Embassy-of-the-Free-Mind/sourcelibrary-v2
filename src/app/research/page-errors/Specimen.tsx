/**
 * Specimen — one class of page error on a real page: the scan crop, what was served, what it should be (#5613).
 *
 * PRIOR ART: ../quality/ErrorLadder.tsx (scan crop beside reference and engine read, segment marks) and
 * ../quality/page.tsx SpecimenRow. The marks and segment renderer are imported from ErrorLadder; this file
 * adds the served/should-be layout, which shows several served panes (transcription, English) against one
 * corrected reading. Data: src/data/page-errors.json. Server component; no client state.
 */
import type { ReactNode } from 'react';
import { KIND_CLASS, Segments, type Kind, type Seg } from '../quality/ErrorLadder';

type Crop = { x: number; y: number; w: number; h: number };
type Pane = { label?: string; lang?: string; dir?: string; segs: Seg[] };
export type SpecimenData = {
  key: string;
  cls: string;
  title: string;
  book: string;
  bookId: string;
  page: number;
  image: string;
  size: number[];
  crop: Crop;
  alt: string;
  scan: string;
  served: Pane[];
  should: Pane;
  note: string;
  servedOn: string;
  credit: { text: string; href?: string };
};

export const pageHref = (bookId: string, page: number) => `https://sourcelibrary.org/book/${bookId}?page=${page}`;

function ScanCrop({ s }: { s: SpecimenData }) {
  const { x, y, w, h } = s.crop;
  const W = s.size[0];
  return (
    <div className="relative overflow-hidden rounded border border-light bg-white" style={{ aspectRatio: `${w} / ${h}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={s.image}
        alt={s.alt}
        loading="lazy"
        className="absolute max-w-none"
        style={{ width: `${(W / w) * 100}%`, left: `${(-x / w) * 100}%`, top: `${(-y / h) * 100}%` }}
      />
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="text-xs uppercase tracking-wider text-muted mb-1.5">{children}</div>;
}

export function SpecimenLegend() {
  const items: [Kind, string][] = [
    ['wrong', 'served, but the scan shows something else'],
    ['missing', 'on the scan, or in the source, and not served'],
    ['invented', 'served, with nothing on the leaf behind it'],
  ];
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted">
      {items.map(([k, text]) => (
        <li key={k}><span className={`${KIND_CLASS[k]} text-sm`}>abc</span> {text}</li>
      ))}
    </ul>
  );
}

export default function Specimen({ s }: { s: SpecimenData }) {
  const vertical = s.crop.h > s.crop.w;
  return (
    <figure id={`specimen-${s.key}`} className="mt-5 mb-2 border border-light rounded bg-white/60 p-4 scroll-mt-24">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
        <span className="text-base text-primary font-semibold">Specimen. {s.title}</span>
        <a href={pageHref(s.bookId, s.page)} className="text-sm text-accent-rust hover:underline">{s.book}</a>
      </figcaption>
      <div className={vertical ? 'grid gap-4 grid-cols-[6rem_1fr] sm:grid-cols-[9rem_1fr]' : 'grid gap-4'}>
        <div>
          <Label>Scan</Label>
          <ScanCrop s={s} />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-secondary leading-relaxed mb-4"><span className="font-semibold text-primary">On the scan.</span> {s.scan}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="min-w-0 space-y-3">
              {s.served.map((p, i) => (
                <div key={i}>
                  <Label>Served{p.label ? `: ${p.label.toLowerCase()}` : ''}</Label>
                  <Segments segs={p.segs} lang={p.lang} dir={p.dir} />
                </div>
              ))}
            </div>
            <div className="min-w-0">
              <Label>What it should be</Label>
              <Segments segs={s.should.segs} lang={s.should.lang} dir={s.should.dir} />
            </div>
          </div>
        </div>
      </div>
      <p className="text-sm text-muted leading-relaxed mt-4">{s.note}</p>
      <p className="text-xs text-muted mt-2">
        Served text {s.servedOn}; scan checked by eye.{' '}
        {s.credit.href ? <a href={s.credit.href} className="hover:underline">{s.credit.text}</a> : s.credit.text}
      </p>
    </figure>
  );
}
