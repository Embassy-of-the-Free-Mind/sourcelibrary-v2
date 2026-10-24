import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import TechniquesTimeline from './TechniquesTimeline';
import './body.css';

// Shared by /blog/techniques-of-the-body and its Spanish twin /es/blog/techniques-of-the-body.
// The document HTML is authored (document.json; document.es.json is built from it by
// scripts/maintenance/translate-html-document.mjs). The index at the top is read from the
// document's own section and sub-section ids, so it cannot drift from the content.

export type DocLang = 'en' | 'es';

export const HERO_PATH = '/articles/techniques-of-the-body/hero-khrul-khor.jpg';

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
    back: 'All articles',
    contents: 'Contents',
    backHref: '/articles',
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
    backHref: '/articles',
  },
};

const FONTS =
  'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&family=Noto+Serif+Devanagari:wght@400;600&family=Noto+Serif+Tibetan:wght@400&family=Noto+Serif+Hebrew:wght@400&family=Noto+Serif+Tamil:wght@400&display=swap';

/**
 * Every picture in the body is a plain <img> in the document HTML; route the ones in
 * public/articles/ through the image optimiser (AVIF or WebP at the width shown), as
 * ArticleImage does for the other articles. Widths must be in next.config.ts
 * images.deviceSizes / imageSizes. The woodcut thumbnails (year and brocades) show at
 * 150 to 180 px; plates in the grid at about 300 px; wide figures across the column.
 */
const OPT_WIDTHS = [400, 640, 828, 1200, 1920];
const optimised = (src: string, w: number) => `/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=75`;

export function optimiseImages(html: string): string {
  const wideRanges = [...html.matchAll(/<figure class="wide">[\s\S]*?<\/figure>/g)].map(
    (m) => [m.index!, m.index! + m[0].length] as const,
  );
  return html.replace(/<img ([^>]*?)src="(\/articles\/[^"]+)"([^>]*)>/g, (tag, pre: string, src: string, post: string, at: number) => {
    const attrs = pre + post;
    const width = Number(/\bwidth="(\d+)"/.exec(attrs)?.[1] || 0);
    if (width && width <= 180) {
      // woodcut thumbnail: one size, twice its display width
      return `<img ${pre}src="${optimised(src, 400)}"${post}>`;
    }
    const inWide = wideRanges.some(([a, b]) => at > a && at < b);
    const sizes = inWide ? '(max-width: 768px) 100vw, 920px' : '(max-width: 520px) 100vw, 320px';
    const ws = OPT_WIDTHS.filter((w) => !width || w < width * 1.2);
    const set = (ws.length ? ws : [400]).map((w) => `${optimised(src, w)} ${w}w`).join(', ');
    return `<img ${pre}src="${optimised(src, 828)}" srcset="${set}" sizes="${sizes}"${post}>`;
  });
}

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
  const html = optimiseImages(body);
  // split after the legend paragraph; the opening <div class="wrap"> is not needed for layout
  const legendEnd = html.indexOf('</p>', html.indexOf('<p class="legend">')) + 4;
  const opening = html.slice(0, legendEnd).replace(/^<div class="wrap">/, '');
  const rest = html.slice(legendEnd).replace(/<\/div>\s*$/, '');
  const other = lang === 'en'
    ? { href: '/es/blog/techniques-of-the-body', label: 'Español', hrefLang: 'es' }
    : { href: '/articles/techniques-of-the-body', label: 'English', hrefLang: 'en' };
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark" backHref={c.backHref} backLabel={c.back} title={c.title} subtitle={c.description} image={HERO_PATH} imageAlt={c.heroAlt}>
          <p className="text-stone-400 text-sm mt-4">{c.date}</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      {/* Chinese and Devanagari faces are not in the site stylesheet; this page quotes both at length. */}
      <link rel="stylesheet" href={FONTS} />
      <div className="mb-8 flex items-center justify-end gap-4 text-sm">
        <Link href={other.href} hrefLang={other.hrefLang} lang={other.hrefLang} className="text-muted hover:text-secondary transition-colors">
          {other.label}
        </Link>
      </div>
      <div className="bodymap">
        <nav className="toc" aria-label={c.contents}>
          <p className="toc-h">{c.contents}</p>
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
      {/* The timeline goes after the opening paragraphs and the legend, before the first section. */}
      <div className="bodymap" lang={lang} dangerouslySetInnerHTML={{ __html: opening }} />
      <div className="bodymap">
        <TechniquesTimeline lang={lang} />
      </div>
      <article className="bodymap" lang={lang} dangerouslySetInnerHTML={{ __html: rest }} />
    </ContentPageLayout>
  );
}
