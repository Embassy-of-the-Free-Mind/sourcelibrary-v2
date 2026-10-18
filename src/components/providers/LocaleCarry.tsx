'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useIsEmbedded } from '@/hooks/useEmbedContext';
import { carriedLocale, carryLocale, localeFromPathname, setCarriedLocale } from '@/lib/i18n';

/**
 * Keeps the site language across pages that have no translated twin (#6938).
 *
 * Renders nothing. Two jobs:
 *
 * 1. Publishes the `?lang=` of an English-only page to `useChromeLocale()`, so
 *    the header and footer stay in the language the reader chose. It reads
 *    `useSearchParams` inside its OWN Suspense boundary: anywhere else that
 *    hook would push the whole page out of static rendering.
 * 2. Rewrites every internal link as it is followed, through `carryLocale`:
 *    under the prefix where the page has a twin, else with `?lang=`. One
 *    capture-phase listener instead of editing every link site in the app,
 *    most of which hard-code `/gallery` or `/book/<id>`.
 *
 * Links that name a language on purpose (the language menus, marked with
 * `hrefLang`) are left alone, so choosing English always clears the carry.
 * Off on partner subdomains, embeds and iframes, which have their own link
 * handling (`EmbedLinkInterceptor`) and strip the locale prefix (#5038).
 */
export default function LocaleCarry() {
  return (
    <Suspense fallback={null}>
      <CarriedLocaleSync />
      <LinkCarry />
    </Suspense>
  );
}

function CarriedLocaleSync() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    // Under a prefix the prefix decides; the query only speaks for English URLs.
    setCarriedLocale(localeFromPathname(pathname) === 'en' ? carriedLocale(search?.toString()) : null);
  }, [pathname, search]);
  return null;
}

function LinkCarry() {
  const router = useRouter();
  const embedded = useIsEmbedded();
  useEffect(() => {
    if (embedded) return;
    const onActivate = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.hasAttribute('download') || a.hasAttribute('hreflang')) return;

      const here = window.location;
      const lang = localeFromPathname(here.pathname) !== 'en'
        ? localeFromPathname(here.pathname)
        : carriedLocale(here.search);
      if (!lang) return;

      const url = new URL(a.href, here.href);
      if (url.origin !== here.origin) return;
      // An in-page anchor (`#notes`) already carries the current query.
      if (url.pathname === here.pathname && url.search === here.search) return;
      const from = url.pathname + url.search + url.hash;
      const to = carryLocale(from, lang);
      if (to === from) return;

      // The attribute serves new tabs, middle clicks and "copy link".
      a.setAttribute('href', to);
      const plainClick = e.type === 'click' && e.button === 0
        && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
        && (!a.target || a.target === '_self');
      if (!plainClick) return;
      // A Next <Link> navigates to its PROP href, not the attribute; marking
      // the event handled makes it stand down (it checks defaultPrevented).
      e.preventDefault();
      router.push(to);
    };
    const opts = { capture: true };
    document.addEventListener('click', onActivate, opts);
    document.addEventListener('auxclick', onActivate, opts);
    document.addEventListener('contextmenu', onActivate, opts);
    return () => {
      document.removeEventListener('click', onActivate, opts);
      document.removeEventListener('auxclick', onActivate, opts);
      document.removeEventListener('contextmenu', onActivate, opts);
    };
  }, [router, embedded]);
  return null;
}
