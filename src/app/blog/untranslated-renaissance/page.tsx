import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'Ninety Percent of the Renaissance Has Never Been Translated - Blog - Source Library',
  description: 'There are roughly 140,000 Latin editions from the Renaissance. Harvard\'s flagship translation series has published 100 volumes in 20 years. At that pace, finishing would take 28,000 years.',
  openGraph: {
    title: 'Ninety Percent of the Renaissance Has Never Been Translated',
    description: 'There are roughly 140,000 Latin editions from the Renaissance. Harvard\'s flagship translation series has published 100 volumes in 20 years. At that pace, finishing would take 28,000 years.',
  },
  alternates: {
    canonical: '/blog/untranslated-renaissance',
  },
};

export default function UntranslatedRenaissancePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Ninety Percent of the Renaissance Has Never Been Translated"
          subtitle="The scale of what we haven't read"
        >
          <p className="text-stone-400 text-sm mt-4">15 March 2026 &middot; 10 min read</p>
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
          All posts
        </Link>
      </div>

      <article className="prose-content max-w-none">
        {/* Lede */}
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Most people assume that if a historical text is important, someone has translated it into English by now. That assumption is wrong, and the scale of the gap is staggering.
        </p>

        <p className="text-secondary leading-relaxed mb-10 font-body">
          According to a UCLA study supported by the Mellon Foundation, ninety percent of Latin texts from the Renaissance have never been available in translation &mdash; into English or any other modern language.<sup><a href="#fn1" className="text-accent-rust">[1]</a></sup> These are not fragments or marginalia. They include major works of philosophy, science, theology, medicine, and law &mdash; books that shaped the intellectual history of Europe and that scholars have discussed at second hand for centuries without anyone doing the work of translation.
        </p>

        <hr className="border-border-light my-12" />

        {/* === The numbers === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            The numbers
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The Universal Short Title Catalogue at the University of St Andrews &mdash; the most comprehensive record of European printed books before 1601 &mdash; contains roughly 350,000 editions.<sup><a href="#fn2" className="text-accent-rust">[2]</a></sup> Based on the standard estimate that Latin accounted for 40&ndash;50% of 16th-century book production (and 77% of incunabula before 1501),<sup><a href="#fn3" className="text-accent-rust">[3]</a></sup> that means somewhere between 140,000 and 175,000 of those editions are in Latin.
          </p>

          <p className="text-secondary leading-relaxed mb-8 font-body">
            Against that number, consider the major English-language translation series for pre-modern Latin:
          </p>

          {/* Comparison */}
          <div className="grid md:grid-cols-3 gap-4 my-10">
            <div className="bg-white rounded-xl border border-border-light p-5">
              <p className="font-serif text-3xl text-accent-rust mb-1">~550</p>
              <p className="text-sm font-medium text-stone-800">Loeb Classical Library</p>
              <p className="text-xs text-muted mt-1">Classical antiquity. Founded 1911.</p>
            </div>
            <div className="bg-white rounded-xl border border-border-light p-5">
              <p className="font-serif text-3xl text-accent-rust mb-1">100</p>
              <p className="text-sm font-medium text-stone-800">I Tatti Renaissance Library</p>
              <p className="text-xs text-muted mt-1">Renaissance Latin. Founded 2001.</p>
            </div>
            <div className="bg-white rounded-xl border border-border-light p-5">
              <p className="font-serif text-3xl text-accent-rust mb-1">~90</p>
              <p className="text-sm font-medium text-stone-800">Dumbarton Oaks Medieval Library</p>
              <p className="text-xs text-muted mt-1">Medieval Latin &amp; Greek. Founded 2010.</p>
            </div>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            These three series represent the entire institutional infrastructure of Latin-to-English translation in the anglophone world. Together, they have published roughly 740 volumes over the past century. The I Tatti Renaissance Library, Harvard&apos;s flagship bilingual series for Renaissance Latin, has published 100 volumes in just over twenty years.
          </p>

          <div className="border-l-4 border-accent-rust pl-6 my-12">
            <p className="text-lg text-secondary italic font-body leading-relaxed">
              At that pace &mdash; five volumes per year &mdash; translating the remaining Latin editions from the Renaissance alone would take 28,000 years.
            </p>
          </div>

          <p className="text-secondary leading-relaxed font-body">
            And that is just Latin, and just before 1601. The German national bibliographies catalogue another 106,000 editions from 1501&ndash;1600 (VD16) and 314,000 from 1601&ndash;1700 (VD17).<sup><a href="#fn4" className="text-accent-rust">[4]</a></sup> The vast majority of those have never been translated into English either.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === What's missing === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            What&apos;s missing is not what you&apos;d expect
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The untranslated ninety percent is not a collection of minor footnotes. It includes works that are famous &mdash; works cited in every survey course, every intellectual history, every introduction to their field &mdash; that simply never received the labour of translation.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Peter Lombard&apos;s <em>Sentences</em> was the most widely read textbook in European universities for four hundred years. Every major theologian from Aquinas to Luther wrote a commentary on it. It has no complete English translation.<sup><a href="#fn5" className="text-accent-rust">[5]</a></sup>
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Servius&apos;s commentary on the <em>Aeneid</em> &mdash; the foundational work of classical literary criticism, read continuously since late antiquity &mdash; has no English translation.<sup><a href="#fn6" className="text-accent-rust">[6]</a></sup>
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Johann Salomo Semler&apos;s <em>Free Investigation of the Canon</em> (1771), widely recognized as the founding text of modern biblical criticism, has been discussed in every course on the subject for 250 years. Students have read <em>about</em> Semler. They have never been able to read Semler.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Athanasius Kircher&apos;s <em>Oedipus Aegyptiacus</em> (1652) &mdash; one of the most ambitious scholarly works of the 17th century, cited in every history of Egyptology &mdash; existed only in Latin until Source Library translated its 581 pages last month.
          </p>

          <p className="text-secondary leading-relaxed mb-8 font-body">
            These are not obscure books. They are central works of Western intellectual history that English-speaking readers have been unable to access in their own language.
          </p>

          <div className="bg-warm rounded-xl p-6 border border-border-light my-8">
            <p className="text-secondary leading-relaxed font-body">
              If you are a Latin scholar, none of this is surprising. The gap is so enormous that it is simply the water you swim in &mdash; an ambient, permanent condition of the field. But for everyone else, it is genuinely shocking that we have not done this work. The assumption that &ldquo;someone must have translated this by now&rdquo; turns out to be wrong for the overwhelming majority of the historical record.
            </p>
          </div>
        </section>

        <hr className="border-border-light my-12" />

        {/* === Why it happened === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            Why it happened
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The translation gap is not the result of a single failure. It is the product of centuries of reasonable decisions, each one narrowing the funnel a little more.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Translating a 16th-century Latin text into English is hard. The Latin is often not classical &mdash; it is Neolatin, with its own vocabulary, its own conventions, its own relationship to the vernacular languages that were emerging around it. A translator needs Latin, but also needs the subject-matter expertise to make sense of alchemical terminology, theological disputes, astrological tables, or medical recipes. The number of people alive at any moment who have both the linguistic skill and the domain knowledge to translate a given text is very small.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Those people have careers. They have tenure cases to build, courses to teach, articles to write. A full translation of a 400-page Latin text can take years of work. The academic incentive structure rewards articles and monographs about texts, not translations of them. A scholar who spends three years translating an alchemical treatise has three years less on their CV than the colleague who wrote three articles <em>about</em> alchemical treatises.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            And then there is selection. Even when translations are funded, someone has to decide which texts deserve the investment. The I Tatti series can publish five volumes a year. Choosing five out of 140,000 means that everything not chosen waits another year &mdash; and has been waiting, in many cases, for five centuries. The selection necessarily reflects the priorities of the present moment: what is fashionable in the academy, what has a readership, what a press believes it can sell.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            The result is a literature that has been filtered twice &mdash; once by the accident of what survived, and again by the accident of what scholars happened to translate. We read the fraction of the fraction, and mistake it for the whole.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === What changes === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            What changes now
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            AI translation does not solve every problem. It cannot produce a critical apparatus. It cannot identify textual variants or trace manuscript traditions. It does not replace scholarly editing.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            But it removes the bottleneck. The reason ninety percent of Renaissance Latin has never been translated is not that the texts are unimportant. It is that translation is slow, expensive, and unrewarded. AI makes it fast and cheap. Not perfect &mdash; but readable. And for the vast majority of these texts, a readable translation is infinitely better than no translation at all.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Source Library has now translated over 5,000 books from the pre-modern period, producing nearly{' '}
            <Link href="https://sourcelibrary.org/blog/first-translations" className="text-accent-rust hover:text-accent-rust underline">2,000 first English translations</Link>.{' '}
            The broader project, <a href="https://secondrenaissance.ai" className="text-accent-rust hover:text-accent-rust underline">Second Renaissance</a>, is dedicated to making this work systematic.
            Every translation preserves the original text alongside the English for verification. Every page can be checked against the source. The original is never replaced &mdash; it is made accessible.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Five thousand books is a start. It is roughly 3% of the Latin editions in the USTC alone. But it is more than all three major translation series have published in a combined 115 years of work. And the pace is accelerating.
          </p>

          <div className="border-l-4 border-accent-gold pl-6 my-12">
            <p className="text-lg text-secondary italic font-body leading-relaxed">
              The history of translation has always been a history of selection &mdash; someone deciding what is worth the effort. When the effort approaches zero, selection becomes unnecessary. The texts can speak for themselves.
            </p>
          </div>
        </section>

        <hr className="border-border-light my-12" />

        {/* === For scholars === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            A note for scholars
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            If you work in this field, you already know everything in this post. You know the gap. You know why it exists. You have lived with it your entire career.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            What you may not know is that it is starting to close. Not through the traditional channels &mdash; not through grant-funded editorial projects producing five volumes a year &mdash; but through AI systems that can process a 400-page Latin text in hours rather than years.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The translations are imperfect. Of course they are. But they are also checkable: the original text is always there, on the same page. And they are improvable &mdash; by you, by your students, by anyone with the Latin to spot an error and the goodwill to report it. An AI translation is not a finished product. It is a first draft that invites correction.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            We would rather have your corrections than your silence.
          </p>
        </section>

        {/* === Footnotes === */}
        <div className="border-t border-border-light pt-8 mt-16">
          <h3 className="font-serif text-lg text-primary mb-4">Notes</h3>
          <ol className="space-y-3 text-sm text-muted font-body">
            <li id="fn1">
              <span className="text-accent-rust">[1]</span>{' '}
              UCLA Newsroom, &ldquo;Learning the &lsquo;little-known&rsquo; language of the Renaissance.&rdquo; Reporting on a $700,000 Mellon Foundation grant for Renaissance Latin studies. The article states: &ldquo;90 percent of the Latin texts from the Renaissance have never been available in translation.&rdquo;
            </li>
            <li id="fn2">
              <span className="text-accent-rust">[2]</span>{' '}
              Universal Short Title Catalogue, University of St Andrews. Founded 1997 by Andrew Pettegree. Covers European printed works 1450&ndash;1600. Approximately 350,000 editions representing 1.5 million surviving copies in over 5,000 libraries worldwide.
            </li>
            <li id="fn3">
              <span className="text-accent-rust">[3]</span>{' '}
              Lucien Febvre and Henri-Jean Martin, <em>The Coming of the Book: The Impact of Printing 1450&ndash;1800</em> (London: Verso, 1976). The 77% figure for incunabula is the standard estimate. The Incunabula Short Title Catalogue (British Library) records 30,596 editions of 15th-century books.
            </li>
            <li id="fn4">
              <span className="text-accent-rust">[4]</span>{' '}
              VD16: <em>Verzeichnis der im deutschen Sprachbereich erschienenen Drucke des 16. Jahrhunderts</em>, Bayerische Staatsbibliothek. ~106,000 titles. VD17: <em>Verzeichnis der im deutschen Sprachraum erschienenen Drucke des 17. Jahrhunderts</em>. ~314,000 items as of January 2025.
            </li>
            <li id="fn5">
              <span className="text-accent-rust">[5]</span>{' '}
              Noted in the Polis Institute Jerusalem, &ldquo;A New Renaissance of Latin&rdquo; &mdash; observing that we still lack a full English translation of Peter Lombard&apos;s <em>Sentences</em> or Aquinas&apos;s commentary on it.
            </li>
            <li id="fn6">
              <span className="text-accent-rust">[6]</span>{' '}
              Discussed on the Latin Discussion forum, &ldquo;Untranslated Latin Texts&rdquo; thread, among other sources. The neo-Latin bibliography contains over 59,000 texts, the vast majority untranslated.
            </li>
          </ol>
        </div>

        {/* === CTA === */}
        <div className="bg-warm rounded-xl p-6 md:p-8 border border-border-light mt-12 mb-8">
          <p className="font-serif text-lg text-primary mb-3">Explore what&apos;s been translated</p>
          <div className="grid md:grid-cols-2 gap-3">
            <Link href="https://sourcelibrary.org/blog/first-translations" className="block bg-white rounded-lg p-4 border border-border-light hover:border-accent-rust/30 transition-colors group">
              <p className="font-medium text-sm text-stone-800 group-hover:text-accent-rust transition-colors">2,000 First English Translations</p>
              <p className="text-xs text-muted mt-1">Books that have never been read in English before</p>
            </Link>
            <Link href="https://sourcelibrary.org/search" className="block bg-white rounded-lg p-4 border border-border-light hover:border-accent-rust/30 transition-colors group">
              <p className="font-medium text-sm text-stone-800 group-hover:text-accent-rust transition-colors">Browse the full collection</p>
              <p className="text-xs text-muted mt-1">5,000+ books with original text and translation</p>
            </Link>
          </div>
        </div>

        {/* === Footer === */}
        <div className="border-t border-border-light pt-8 mt-16">
          <p className="text-secondary text-sm leading-relaxed font-body">
            Source Library is a project of the Embassy of the Free Mind. The collection is CC0 public domain. If you are a scholar who can improve any of these translations, or if you know of a prior English translation we missed, please reach out &mdash;{' '}
            <a href="mailto:derek@ancientwisdomtrust.org" className="text-accent-rust hover:text-accent-rust underline">derek@ancientwisdomtrust.org</a>.
          </p>
        </div>
      </article>

      <BlogComments slug="untranslated-renaissance" />
    </ContentPageLayout>
  );
}
