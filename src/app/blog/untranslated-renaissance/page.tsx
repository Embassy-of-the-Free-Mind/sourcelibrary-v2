import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'How Much of the Renaissance Has Been Translated? We Tried to Count. - Research Notes - Source Library',
  description: 'We built the first draft of a translation census — matching 1.4 million early modern editions against every English translation catalog we could find. The results are provisional, incomplete, and worse than we expected.',
  openGraph: {
    title: 'How Much of the Renaissance Has Been Translated? We Tried to Count.',
    description: 'We matched 1.4 million early modern editions against every English translation catalog we could find. The results are provisional, incomplete, and worse than we expected.',
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
          title="How Much of the Renaissance Has Been Translated?"
          subtitle="We tried to count."
        >
          <p className="text-stone-400 text-sm mt-4">15 March 2026 &middot; 12 min read</p>
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
          Nobody knows what percentage of Renaissance texts have been translated into English. The question has never had a precise answer, because nobody has tried to count. So we tried.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          What follows is the first draft of a translation census &mdash; an attempt to match the known record of early modern European book production against every English translation catalog we could assemble. The results are provisional. The catalog is incomplete. The methodology has known limitations, and we will describe them honestly. But even in this rough form, the data tells a story that we think is important enough to share before it is perfect.
        </p>

        <p className="text-secondary leading-relaxed mb-10 font-body">
          The story is: almost nothing has been translated. And &ldquo;almost nothing&rdquo; is not a rhetorical exaggeration. It is what the data says.
        </p>

        <hr className="border-border-light my-12" />

        {/* === What we did === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            What we did
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            We started with the Universal Short Title Catalogue at the University of St Andrews &mdash; the most comprehensive record of European printed books from the hand-press era. Our copy of the USTC contains 1,628,578 editions spanning roughly 1450 to 1700, across all languages. Of these, 1,464,217 are in languages other than English.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            We then assembled a catalog of known English translations from every source we could find: the UNESCO Index Translationum (3,191 records), Open Library (2,524), Internet Archive (472), Harvard&apos;s three major bilingual series &mdash; the Loeb Classical Library, the I Tatti Renaissance Library, and the Dumbarton Oaks Medieval Library &mdash; plus Penguin Classics, Brill, Cambridge University Press, Oxford University Press, Routledge, De Gruyter, and 30 other publishers and specialized presses. In total, 7,542 records from 46 sources, covering English translations of pre-modern works published between 1800 and 2025.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            We matched them. For each of the seven major languages in the USTC &mdash; Latin, German, French, Italian, Dutch, Spanish, and Portuguese &mdash; we extracted every distinct author surname, then checked whether that author appeared in our translation catalog. For Latin, where USTC names are in their Latin form (&ldquo;Ovidius Naso&rdquo;) and the catalog uses English forms (&ldquo;Ovid&rdquo;), we built 120 hand-checked name aliases.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            The result is a rough but real picture of how much of the early modern printed record exists in English. It is the first time, as far as we know, that anyone has attempted this comparison at scale.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === What we found === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            What we found
          </h2>

          {/* All-language table */}
          <div className="overflow-x-auto my-10">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-border-light">
                  <th className="text-left py-3 pr-4 font-medium text-stone-800">Language</th>
                  <th className="text-right py-3 px-4 font-medium text-stone-800">USTC editions</th>
                  <th className="text-right py-3 px-4 font-medium text-stone-800">Distinct works</th>
                  <th className="text-right py-3 px-4 font-medium text-stone-800">Known translations</th>
                  <th className="text-right py-3 pl-4 font-medium text-stone-800">% translated</th>
                </tr>
              </thead>
              <tbody className="font-body text-secondary">
                {[
                  ['Latin', '499,607', '362,263', '~3,500', '~1%'],
                  ['German', '340,205', '124,394', '~1,000', '~0.8%'],
                  ['French', '233,563', '65,266', '~1,200', '~1.9%'],
                  ['Italian', '110,333', '70,284', '~640', '~0.9%'],
                  ['Dutch', '113,839', '29,649', '~680', '~2.3%'],
                  ['Spanish', '83,510', '37,484', '~320', '~0.9%'],
                  ['Portuguese', '6,994', '3,795', '~36', '~0.9%'],
                ].map(([lang, editions, works, translations, pct]) => (
                  <tr key={lang} className="border-b border-border-light">
                    <td className="py-2.5 pr-4">{lang}</td>
                    <td className="py-2.5 px-4 text-right">{editions}</td>
                    <td className="py-2.5 px-4 text-right">{works}</td>
                    <td className="py-2.5 px-4 text-right">{translations}</td>
                    <td className="py-2.5 pl-4 text-right font-medium text-accent-rust">{pct}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-light font-medium">
                  <td className="py-3 pr-4 text-stone-800">Total</td>
                  <td className="py-3 px-4 text-right text-stone-800">1,388,051</td>
                  <td className="py-3 px-4 text-right text-stone-800">693,135</td>
                  <td className="py-3 px-4 text-right text-stone-800">~7,400</td>
                  <td className="py-3 pl-4 text-right text-accent-rust">~1.1%</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Across all seven languages, our catalog identifies roughly 7,400 works with a known English translation, out of approximately 693,000 distinct works in the USTC. That is about 1.1%.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Latin is not the worst. German, at 0.8%, has the lowest rate. French and Dutch are the highest, around 2%, likely reflecting stronger anglophone scholarly interest in those literatures. But no language exceeds 2.5%.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            At the author level: of 49,306 distinct Latin author surnames in the USTC, 1,076 &mdash; about 2% &mdash; have any known English translation at all. The remaining 48,230 authors wrote in Latin, published their work between 1450 and 1700, and have never had a single word translated into English.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === What we know we're missing === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            What we know we&apos;re missing
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            We want to be careful here, because the catalog is not complete, and we know it.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            When we checked our data against well-known authors, we found two kinds of errors. The first is over-counting: Erasmus appears 179 times in the catalog, but many of those are different editions of the same translation. The Collected Works of Erasmus alone generates dozens of entries. The actual number of distinct Erasmus works translated into English is probably 30 to 40, not 167.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The second error is worse. Machiavelli &mdash; one of the most widely translated authors in European history &mdash; appears exactly once in our catalog. One record. <em>The Prince</em> has had dozens of English editions since the 16th century. The <em>Discourses</em>, the <em>Art of War</em>, the <em>Florentine Histories</em>, the plays &mdash; none of them are in our data. This is not a marginal gap. It means the catalog is missing major, well-known translations.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The UNESCO Index Translationum, our largest single source, ran from 1932 to 2012 and relied on national libraries to submit records. Many didn&apos;t report consistently. It covers published books, not journal articles, dissertation appendices, or chapter-length translations in edited volumes. Open Library and Internet Archive add coverage, but they too have gaps.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            If the catalog captures something like a third of actual translations &mdash; and the Machiavelli gap suggests it could be that incomplete &mdash; then the true number might be 15,000 to 20,000 translated works rather than 7,400. Against 693,000 USTC works, that would put the figure at 2 to 3%.
          </p>

          <div className="bg-warm rounded-xl p-6 border border-border-light my-10">
            <p className="text-secondary leading-relaxed font-body">
              So we cannot say with confidence whether 1% or 3% of the Renaissance has been translated. What we can say is that the number is very small. Even tripling our count leaves 97% of the record untranslated. The finding is robust to large errors in the catalog: the gap is not a statistical artifact. It is an ocean.
            </p>
          </div>

          <p className="text-secondary leading-relaxed font-body">
            A previous estimate from UCLA, reporting on a Mellon Foundation grant for Renaissance Latin studies, put the figure at 90% untranslated.<sup><a href="#fn1" className="text-accent-rust">[1]</a></sup> Our data suggests this is in the right neighbourhood, though possibly generous. The exact number awaits a better catalog. Building that catalog is one of the goals of this project.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === Even the famous authors === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            Even the famous authors
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The authors who have been translated are barely translated. The USTC records not just the famous works but the full published output &mdash; every edition of every text. When you compare an author&apos;s total output against what has been rendered into English, even the most canonical figures look thin.
          </p>

          <div className="overflow-x-auto my-10">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-border-light">
                  <th className="text-left py-3 pr-4 font-medium text-stone-800">Author</th>
                  <th className="text-right py-3 px-4 font-medium text-stone-800">USTC works</th>
                  <th className="text-right py-3 px-4 font-medium text-stone-800">Known translations</th>
                  <th className="text-right py-3 pl-4 font-medium text-stone-800">Coverage</th>
                </tr>
              </thead>
              <tbody className="font-body text-secondary">
                {[
                  ['Cicero', '3,448', '~284', '~8%'],
                  ['Erasmus', '1,945', '~30\u201340*', '~2%'],
                  ['Aristotle (Latin eds.)', '1,318', 'many', 'varies'],
                  ['Melanchthon', '1,222', '5', '<1%'],
                  ['Ovid', '1,075', '~108', '~10%'],
                  ['Augustine', '763', '~123', '~16%'],
                  ['Thomas Aquinas', '722', '~224', '~31%'],
                  ['Virgil', '836', '~59', '~7%'],
                  ['Horace', '633', '~79', '~12%'],
                  ['Luther', '621', '8', '~1%'],
                  ['Seneca', '471', '~52', '~11%'],
                  ['Galen', '416', '2', '<1%'],
                  ['Lipsius', '427', '1', '<1%'],
                ].map(([author, works, translations, coverage]) => (
                  <tr key={author} className="border-b border-border-light">
                    <td className="py-2.5 pr-4">{author}</td>
                    <td className="py-2.5 px-4 text-right">{works}</td>
                    <td className="py-2.5 px-4 text-right">{translations}</td>
                    <td className="py-2.5 pl-4 text-right font-medium text-accent-rust">{coverage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted mt-2">
              * Erasmus&apos;s catalog count (167) is inflated by multiple editions of the Collected Works. Actual distinct works translated is estimated at 30&ndash;40.
            </p>
          </div>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Thomas Aquinas has the highest coverage at roughly 31%, reflecting centuries of sustained theological interest. Cicero, the most published Latin author in the USTC, is at about 8%. Melanchthon &mdash; the intellectual architect of the Protestant Reformation, the most influential educator in early modern Europe, an author of 1,222 distinct works &mdash; has five English translations.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Galen, whose medical writings were the basis of European medicine for over a thousand years, has two. Justus Lipsius, the most important Neostoic philosopher of the 16th century, has one.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            These are the best-case numbers &mdash; the most famous, most studied, most canonical authors in the Western tradition. The USTC coverage figures overcount slightly (because &ldquo;distinct works&rdquo; includes title variants of the same text) and our translation counts may undercount (because of catalog gaps like the Machiavelli problem). But even with generous adjustments, the picture is clear: even the most translated authors are mostly untranslated.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === The books === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            Books that should have been translated centuries ago
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Some gaps are genuinely shocking &mdash; books that are famous, widely cited, central to their fields, and simply never translated.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Peter Lombard&apos;s <em>Sentences</em> was the standard textbook of European universities for four hundred years. Every major theologian from Aquinas to Luther wrote a commentary on it. It has no complete English translation.<sup><a href="#fn2" className="text-accent-rust">[2]</a></sup>
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Servius&apos;s commentary on the <em>Aeneid</em> &mdash; the foundational work of classical literary criticism, read continuously for sixteen centuries &mdash; has no English translation.<sup><a href="#fn3" className="text-accent-rust">[3]</a></sup>
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Johann Salomo Semler&apos;s <em>Free Investigation of the Canon</em> (1771), widely recognized as the founding text of modern biblical criticism, has been discussed in every course on the subject for 250 years. Students have read <em>about</em> Semler. They cannot read Semler.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            These are not obscure texts. They are central works of Western intellectual history &mdash; books that sit at the root of entire disciplines &mdash; and they have never been available in English.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === Why === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            Why the gap exists
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            If you talk to Latin scholars, the scale of what hasn&apos;t been translated is so enormous that it is hardly discussed. It is simply the ambient condition of the field &mdash; like the depth of the ocean, known but not often remarked upon, because remarking on it changes nothing. The gap has always been there. It has always been too large for any institutional effort to close.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The reasons are structural. Translating a 16th-century Latin text into English requires not just Latin but subject-matter expertise &mdash; the ability to make sense of alchemical terminology, theological distinctions, astrological tables, legal formulae, or medical recipes in a dead language. The number of people alive at any given moment who can translate a specific text is very small.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Those people have careers. The academic incentive structure rewards articles and monographs <em>about</em> texts, not translations of them. A scholar who spends three years translating a 400-page Latin treatise has three years less on their CV than the colleague who wrote three articles about it.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            And there is selection. The three major English-language translation series for pre-modern Latin &mdash; the Loeb Classical Library (~550 volumes since 1911), the I Tatti Renaissance Library (100 volumes since 2001), and the Dumbarton Oaks Medieval Library (~90 volumes since 2010) &mdash; together represent the institutional infrastructure of Latin-to-English translation. Roughly 740 volumes in a combined 115 years. The selection necessarily reflects what scholars in each generation deemed important, fashionable, or commercially viable. Everything else waits.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Put it in dollars and years. The USTC records approximately 362,000 distinct Latin works printed before 1700. Roughly 355,000 have no English translation. If you hired dedicated translators at $80,000 a year, each producing five books &mdash; a generous pace for texts requiring expertise in alchemical terminology, theological distinctions, or Renaissance medical Latin &mdash; the project would cost $5.7 billion and require 71,000 translator-years. A hundred translators working simultaneously would need 700 years. A thousand &mdash; a workforce that does not exist and cannot be trained, because the required specializations number in the hundreds &mdash; would still need 71 years. And that is Latin alone, one of seven major languages in the USTC.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            The result is a literature filtered twice &mdash; once by the accident of what survived, and again by the accident of what scholars happened to translate. We read the fraction of the fraction, and mistake it for the whole.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === The census === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            Building the census
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            We are building this census as a public resource &mdash; a searchable, correctable, living record of which pre-modern works have been translated into English and which have not. The data we have published here is the first draft. It is wrong in known ways and probably wrong in ways we have not yet discovered. That is the point: to make the data visible so it can be improved.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The most valuable thing a scholar can do with this post is tell us where we are wrong. If you know of a translation we missed &mdash; a dissertation, a journal appendix, an out-of-print 19th-century edition, a small-press publication from a specialist house &mdash; we want to add it. Every correction makes the census more accurate. Every missing translation we learn about narrows the gap between what we count and what actually exists.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            We are also adding to the count ourselves.{' '}
            <Link href="https://sourcelibrary.org" className="text-accent-rust hover:text-accent-rust underline">Source Library</Link>{' '}
            has now translated over 5,000 books from the pre-modern period using AI, producing nearly{' '}
            <Link href="https://sourcelibrary.org/blog/first-translations" className="text-accent-rust hover:text-accent-rust underline">2,000 first English translations</Link>.{' '}
            The broader project,{' '}
            <a href="https://secondrenaissance.ai" className="text-accent-rust hover:text-accent-rust underline">Second Renaissance</a>,{' '}
            is dedicated to making this work systematic. Every translation preserves the original text alongside the English for verification. Every page can be checked against the source. The original is never replaced &mdash; it is made accessible.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            AI translation does not replace scholarly editing. It cannot produce a critical apparatus, identify textual variants, or situate a passage in its full intellectual context. But for the vast majority of these texts &mdash; for the 97% or 99% that have no English translation at all &mdash; the alternative is not a better translation. The alternative is no translation. A readable first draft that invites correction is, we believe, better than five more centuries of silence.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === What you can do === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            How to help
          </h2>

          <p className="text-secondary leading-relaxed mb-4 font-body">
            <strong className="text-stone-800">If you are a scholar:</strong> Tell us what we&apos;re missing. If you know of a translation not in our catalog &mdash; especially from specialist publishers, foreign presses, dissertations, or pre-1900 editions &mdash; email us. We would rather have your corrections than your silence.
          </p>

          <p className="text-secondary leading-relaxed mb-4 font-body">
            <strong className="text-stone-800">If you read Latin, German, French, Italian, Dutch, or Spanish:</strong> Our AI translations are first drafts. They are checkable &mdash; the original text is always on the same page. If you spot an error, you can improve a text that may never have been in English before.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            <strong className="text-stone-800">If you want to follow the census:</strong> The data, code, and methodology are open source. The{' '}
            <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/187" className="text-accent-rust hover:text-accent-rust underline">translation census project</a>{' '}
            tracks progress and design decisions in public.
          </p>
        </section>

        {/* === Methodology === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            Methodology
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            <strong className="text-stone-800">Corpus:</strong> 1,388,051 non-English editions from the Universal Short Title Catalogue (University of St Andrews), covering printed works from 1450 to 1700. The USTC is the most comprehensive catalog of European hand-press-era printing. Our copy contains 1,628,578 total editions; 164,361 are in English and excluded. &ldquo;Distinct works&rdquo; are counted as unique titles per author &mdash; title variants inflate the count, so 693,135 is an upper bound on the true number of distinct works.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            <strong className="text-stone-800">Translation catalog:</strong> 7,542 records aggregated from 46 sources, including the UNESCO Index Translationum (3,191), Open Library (2,524), Internet Archive (472), the Loeb Classical Library, I Tatti Renaissance Library, Dumbarton Oaks Medieval Library, Penguin Classics, Brill, Cambridge UP, Oxford UP, Routledge, De Gruyter, Cazimi Press, Cistercian Publications, and others. Covers English translations published between 1800 and 2025.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            <strong className="text-stone-800">Matching:</strong> Author surname extraction from USTC &ldquo;Surname, Given&rdquo; format, matched against catalog author surnames. For Latin, 120+ hand-checked aliases map Latin forms to English forms (e.g., &ldquo;Ovidius Naso&rdquo; &rarr; &ldquo;Ovid&rdquo;). Work-level matching uses the minimum of catalog works and USTC works per matched author as an upper-bound estimate.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            <strong className="text-stone-800">Known limitations:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-2 text-secondary font-body mb-6">
            <li>The catalog is incomplete. Spot-checks reveal major gaps: Machiavelli has 1 record (should have dozens). Translations in dissertations, journal appendices, and out-of-print editions are underrepresented.</li>
            <li>The catalog over-counts for some authors: different editions of the same translation each get their own entry.</li>
            <li>USTC &ldquo;distinct works&rdquo; counts title variants of the same text separately, inflating the denominator.</li>
            <li>USTC includes broadsides, pamphlets, and single-sheet prints that may not need &ldquo;translation&rdquo; in the traditional sense.</li>
            <li>USTC coverage for 1600&ndash;1700 is still being expanded and may be incomplete.</li>
            <li>Surname matching misses authors known only by first name, pseudonym, or institutional affiliation.</li>
          </ul>

          <p className="text-secondary leading-relaxed font-body">
            Full data and code available at{' '}
            <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2" className="text-accent-rust hover:text-accent-rust underline">github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2</a>.
          </p>
        </section>

        {/* === Footnotes === */}
        <div className="border-t border-border-light pt-8 mt-16">
          <h3 className="font-serif text-lg text-primary mb-4">Notes</h3>
          <ol className="space-y-3 text-sm text-muted font-body">
            <li id="fn1">
              <span className="text-accent-rust">[1]</span>{' '}
              UCLA Newsroom, &ldquo;Learning the &lsquo;little-known&rsquo; language of the Renaissance,&rdquo; reporting on a $700,000 Mellon Foundation grant for Renaissance Latin studies: &ldquo;90 percent of the Latin texts from the Renaissance have never been available in translation.&rdquo; Our data is broadly consistent with this estimate, though the true figure may be higher or lower depending on catalog completeness.
            </li>
            <li id="fn2">
              <span className="text-accent-rust">[2]</span>{' '}
              Noted by the Polis Institute Jerusalem, &ldquo;A New Renaissance of Latin,&rdquo; observing that we still lack a full English translation of Peter Lombard&apos;s <em>Sentences</em> or Aquinas&apos;s commentary on it.
            </li>
            <li id="fn3">
              <span className="text-accent-rust">[3]</span>{' '}
              Discussed on the Latin Discussion forum, &ldquo;Untranslated Latin Texts&rdquo; thread. The neo-Latin bibliography alone contains over 59,000 texts, the vast majority untranslated.
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
              <p className="text-xs text-muted mt-1">10,000+ books with original text and translation</p>
            </Link>
          </div>
        </div>

        {/* === Footer === */}
        <div className="border-t border-border-light pt-8 mt-16">
          <p className="text-secondary text-sm leading-relaxed font-body">
            Source Library is a project of the Embassy of the Free Mind. If you know of a translation we missed, or if you can improve one of ours, please reach out &mdash;{' '}
            <a href="mailto:derek@sourcelibrary.org" className="text-accent-rust hover:text-accent-rust underline">derek@sourcelibrary.org</a>.
          </p>
        </div>
      </article>

      <BlogComments slug="untranslated-renaissance" />
    </ContentPageLayout>
  );
}
