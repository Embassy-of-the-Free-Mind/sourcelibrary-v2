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
import { CapsLabel } from './ReaderV2Bits';

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
