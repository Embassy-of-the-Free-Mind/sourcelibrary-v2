import type { Metadata } from 'next';
import { ABOUT_STRINGS } from '@/lib/about-i18n';
import { OG_LOCALE } from '@/lib/og-locale';
import type { Locale } from '@/lib/locale-path';

/** The URL of /about in a language. */
export const aboutPath = (lang: Locale) => (lang === 'en' ? '/about' : `/${lang}/about`);

/** Share card made from the hero (scripts/one-off/generate-about-og.mjs). */
export const aboutOgImage = (lang: Locale) => (lang === 'en' ? '/og-about.jpg' : `/og-about-${lang}.jpg`);

export function aboutMetadata(lang: Locale): Metadata {
  const { title, description, ogAlt } = ABOUT_STRINGS[lang].meta;
  const image = { url: aboutOgImage(lang), width: 1200, height: 630, alt: ogAlt };
  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: aboutPath(lang),
      languages: {
        en: '/about',
        es: '/es/about',
        la: '/la/about',
        nl: '/nl/about',
        zh: '/zh/about',
        'x-default': '/about',
      },
    },
    openGraph: { type: 'website', siteName: 'Source Library', title, description, url: aboutPath(lang), locale: OG_LOCALE[lang], images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}
