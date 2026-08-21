import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogPostSchema from '@/components/seo/BlogPostSchema';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: '10,000 Books - Research Notes - Source Library',
  description:
    'Source Library passed 10,000 books. The 10,000th: Champier\'s Four Volumes of Divine and Human Marvels (1517), a Renaissance encyclopedia never before translated into English.',
  openGraph: {
    title: '10,000 Books',
    description:
      'Champier\'s Four Volumes of Divine and Human Marvels (1517), translated into English for the first time.',
    images: [
      {
        url: 'https://images.sourcelibrary.org/archived/6909aba7cf28baa1b4caef69/5.jpg',
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/6909aba7cf28baa1b4caef69/5.jpg' }],
  },
  alternates: {
    canonical: '/blog/10000-books',
  },
};

export default function TenThousandBooksPage() {
  return (
    <>
      <BlogPostSchema
        slug="10000-books"
        title="10,000 Books"
        description="Source Library passed 10,000 books. The 10,000th: Champier's Four Volumes of Divine and Human Marvels (1517), a Renaissance encyclopedia never before translated into English."
        datePublished="2026-04-13"
        image="https://images.sourcelibrary.org/archived/6909aba7cf28baa1b4caef69/5.jpg"
      />
    <ContentPageLayout
      header={
        <ContentHeader
          title="10,000 Books"
          subtitle="And the Renaissance encyclopedia that nobody translated for 509 years"
          image="https://images.sourcelibrary.org/archived/6909aba7cf28baa1b4caef69/5.jpg"
          imageAlt="Woodcut dedication page from Champier's Mirabilium divinorum, 1517"
        >
          <p className="text-stone-400 text-sm mt-4">13 April 2026 &middot; 4 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        {/* Lede */}
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Source Library has passed 10,000 books.
        </p>

        <p className="text-secondary leading-relaxed mb-10 font-body">
          Four years ago the collection was one book &mdash; Ficino&apos;s <em>Liber de Voluptate</em>,
          untranslated for five centuries, sitting in a glass case at the{' '}
          <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:text-accent-rust underline">
            Embassy of the Free Mind
          </a>{' '}
          in Amsterdam. The collection now holds 10,263 works, spanning Sumerian tablets to
          nineteenth-century Sanskrit, nearly all OCR&apos;d and translated into English. About 95%
          of the pages are done. The pipeline translates roughly 700 new pages a day.
        </p>

        {/* Hero image */}
        <figure className="my-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.sourcelibrary.org/archived/6909aba7cf28baa1b4caef69/5.jpg"
            alt="Woodcut dedication page from Champier's Mirabilium divinorum humanorumque volumina quattuor, 1517, showing Christ enthroned within a celestial scene"
            className="w-full max-w-2xl mx-auto rounded-lg shadow-md"
          />
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            Symphorien Champier, <em>Mirabilium divinorum humanorumque volumina quattuor</em> (1517).
            Bibliotheca Philosophica Hermetica, Amsterdam.
          </figcaption>
        </figure>

        <hr className="border-border-light my-12" />

        {/* Champier */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            The 10,000th book
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            We wanted the 10,000th book to mean something, so we chose one. Symphorien Champier&apos;s{' '}
            <a
              href="https://sourcelibrary.org/book/four-volumes-of-divine-and-human-marvels-champier"
              className="text-accent-rust hover:text-accent-rust underline"
            >
              <em>Mirabilium divinorum humanorumque volumina quattuor</em>
            </a>{' '}
            &mdash; &ldquo;Four Volumes of Divine and Human Marvels&rdquo; &mdash; published in 1517.
            Never translated into English. 165 pages of Latin, accessible only to specialists for
            five hundred and nine years.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Champier was a physician from Lyon. He knew the circle around Pico della Mirandola &mdash;
            the dedication mentions both Pico and Jacques Lef&egrave;vre d&apos;&Eacute;taples by name.
            The book is his attempt to synthesize everything: Orphic, Hermetic, Zoroastrian, Pythagorean,
            Platonic, Aristotelian. Four volumes asking what all these traditions actually agreed on
            about the nature of divinity, the soul, and the cosmos. A Renaissance encyclopedia of
            the perennial philosophy, written by someone who had met the people doing the work.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The physical copy resides at the Bibliotheca Philosophica Hermetica &mdash; the same
            library where this project began. That felt appropriate.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* Runner-ups */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            The runner-ups
          </h2>

          <p className="text-secondary leading-relaxed mb-8 font-body">
            The pipeline doesn&apos;t finish one book at a time. It translates thousands of pages
            simultaneously &mdash; forty books in parallel, eight pages per API call, rotating across
            multiple Gemini keys. On the day we hit 10,000, the pipeline was processing nearly 20,000
            pages per hour. Books arrive in waves, not in a queue. Here are three that crossed the
            line alongside Champier.
          </p>

          {/* Dürer */}
          <h3 className="font-serif text-xl md:text-2xl text-primary mb-4">
            D&uuml;rer&apos;s fortifications
          </h3>

          <figure className="my-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.sourcelibrary.org/archived/69a5b99ed76b98f272fced25/40.jpg"
              alt="Dürer's woodcut plan for an ideal fortified city, showing geometric bastions and defensive structures"
              className="w-full max-w-2xl mx-auto rounded-lg shadow-md"
            />
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              D&uuml;rer&apos;s plan for an ideal fortified city. Getty Research Institute, via Internet Archive.
            </figcaption>
          </figure>

          <p className="text-secondary leading-relaxed mb-4 font-body">
            Everyone knows D&uuml;rer the painter. Fewer know that in 1527, a year before his death,
            he published a treatise on how to protect cities from cannon fire.{' '}
            <a
              href="https://sourcelibrary.org/book/instruction-on-the-fortification-of-cities-durer"
              className="text-accent-rust hover:text-accent-rust underline"
            >
              <em>Etliche Underricht zu Befestigung der Stett</em>
            </a>{' '}
            contains extraordinary woodcuts &mdash; precise geometric plans for bastions, casemates,
            and an ideal fortified city, drawn with the same hand that engraved <em>Melencolia I</em>.
            This is the first complete English translation.
          </p>

          <figure className="my-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.sourcelibrary.org/archived/69a5b99ed76b98f272fced25/22.jpg"
              alt="Woodcut elevation of a fortification bastion with arched casemates"
              className="w-full max-w-2xl mx-auto rounded-lg shadow-md"
            />
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              Elevation of a fortification bastion with arched casemates.
            </figcaption>
          </figure>

          {/* Schurman */}
          <h3 className="font-serif text-xl md:text-2xl text-primary mt-12 mb-4">
            Anna Maria van Schurman&apos;s <em>Opuscula</em>
          </h3>

          <figure className="my-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.sourcelibrary.org/cropped/6984e84d875ef560e34aef4e/6984ea4a1df714da9b420ae8.jpg"
              alt="Title page of Schurman's Opuscula, 1648 Elzevir edition"
              className="w-full max-w-md mx-auto rounded-lg shadow-md"
            />
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              Title page of Anna Maria van Schurman, <em>Opuscula</em> (1648). Bibliotheca Philosophica Hermetica.
            </figcaption>
          </figure>

          <p className="text-secondary leading-relaxed mb-4 font-body">
            Schurman was arguably the most learned woman in seventeenth-century Europe. She read
            fourteen languages, corresponded with Descartes, Rivet, and Voetius, and was the first
            woman admitted to a Dutch university (Utrecht, 1636 &mdash; though she had to listen from
            behind a screen). Her{' '}
            <a
              href="https://sourcelibrary.org/book/minor-works-opuscula-schurman"
              className="text-accent-rust hover:text-accent-rust underline"
            >
              <em>Opuscula</em>
            </a>{' '}
            collects her shorter works: letters, poems in Latin, Greek, and Hebrew, and her famous
            argument that women are capable of scholarly education. Individual pieces have been
            translated before, notably <em>The Learned Maid</em> in 1659. But the complete{' '}
            <em>Opuscula</em> &mdash; the full collection as published by Elzevir &mdash; has never
            appeared in English until now. Our copy bears the bookplate of the Bibliotheca Philosophica
            Hermetica and an ownership inscription from 1652 linking it to Justus Laigneau, a medical
            doctor at Padua.
          </p>

          {/* Reuchlin */}
          <h3 className="font-serif text-xl md:text-2xl text-primary mt-12 mb-4">
            The book that brought Hebrew to Europe
          </h3>

          <figure className="my-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.sourcelibrary.org/archived/6952062dab34727b1f0432ef/4.jpg"
              alt="Page from Reuchlin's De rudimentis hebraicis showing Hebrew text and Latin commentary"
              className="w-full max-w-2xl mx-auto rounded-lg shadow-md"
            />
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              Johann Reuchlin, <em>De rudimentis hebraicis</em> (1506). Bibliotheca Philosophica Hermetica.
            </figcaption>
          </figure>

          <p className="text-secondary leading-relaxed mb-4 font-body">
            Before Reuchlin, a Christian who wanted to read the Old Testament in Hebrew had exactly
            one option: find a Jewish scholar willing to teach you. Pico della Mirandola did this in
            the 1480s, studying Kabbalah with Yohanan Alemanno and Flavius Mithridates. But Pico
            never systematized what he&apos;d learned. The knowledge stayed in private circles,
            passed person to person.
          </p>

          <p className="text-secondary leading-relaxed mb-4 font-body">
            Reuchlin visited Pico in Italy and caught the fire. He spent years tracking down Jewish
            tutors &mdash; Jacob ben Jehiel Loans taught him in Germany; Obadiah Sforno taught him
            in Rome, &ldquo;every day, though not without the payment of a significant fee.&rdquo;
            Then he did what Pico never did: he wrote it all down in a textbook.
          </p>

          <p className="text-secondary leading-relaxed mb-4 font-body">
            <a
              href="https://sourcelibrary.org/book/on-the-fundamentals-of-hebrew-de-rudimentis-hebraicis-reuchlin"
              className="text-accent-rust hover:text-accent-rust underline"
            >
              <em>De rudimentis hebraicis</em>
            </a>{' '}
            was published in 1506. In the preface, Reuchlin explains why:
          </p>

          <blockquote className="border-l-4 border-accent-rust pl-6 my-8">
            <p className="text-secondary italic font-body leading-relaxed">
              I remember the miserable fate of the Jews in our time. They have been driven not only
              from the borders of Spain but also from our own Germany. They are forced to seek other
              homes&hellip; Because of this, it is possible that the Hebrew language might eventually
              cease and vanish from among us.
            </p>
          </blockquote>

          <p className="text-secondary leading-relaxed mb-4 font-body">
            The expulsions were destroying the chain of transmission. Reuchlin wanted to preserve
            what he&apos;d learned before it was lost. He also had bigger ambitions:
          </p>

          <blockquote className="border-l-4 border-accent-rust pl-6 my-8">
            <p className="text-secondary italic font-body leading-relaxed">
              I intend to provide more advanced works in the future. These will serve the secret
              teachings of Pythagoras and the Kabbalistic art. No one can understand these subjects
              unless they have been taught Hebrew first.
            </p>
          </blockquote>

          <p className="text-secondary leading-relaxed mb-4 font-body">
            Three years after publication, the book made Reuchlin famous and nearly destroyed him.
            Johannes Pfefferkorn launched a campaign to confiscate and burn all Jewish books in
            Germany. Reuchlin opposed it. The resulting controversy &mdash; the &ldquo;Reuchlin
            affair&rdquo; &mdash; dragged in the Pope, the Dominican order, the Emperor, and most
            of the intellectuals in Europe. It became one of the defining conflicts of the early
            Reformation.
          </p>

          <p className="text-secondary leading-relaxed mb-4 font-body">
            The book survived. It became the foundation of Christian Hebraism. And for 520 years,
            it was never translated into English. Our copy is from the Bibliotheca Philosophica
            Hermetica &mdash; a library founded to collect exactly the kind of texts Reuchlin was
            trying to unlock.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* Where things stand */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            Where things stand
          </h2>

          <div className="bg-white border border-border-light rounded-xl p-6 md:p-8 my-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
              <div>
                <p className="font-serif text-3xl md:text-4xl text-primary">10,263</p>
                <p className="text-sm text-muted mt-1">books</p>
              </div>
              <div>
                <p className="font-serif text-3xl md:text-4xl text-primary">8,091</p>
                <p className="text-sm text-muted mt-1">fully translated</p>
              </div>
              <div>
                <p className="font-serif text-3xl md:text-4xl text-primary">2.94M</p>
                <p className="text-sm text-muted mt-1">pages done</p>
              </div>
              <div>
                <p className="font-serif text-3xl md:text-4xl text-primary">~44K</p>
                <p className="text-sm text-muted mt-1">pages per day</p>
              </div>
            </div>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The books come from the BPH, the Internet Archive, Gallica, e-rara, the Bayerische
            Staatsbibliothek, HathiTrust, and about forty other digital libraries. Translations
            are produced by Gemini, working page by page from high-resolution scans. The original
            text is always displayed alongside the English so you can check it.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The{' '}
            <Link href="/census" className="text-accent-rust hover:text-accent-rust underline">
              union catalog
            </Link>{' '}
            behind Source Library tracks over 700,000 digitized pre-modern editions. We have translated
            approximately 1.4% of them. The{' '}
            <Link href="/blog/untranslated-renaissance" className="text-accent-rust hover:text-accent-rust underline">
              translation census
            </Link>{' '}
            estimates that roughly 99% of Renaissance texts have never been translated into English
            at all. Ten thousand is a beginning.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* Closing */}
        <section className="mb-16">
          <p className="text-secondary leading-relaxed mb-6 font-body">
            The constraint is no longer technical. Models are fast enough and cheap enough. The
            constraint is curatorial &mdash; deciding what to translate next, in what order, and
            how to make it findable once it arrives. A year ago the question was whether this
            was possible at all.
          </p>

          <p className="text-secondary leading-relaxed mb-10 font-body">
            Champier&apos;s book sat in a library in Amsterdam for five centuries. Now anyone can{' '}
            <a
              href="https://sourcelibrary.org/book/four-volumes-of-divine-and-human-marvels-champier"
              className="text-accent-rust hover:text-accent-rust underline"
            >
              read it
            </a>
            .
          </p>
        </section>

        {/* Footer */}
        <div className="border-t border-border-light pt-8 mt-16">
          <p className="text-secondary text-sm leading-relaxed font-body">
            Source Library is a project of the Embassy of the Free Mind. If you have leads on
            untranslated texts that belong in the collection &mdash;{' '}
            <a href="mailto:team@sourcelibrary.org" className="text-accent-rust hover:text-accent-rust underline">
              team@sourcelibrary.org
            </a>.
          </p>
        </div>
      </article>

    </ContentPageLayout>
    </>
  );
}
