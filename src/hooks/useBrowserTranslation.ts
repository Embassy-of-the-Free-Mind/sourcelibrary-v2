'use client';

import { useEffect, useState } from 'react';

/**
 * Is a browser translator currently rewriting this page?
 *
 * Chrome/Edge's built-in translator and the Google Translate widget both work by
 * replacing every text node with a nested <font style="vertical-align: inherit">
 * pair. React keeps a reference to the ORIGINAL text node, so once that has
 * happened React can no longer reconcile the text it rendered: its updates land
 * on nodes that are no longer in the document, and the reader shows the previous
 * page's words after a page turn. (Before the DOM guard in the root layout, the
 * same mismatch threw NotFoundError and blanked the page outright.)
 *
 * The cure is to stop asking React to reconcile translated text at all — remount
 * the subtree instead, so it builds fresh nodes the translator then translates.
 * Remounting is not free, so callers should only do it while this returns true.
 *
 * Three independent signals, any of which is sufficient:
 *  - `translated-ltr` / `translated-rtl` on <html> (both Chrome and the widget)
 *  - <html lang> rewritten away from the 'en' we serve (Chrome sets the target)
 *  - the translator's own <font style="vertical-align: inherit"> wrappers
 *
 * The first two are attributes on <html>, so a cheap attribute observer catches
 * a translation that starts mid-session. The third is the fallback for any
 * translator that does not touch <html>, checked on mount and shortly after
 * (translation typically lands a beat after first paint).
 */
function detectBrowserTranslation(): boolean {
  if (typeof document === 'undefined') return false;
  const html = document.documentElement;
  if (/(?:^|\s)translated-(?:ltr|rtl)(?:\s|$)/.test(html.className)) return true;
  const lang = (html.lang || '').toLowerCase();
  if (lang && !lang.startsWith('en')) return true;
  return !!document.querySelector('font[style*="vertical-align: inherit"]');
}

export function useBrowserTranslation(): boolean {
  const [translated, setTranslated] = useState(false);

  useEffect(() => {
    // Latch on: a translator that has rewritten the DOM once will keep doing so,
    // and flipping back would remount the reader for no reason.
    let done = false;
    const check = () => {
      if (done) return;
      if (detectBrowserTranslation()) {
        done = true;
        setTranslated(true);
      }
    };

    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'lang'],
    });
    // Catch translators that rewrite text without touching <html>.
    const timers = [setTimeout(check, 1200), setTimeout(check, 4000)];

    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);

  return translated;
}
