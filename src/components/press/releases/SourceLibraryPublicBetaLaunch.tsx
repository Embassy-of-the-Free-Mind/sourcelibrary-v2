/**
 * Press release body — "Most of the Renaissance Was Never Translated" (June 2026 launch).
 * Mission-led: the public narrative is the untranslated-Renaissance idea, the scale, and open
 * access. Fundraising/asks live only in private donor materials, never here.
 * Figures verified against the live Source Library database on 30 May 2026.
 * Header/dateline and back-link are supplied by the /press-releases/[slug] route.
 */

const STATS = [
  { number: '13,900+', label: 'Digitised books in 170+ languages' },
  { number: '13,000+', label: 'Books translated into English' },
  { number: '6,900+', label: 'First-ever English translations' },
  { number: '~4M', label: 'Pages translated, beside their originals' },
];

const SHOWCASE_BOOKS = [
  {
    title: 'History of Both Worlds',
    author: 'Robert Fludd',
    year: '1617–1619',
    description:
      'Over 1,700 pages on the macrocosm and microcosm, containing some of the most reproduced images in the history of esoteric art. The BPH holds multiple Fludd editions. No complete English translation had existed until now.',
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
      'Most readers know only his Oration on the Dignity of Man. This 800-page volume includes the 900 Theses, the Heptaplus, and his polemic against astrology — from an edition in the BPH’s own collection.',
    slug: 'complete-works-1557-basel-edition-pico-della-mirandola',
    bph: true,
  },
  {
    title: 'The Zohar',
    author: 'Attributed',
    year: '1526',
    description:
      'The central text of the Jewish mystical tradition, translated from Hebrew. Source Library extends far beyond Latin, with thousands of newly translated works in Sanskrit, Classical Chinese, Tibetan, Arabic, Armenian, and more.',
    slug: 'the-zohar-book-of-genesis-attributed',
    bph: false,
  },
];

const COMPARISONS = [
  { name: 'Source Library', count: '13,000+', years: 'Since 2022', access: 'Free & open', highlight: true },
  { name: 'Loeb Classical Library', count: '~540', years: '115 years', access: 'Paywall', highlight: false },
  { name: 'Perseus Digital Library', count: '~1,000', years: '38 years', access: 'Free (reprints)', highlight: false },
  { name: 'Sacred Texts Archive', count: '~1,700', years: '25+ years', access: 'Free (reprints)', highlight: false },
  { name: 'I Tatti Renaissance Library', count: '~100', years: '25 years', access: 'Paywall', highlight: false },
];

export default function SourceLibraryPublicBetaLaunch() {
  return (
    <article className="prose-content max-w-none">
      {/* Lede — lead with the idea, not the announcement */}
      <p className="text-2xl text-accent-rust font-serif leading-snug mb-6">
        To create the next Renaissance, translate the first.
      </p>
      <p className="text-xl text-secondary leading-relaxed mb-10 font-body">
        Most of what the Renaissance wrote has never been translated into English. A free digital
        library at the Embassy of the Free Mind in Amsterdam has set out to change that &mdash; and has
        already become the largest collection of translated historical primary sources ever assembled.
      </p>

      <hr className="border-border-light my-12" />

      {/* The gap — the substance, up front */}
      <section className="mb-16">
        <p className="text-secondary leading-relaxed mb-6 font-body">
          <strong className="text-stone-800">AMSTERDAM</strong> &mdash; In 1462, Cosimo de&rsquo; Medici
          paid Marsilio Ficino to translate the <em>Corpus Hermeticum</em> from Greek into Latin, and
          helped set the Renaissance in motion. Five centuries later, most of the Renaissance still
          waits to be translated.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          A census conducted by Source Library &mdash; believed to be the first of its kind &mdash;
          matched roughly 1.6 million editions from the{' '}
          <a href="https://sourcelibrary.org/census" className="text-accent-rust hover:underline">
            Universal Short Title Catalogue
          </a>{' '}
          against Library of Congress holdings and dozens of additional catalogues. The finding: the
          overwhelming majority of everything printed in Europe between 1450 and 1700 has never been
          translated into English &mdash; and that is before counting the manuscript traditions, or the
          vast written inheritance of China, India, the Islamic world, and beyond. At the pace of
          traditional scholarship, closing that gap would take many centuries.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          &ldquo;The assumption that the important texts have already been translated is simply wrong
          &mdash; we tested it,&rdquo; says Derek Lomas, founder of Source Library and a cognitive
          scientist and researcher at TU Delft. &ldquo;The intellectual foundation of the modern world
          has been locked behind languages almost no one reads anymore &mdash; not only Latin, but
          Classical Chinese, Sanskrit, Arabic, Tibetan, Armenian. We built Source Library to open it.&rdquo;
        </p>
      </section>

      <hr className="border-border-light my-12" />

      {/* The answer */}
      <section className="mb-16">
        <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
          A library of the untranslated
        </h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Today the Embassy of the Free Mind opens the public beta of Source Library, which has used AI
          to translate more than <strong className="text-stone-800">13,000 historical books</strong> into
          English &mdash; including close to <strong className="text-stone-800">7,000 works that had never
          before appeared in any modern language</strong> &mdash; across roughly four million pages, each
          shown beside its original scan, and free for anyone to read.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The project begins from the{' '}
          <a href="https://embassyofthefreemind.com/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
            Bibliotheca Philosophica Hermetica
          </a>{' '}
          (BPH), the Embassy&rsquo;s 25,000-volume collection of rare works on Hermeticism, alchemy,
          mysticism, Rosicrucianism, and Kabbalah, inscribed on UNESCO&rsquo;s Memory of the World
          Register &mdash; and reaches outward from there into the wider record of human thought.
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

      {/* A new scale of access */}
      <section className="mb-16">
        <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
          A new scale of access
        </h2>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          The collection already exceeds every comparable resource by an order of magnitude &mdash; and
          unlike them, it produces new translations of texts that have never been available in English,
          without a paywall or institutional subscription.
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

        {/* Wikipedia-scale callout */}
        <div className="bg-accent-gold/5 rounded-lg border border-accent-gold/20 p-6 md:p-8 mb-8">
          <h3 className="font-serif text-lg text-primary mb-3">On the scale of all of Wikipedia &mdash; in primary sources</h3>
          <p className="text-secondary leading-relaxed font-body mb-3">
            The English Wikipedia, the largest reference work ever created, holds about{' '}
            <strong className="text-stone-800">5 billion words</strong> across 7.2 million articles.
            Source Library&rsquo;s English translations alone come to roughly{' '}
            <strong className="text-stone-800">1.7 billion words</strong> &mdash; about a third that size.
            Counting the original-language transcriptions shown beside every translation, plus the
            AI-generated summaries and indexes, the full corpus runs to roughly{' '}
            <strong className="text-stone-800">3.5 billion words &mdash; around 5 billion tokens</strong>,
            approaching the size of the entire English Wikipedia. But where Wikipedia is modern summary,
            this is the original record of human thought across five centuries and more than 170 languages.
          </p>
          <p className="text-xs text-muted font-body">
            Word counts estimated from random samples of the 6.5-million-page corpus (4 million+ pages
            translated), using median and trimmed-mean page lengths to exclude OCR artifacts; original
            transcriptions in non-spaced scripts (e.g. Chinese, Tibetan) are undercounted, so the true
            total is higher. English Wikipedia figures per Wikipedia&rsquo;s own statistics, May 2026.
          </p>
        </div>
      </section>

      <hr className="border-border-light my-12" />

      {/* How it works */}
      <section className="mb-16">
        <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
          How it works
        </h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Source Library ingests high-resolution page scans from major research libraries worldwide
          &mdash; among them the Internet Archive, the Bavarian State Library, the Biblioth&egrave;que
          nationale de France (Gallica), the Vatican Library, the Bodleian Library at Oxford, the
          Wellcome Collection, and the Library of Congress &mdash; then uses frontier AI models (Google
          Gemini) to read each page in its original language and render it into English. Every translated
          page is displayed directly alongside the original scan, so readers and scholars can check the
          translation against the source.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          AI makes it possible to do in months what would otherwise take centuries. It is not a
          replacement for expert human scholarship; it is a way to do the part no one ever had the
          bandwidth to do &mdash; making vast bodies of untranslated material readable and navigable for
          the first time, and lowering the barrier that has kept these texts confined to specialists.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Because the translations are in English, they can in turn be carried into any modern language
          with widely available tools. English becomes a bridge: a text once legible to a handful of
          specialists in Latin or Classical Chinese can now reach readers in every language on earth.
        </p>
      </section>

      <hr className="border-border-light my-12" />

      {/* Works that have waited centuries */}
      <section className="mb-16">
        <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
          Works that have waited centuries
        </h2>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          Among the works now readable in English for the first time:
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

      {/* For scholars and AI */}
      <section className="mb-16">
        <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
          For scholars and AI systems
        </h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Every book has a permanent URL and structured metadata. Selected translations are published as
          scholarly editions with DOIs through Zenodo, making them citable in academic work. An open API
          and a Model Context Protocol (MCP) server let AI systems query the library directly &mdash; so
          that language models can learn from primary sources rather than secondhand summaries. Source
          Library is offered as a working draft of the historical record: scholars are invited to correct
          it, and every correction makes it better.
        </p>
      </section>

      <hr className="border-border-light my-12" />

      {/* Quote */}
      <section className="mb-16">
        <div className="border-l-4 border-accent-rust pl-6">
          <p className="text-lg text-secondary italic font-body leading-relaxed mb-3">
            &ldquo;Joost Ritman built this library on one conviction: that wisdom belongs to everyone.
            For decades much of it sat on our shelves, readable only by specialists. To see thousands of
            these works open at once &mdash; in English, beside their originals, free to anyone &mdash; is
            to watch that conviction become real at a scale we never expected to witness.&rdquo;
          </p>
          <p className="text-sm text-muted">
            &mdash; [Name, Title], Embassy of the Free Mind <span className="italic">(quote draft, pending approval)</span>
          </p>
        </div>
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
              of roughly 25,000 volumes on Hermetica, alchemy, mysticism, Rosicrucianism, Kabbalah, and
              gnosis, inscribed on the UNESCO Memory of the World Register. Scholarly guidance is provided
              by Library Director Paul Dijstelberge and an Academic Advisory Board including Wouter
              Hanegraaff (University of Amsterdam), Lawrence Principe (Johns Hopkins), Bernard McGinn
              (University of Chicago, emer.), Georgiana Hedesan (Oxford), and Didier Kahn (CNRS).{' '}
              <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
                embassyofthefreemind.com
              </a>
            </p>
          </div>

          <div className="bg-warm rounded-lg border border-border-light p-6">
            <h3 className="font-serif text-lg text-primary mb-3">About Source Library</h3>
            <p className="text-sm text-secondary leading-relaxed font-body">
              Source Library is a free, open-access digital library of translated ancient and early modern
              primary sources, founded by Derek Lomas in 2022 after he encountered Marsilio Ficino&rsquo;s{' '}
              <em>Liber de Voluptate</em> at the Embassy of the Free Mind. Using AI-assisted translation,
              it makes previously inaccessible texts readable in English alongside their original
              languages. The platform is open-source and its translations are published under a Creative
              Commons Attribution-ShareAlike 4.0 licence (CC BY-SA 4.0). Source Library is an initiative of
              the Embassy of the Free Mind.{' '}
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
        <p className="text-sm text-secondary font-body">Derek Lomas, Founder</p>
        <p className="text-sm text-secondary font-body">
          <a href="mailto:derek@sourcelibrary.org" className="text-accent-rust hover:underline">
            derek@sourcelibrary.org
          </a>
        </p>
        <p className="text-sm text-muted font-body mt-1">
          Embassy of the Free Mind, Keizersgracht 123, Amsterdam
        </p>
        <p className="text-xs text-muted font-body mt-3">
          Figures verified against the live Source Library database, 30 May 2026.
        </p>
      </div>
    </article>
  );
}
