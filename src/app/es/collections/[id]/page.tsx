import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import CollectionCardImage from '@/components/collections/CollectionCardImage';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import { getEsCollection } from '@/lib/es-collections';
import { isNativeEdition } from '@/lib/localized';
import { siteOgImage } from '@/lib/og-locale';
import collectionRedirects from '@/lib/collection-redirects.json';

// Spanish edition of /collections/[id] — see src/lib/es-collections.ts for why
// it is a thin twin. Cards with a Spanish edition open the reader in Spanish.
export const revalidate = 3600;
export const dynamicParams = true;
export const maxDuration = 60;

// Only the Spanish-editions collection is prerendered; the rest render on demand.
export async function generateStaticParams() {
  return [{ id: 'en-espanol' }];
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const col = await getEsCollection(id);
  if (!col) return { title: 'Colección no encontrada | Source Library' };
  const description = col.subtitle || `${col.name}: fuentes primarias en Source Library.`;
  // The collection's own plate where it has one (as on the English twin — the
  // image carries no words, so it reads the same in either language), otherwise
  // the Spanish site card. Never the English card: this page previews in
  // Spanish everywhere it is pasted (#4162).
  const cardImage = col.heroImage
    ? { url: col.heroImage, alt: `${col.name} — colección de Source Library` }
    : siteOgImage('es');
  return {
    title: `${col.name} | Source Library`,
    description,
    alternates: {
      canonical: `/es/collections/${id}`,
      languages: { en: `/collections/${id}`, es: `/es/collections/${id}`, 'x-default': `/collections/${id}` },
    },
    openGraph: {
      title: col.name,
      description,
      siteName: 'Source Library',
      type: 'website',
      locale: 'es_ES',
      url: `https://sourcelibrary.org/es/collections/${id}`,
      images: [cardImage],
    },
    // Declaring only `openGraph` leaves the layout's English `twitter` block in
    // place, and the clients that prefer it then show an English card.
    twitter: {
      card: 'summary_large_image',
      site: '@SourceLibrary_',
      title: col.name,
      description,
      images: [cardImage],
    },
  };
}

const nf = (n: number) => n.toLocaleString('es-ES');

/** Mirrors hasEsEdition in es-collections.ts — the one rule, read on the page. */
const readableInSpanish = (b: { pages_translated_es?: number; language?: string }) =>
  (b.pages_translated_es ?? 0) > 0 || isNativeEdition(b as unknown as Record<string, unknown>, 'es');

export default async function EsCollectionPage({ params }: Props) {
  const { id } = await params;
  const redirectTarget = (collectionRedirects as Record<string, string>)[id];
  if (redirectTarget) permanentRedirect(`/es/collections/${redirectTarget}`);

  const col = await getEsCollection(id);
  if (!col) notFound();

  // Readable in Spanish EITHER WAY — translated into it, or written in it. The
  // counter alone put Cogolludo, Landa and Scherzer under "these read in their
  // original language and in English", which is exactly backwards: their
  // original language IS Spanish. `href` already decides this correctly upstream
  // (getEsCollection), so before this the card linked into the Spanish reader
  // while sitting under the English-only heading.
  const spanishBooks = col.books.filter(readableInSpanish);
  const otherBooks = col.books.filter((b) => !readableInSpanish(b));
  const isSpanishCollection = id === 'en-espanol';

  return (
    <div className="min-h-screen bg-cream" lang="es">
      <ConditionalSiteHeader variant="light" />

      {/* Hero */}
      <div className="relative bg-dark overflow-hidden">
        {col.heroCandidates.length > 0 && (
          <div className="absolute inset-0 opacity-30">
            <CollectionCardImage candidates={col.heroCandidates} alt="" sizes="100vw" priority />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-transparent" />
        <div className="relative max-w-[1500px] mx-auto px-6 pt-8 pb-12 sm:pb-16">
          <Link
            href={col.parent ? `/es/collections/${col.parent.slug}` : '/es/collections'}
            className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            {col.parent ? col.parent.name : 'Colecciones'}
          </Link>
          <h1 className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3 font-display">{col.name}</h1>
          {col.subtitle && <p className="text-lg sm:text-xl text-white/70 max-w-3xl leading-relaxed mb-4">{col.subtitle}</p>}
          <div className="flex flex-wrap items-center gap-4 text-sm text-white/50">
            <span>{nf(col.bookCount)} {col.bookCount === 1 ? 'libro' : 'libros'}</span>
            {spanishBooks.length > 0 && !isSpanishCollection && (
              <>
                <span className="w-px h-4 bg-white/20" />
                <span>{nf(spanishBooks.length)} en español</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[1500px] mx-auto px-6 py-12">
        {col.description && (
          <div className="max-w-3xl mb-12">
            <p className="text-lg leading-relaxed text-primary/90 whitespace-pre-line" lang={col.descriptionIsEnglish ? 'en' : 'es'}>
              {col.description}
            </p>
            {col.descriptionIsEnglish && (
              <p className="mt-3 text-sm text-muted">Introducción disponible en inglés.</p>
            )}
          </div>
        )}

        {/* Sub-collections. Without these the branch could only be walked
            upward, so americas → maya had no way down and the Maya material was
            unreachable by clicking from anywhere on /es. Only children holding
            Spanish books are listed. */}
        {col.children.length > 0 && (
          <section className="mb-14">
            <h2 className="text-2xl sm:text-3xl font-display text-primary mb-4">Dentro de esta colección</h2>
            <div className="flex flex-wrap gap-2">
              {col.children.map((ch) => (
                <Link
                  key={ch.slug}
                  href={`/es/collections/${ch.slug}`}
                  className="inline-flex items-baseline gap-2 px-3 py-2 border border-[var(--border-light)] hover:border-accent-rust transition-colors"
                >
                  <span className="text-primary">{ch.name}</span>
                  <span className="text-xs text-muted tabular-nums">{nf(ch.spanishBookCount)}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {spanishBooks.length > 0 && (
          <section className="mb-14">
            <div className="flex items-baseline justify-between gap-4 mb-2">
              <h2 className="text-2xl sm:text-3xl font-display text-primary">
                {isSpanishCollection ? 'Los libros' : 'En español'}
              </h2>
            </div>
            <p className="text-muted mb-6 max-w-2xl">
              Cada libro se abre directamente en su edición en español; en el lector puedes cambiar a «English» en cualquier momento.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
              {spanishBooks.map((b, i) => (
                <CollectionBookCard key={b.id} book={b as unknown as CollectionBook} href={b.href} lang="es" priority={i < 5} />
              ))}
            </div>
          </section>
        )}

        {otherBooks.length > 0 && (
          <section className="mb-14">
            <h2 className="text-2xl sm:text-3xl font-display text-primary mb-2">
              {spanishBooks.length > 0 ? 'Más obras de la colección' : 'Las obras'}
            </h2>
            <p className="text-muted mb-6 max-w-2xl">
              Estas obras se leen por ahora en su lengua original y en inglés.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
              {otherBooks.map((b) => (
                <CollectionBookCard key={b.id} book={b as unknown as CollectionBook} href={b.href} lang="es" />
              ))}
            </div>
          </section>
        )}

        {col.books.length === 0 && (
          <p className="text-muted">Esta colección aún no tiene libros visibles.</p>
        )}

        <div className="border-t border-border-light pt-8 text-sm text-muted space-y-2">
          {col.truncated && (
            <p>
              Se muestran {nf(col.books.length)} de {nf(col.bookCount)} libros.{' '}
              <Link href={`/collections/${id}`} className="underline hover:text-accent-rust">Ver la colección completa (en inglés)</Link>.
            </p>
          )}
          {!col.truncated && (
            <p>
              <Link href={`/collections/${id}`} className="underline hover:text-accent-rust">Ver esta colección con su aparato completo (en inglés)</Link>: obra destacada, primeras traducciones, ilustraciones.
            </p>
          )}
          {isSpanishCollection && (
            <p>
              ¿Quieres ayudar a traducir más libros al español?{' '}
              <Link href="/es/support" className="underline hover:text-accent-rust">Apoya el proyecto</Link>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
