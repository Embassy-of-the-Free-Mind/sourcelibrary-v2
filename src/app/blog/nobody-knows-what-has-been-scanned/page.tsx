import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogPostSchema from '@/components/seo/BlogPostSchema';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Nobody Knows What Has Been Scanned - Research Notes - Source Library',
  description:
    'There is no global registry of digitized books. Every library that wants to scan responsibly has to privately rebuild the same census — we know, because we just did. The case for a shared one.',
  openGraph: {
    title: 'Nobody Knows What Has Been Scanned',
    description:
      'There is no global registry of digitized books. The case for building a shared one.',
    images: [
      {
        url: 'https://images.sourcelibrary.org/archived/69b51d1f47b06ecd58183e84/2.jpg',
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/69b51d1f47b06ecd58183e84/2.jpg' }],
  },
  alternates: {
    canonical: '/blog/nobody-knows-what-has-been-scanned',
  },
};

export default function GlobalScanRegistryPage() {
  return (
    <>
      <BlogPostSchema
        slug="nobody-knows-what-has-been-scanned"
        title="Nobody Knows What Has Been Scanned"
        description="There is no global registry of digitized books. Every library that wants to scan responsibly has to privately rebuild the same census. The case for a shared one."
        datePublished="2026-08-09"
        image="https://images.sourcelibrary.org/archived/69b51d1f47b06ecd58183e84/2.jpg"
      />
      <ContentPageLayout
        header={
          <ContentHeader
            title="Nobody Knows What Has Been Scanned"
            subtitle="The case for a global registry of digitized books"
            image="https://images.sourcelibrary.org/archived/69b51d1f47b06ecd58183e84/2.jpg"
            imageAlt="Engraved title page of Zwinger's Theatrum Humanae Vitae, 1604 — the largest encyclopedia of its age"
          >
            <p className="text-stone-400 text-sm mt-4">9 August 2026 &middot; 6 min read</p>
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
            Here is a question no institution on earth can answer: <em>has this book been scanned?</em>
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Not &ldquo;does my library have a scan&rdquo; &mdash; any catalogue can answer that.
            The real question a scanning program needs answered: has <em>anyone</em>, at any of the
            thousands of institutions digitizing books, already put this particular printing online?
            Because scanning budgets are finite, and the marginal scan should be a book the world
            lacks, not a fourth copy of one it already has.
          </p>

          <p className="text-secondary leading-relaxed mb-10 font-body">
            There is no registry to ask. This post is about what we had to build instead, and why
            the world should build the real thing together.
          </p>

          <hr className="border-border-light my-12" />

          <section className="mb-16">
            <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
              What it took to answer the question once
            </h2>

            <p className="text-secondary leading-relaxed mb-6 font-body">
              This week we tried to answer it for one library: the{' '}
              <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:text-accent-rust underline">
                Bibliotheca Philosophica Hermetica
              </a>{' '}
              in Amsterdam, whose 29,879-record catalogue we help steward. The library wants to
              digitize; it wanted to know which of its books deserve the scanner first.
            </p>

            <p className="text-secondary leading-relaxed mb-6 font-body">
              To find out, we had to compare the catalogue against every digitization we could see.
              &ldquo;Every digitization we could see&rdquo; is doing enormous work in that sentence.
              There is no list. We have spent months harvesting one: 3.5 million records of scanned
              books, gathered institution by institution &mdash; the Internet Archive, the Bavarian
              State Library, e-rara, Gallica, Biblissima, the Vatican, and a dozen more &mdash;
              because the IIIF standard that makes scans interoperable deliberately has no central
              registry of what exists. In the IIIF community this is politely called the
              &ldquo;discovery problem.&rdquo; It has been open for a decade.
            </p>

            <p className="text-secondary leading-relaxed mb-6 font-body">
              With that private census in hand, the answer took an afternoon:{' '}
              <strong>3,655 books printed before 1830 in this one collection have no digitization
              anywhere we can find</strong> &mdash; plus about five hundred manuscripts, unique by
              definition. Meanwhile 324 of its books are printings that are already online in full,
              where a rescan would duplicate the world&apos;s coverage almost exactly.
            </p>

            <p className="text-secondary leading-relaxed mb-6 font-body">
              That is the scanning queue any collection would want. And here is the absurdity: every
              library that wants to scan responsibly has to rebuild this same apparatus privately
              &mdash; the harvest, the identity matching, the census &mdash; or scan blind. Most,
              reasonably, scan blind.
            </p>
          </section>

          <hr className="border-border-light my-12" />

          <section className="mb-16">
            <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
              The registries that almost exist
            </h2>

            <p className="text-secondary leading-relaxed mb-6 font-body">
              The pieces are scattered across a landscape of heroic, partial efforts. The{' '}
              <a href="https://www.ustc.ac.uk" className="text-accent-rust hover:text-accent-rust underline">
                Universal Short Title Catalogue
              </a>{' '}
              knows 1.65 million European editions printed before 1700 and links about 600,000
              digital copies &mdash; the best attempt anywhere, and still tagged to under a third of
              its records, with nothing after 1700. The incunabula catalogues (ISTC, GW) do this
              well for the fifteenth century. The German VD16/17/18 do it for German print; the
              Dutch STCN for Dutch. The English ESTC links to scans that mostly sit behind
              subscription walls. Europeana and HathiTrust aggregate tens of millions of digitized
              objects but at the level of <em>files</em>, not <em>editions</em> &mdash; they cannot
              tell you whether two records are the same printing. Google scanned perhaps forty
              million books and publishes no list at all.
            </p>

            <p className="text-secondary leading-relaxed mb-6 font-body">
              Each covers one period, one nation, one language, or one silo. None joins to the
              others. A librarian in Amsterdam holding a 1688 Latin alchemical treatise would need
              to consult half a dozen of these and would still miss the digitization sitting in
              Munich under a variant spelling.
            </p>

            <p className="text-secondary leading-relaxed mb-6 font-body">
              That last detail is not hypothetical. In our spot checks, a 1688 Tollius volume showed
              up as &ldquo;never digitized&rdquo; until we found its later German edition at the
              Bavarian State Library &mdash; catalogued under <em>Manvdvctio Ad Coelvm
              Chemicvm</em>, with the author&apos;s name fused into the title and <em>coelum</em>{' '}
              spelled against our <em>caelum</em>. Early modern books do not agree on their own
              names. Matching them takes bibliographic identity work &mdash; author, title, year,
              volume, orthography &mdash; not string comparison.
            </p>
          </section>

          <hr className="border-border-light my-12" />

          <section className="mb-16">
            <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
              What a real registry would take
            </h2>

            <p className="text-secondary leading-relaxed mb-6 font-body">
              We have learned some of this the hard way, building the private version. A global
              registry of digitizations would need four properties:
            </p>

            <ul className="list-disc pl-6 text-secondary leading-relaxed mb-6 font-body space-y-3">
              <li>
                <strong>Edition-grain identity.</strong> The unit is the printing, not the title
                string and not the file. &ldquo;Some copy of some edition of this work exists
                somewhere&rdquo; and &ldquo;this 1688 Amsterdam printing is online&rdquo; are
                different facts, and a scanning decision needs the second.
              </li>
              <li>
                <strong>Evidence, not flags.</strong> A record should carry the manifest URL
                itself &mdash; a checkable claim. We inherited a dataset whose bare
                &ldquo;has been scanned&rdquo; flag turned out to undercount by more than a
                quarter, and there was no way to tell which rows were wrong because the flag
                carried no provenance.
              </li>
              <li>
                <strong>Orthography-aware matching.</strong> u/v, i/j, ae/oe, names fused into
                titles, titles translated between languages. Exact matching quietly fails on
                exactly the books that matter most.
              </li>
              <li>
                <strong>Openness.</strong> Harvestable in bulk, IIIF-native, contributed to by the
                institutions doing the scanning &mdash; the way OCLC built a shared catalogue of
                <em> holdings</em>, but for digitizations, and open.
              </li>
            </ul>

            <p className="text-secondary leading-relaxed mb-6 font-body">
              None of this is speculative. The USTC has proven the bibliographic spine works at
              the scale of a million editions. IIIF has proven the interoperability. The missing
              piece is the join &mdash; maintained as shared infrastructure rather than re-derived
              in private by every project with a harvester and a deadline.
            </p>
          </section>

          <hr className="border-border-light my-12" />

          <section className="mb-16">
            <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
              An offer
            </h2>

            <p className="text-secondary leading-relaxed mb-6 font-body">
              Source Library is a small project, and this is not an announcement that we are
              building the world&apos;s registry. But we hold a working prototype of its parts: a
              3.5-million-record harvest of digitized books across nineteen sources, matching
              tooling tuned for early modern print, and a live case study in what the census makes
              possible &mdash; a real library&apos;s scanning priorities, computed rather than
              guessed.
            </p>

            <p className="text-secondary leading-relaxed mb-6 font-body">
              If you work on USTC, on IIIF discovery, at CERL, at an aggregator, or at a library
              trying to decide what to scan next: the data and the tooling are open, and we would
              rather contribute them to a shared registry than keep maintaining a private one.{' '}
              <a href="mailto:contact@sourcelibrary.org" className="text-accent-rust hover:text-accent-rust underline">
                Write to us
              </a>.
            </p>

            <p className="text-secondary leading-relaxed mb-6 font-body">
              Every year, digitization money is spent rescanning books that are already online,
              while books that exist nowhere else wait. Not because anyone chose that &mdash;
              because nobody can see the whole board. The fix is a list. Libraries have known how
              to make lists for four thousand years. This one is overdue.
            </p>
          </section>
        </article>
      </ContentPageLayout>
    </>
  );
}
