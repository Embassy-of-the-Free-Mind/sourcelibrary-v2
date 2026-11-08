import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import ReadAlong from '@/app/articles/solve-et-coagula/ReadAlong';
import { LISTS, type ReadAlongLink } from '@/app/articles/solve-et-coagula/extras';

// Spanish twin of /articles/solve-et-coagula. The conversation is in English; the transcript is the
// standalone page's Spanish translation (transcript.es.json). Its word timings are approximate: each
// English paragraph's span is spread evenly over the Spanish words, as the note on the page says.

const TITLE = 'Solve et Coagula: Derek Lomas habla de Source Library';
const DESCRIPTION =
  'Derek Lomas conversa con Alex, de Agrippa’s Diary, sobre Ficino, Agripa, Maier y Source Library. El episodio, con una transcripción en español sincronizada.';
const HERO = '/articles/solve-et-coagula/atalanta-title-page-race.jpg';
const HERO_ALT =
  'Grabado de la portada de Atalanta fugiens de Maier (1618): Hipómenes corre con manzanas de oro mientras Atalanta se agacha a recoger una, con dos leones y un templo redondo al fondo.';

export const metadata: Metadata = {
  title: `${TITLE} - Source Library`,
  description: DESCRIPTION,
  openGraph: { images: [{ url: HERO, alt: HERO_ALT }], title: TITLE, description: DESCRIPTION, locale: 'es_ES', type: 'article' },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: {
    canonical: '/es/articles/solve-et-coagula',
    languages: { en: '/articles/solve-et-coagula', es: '/es/articles/solve-et-coagula' },
  },
};

const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-2xl md:text-3xl text-primary mb-6';

function LinkList({ items }: { items: ReadAlongLink[] }) {
  return (
    <ul className="list-disc pl-5 space-y-2 text-secondary font-body leading-relaxed mb-6">
      {items.map((m) => {
        const at = m.title.match(/^(.*?)\s*\((\d+:\d{2}(?::\d{2})?)\)$/);
        return (
          <li key={m.url}>
            <Link href={m.url} className="underline decoration-accent-gold underline-offset-4 hover:decoration-primary">
              {at ? at[1] : m.title}
            </Link>
            {at && <span className="text-muted text-sm font-sans"> &middot; {at[2]}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export default function SolveEtCoagulaEsPage() {
  const es = LISTS.es;
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          feature
          headerVariant="dark"
          image={HERO}
          imageAlt={HERO_ALT}
          title={TITLE}
          subtitle="Alex, de Agrippa’s Diary, conversa con Derek Lomas en la Embassy of the Free Mind de Ámsterdam. El episodio completo, con una transcripción en la que se puede hacer clic."
          backLabel="Todos los artículos (en inglés)"
        >
          <p className="text-stone-400 text-sm mt-4">9 de noviembre de 2026 &middot; vídeo, 1 h 32 min</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="prose-content max-w-none" lang="es">
        <p className="text-xl text-secondary leading-relaxed mb-6 font-body">
          Derek Lomas, que creó Source Library en la Embassy of the Free Mind de Ámsterdam, fue invitado de Alex,
          del canal de YouTube Agrippa&rsquo;s Diary, en su podcast Solve et Coagula. La conversación dura hora y
          media y es en inglés; aquí la transcripción está traducida al español.
        </p>
        <p className={P}>
          La primera mitad trata de cómo llegó Derek a estos textos: una tutoría sobre Platón y Aristóteles en Yale,
          los pitagóricos y el primer libro antiguo que compró, el{' '}
          <Link href="/es/book/iamblichus-de-mysteriis-1497-aldine-editio-princeps-trans" className="underline decoration-accent-gold underline-offset-4">
            <em>De mysteriis</em> de Jámblico
          </Link>{' '}
          impreso por Aldo Manucio en 1497, en el latín de Ficino. Hablan de qué es un alma y de la inteligencia
          artificial. Hacia el minuto 28 Derek comparte su pantalla y recorre el sitio. Después pasan a Drebbel,
          Agripa, Maier, Fludd y Kircher, y a la <em>Oración</em> de Pico y el transhumanismo.
        </p>
        <p className={P}>
          El vídeo y la transcripción están enlazados. Haz clic en cualquier palabra para reproducir desde ese
          momento. Mientras el vídeo avanza, la transcripción lo sigue; en cuanto te desplazas, deja de seguirlo, y el
          botón Siguiendo lo vuelve a activar. Las marcas numeradas remiten a los libros, artículos y otras fuentes que
          se mencionan, al margen del párrafo (debajo, en el móvil).
        </p>

        <section className="mb-14">
          <h2 className={H2}>El episodio</h2>
          <ReadAlong lang="es" otherLanguage={{ href: '/articles/solve-et-coagula', label: 'English transcript', hrefLang: 'en' }} />
          <p className="text-sm text-muted font-sans mt-8 leading-relaxed">
            Transcripción hecha con Whisper y traducida al español con Gemini. La sincronización con el audio es
            aproximada y algunos nombres pueden estar mal oídos. Ver en{' '}
            <a href="https://www.youtube.com/watch?v=MBSFA2FmOj0" target="_blank" rel="noopener" className="underline decoration-accent-gold underline-offset-4">
              YouTube
            </a>
            .
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>Libros mencionados en el episodio</h2>
          <LinkList items={es.mentioned} />
        </section>

        <section className="mb-14">
          <h2 className={H2}>Lecturas</h2>
          <p className={P}>Artículos en inglés sobre los temas del episodio; la hora indica cuándo aparece el tema.</p>
          <LinkList items={es.reading} />
        </section>

        <section className="mb-14">
          <h2 className={H2}>Pruébalo tú</h2>
          <LinkList items={es.tools} />
          <p className={P}>
            Para enterarte de las novedades,{' '}
            <Link href="/es/auth/signin" className="underline decoration-accent-gold underline-offset-4">
              crea una cuenta gratuita en Source Library
            </Link>{' '}
            y recibe el boletín ocasional, o sigue a{' '}
            <a href="https://www.instagram.com/source.library/" target="_blank" rel="noopener" className="underline decoration-accent-gold underline-offset-4">
              @source.library en Instagram
            </a>
            .
          </p>
        </section>
      </article>
    </ContentPageLayout>
  );
}
