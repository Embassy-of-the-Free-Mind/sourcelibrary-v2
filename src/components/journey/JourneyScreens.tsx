/**
 * The film's "real screens" (#5861): the reader's panes for this page,
 * rendered from the page's own text instead of screenshots so they cannot
 * drift from the data. Non-interactive; the film moves and highlights them.
 *
 * They follow the reader's layout and labels (scan · original · English, the
 * Trace toggle, the machine-draft line, the Cite panel) but are not the
 * reader's components, which are bound to live reader state.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { JourneyData } from '@/lib/journey/types';
import type { ScreenKey } from './journey-timeline';
import { READER_UI_STRINGS } from '@/lib/reader-strings';
import { trimImage } from '@/lib/journey/page-trim';
import s from './JourneyFilm.module.css';

/** The reader's own wording, so the film can never paraphrase the label. */
const MACHINE_DRAFT_NOTICE = READER_UI_STRINGS.en.info.machineDraftNotice;

/**
 * A scan with any dark scanner bed around the page trimmed off (page-trim.ts).
 * Shows the untrimmed image until the trimmed copy is ready, and keeps it if
 * there is nothing to trim or the pixels cannot be read.
 */
function PageImg({ src, alt }: { src: string; alt: string }) {
  const [trimmed, setTrimmed] = useState<{ from: string; url: string } | null>(null);
  useEffect(() => {
    let live = true;
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => {
      const out = trimImage(im);
      if (live && out !== im) setTrimmed({ from: src, url: (out as HTMLCanvasElement).toDataURL('image/jpeg', 0.9) });
    };
    im.src = src;
    return () => { live = false; };
  }, [src]);
  const shown = trimmed?.from === src ? trimmed.url : src;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={shown} alt={alt} decoding="async" crossOrigin="anonymous" />;
}

/** Wrap the first occurrence of each span; `hl` spans get the highlight class. */
function marked(text: string, spans: { text: string; hl: boolean }[]): ReactNode[] {
  const hits: { at: number; len: number; hl: boolean }[] = [];
  for (const sp of spans) {
    const needle = sp.text.replace(/…$/, '').trim();
    if (!needle) continue;
    const at = text.indexOf(needle);
    if (at < 0) continue;
    if (hits.some(h => at < h.at + h.len && h.at < at + needle.length)) continue;
    hits.push({ at, len: needle.length, hl: sp.hl });
  }
  hits.sort((a, b) => a.at - b.at);
  const out: ReactNode[] = [];
  let pos = 0;
  hits.forEach((h, i) => {
    if (h.at > pos) out.push(text.slice(pos, h.at));
    out.push(
      <span key={i} data-anchor="" data-hl={h.hl ? '' : undefined} className={h.hl ? s.hl : undefined}>
        {text.slice(h.at, h.at + h.len)}
      </span>,
    );
    pos = h.at + h.len;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

function ReaderPane({ d, variant, originalFont }: { d: JourneyData; variant: ScreenKey; originalFont: string }) {
  const traceOn = variant === 'trace';
  const oSpans = traceOn && d.trace
    ? [{ text: d.trace.s, hl: true }]
    : d.lines.original.map(t => ({ text: t, hl: variant === 'ocr' }));
  const eSpans = traceOn && d.trace
    ? [{ text: d.trace.t, hl: true }]
    : d.lines.english.map(t => ({ text: t, hl: variant === 'english' }));
  return (
    <div className={s.pane}>
      <div className={s.paneBar}>
        <span className={s.paneTitle}>{d.displayTitle || d.title}</span>
        <span>{d.citation.locator}</span>
        <span className={`${s.chip} ${traceOn ? s.chipOn : ''}`}>Trace</span>
        <span className={s.chip}>Cite</span>
      </div>
      <div className={s.cols}>
        <div className={`${s.col} ${s.colScan}`}>
          <div className={s.colHead}>Scan</div>
          <PageImg src={d.scan.url} alt={`Page ${d.pageNumber} of ${d.title}`} />
        </div>
        <div className={s.col}>
          <div className={s.colHead}>{d.language}</div>
          <div className={s.colBody} data-scroll="" style={{ fontFamily: originalFont }}>
            {marked(d.paneOriginal, oSpans)}
          </div>
        </div>
        <div className={s.col}>
          <div className={s.colHead}>English</div>
          <div className={s.colBody} data-scroll="">
            {d.machineDraft && (
              <p className={s.draft}>
                <span className={variant === 'draft' ? s.hl : undefined} data-hl={variant === 'draft' ? '' : undefined}>
                  {MACHINE_DRAFT_NOTICE}
                </span>
              </p>
            )}
            {marked(d.paneEnglish, eSpans)}
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewPane({ d }: { d: JourneyData }) {
  return (
    <div className={s.pane}>
      <div className={s.overview}>
        {d.cover ? (
          <PageImg src={d.cover.url} alt="" />
        ) : (
          <PageImg src={d.scan.url} alt="" />
        )}
        <div>
          <h3 className={s.ovTitle}>{d.displayTitle || d.title}</h3>
          <p className={s.ovSub}>{[d.author, d.published].filter(Boolean).join(' · ')}{d.displayTitle ? <><br /><i>{d.title}</i></> : null}</p>
          <div className={`${s.ovFacts} ${s.hl}`} data-hl="">
            <span>{d.pagesCount.toLocaleString('en-US')} page scans</span>
            <span>{d.language} text</span>
            <span>English translation</span>
            {d.providerName && <span>Scan: {d.providerName}</span>}
          </div>
          <span className={s.ovRead}>Read</span>
        </div>
      </div>
    </div>
  );
}

function CitePane({ d, originalFont }: { d: JourneyData; originalFont: string }) {
  return (
    <div className={s.pane}>
      <div className={s.citeWrap}>
        <div className={s.citeDim}><ReaderPane d={d} variant="cite" originalFont={originalFont} /></div>
        <div className={`${s.citeBox} ${s.hl}`} data-hl="">
          <div className={s.citeHead}>Chicago</div>
          <div>{d.citation.chicago}</div>
          <div className={s.citeHead}>In text</div>
          <div>{d.citation.inline}</div>
          <div className={s.citeHead}>Link to this page</div>
          <div className={s.citeLink}>{d.citation.short_url}</div>
          {d.citation.doi_url && (
            <>
              <div className={s.citeHead}>DOI</div>
              <div className={s.citeLink}>{d.citation.doi_url}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function screenUrl(d: JourneyData, key: ScreenKey): string {
  const reader = `sourcelibrary.org${d.readerPath}`;
  if (key === 'overview') return `sourcelibrary.org${d.bookPath}`;
  if (key === 'trace') return `${reader} · Trace`;
  if (key === 'cite') return `${reader} · Cite`;
  return reader;
}

export function ScreenContent({ d, k, originalFont }: { d: JourneyData; k: ScreenKey; originalFont: string }) {
  if (k === 'overview') return <OverviewPane d={d} />;
  if (k === 'cite') return <CitePane d={d} originalFont={originalFont} />;
  return <ReaderPane d={d} variant={k} originalFont={originalFont} />;
}

export interface ScreenText {
  title: string;
  body: string;
}

/** Caption for each screen; plain, sequential, only what this page shows. */
export function screenText(d: JourneyData, k: ScreenKey): ScreenText {
  switch (k) {
    case 'ocr':
      return { title: `The ${d.language}, as read`, body: 'In the reader, the transcription sits beside the scan, with any notes on the page kept with it.' };
    case 'english':
      return {
        title: 'The English, beside it',
        body: d.lines.pairing === 'verse'
          ? 'The translation keeps the verse as a verse, line for line.'
          : 'The English sits beside the original, page for page.',
      };
    case 'trace':
      return { title: 'Tracing each line', body: 'With Trace on, clicking a phrase shows its partner in the other language. Here one phrase is matched to its English.' };
    case 'draft':
      return { title: 'Saying what is checked', body: 'Until a scholar has reviewed it, every translated page carries this label. Readers can report a problem on any page.' };
    case 'overview':
      return { title: 'The book online', body: `The edition, its ${d.pagesCount.toLocaleString('en-US')} scans, the ${d.language} text and the English are at one address, free to read.` };
    case 'cite':
      return { title: 'Citing it', body: 'The Cite button gives a reference to this exact page, with a link that will keep working.' };
  }
}
