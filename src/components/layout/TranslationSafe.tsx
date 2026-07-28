'use client';

import { Fragment, type ReactNode } from 'react';
import { useBrowserTranslation } from '@/hooks/useBrowserTranslation';

/**
 * Remount a subtree instead of reconciling it, while a browser translator is
 * rewriting the page.
 *
 * Chrome/Edge's translator replaces every text node with a nested
 * <font style="vertical-align: inherit"> pair. React still holds the ORIGINAL
 * text node, so its next commit patches nodes that have left the document. The
 * inline guard in the root layout (TRANSLATION_DOM_GUARD_SCRIPT) stops the
 * resulting throw, but it cannot make the update *arrive* — only a remount
 * does that. Both halves shipped for the reader in #3314; this is the second
 * half generalised, because every other list that re-renders needs it too.
 *
 * Measured before writing this (PostHog, 30d): the null-`parentNode` /
 * `insertBefore` crash class runs at ~2,575 events on collection pages and 147
 * on /search, and Spanish-locale visitors hit it ~16x more often than
 * English-locale ones — the auto-translate signature. The reader, which has
 * had the remount since #3314, sits at 333 events across 502K pageviews.
 *
 * `identity` must change whenever the subtree's *content* changes — sort,
 * filter, query, page. That is what triggers the remount.
 *
 * Costs nothing when no translator is present: the key is `undefined`, so
 * React reconciles exactly as before and untranslated readers are untouched.
 *
 * Wrap the CONTENT that re-renders, never a parent holding UI state — keying
 * a subtree resets any state inside it. (The reader learned this: panel
 * toggles and font size deliberately live above its key.)
 */
export default function TranslationSafe({
  identity,
  children,
}: {
  identity: string | number;
  children: ReactNode;
}) {
  const translated = useBrowserTranslation();
  return <Fragment key={translated ? `sl-t-${identity}` : undefined}>{children}</Fragment>;
}
