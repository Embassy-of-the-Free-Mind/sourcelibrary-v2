import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import ReadAlong from './ReadAlong';
import { LISTS, type ReadAlongLink } from './extras';

// The Solve et Coagula episode (Agrippa's Diary, YouTube MBSFA2FmOj0, 1:32:23) as a read-along article.
// It replaces the standalone page at sourcelib-solve-et-coagula.vercel.app, whose transcript, references
// and lists it reuses (see ReadAlong.tsx and extras.ts). Everything said about the episode below comes
// from that transcript and its chapter list. Spanish twin: src/app/es/articles/solve-et-coagula.
//
// Hero: a frame of the episode itself (1:31:10), Alexander and Derek side by side; Derek chose a picture of
// the podcast over a plate (2026-11-09). Screen grabs from his tour of the site sit in the transcript
// (FIGURES in ReadAlong.tsx), cut from the episode video with the browser bar cropped off.

const TITLE = 'Solve et Coagula: Derek Lomas on Source Library';
const DESCRIPTION =
  'Derek Lomas talks with Alex of Agrippa’s Diary about Ficino, Agrippa, Maier and Source Library. Watch the episode and click any word of the transcript.';
const HERO = '/articles/solve-et-coagula/episode-artwork.jpg';
const HERO_ALT =
  'Derek Lomas (left) and Alexander of Agrippa’s Diary (right), either side of a green lion devouring the sun: the episode’s artwork, from Agrippa’s Diary.';

export const metadata: Metadata = withArticleMeta('solve-et-coagula', {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: { images: [{ url: HERO, alt: HERO_ALT }], title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: {
    canonical: '/articles/solve-et-coagula',
    languages: { en: '/articles/solve-et-coagula', es: '/es/articles/solve-et-coagula' },
  },
});

const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-2xl md:text-3xl text-primary mb-6';

// "Where Source Library came from (18:23)": the time is where it comes up in the episode.
function LinkList({ items }: { items: ReadAlongLink[] }) {
  return (
    <ul className="list-disc pl-5 space-y-2 text-secondary font-body leading-relaxed mb-6">
      {items.map((m) => {
        const at = m.title.match(/^(.*?)\s*\((\d+:\d{2}(?::\d{2})?)\)$/);
        return (
          <li key={m.url}>
            <Link href={m.url}>{at ? at[1] : m.title}</Link>
            {at && <span className="text-muted text-sm font-sans"> &middot; {at[2]}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export default function SolveEtCoagulaPage() {
  const en = LISTS.en;
  // The books go to the "Books in this article" grid the layout adds; the two articles in the
  // episode's "mentioned" list lead the reading list instead.
  const mentionedArticles = en.mentioned.filter((m) => m.url.startsWith('/articles/'));
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          feature
          headerVariant="dark"
          image={HERO}
          imageAlt={HERO_ALT}
          title={TITLE}
          subtitle="Alex of Agrippa’s Diary in conversation with Derek Lomas, at the Embassy of the Free Mind in Amsterdam. The full episode, with a transcript you can click."
        >
          <p className="text-stone-400 text-sm mt-4">9 November 2026 &middot; video, 1 h 32 min</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-6 font-body">
          Derek Lomas, who started Source Library at the Embassy of the Free Mind in Amsterdam, was the guest of
          Alex, who runs the YouTube channel Agrippa&rsquo;s Diary, on its Solve et Coagula podcast. The
          conversation runs an hour and a half.
        </p>
        <p className={P}>
          The first half is about how Derek came to this material: a tutorial on Plato and Aristotle at Yale, the
          Pythagoreans, and the first rare book he bought, the 1497 Aldine{' '}
          <Link href="/book/iamblichus-de-mysteriis-1497-aldine-editio-princeps-trans">
            <em>De mysteriis</em> of Iamblichus
          </Link>{' '}
          in Ficino&rsquo;s Latin. He describes trying to read Ficino&rsquo;s complete works in the Embassy&rsquo;s
          reading room, finding they were in Latin, and how little Renaissance Latin has been translated. They talk
          about what a soul is, and about AI. At about 28 minutes Derek shares his screen and goes through the
          site. After that they turn to Drebbel, Agrippa, Maier, Fludd and Kircher, and to Pico&rsquo;s <em>Oration</em>{' '}
          and transhumanism.
        </p>
        <p className={P}>
          The video and the transcript below are linked. Click any word to play from that moment. While the video
          plays, the transcript follows it; as soon as you scroll, it stops following, and the Following button turns
          it back on. The numbered marks in the text point to the books, articles and other sources that come up,
          shown in the margin beside the paragraph (below it on a phone). The chapters list jumps to each topic.
        </p>

        <section className="mb-14">
          <h2 className={H2}>The episode</h2>
          <ReadAlong lang="en" otherLanguage={{ href: '/es/articles/solve-et-coagula', label: 'Transcripción en español', hrefLang: 'es' }} />
          <p className="text-sm text-muted font-sans mt-8 leading-relaxed">
            The transcript was made with Whisper and aligned to the audio; names may be misheard. Watch on{' '}
            <a href="https://www.youtube.com/watch?v=MBSFA2FmOj0" target="_blank" rel="noopener">
              YouTube
            </a>{' '}
            or{' '}
            <a href="https://www.youtube.com/@AgrippasDiary" target="_blank" rel="noopener">
              subscribe to Agrippa&rsquo;s Diary
            </a>
            .
          </p>
        </section>

        <section className="mb-14">
          <h2 className={H2}>Further reading</h2>
          <p className={P}>
            Articles on the subjects of the episode. The time is where the subject comes up; the books mentioned are
            listed after the article.
          </p>
          <LinkList items={[...mentionedArticles, ...en.reading]} />
        </section>

        <section className="mb-14">
          <h2 className={H2}>Try it yourself</h2>
          <LinkList items={en.tools} />
          <p className={P}>
            To hear when there is something new, <Link href="/auth/signin">make a free Source Library account</Link>{' '}
            and get the occasional newsletter, or follow{' '}
            <a href="https://www.instagram.com/source.library/" target="_blank" rel="noopener">
              @source.library on Instagram
            </a>{' '}
            for pages from the books.
          </p>
        </section>
      </article>
    </ContentPageLayout>
  );
}
