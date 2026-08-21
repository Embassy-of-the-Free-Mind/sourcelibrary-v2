import type { Metadata } from 'next';
import Link from 'next/link';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import CollectionCardImage from '@/components/collections/CollectionCardImage';
import { getEsCollectionList, type EsCollectionSummary } from '@/lib/es-collections';
import { siteOgImage } from '@/lib/og-locale';

// Spanish edition of /collections. Real, indexable route; the header and footer
// localize themselves from the `/es` prefix. Data failures throw (ISR keeps the
// last good page) — never a cached empty grid (#2973).
export const revalidate = 3600;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Colecciones | Source Library',
  description:
    'Miles de textos históricos organizados en colecciones temáticas: alquimia, hermetismo, filosofía clásica, textos sagrados y más. Incluye los libros con edición en español.',
  alternates: {
    canonical: '/es/collections',
    languages: { en: '/collections', es: '/es/collections', 'x-default': '/collections' },
  },
  openGraph: {
    title: 'Colecciones | Source Library',
    description:
      'Miles de textos históricos organizados en colecciones temáticas: alquimia, hermetismo, filosofía clásica, textos sagrados y más. Incluye los libros con edición en español.',
    siteName: 'Source Library',
    type: 'website',
    locale: 'es_ES',
    url: 'https://sourcelibrary.org/es/collections',
    images: [siteOgImage('es')],
  },
  // The layout's `twitter` block survives when a page declares only
  // `openGraph` — and its image is the English card, which is what WhatsApp
  // previewed here. Spanish page, Spanish card, in both blocks.
  twitter: {
    card: 'summary_large_image',
    site: '@SourceLibrary_',
    title: 'Colecciones | Source Library',
    description:
      'Miles de textos históricos organizados en colecciones temáticas: alquimia, hermetismo, filosofía clásica, textos sagrados y más. Incluye los libros con edición en español.',
    images: [siteOgImage('es')],
  },
};

const nf = (n: number) => n.toLocaleString('es-ES');

function countLabel(c: EsCollectionSummary): string {
  const parts = [`${nf(c.bookCount)} ${c.bookCount === 1 ? 'libro' : 'libros'}`];
  if (c.spanishBookCount > 0) parts.push(`${nf(c.spanishBookCount)} en español`);
  if (c.childrenCount > 0) parts.push(`${nf(c.childrenCount)} subcolecciones`);
  return parts.join(' · ');
}

function Card({ col, priority }: { col: EsCollectionSummary; priority?: boolean }) {
  return (
    <Link
      href={`/es/collections/${col.slug}`}
      className="group relative block overflow-hidden rounded-lg aspect-square animate-fade-in-up"
    >
      <CollectionCardImage
        candidates={col.imageCandidates}
        alt={`Ilustración de ${col.name}`}
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
        priority={priority}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />
      <div className="absolute inset-0 flex flex-col justify-end p-3 sm:p-4">
        <p className="text-white/50 text-[11px] mb-1 hidden sm:block">{countLabel(col)}</p>
        <h2 className="font-serif text-sm sm:text-base lg:text-lg text-white font-semibold leading-tight line-clamp-2 group-hover:text-accent-gold transition-colors">
          {col.name}
        </h2>
      </div>
    </Link>
  );
}

export default async function EsCollectionsPage() {
  const collections = await getEsCollectionList();
  const spanish = collections.find((c) => c.slug === 'en-espanol');
  // Spanish-bearing collections first, richest first — then the rest, labelled.
  // A reader should be able to see at a glance where Spanish reading is
  // possible, instead of opening collections until one has something.
  const rest = collections.filter((c) => c.slug !== 'en-espanol');
  const withSpanish = rest
    .filter((c) => c.spanishBookCount > 0)
    .sort((a, b) => b.spanishBookCount - a.spanishBookCount);
  const englishOnly = rest.filter((c) => c.spanishBookCount === 0);

  return (
    <div className="min-h-screen bg-cream" lang="es">
      <ConditionalSiteHeader variant="light" />

      <div className="max-w-[1500px] mx-auto px-6 pt-10 pb-6">
        <h1 className="text-4xl sm:text-5xl font-display text-primary mb-3">Colecciones</h1>
        <p className="text-muted max-w-2xl leading-relaxed">
          La biblioteca, ordenada por tradiciones. Primero las colecciones que ya contienen libros con edición en
          español; debajo, el resto de la biblioteca, en su lengua original y con traducción al inglés en muchos casos.
          Las colecciones con libros en español llevan su nombre y su introducción traducidos; en el resto, la
          introducción aparece en inglés y así se indica.
        </p>
      </div>

      {spanish && (
        <section className="max-w-[1500px] mx-auto px-6 pb-10">
          <Link
            href={`/es/collections/${spanish.slug}`}
            className="group grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-0 overflow-hidden rounded-lg border border-border-light bg-white hover:border-accent-rust/40 hover:shadow-md transition-[border-color,box-shadow]"
          >
            <div className="relative aspect-square sm:aspect-auto sm:min-h-[220px]">
              <CollectionCardImage candidates={spanish.imageCandidates} alt="" sizes="(max-width: 640px) 100vw, 33vw" priority />
            </div>
            <div className="p-6 sm:p-8 flex flex-col justify-center">
              <p className="text-xs uppercase tracking-[0.2em] text-accent-rust mb-2">Leer en español</p>
              <h2 className="text-2xl sm:text-3xl font-display text-primary mb-2 group-hover:text-accent-rust transition-colors">{spanish.name}</h2>
              <p className="text-muted leading-relaxed mb-4">
                Las obras de la biblioteca que ya cuentan con una edición en español, página a página junto al original.
              </p>
              <p className="text-sm text-secondary">{nf(spanish.bookCount)} {spanish.bookCount === 1 ? 'libro' : 'libros'} &rarr;</p>
            </div>
          </Link>
        </section>
      )}

      {withSpanish.length > 0 && (
        <section className="max-w-[1500px] mx-auto px-6 pb-14">
          <div className="flex items-baseline justify-between gap-4 mb-4">
            <h2 className="text-2xl sm:text-3xl font-display text-primary">Colecciones con libros en español</h2>
            <span className="text-sm text-muted whitespace-nowrap">{nf(withSpanish.length)}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {withSpanish.map((col, i) => <Card key={col.slug} col={col} priority={i < 4} />)}
          </div>
        </section>
      )}

      <section className="max-w-[1500px] mx-auto px-6 pb-20">
        <div className="flex items-baseline justify-between gap-4 mb-2">
          <h2 className="text-2xl sm:text-3xl font-display text-primary">El resto de la biblioteca</h2>
          <span className="text-sm text-muted whitespace-nowrap">{nf(englishOnly.length)}</span>
        </div>
        <p className="text-sm text-muted mb-4 max-w-2xl">
          Estas colecciones todavía no tienen ninguna edición en español. Sus libros están en su lengua original —
          latín, griego, alemán, francés… — con traducción al inglés en muchos casos.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {englishOnly.map((col) => <Card key={col.slug} col={col} />)}
        </div>
        <p className="mt-10 text-sm text-muted">
          ¿Buscas las exposiciones y la galería? Están en la{' '}
          <Link href="/collections" className="underline hover:text-accent-rust">página de colecciones en inglés</Link>.
        </p>
      </section>
    </div>
  );
}
