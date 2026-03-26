import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Press Release: Embassy of the Free Mind Launches Source Library — Source Library',
  description:
    'The Embassy of the Free Mind announces the public beta of Source Library, the world\'s largest collection of translated ancient and early modern texts — 5,100+ books translated into English, 4,200+ for the first time.',
  openGraph: {
    title: 'Embassy of the Free Mind Launches Source Library',
    description:
      'The world\'s largest collection of translated ancient texts — 5,100+ books, 1.1 million pages, 4,200+ first-ever English translations. Free and open.',
    images: [
      {
        url: 'https://sourcelibrary.org/og-image.png',
        width: 1200,
        height: 630,
      },
    ],
  },
  alternates: {
    canonical: '/press-release',
  },
};

const STATS = [
  { number: '13,000+', label: 'Digitised books in 50+ languages' },
  { number: '5,100+', label: 'Books with English translation' },
  { number: '1.1M+', label: 'Pages translated into English' },
  { number: '4,200+', label: 'First-ever English translations' },
];

const SHOWCASE_BOOKS = [
  {
    title: 'History of Both Worlds',
    author: 'Robert Fludd',
    year: '1617\u20131619',
    description:
      'Over 1,700 pages on the macrocosm and microcosm, containing some of the most reproduced images in the history of esoteric art. The BPH holds multiple Fludd editions. No complete English translation has existed until now.',
    slug: 'history-of-both-worlds-macrocosm-fludd',
    bph: true,
  },
  {
    title: 'Complete Works of Marsilio Ficino',
    author: 'Marsilio Ficino',
    year: '1561',
    description:
      'The father of the Renaissance Platonic revival. Over 1,000 pages of his complete Latin works. The BPH holds four Ficino editions, including the De Voluptate that inspired the creation of Source Library.',
    slug: 'the-complete-works-of-marsilio-ficino-ficino',
    bph: true,
  },
  {
    title: 'Musurgia Universalis',
    author: 'Athanasius Kircher',
    year: '1650',
    description:
      'A 1,400-page encyclopedia of music, sound, and universal harmony, filled with extraordinary diagrams and musical notation. Never before in English.',
    slug: 'kircher-musurgia-universalis-vol-i-1650-kircher',
    bph: false,
  },
  {
    title: 'Complete Works',
    author: 'Pico della Mirandola',
    year: '1557',
    description:
      'Most readers know only his Oration on the Dignity of Man. This 800-page volume includes the 900 Theses, the Heptaplus, and his polemic against astrology \u2014 from an edition in the BPH\u2019s own collection.',
    slug: 'complete-works-1557-basel-edition-pico-della-mirandola',
    bph: true,
  },
  {
    title: 'The Zohar',
    author: 'Attributed',
    year: '1526',
    description:
      'The central text of Jewish mystical tradition, translated from Hebrew. Source Library extends well beyond Latin, with thousands of newly translated works in Sanskrit, Classical Chinese, Arabic, Armenian, and more.',
    slug: 'the-zohar-book-of-genesis-attributed',
    bph: false,
  },
  {
    title: 'Collected Works of Jacob Boehme',
    author: 'Jacob Boehme',
    year: 'various',
    description:
      'The BPH\u2019s single deepest holding: 231 editions of the visionary shoemaker-mystic. Thirty-seven BPH volumes have been digitised and translated, many for the first time.',
    slug: 'a-fine-treatise-on-many-wonderful-things-sperber',
    bph: true,
  },
];

const COMPARISONS = [
  { name: 'Source Library', count: '5,100+', years: 'Since 2022', access: 'Free & open', highlight: true },
  { name: 'Loeb Classical Library', count: '~540', years: '115 years', access: 'Paywall', highlight: false },
  { name: 'Perseus Digital Library', count: '~1,000', years: '38 years', access: 'Free (reprints)', highlight: false },
  { name: 'Sacred Texts Archive', count: '~1,700', years: '25+ years', access: 'Free (reprints)', highlight: false },
  { name: 'I Tatti Renaissance Library', count: '~100', years: '25 years', access: 'Paywall', highlight: false },
];

export default function PressReleasePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Embassy of the Free Mind Launches Source Library"
          subtitle="The world&rsquo;s largest collection of translated ancient and early modern texts"
        >
          <p className="text-stone-400 text-sm mt-4">FOR IMMEDIATE RELEASE &middot; March 2026 &middot; Amsterdam, the Netherlands</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Library
        </Link>
      </div>

      <article className="prose-content max-w-none">
        {/* Lede */}
        <p className="text-xl text-secondary leading-relaxed mb-4 font-body italic">
          Drawing on the nearly 28,000 works of the Bibliotheca Philosophica Hermetica, the Embassy
          announces a public beta of a digital library with more than 5,000 books translated into
          English, many for the first time.
        </p>
        <p className="text-lg text-accent-rust font-serif mb-10">
          &ldquo;We want to translate the Renaissance&rdquo;
        </p>

        <hr className="border-border-light my-12" />

        {/* Body */}
        <section className="mb-16">
          <p className="text-secondary leading-relaxed mb-6 font-body">
            <strong className="text-stone-800">AMSTERDAM</strong> &mdash; The Embassy of the Free Mind today announces the
            public beta of Source Library, the largest freely available collection of translated
            historical primary sources ever assembled.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            &ldquo;We want to translate the Renaissance with AI and make it available to everyone,&rdquo;
            says program director Dr. Derek Lomas. &ldquo;Most of the Renaissance was written in Latin.
            Yet, at current rates, it would take thousands of years to completely translate the more than
            500,000 untranslated Latin texts. We are transcribing and translating thousands of texts so
            that powerful AI systems have the Renaissance in their training data.&rdquo;
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Source Library begins with the{' '}
            <a href="https://embassyofthefreemind.com/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
              Bibliotheca Philosophica Hermetica
            </a>{' '}
            (BPH), the Amsterdam-based collection founded by Joost R. Ritman and recognised by UNESCO as
            a Memory of the World. The BPH holds nearly 28,000 works spanning alchemy, Hermetica, Kabbalah,
            Rosicrucianism, natural philosophy, and the pre-modern roots of modern science &mdash; including
            231 editions of Jacob Boehme, 160 of Paracelsus, over 100 each of Hermes Trismegistus and
            Giordano Bruno, and dozens of works by Marsilio Ficino, Robert Fludd, Heinrich Cornelius Agrippa,
            and John Dee. It also holds the Guinness World Record as the world&rsquo;s largest library
            dedicated to magic and mysticism.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            More than 2,000 of these works have been digitised so far, with over 1,000 already translated
            into English. Source Library extends the BPH&rsquo;s founding mission &mdash; preserving and
            opening access to humanity&rsquo;s deepest philosophical explorations &mdash; by translating
            these texts at a scale that was previously impossible.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* A new scale of access */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            A new scale of access
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Beyond the BPH&rsquo;s own holdings, Source Library draws on digitised books from major
            research libraries worldwide, including the Bavarian State Library, the Biblioth&egrave;que
            nationale de France, the Vatican Library, the Bodleian Library at Oxford, the Wellcome
            Collection, the Library of Congress, Cambridge University Library, and many others &mdash;
            accessed through IIIF and the Internet Archive.
          </p>

          <p className="text-secondary leading-relaxed mb-8 font-body">
            The result is a collection that surpasses every comparable resource by an order of magnitude.
          </p>

          {/* Comparison table */}
          <div className="bg-warm rounded-lg border border-border-light p-6 md:p-8 mb-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-medium">
                  <th className="text-left py-2 text-secondary font-medium">Collection</th>
                  <th className="text-right py-2 text-secondary font-medium px-4">Translated texts</th>
                  <th className="text-right py-2 text-secondary font-medium hidden md:table-cell">Time span</th>
                  <th className="text-right py-2 text-secondary font-medium">Access</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISONS.map((c) => (
                  <tr key={c.name} className={`border-b border-border-light ${c.highlight ? 'bg-accent-rust/5' : ''}`}>
                    <td className={`py-2.5 font-medium ${c.highlight ? 'text-accent-rust' : 'text-secondary'}`}>
                      {c.name}
                    </td>
                    <td className={`py-2.5 text-right px-4 tabular-nums ${c.highlight ? 'text-accent-rust font-medium' : 'text-muted'}`}>
                      {c.count}
                    </td>
                    <td className="py-2.5 text-right text-muted hidden md:table-cell">{c.years}</td>
                    <td className="py-2.5 text-right text-muted text-xs">{c.access}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Unlike these collections, Source Library produces new translations of texts that have never
            been available in English, and provides them without a paywall or institutional subscription.
          </p>
        </section>

        {/* Stats block */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-12">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center py-5 px-3 bg-warm rounded-lg border border-border-light">
              <div className="font-serif text-3xl md:text-4xl text-accent-rust mb-1">{stat.number}</div>
              <div className="text-xs text-muted leading-tight">{stat.label}</div>
            </div>
          ))}
        </div>

        <hr className="border-border-light my-12" />

        {/* Works that have waited centuries */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            Works that have waited centuries
          </h2>

          <p className="text-secondary leading-relaxed mb-8 font-body">
            Among the translations now available for the first time in English:
          </p>

          <div className="space-y-6">
            {SHOWCASE_BOOKS.map((book) => (
              <div key={book.slug} className="bg-warm rounded-lg border border-border-light p-6">
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div>
                    <h3 className="font-serif text-lg text-primary">
                      <a
                        href={`https://sourcelibrary.org/book/${book.slug}`}
                        className="hover:text-accent-rust transition-colors"
                      >
                        {book.title}
                      </a>
                    </h3>
                    <p className="text-sm text-muted">
                      {book.author} &middot; {book.year}
                    </p>
                  </div>
                  {book.bph && (
                    <span className="text-xs text-accent-rust bg-accent-rust/10 px-2 py-1 rounded shrink-0">
                      BPH collection
                    </span>
                  )}
                </div>
                <p className="text-sm text-secondary leading-relaxed font-body">
                  {book.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <hr className="border-border-light my-12" />

        {/* AI translation */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            AI translation as a tool for access
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Source Library&rsquo;s translations are generated using frontier artificial intelligence
            models (Google Gemini 3), not traditional scholarly editing. Each translated page is
            presented directly alongside an image of the original-language text, so scholars can
            always consult the source directly.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            These are working translations, not critical editions. AI handles cleanly printed Latin
            remarkably well, but users will encounter errors &mdash; particularly with handwritten
            manuscripts, damaged pages, and unusual scripts. Some texts that appear as
            &ldquo;first translations&rdquo; may have existing translations we have not yet identified.
            The collection is a beta in the fullest sense: it is published early so the scholarly
            community can help improve it.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The Embassy views AI translation as a complement to, not a replacement for, expert human
            scholarship. The goal is not to produce definitive editions but to make vast bodies of
            untranslated material discoverable and navigable for the first time &mdash; lowering
            the barrier that has kept these texts confined to specialists for centuries. A working
            translation that lets a researcher find a relevant passage in a 1,000-page Latin treatise
            is, we believe, better than no translation at all.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* Quotes */}
        <section className="mb-16">
          <div className="border-l-4 border-accent-rust pl-6 mb-10">
            <p className="text-lg text-secondary italic font-body leading-relaxed mb-3">
              &ldquo;[Quote from EFM director about the BPH&rsquo;s mission of making knowledge
              accessible, and what Source Library represents for the collection&rsquo;s next chapter.]&rdquo;
            </p>
            <p className="text-sm text-muted">
              &mdash; [Name, Title], Embassy of the Free Mind
            </p>
          </div>

          <div className="border-l-4 border-accent-rust pl-6">
            <p className="text-lg text-secondary italic font-body leading-relaxed mb-3">
              &ldquo;[Quote from Derek Lomas about the vision, the scale of what has been achieved,
              and the invitation to scholars and the public.]&rdquo;
            </p>
            <p className="text-sm text-muted">
              &mdash; Derek Lomas, Program Director, Source Library
            </p>
          </div>
        </section>

        <hr className="border-border-light my-12" />

        {/* About the public beta */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            About the public beta
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Source Library is released as a public beta. The project began in 2022 when Lomas encountered
            an{' '}
            <a href="https://sourcelibrary.org/blog/origin-story" className="text-accent-rust hover:underline">
              untranslated Ficino manuscript
            </a>{' '}
            in the BPH&rsquo;s collection and wondered why, in an age of AI, it had never been rendered
            into English. The collection has grown rapidly since, and there are rough edges. Manuscript transcriptions are often imperfect.
            Metadata for some books is incomplete. Some &ldquo;first translation&rdquo; claims will
            turn out to be wrong once scholars with deeper knowledge of specific fields weigh in.
            We are publishing now rather than waiting for perfection because the alternative &mdash;
            leaving hundreds of thousands of texts inaccessible while we polish &mdash; serves no one.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The aspiration is simple: translate the entire Renaissance. The{' '}
            <a href="https://sourcelibrary.org/blog/counting-the-gap" className="text-accent-rust hover:underline">
              Universal Short Title Catalogue
            </a>{' '}
            records over 690,000 distinct non-English works printed between 1450 and 1700. We estimate
            that fewer than 5% have ever been translated into English. AI translation is now fast enough
            and good enough to close that gap within years, not centuries. Source Library is the beginning
            of that effort.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            We welcome corrections, additions, and criticism. If you find an error, know of an existing
            translation we missed, or want to contribute expertise on a particular text or tradition,
            please reach out.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Source Library is available now at{' '}
            <a href="https://sourcelibrary.org" className="text-accent-rust hover:underline">
              sourcelibrary.org
            </a>
            . Feedback is welcome at{' '}
            <a href="mailto:derek@sourcelibrary.org" className="text-accent-rust hover:underline">
              derek@sourcelibrary.org
            </a>.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* About sections */}
        <section className="mb-16">
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-warm rounded-lg border border-border-light p-6">
              <h3 className="font-serif text-lg text-primary mb-3">About the Embassy of the Free Mind</h3>
              <p className="text-sm text-secondary leading-relaxed font-body">
                The Embassy of the Free Mind is a museum, library, and cultural centre in Amsterdam,
                housed in the historic Huis met de Hoofden on the Keizersgracht. It is home to the
                Bibliotheca Philosophica Hermetica (BPH), founded by Joost R. Ritman &mdash; a collection
                of approximately 25,000 printed volumes and nearly 3,000 manuscripts on Hermetica, alchemy,
                mysticism, Rosicrucianism, Kabbalah, and gnosis. The BPH has been recognised by UNESCO as
                a &ldquo;Memory of the World&rdquo; (2022) and by Guinness World Records as the
                world&rsquo;s largest library dedicated to magic and mysticism (2024). The Embassy&rsquo;s
                mission is to inspire free thinking and make the wisdom traditions of the past accessible
                to all.{' '}
                <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
                  embassyofthefreemind.com
                </a>
              </p>
            </div>

            <div className="bg-warm rounded-lg border border-border-light p-6">
              <h3 className="font-serif text-lg text-primary mb-3">About Source Library</h3>
              <p className="text-sm text-secondary leading-relaxed font-body">
                Source Library is a free, open-access digital library of translated ancient and early modern
                primary sources. Using AI-powered translation, it makes previously inaccessible texts
                available in English alongside their original languages. Beginning from the Bibliotheca
                Philosophica Hermetica&rsquo;s own collection of nearly 28,000 works, it has expanded to
                include 13,000+ digitised books in 50+ languages from major research libraries worldwide.
                Source Library is an initiative of the Embassy of the Free Mind.{' '}
                <a href="https://sourcelibrary.org" className="text-accent-rust hover:underline">
                  sourcelibrary.org
                </a>
              </p>
            </div>
          </div>
        </section>

        {/* Media contact */}
        <div className="bg-warm rounded-lg border border-border-light p-6 text-center">
          <h3 className="font-serif text-lg text-primary mb-2">Media contact</h3>
          <p className="text-sm text-secondary font-body">
            Derek Lomas, Program Director
          </p>
          <p className="text-sm text-secondary font-body">
            <a href="mailto:derek@sourcelibrary.org" className="text-accent-rust hover:underline">
              derek@sourcelibrary.org
            </a>
          </p>
          <p className="text-sm text-muted font-body mt-1">
            Embassy of the Free Mind, Keizersgracht 123, Amsterdam
          </p>
        </div>
      </article>
    </ContentPageLayout>
  );
}
