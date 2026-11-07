'use client';

// The translation pane of a facing-page edition (a Loeb, #8321). On the
// original leaf it shows the published English printed opposite — labelled
// with the translator and year — and keeps our AI translation one click away,
// labelled as ours. On the English leaf it says what the page is and links to
// the original it translates. Not PairedEdition.tsx, which overlays one
// manuscript's own two columns (the Marcianus).

import type { Book, Page } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { getReaderStrings } from '@/lib/reader-strings';
import { facingTranslationLabel, printedNumber, type FacingPartner } from '@/lib/facing-translation';
import { stripEditorialWrapperBlocks } from '@/lib/strip-editorial-wrappers';
import { CapsLabel, ReaderProse, resolveScanUrls, SURFACE } from './ReaderV2Bits';
import type { ReaderSettings } from './useReaderV2';

/**
 * The page as the translation pane should render it: the facing leaf's printed
 * English in the `translation` slot. Served-only; nothing reads it back.
 */
export function withFacingEnglish(page: Page, facing: FacingPartner<Page>): Page {
  const english = stripEditorialWrapperBlocks(String(facing.page.ocr?.data ?? '')).trim();
  return { ...page, translation: { data: english } } as Page;
}

const TOGGLE_CLASS = 'font-sans text-[12.5px] underline underline-offset-2';

export function FacingPaneHeader({ book, showingOurs, onToggle }: {
  book: Book;
  showingOurs: boolean;
  onToggle: () => void;
}) {
  const t = getReaderStrings(useLocale()).facing;
  return (
    <div className="flex items-center gap-3 min-w-0">
      <CapsLabel as="h2" style={{ color: 'var(--text-muted)', letterSpacing: '0.16em' }}>
        {showingOurs ? t.sourceLibraryTranslation : facingTranslationLabel(book, t.loebTranslation)}
      </CapsLabel>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={showingOurs}
        className={TOGGLE_CLASS}
        style={{ color: 'var(--text-secondary)' }}
      >
        {showingOurs ? t.showLoebTranslation : t.showSourceLibraryTranslation}
      </button>
    </div>
  );
}

/** One quiet line above our translation on a Loeb, so it is never read as the published one. */
export function SourceLibraryTranslationNote() {
  const t = getReaderStrings(useLocale()).facing;
  return (
    <p className="font-sans text-[12.5px] mb-3" style={{ color: 'var(--text-faint)' }}>
      {t.sourceLibraryTranslationNote}
    </p>
  );
}

/** The English leaf: it IS the translation, of the page opposite. */
export function FacingEnglishLeafNote({ facing, onGo }: { facing: FacingPartner<Page>; onGo: () => void }) {
  const t = getReaderStrings(useLocale()).facing;
  const printed = printedNumber(facing.page);
  return (
    <p className="font-sans text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
      {t.englishLeafNote(String(printed ?? facing.page.page_number))}{' '}
      <button type="button" onClick={onGo} className={TOGGLE_CLASS} style={{ color: 'var(--text-secondary)' }}>
        {t.goToOriginal}
      </button>
    </p>
  );
}

/** The two leaves on screen together: the original and the English printed facing it. */
export interface FacingOpeningLeaves {
  original: Page;
  english: Page;
}

/** The opening the current leaf belongs to, or null when it is unpaired. */
export function openingOf(current: Page, facing: FacingPartner<Page> | null): FacingOpeningLeaves | null {
  if (!facing) return null;
  return facing.role === 'original'
    ? { original: current, english: facing.page }
    : { original: facing.page, english: current };
}

/** "pp. 296–297": the counter on an opening. Null when either leaf has no arabic number. */
export function openingPagesLabel(opening: FacingOpeningLeaves, format: (a: string, b: string) => string): string | null {
  const a = printedNumber(opening.original);
  const b = printedNumber(opening.english);
  return a != null && b != null ? format(String(a), String(b)) : null;
}

/**
 * The book lying open (#8321): the original leaf on the left and the published
 * English on the right, the two scans at one height with a gutter between, each
 * leaf's text under its own scan. `stacked` (the phone) puts the English under
 * the original, which reads straight down and leaves the sideways swipe to turn
 * the page. Display only: each leaf is still its own page, with its own id,
 * citation and OCR. The leaf the URL names is `currentId`; when that is the
 * English leaf (an old link, a search hit) it is the one marked.
 */
export function FacingOpening({ book, opening, currentId, settings, showOurs, onToggleOurs, onSelectLeaf, stacked }: {
  book: Book;
  opening: FacingOpeningLeaves;
  currentId: string;
  settings: ReaderSettings;
  showOurs: boolean;
  onToggleOurs: () => void;
  onSelectLeaf: (pageId: string) => void;
  stacked: boolean;
}) {
  const t = getReaderStrings(useLocale()).facing;
  const englishBook = { ...book, language: 'English' } as Book;
  const leaves = [
    { page: opening.original, label: t.originalLeaf, prose: book },
    { page: opening.english, label: facingTranslationLabel(book, t.loebTranslation), prose: englishBook },
  ];
  const baseSize = stacked ? 16 : 18.5;
  return (
    <div
      data-facing-opening=""
      className={stacked ? 'flex flex-col' : 'flex-1 min-w-0 min-h-0 overflow-y-auto'}
      style={{ background: SURFACE.translation, overscrollBehavior: 'contain' }}
    >
      <div className={stacked ? 'flex flex-col' : 'grid grid-cols-2 max-w-[1500px] mx-auto px-8 pt-6 pb-12'}>
        {leaves.map(({ page, label, prose }, i) => {
          const marked = page.id === currentId && page.id === opening.english.id;
          const printed = printedNumber(page);
          const display = resolveScanUrls(page).display;
          return (
            <section
              key={page.id}
              data-facing-leaf={i === 0 ? 'original' : 'english'}
              aria-current={page.id === currentId ? 'page' : undefined}
              className={stacked ? (i ? 'border-t' : '') : i ? 'pl-6 border-l' : 'pr-6'}
              style={{ borderColor: 'var(--border-medium)' }}
            >
              <div className={`flex items-center gap-2 ${stacked ? 'h-[34px] px-4 border-b' : 'mb-3'}`} style={{ borderColor: 'var(--border-medium)' }}>
                <CapsLabel as="h2" style={{ color: marked ? 'var(--accent-rust)' : 'var(--text-muted)', letterSpacing: '0.16em' }}>
                  {label}{printed != null ? ` · p. ${printed}` : ''}
                </CapsLabel>
              </div>
              {display && (
                <button
                  type="button"
                  onClick={() => onSelectLeaf(page.id)}
                  className={`block w-full ${stacked ? 'px-4 py-4' : 'py-2'}`}
                  style={{ background: SURFACE.scanBed }}
                  aria-label={label}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={display}
                    alt=""
                    decoding="async"
                    // Each scan meets the gutter, as the leaves of an open book do.
                    className={stacked ? 'w-full h-auto' : `block w-auto max-w-full object-contain ${i ? 'mr-auto' : 'ml-auto'}`}
                    style={{
                      ...(stacked ? {} : { height: 'min(72vh, 1000px)' }),
                      boxShadow: marked ? '0 0 0 2px var(--accent-rust)' : undefined,
                    }}
                  />
                </button>
              )}
              <div className={stacked ? 'px-[22px] pt-4 pb-6' : 'pt-6'}>
                <ReaderProse page={page} book={prose} kind="ocr" settings={settings} baseSize={baseSize} />
                {i === 0 && (
                  <div className="mt-6">
                    <button
                      type="button"
                      onClick={onToggleOurs}
                      aria-expanded={showOurs}
                      className={TOGGLE_CLASS}
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {t.sourceLibraryTranslation} {showOurs ? '−' : '+'}
                    </button>
                    {showOurs && (
                      <div className="mt-3">
                        <SourceLibraryTranslationNote />
                        <ReaderProse page={page} book={book} kind="translation" settings={settings} baseSize={baseSize} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
