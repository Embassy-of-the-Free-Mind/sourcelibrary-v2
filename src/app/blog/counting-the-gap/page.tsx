import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'We Spent a Day Counting What Hasn\'t Been Translated - Research Notes - Source Library',
  description: 'We downloaded the entire Library of Congress catalog, scraped a Renaissance bibliography, and matched it all against 1.6 million early modern editions. Here\'s what happened.',
  openGraph: {
    images: [{ url: 'https://images.sourcelibrary.org/pages/697c8e0fbaa544415f85b6c6/0132-full.jpg', alt: 'Tree of Knowledge of Good and Evil from Secret Symbols of the Rosicrucians, 1785' }],
    title: 'We Spent a Day Counting What Hasn\'t Been Translated',
    description: 'We downloaded the entire Library of Congress catalog, scraped a Renaissance bibliography, and matched it all against 1.6 million early modern editions.',
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/pages/697c8e0fbaa544415f85b6c6/0132-full.jpg', alt: 'Tree of Knowledge of Good and Evil from Secret Symbols of the Rosicrucians, 1785' }],
  },
  alternates: {
    canonical: '/blog/counting-the-gap',
  },
};

export default function CountingTheGapPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="We Spent a Day Counting What Hasn't Been Translated"
          subtitle="A working session that got out of hand"
          image="https://images.sourcelibrary.org/pages/697c8e0fbaa544415f85b6c6/0132-full.jpg"
          imageAlt="Tree of Knowledge of Good and Evil from Secret Symbols of the Rosicrucians, 1785"
        >
          <p className="text-stone-400 text-sm mt-4">15 March 2026 &middot; 8 min read</p>
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
        {/* Update banner */}
        <div className="bg-amber-50 border border-amber-200/50 rounded-lg p-4 mb-10">
          <p className="text-sm text-stone-700 leading-relaxed">
            <strong>Update (April 2026):</strong> The census described below is now live at{' '}
            <Link href="/census" className="text-accent-rust hover:underline">/census</Link>.
            With work-level matching (not edition-level), the number is lower than our first estimate:
            under 1% of pre-1700 works have a known English translation, not the 4.5% we initially reported.
            The methodology below describes how we got here; the live census reflects the corrected figures.
          </p>
        </div>

        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          This morning I was writing a blog post about{' '}
          <Link href="/blog/origin-story" className="text-accent-rust hover:text-accent-rust underline">where Source Library came from</Link>.
          By the end of the day, I had downloaded 3 gigabytes of Library of Congress catalog data, scraped 4,000 records from a Renaissance bibliography, and produced what might be the first empirical count of how much of the early modern European printed record has been translated into English.
        </p>

        <p className="text-secondary leading-relaxed mb-10 font-body">
          The answer is: not much.
        </p>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            How it started
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            I was trying to write about the scale of untranslated Renaissance texts. A UCLA press release from a Mellon Foundation grant had claimed that &ldquo;90 percent of Latin texts from the Renaissance have never been available in translation.&rdquo; I wanted to cite that number. But when I looked for the methodology behind it, there wasn&apos;t one. It was an expert estimate, not a measurement.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            So I tried to measure it.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            We already had the Universal Short Title Catalogue on Supabase &mdash; 1.6 million edition records of European printed works from 1450 to 1700. And we had a translation catalog we&apos;d assembled from the UNESCO Index Translationum, Open Library, and about 40 other sources &mdash; 7,542 records of known English translations.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            The first pass took twenty minutes. Match author surnames across the two databases, count matches. The result: about 1% of USTC works had a known English translation. That couldn&apos;t be right &mdash; our catalog was clearly missing things. We checked Machiavelli. One record. <em>The Prince</em> alone has had dozens of English editions. Our catalog was broken.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            The Library of Congress
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            It turns out the Library of Congress distributes its entire catalog as downloadable files. 10 million MARC records, 3 gigabytes compressed, 41 files. Free. And buried in those records is a field &mdash; MARC 041 subfield $h &mdash; that encodes the original language of translations. A cataloger at some point looked at each book and recorded: this is an English translation from Latin. Or from French. Or from German.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Nobody, as far as I can tell, has ever aggregated those codes at scale and asked: how many English translations of pre-modern works does the Library of Congress hold?
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            We downloaded all 41 files and wrote a parser. It took about an hour to process 10 million records. Result: 34,562 English translations of works originally in Latin, German, French, Italian, Dutch, Spanish, or Portuguese, by authors active before 1800.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            Machiavelli: 67 records. The Prince, the Discourses, the Art of War, the Florentine Histories, Mandragola, Belphegor, his poems. The test passed.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            Renaissance Cultural Crossroads
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The LOC data had one big gap. MARC 041 coding wasn&apos;t consistently applied before the mid-20th century, so translations published in the 1500s and 1600s &mdash; the Elizabethan and Jacobean golden age of translation &mdash; were underrepresented. Chapman&apos;s Homer, Florio&apos;s Montaigne, Philemon Holland&apos;s Pliny &mdash; the translations that fed Shakespeare &mdash; were largely absent.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            There is a database that covers exactly this period: Renaissance Cultural Crossroads, a catalog of all translations printed in Britain from 1473 to 1640, built by Brenda Hosington at the University of Warwick. We scraped it &mdash; carefully, one request per second &mdash; and got 4,016 records. Calvin (101 translations), Augustine (55), Ovid (52), Bèze (48), Luther (43), Erasmus (37).
          </p>

          <p className="text-secondary leading-relaxed font-body">
            These are the translations the LOC data was missing. The 16th and 17th centuries weren&apos;t a dead zone for translation &mdash; they were a boom. The LOC just didn&apos;t have the MARC codes for books cataloged before the standard existed.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            The number
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Combined, we now have roughly 42,000 known English translation records from the Library of Congress, UNESCO, Renaissance Cultural Crossroads, and 43 other sources. After deduplication &mdash; which is imperfect, because the same translation appears under different titles in different databases &mdash; we estimate about 31,000 distinct translated works.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The USTC contains approximately 693,000 distinct non-English works printed between 1450 and 1700.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-10">
            {[
              { number: '693,135', label: 'Distinct works in the USTC' },
              { number: '~31,000', label: 'With known English translation' },
              { number: '~4.5%', label: 'Translated (lower bound)' },
              { number: '5\u201314%', label: 'Estimated true range' },
            ].map((stat) => (
              <div key={stat.label} className="text-center py-5 px-3 bg-warm rounded-lg border border-border-light">
                <div className="font-serif text-2xl md:text-3xl text-accent-rust mb-1">{stat.number}</div>
                <div className="text-xs text-muted leading-tight">{stat.label}</div>
              </div>
            ))}
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The 4.5% is a hard floor &mdash; we have evidence for each of those translations. The true rate is higher, because our catalog doesn&apos;t include translations published in dissertations, journal articles, or by presses we haven&apos;t cataloged. We estimate the true figure is somewhere between 5% and 14%. We wrote{' '}
            <Link href="/blog/untranslated-renaissance" className="text-accent-rust hover:text-accent-rust underline">a longer post</Link>{' '}
            laying out the methodology and its limitations.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            Under any reasonable assumption, more than 85% of the early modern European printed record has never been translated into English. And that&apos;s just 1450 to 1700 &mdash; we haven&apos;t even looked at the 18th century, which probably produced more books than the previous 250 years combined.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            What surprised me
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            <strong className="text-stone-800">The LOC and our existing catalog barely overlap.</strong> Of 15,000 distinct author surnames in the combined catalog, only 718 appear in both the LOC data and our previous catalog. The two sources are almost entirely complementary. This means every new catalog source we add will find translations the others missed.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            <strong className="text-stone-800">Even Cicero is only 8% translated.</strong> The most published Latin author in the USTC, with 3,448 distinct works, has about 300 English translations. Thomas Aquinas has the best coverage at 31%, and he&apos;s exceptional because of centuries of sustained theological interest. Melanchthon &mdash; 1,222 works &mdash; has about 10 translations.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            <strong className="text-stone-800">&ldquo;Translated&rdquo; doesn&apos;t mean &ldquo;accessible.&rdquo;</strong> When we checked our own 4,083 verified books, we found that 18% have only partial translations &mdash; a chapter in an anthology, a passage quoted in an article, a 19th-century version in archaic English. They show up as &ldquo;translated&rdquo; in a census, but you can&apos;t sit down and read them.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            <strong className="text-stone-800">Nobody had counted before.</strong> This is what surprised me most. The scale of untranslated material is well known among Latin scholars &mdash; it&apos;s the water they swim in. But nobody had tried to put a number on it. The data was there &mdash; the USTC, the LOC MARC records, the UNESCO catalog &mdash; sitting in separate databases, waiting to be connected.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            What we&apos;re building next
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            <strong className="text-stone-800">Update:</strong> The census is now live at{' '}
            <Link href="/census" className="text-accent-rust hover:text-accent-rust underline">sourcelibrary.org/census</Link>.
            You can search any pre-modern author or title and see whether a known English translation exists.
            The data draws from 23,700+ catalog records across the Library of Congress, UNESCO, Open Library,
            HathiTrust, and 20+ other sources &mdash; matched at the work level against 1.4 million USTC editions.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The work-level matching gave us a more precise &mdash; and more sobering &mdash; number than the edition-level
            estimates above. At the work level, under 1% of pre-1700 European works have a known English translation.
            Source Library&apos;s 6,000+ first translations represent a significant fraction of the total.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            Source Library now has nearly 10,000 books with translations and over 6,000 verified first English translations.
            The gap between &ldquo;digitized&rdquo; and &ldquo;translated&rdquo; remains vast &mdash; hundreds of thousands of scanned books
            waiting to be read for the first time in centuries. The images are already online.
            They just need someone &mdash; or something &mdash; to read them.
          </p>
        </section>

        {/* === CTA === */}
        <div className="bg-warm rounded-xl p-6 md:p-8 border border-border-light mb-8">
          <p className="font-serif text-lg text-primary mb-3">Read more</p>
          <div className="grid md:grid-cols-2 gap-3">
            <Link href="/census" className="block bg-white rounded-lg p-4 border border-border-light hover:border-accent-rust/30 transition-colors group">
              <p className="font-medium text-sm text-stone-800 group-hover:text-accent-rust transition-colors">The Translation Census</p>
              <p className="text-xs text-muted mt-1">Search the live database: has it been translated?</p>
            </Link>
            <Link href="/blog/first-translations" className="block bg-white rounded-lg p-4 border border-border-light hover:border-accent-rust/30 transition-colors group">
              <p className="font-medium text-sm text-stone-800 group-hover:text-accent-rust transition-colors">6,000 first translations</p>
              <p className="text-xs text-muted mt-1">What Source Library has contributed so far</p>
            </Link>
          </div>
        </div>

        <div className="border-t border-border-light pt-8 mt-16">
          <p className="text-secondary text-sm leading-relaxed font-body">
            All data and code is open source at{' '}
            <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2" className="text-accent-rust hover:text-accent-rust underline">github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2</a>.
            If you know of a translation we missed, please reach out &mdash;{' '}
            <a href="mailto:team@sourcelibrary.org" className="text-accent-rust hover:text-accent-rust underline">team@sourcelibrary.org</a>.
          </p>
        </div>
      </article>

    </ContentPageLayout>
  );
}
