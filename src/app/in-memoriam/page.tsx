import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'In Memoriam: Joost R. Ritman (1941–2026) — Source Library',
  description:
    'In memory of Joost R. Ritman, founder of the Bibliotheca Philosophica Hermetica — the library where Source Library began, and the man whose motto was ad fontes.',
  alternates: {
    canonical: '/in-memoriam',
  },
};

export default function InMemoriamPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Joost R. Ritman"
          subtitle="10 March 1941 — 5 June 2026"
          image="/memoriam/joost-ritman.jpg"
          imageAlt="Joost R. Ritman at the Embassy of the Free Mind, 2017"
          heightClass="min-h-[340px] md:min-h-[460px]"
        >
          <p className="text-secondary text-sm leading-relaxed">
            <span className="text-accent-gold/90 font-serif italic">In memoriam</span>
            {' '}&middot; Founder of the Bibliotheca Philosophica Hermetica.{' '}
            <span className="text-secondary/70">Photo: Embassy of the Free Mind, 2017.</span>
          </p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none">
        <p className="text-2xl md:text-3xl text-primary leading-snug mb-10 font-serif">
          Every book in this library descends from one man&rsquo;s conviction that the
          wisdom of the past belongs to everyone.
        </p>

        <p className="text-xl text-secondary leading-relaxed mb-6">
          Joost Ruben Ritman &mdash; entrepreneur, art collector, and Rosicrucian &mdash;
          gave seventy years of his life to a single mission. At sixteen he had the
          realization that <span className="italic">everything is one</span>, and he never
          let go of it. He built a fortune and spent it gathering the hermetic, alchemical,
          and mystical heritage of humankind into one place, guided by a principle he made
          his own: <span className="font-serif italic">ad fontes</span> &mdash; back to the
          source. He sought the earliest, most authentic edition of every work he could find.
        </p>

        <p className="text-xl text-secondary leading-relaxed mb-6">
          In 1984 he opened that collection to the public as the{' '}
          <a
            href="https://www.embassyofthefreemind.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-rust hover:underline"
          >
            Bibliotheca Philosophica Hermetica
          </a>{' '}
          &mdash; the Ritman Library &mdash; centred on Hermes Trismegistus and grown into
          one of the great collections of esoteric thought, inscribed on UNESCO&rsquo;s
          Dutch Memory of the World Register. In 2007 he acquired Amsterdam&rsquo;s House
          with the Heads, built in 1622, as its permanent home; in 2015 he gave both the
          library and the building away so they could outlast him. From that gift rose the
          Embassy of the Free Mind &mdash; a research institute, a publishing house, a
          museum, and an academy &mdash; a living institute, in his words,{' '}
          <span className="italic">hermetically open to all</span>.
        </p>

        <p className="text-xl text-secondary leading-relaxed mb-6">
          He was described by those who knew him as generous and spirited, untamable and
          elusive and persistent &mdash; a man who made the impossible possible, and a
          passionate guardian of the freedom of the mind. He built bridges between worlds
          and between people, and never stopped believing that a single rare book, read and
          understood, could change a life.
        </p>

        <figure className="my-12 border-l-2 border-accent-gold/40 pl-6">
          <blockquote className="font-serif text-2xl md:text-3xl text-primary leading-snug italic mb-3">
            &ldquo;Everything is visible to who has mind. Who contemplates himself with his
            mind, knows himself, knows the All: the All is within man.&rdquo;
          </blockquote>
          <figcaption className="text-base text-secondary not-italic">
            &mdash; Hermes Trismegistus, a passage Joost Ritman carried throughout his life
          </figcaption>
        </figure>

        <p className="text-xl text-secondary leading-relaxed mb-6">
          Source Library began in his library. It was at the Embassy of the Free Mind, among
          the shelves Joost Ritman spent a lifetime building, that we came across Marsilio
          Ficino&rsquo;s <em>Liber de Voluptate</em> &mdash; written in 1457, printed in 1497,
          and never once translated into English in all the centuries since. That single
          untranslated book became the seed of everything you can read here. The motto of
          this library is the motto that was his: <span className="font-serif italic">ad
          fontes</span>, carried forward.
        </p>

        <p className="text-xl text-secondary leading-relaxed mb-12">
          We are here because he was here first. Every text we digitize, translate, and give
          freely to the world is a continuation of the work he began, and a debt of gratitude
          we will go on repaying for as long as this library stands.
        </p>

        <div className="border-t border-border-light pt-8 mt-4">
          <p className="text-base text-secondary leading-relaxed">
            The Embassy of the Free Mind has published its own remembrance of its founder.{' '}
            <a
              href="https://www.embassyofthefreemind.com/news/in-memoriam-joost-r-ritman"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-rust hover:underline"
            >
              Read the Embassy&rsquo;s In Memoriam &rarr;
            </a>
          </p>
        </div>
      </div>
    </ContentPageLayout>
  );
}
