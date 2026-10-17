import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import './body.css';

// Shared by /blog/techniques-of-the-body and its Spanish twin /es/blog/techniques-of-the-body.
// The document HTML is authored (document.json; document.es.json is built from it by
// scripts/maintenance/translate-html-document.mjs). The index at the top is read from the
// document's own section and sub-section ids, so it cannot drift from the content.

export type DocLang = 'en' | 'es';

export const HERO_PATH = '/blog/techniques-of-the-body/hero-khrul-khor.jpg';

export const COPY: Record<DocLang, {
  title: string; description: string; heroAlt: string; date: string; back: string; contents: string; backHref: string;
}> = {
  en: {
    title: 'Techniques of the Body',
    description:
      'Postures, breathing methods and exercises quoted from the books that prescribe them, in Chinese, Sanskrit, Tibetan, Greek, Latin, Hebrew, Arabic and the European vernaculars: seasonal exercises, haṭha yoga, breathing methods, the Pythagorean day, theurgy, penance, prayer, drill, the gymnasium and ritual, and in America the Shakers’ dance, the Ghost Dance and the Navajo Night Chant. Each original beside its translation.',
    heroAlt:
      'Two leaves of a Tibetan manuscript of the Nyang tradition: seven figures drawn in the sequence of the ’khrul ’khor, the “magical movement” exercises.',
    date: '15 September 2026',
    back: 'All notes',
    contents: 'Contents',
    backHref: '/blog',
  },
  es: {
    title: 'Técnicas del cuerpo',
    description:
      'Posturas, métodos de respiración y ejercicios citados de los libros que los prescriben, en chino, sánscrito, tibetano, griego, latín, hebreo, árabe y las lenguas vernáculas europeas: ejercicios estacionales, haṭha yoga, métodos de respiración, la jornada pitagórica, teúrgia, penitencia, oración, instrucción militar, el gimnasio y el rito, y en América la danza de los shakers, la Danza de los Espíritus y el Canto de la Noche navajo. Cada original junto a su traducción.',
    heroAlt:
      'Dos hojas de un manuscrito tibetano de la tradición Nyang: siete figuras dibujadas en la secuencia del ’khrul ’khor, los ejercicios de «movimiento mágico».',
    date: '15 de septiembre de 2026',
    back: 'Todas las notas',
    contents: 'Índice',
    // The blog index has no Spanish twin; the link goes to the English one.
    backHref: '/blog',
  },
};

const FONTS =
  'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&family=Noto+Serif+Devanagari:wght@400;600&family=Noto+Serif+Tibetan:wght@400&family=Noto+Serif+Hebrew:wght@400&family=Noto+Serif+Tamil:wght@400&display=swap';

type TocSection = { id: string; label: string; subs: { id: string; label: string }[] };

/** Regions (section.sec + h2) and their practices (div.sub + h3), in document order. */
export function tableOfContents(html: string): TocSection[] {
  const out: TocSection[] = [];
  const re = /<section class="sec" id="([^"]+)"[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>|<div class="sub" id="([^"]+)">\s*<h3>([\s\S]*?)<\/h3>/g;
  for (const m of html.matchAll(re)) {
    if (m[1]) out.push({ id: m[1], label: m[2].trim(), subs: [] });
    else if (out.length) out[out.length - 1].subs.push({ id: m[3], label: m[4].trim() });
  }
  return out;
}

export default function TechniquesDocument({ lang, body }: { lang: DocLang; body: string }) {
  const c = COPY[lang];
  const toc = tableOfContents(body);
  const other = lang === 'en'
    ? { href: '/es/blog/techniques-of-the-body', label: 'Español', hrefLang: 'es' }
    : { href: '/blog/techniques-of-the-body', label: 'English', hrefLang: 'en' };
  return (
    <ContentPageLayout
      header={
        <ContentHeader title={c.title} subtitle={c.description} image={HERO_PATH} imageAlt={c.heroAlt}>
          <p className="text-stone-400 text-sm mt-4">{c.date}</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      {/* Chinese and Devanagari faces are not in the site stylesheet; this page quotes both at length. */}
      <link rel="stylesheet" href={FONTS} />
      <div className="mb-8 flex items-center justify-between gap-4 text-sm">
        <Link href={c.backHref} className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          {c.back}
        </Link>
        <Link href={other.href} hrefLang={other.hrefLang} lang={other.hrefLang} className="text-muted hover:text-secondary transition-colors">
          {other.label}
        </Link>
      </div>
      <div className="bodymap">
        <nav className="toc" aria-label={c.contents}>
          <h2>{c.contents}</h2>
          <ol>
            {toc.map((s) => (
              <li key={s.id}>
                <a className="toc-region" href={`#${s.id}`} dangerouslySetInnerHTML={{ __html: s.label }} />
                {s.subs.length > 0 && (
                  <ul>
                    {s.subs.map((sub) => (
                      <li key={sub.id}>
                        <a href={`#${sub.id}`} dangerouslySetInnerHTML={{ __html: sub.label }} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </nav>
      </div>
      <article className="bodymap" lang={lang} dangerouslySetInnerHTML={{ __html: body }} />
    </ContentPageLayout>
  );
}
