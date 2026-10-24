'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { localeFromPathname } from '@/lib/locale-path';

/**
 * Keeps `<html lang>` in step with the URL's locale prefix (#7055).
 *
 * The root layout cannot read the request path without `headers()`, which
 * would opt every route out of ISR/edge caching, and the locale must never come
 * from a cookie (.claude/docs/i18n.md rule 5). So the static HTML ships
 * `lang="en"` and this sets the right value on the client from the same
 * pathname the rest of the chrome uses. Assistive tech and the browser's
 * translate prompt read the live attribute; crawlers that do not run JS still
 * see "en" (the pages carry hreflang alternates).
 */
export default function HtmlLang() {
  const pathname = usePathname();
  useEffect(() => {
    document.documentElement.lang = localeFromPathname(pathname);
  }, [pathname]);
  return null;
}
