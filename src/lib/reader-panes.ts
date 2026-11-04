/**
 * Which reader panes a page has anything to put in.
 *
 * PRIOR ART: src/lib/translation-pane-state.ts decides what an empty translation
 * pane SAYS once it is open; this decides whether the pane opens at all.
 * src/components/reader-v2/PaneEmptyState.tsx holds the wording it spares the
 * reader from. Neither answers "does this page have text?" for both panes.
 *
 * Why: on a page with a scan and no text, the two text panes both say "Not
 * transcribed yet" and take two thirds of the width from the only thing there
 * is to look at. Khunrath's Emerald Table showed at 560px wide beside two
 * panes of that sentence (Derek, 2026-11-04: "if no english or ocr, default is
 * just image").
 */
import type { Page } from '@/lib/types';
import { getTranslationText } from '@/lib/translation-text';

/**
 * True when the text panes would only say that the page has no text yet.
 *
 * False for the pages whose empty pane TELLS the reader something: the metered
 * wall (`gated`), a reading judged illegible (`ocr.unreadable`) and a
 * translation taken out of service (`translation_withheld`). Hiding those would
 * hide the reason, and a gated page would read as untranscribed.
 */
export function pageHasNoTextToShow(page: Page): boolean {
  if ((page as Page & { gated?: boolean }).gated) return false;
  if (page.ocr?.unreadable) return false;
  if (page.translation_withheld) return false;
  const texts = [
    page.ocr?.data,
    getTranslationText(page),
    page.modernized?.data,
    page.modernized_spelling?.data,
  ];
  return !texts.some(t => t?.trim());
}
