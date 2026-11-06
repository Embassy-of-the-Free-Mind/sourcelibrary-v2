import { ABOUT_STRINGS } from '@/lib/about-i18n';
import { aboutOgImage, aboutPath } from '@/lib/about-meta';
import type { Locale } from '@/lib/locale-path';

const SITE = 'https://sourcelibrary.org';

/** AboutPage structured data, in the page's own language. */
export default function AboutSchema({ lang }: { lang: Locale }) {
  const { title, description } = ABOUT_STRINGS[lang].meta;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    '@id': `${SITE}${aboutPath(lang)}#page`,
    url: `${SITE}${aboutPath(lang)}`,
    name: title,
    description,
    inLanguage: lang,
    primaryImageOfPage: `${SITE}${aboutOgImage(lang)}`,
    isPartOf: { '@id': `${SITE}/#website` },
    about: { '@id': `${SITE}/#organization` },
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, '\\u003c') }} />;
}
