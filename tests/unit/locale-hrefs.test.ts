import { describe, it, expect } from 'vitest';
import { localeHrefs, basePathFromPathname, LOCALIZED_ROUTES } from '@/lib/i18n';

// The EN/ES toggle shows sitewide (#2763). It must never 404: pages with a real
// `/es` twin link to it; every other page sends ES to the Spanish front door.

describe('basePathFromPathname', () => {
  it('strips the /es prefix', () => {
    expect(basePathFromPathname('/es')).toBe('/');
    expect(basePathFromPathname('/es/support')).toBe('/support');
    expect(basePathFromPathname('/es/auth/signin')).toBe('/auth/signin');
  });
  it('leaves English paths unchanged', () => {
    expect(basePathFromPathname('/support')).toBe('/support');
    expect(basePathFromPathname('/book/foo')).toBe('/book/foo');
    expect(basePathFromPathname(null)).toBe('/');
  });
});

describe('localeHrefs', () => {
  it('links to the twin on the homepage', () => {
    expect(localeHrefs('/')).toEqual({ en: '/', es: '/es', hasTwin: true });
    expect(localeHrefs('/es')).toEqual({ en: '/', es: '/es', hasTwin: true });
  });

  it('links to the twin on localized funnel pages', () => {
    expect(localeHrefs('/support')).toEqual({ en: '/support', es: '/es/support', hasTwin: true });
    expect(localeHrefs('/es/support')).toEqual({ en: '/support', es: '/es/support', hasTwin: true });
    expect(localeHrefs('/auth/signin')).toEqual({ en: '/auth/signin', es: '/es/auth/signin', hasTwin: true });
  });

  it('sends ES to the front door (never a 404) on pages with no twin', () => {
    const r = localeHrefs('/book/the-kybalion');
    expect(r.hasTwin).toBe(false);
    expect(r.es).toBe('/es');
    expect(r.en).toBe('/book/the-kybalion');
  });

  it('every LOCALIZED_ROUTE resolves to an existing /es route shape', () => {
    for (const base of LOCALIZED_ROUTES) {
      const { es } = localeHrefs(base);
      expect(es === '/es' || es.startsWith('/es/')).toBe(true);
    }
  });
});
