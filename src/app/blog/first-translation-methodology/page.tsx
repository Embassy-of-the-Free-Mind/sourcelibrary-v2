import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'How We Identify First Translations - Research Notes - Source Library',
  description: 'The methodology behind Source Library\'s first-translation classification: how AI enrichment, bibliographic heuristics, and human review work together to identify books that have never been translated into English.',
  openGraph: {
    title: 'How We Identify First Translations',
    description: 'The methodology behind Source Library\'s first-translation classification: AI enrichment, bibliographic heuristics, and human review.',
    images: [{ url: 'https://images.sourcelibrary.org/archived/6952587bab34727b1f045546/3.jpg', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/6952587bab34727b1f045546/3.jpg' }],
  },
  alternates: {
    canonical: '/blog/first-translation-methodology',
  },
};

export default function FirstTranslationMethodologyPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="How We Identify First Translations"
          subtitle="The methodology behind Source Library's classification system"
          image="https://images.sourcelibrary.org/archived/6952587bab34727b1f045546/3.jpg"
          imageAlt="Title page of Symbola Aureae Mensae by Michael Maier, 1617"
        >
          <p className="text-stone-400 text-sm mt-4">23 February 2026, updated 30 March 2026 &middot; 22 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-6">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Source Library has identified nearly 2,500 books that appear to be first-ever English translations &mdash; over 1,200 of which are now fully translated. This is a strong claim, and it deserves a transparent explanation of how we arrive at it. This post describes the methodology &mdash; the AI classification system, the multi-stage verification pipeline, the confidence levels, and the known limitations.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          If you haven&apos;t read the companion post,{' '}
          <Link href="/blog/first-translations" className="text-accent-rust hover:text-accent-rust underline">
            <em>First English Translations</em>
          </Link>{' '}
          describes what these books are and why they matter. This post is about how we find them.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The problem
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Determining whether a book has ever been translated into English is a surprisingly difficult bibliographic question. For famous works &mdash; the <em>Corpus Hermeticum</em>, Paracelsus&apos;s major treatises, the Rosicrucian manifestos &mdash; the answer is well documented. But for the vast majority of pre-1800 Latin, German, French, and Sanskrit texts in a collection like ours, there is no central registry of translations. You cannot look up &ldquo;has this book been translated into English&rdquo; in a database.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Scholarly bibliographies cover the major works. WorldCat can sometimes surface obscure translations. But for a 1621 German alchemical pamphlet or a 15th-century Sanskrit jyotish manuscript, the absence of evidence really is, in most cases, evidence of absence. If no English translation appears in WorldCat, COPAC, the <em>Universal Short Title Catalogue</em>, or the major subject bibliographies, and no scholar has mentioned one, it almost certainly does not exist. The economics of translation before AI simply did not support rendering thousands of niche historical texts into English.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The classification system
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Every book in Source Library passes through an AI metadata enrichment step. After OCR is complete, the system reads the first 25 pages of transcribed text and asks Google&apos;s Gemini model to classify the book across several dimensions: language, subject categories, estimated publication year, author detection, and &mdash; crucially &mdash; first-translation status.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The AI is prompted to act as a &ldquo;rare books librarian and translation scholar&rdquo; and to classify the first-translation status using one of six values:
        </p>

        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-stone-50">
                <th className="text-left px-4 py-3 text-primary font-semibold">Status</th>
                <th className="text-left px-4 py-3 text-primary font-semibold">Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">confirmed_first</td>
                <td className="px-4 py-3 text-secondary">No known English translation exists. The model has high confidence based on the text&apos;s obscurity, language, and subject matter.</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">likely_first</td>
                <td className="px-4 py-3 text-secondary">Probably no English translation exists, but the model cannot be certain. The text is obscure enough that a translation is unlikely but not impossible.</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">uncertain</td>
                <td className="px-4 py-3 text-secondary">The model cannot determine whether a translation exists. The text may be well-known enough that a translation could plausibly exist but the model isn&apos;t sure.</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">has_partial</td>
                <td className="px-4 py-3 text-secondary">Fragments or excerpts have been translated, but no complete English translation exists. Common for anthologized texts.</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">has_translation</td>
                <td className="px-4 py-3 text-secondary">A known English translation already exists.</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-secondary font-medium">not_applicable</td>
                <td className="px-4 py-3 text-secondary">The text is already in English.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          Each classification includes a reasoning field (1&ndash;2 sentences explaining the assessment), a list of any known English translations the model is aware of, and an independent confidence rating (high, medium, or low). The classification is only applied to the book record when the overall enrichment confidence is medium or higher.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What the model knows
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The AI&apos;s assessment rests on several types of knowledge:
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong className="text-primary">Bibliographic training data.</strong> Large language models have been trained on vast corpora that include library catalogues, bibliographic databases, scholarly articles, book reviews, and publisher listings. When the model encounters a Latin text by Athanasius Kircher, it can draw on its knowledge of Kircher scholarship to assess whether the specific work has been translated. This is the model&apos;s strongest signal for well-known authors and canonical texts.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong className="text-primary">The prior probability of translation.</strong> The prompt includes an important heuristic: &ldquo;Most pre-1800 Latin, German, and other non-English texts on alchemy, Hermeticism, Kabbalah, astrology, and natural philosophy were NEVER translated to English.&rdquo; This is historically accurate. The translation industry before the 20th century was small, and it was heavily biased toward texts that fit the evolving scholarly canon. A German alchemical pamphlet from 1621 had essentially zero chance of being translated into English unless it was unusually famous.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong className="text-primary">The text itself.</strong> The model reads the actual OCR text from the book&apos;s pages &mdash; title page, preface, and opening chapters. This gives it direct evidence of the language, subject matter, author, and approximate date, all of which bear on translation likelihood. A 400-page Latin commentary on Pseudo-Dionysius from 1593 is far less likely to have been translated than a 30-page English summary of alchemical principles from 1650.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong className="text-primary">Negative evidence.</strong> For truly obscure texts, the model&apos;s inability to recall any English translation <em>is itself</em> informative. If a text is so obscure that a model trained on the internet&apos;s worth of text has never encountered a reference to an English translation, the probability that such a translation exists and has simply escaped notice is very low.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The gold badge
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Books classified as <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">confirmed_first</code> or <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">likely_first</code> are surfaced throughout the site with a gold &ldquo;First Translation&rdquo; badge. This appears on book cards in the library and collection pages, in search results, and on the book detail page. The badge is also available as a search filter &mdash; you can search for books and filter to show only first translations.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          We chose to group <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">confirmed_first</code> and <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">likely_first</code> together because the practical difference between them is small for readers. Both indicate that no prior English translation is known to exist. The distinction matters for bibliographic precision, but not for the reader who wants to know whether this text has been available in English before.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Deep verification
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The AI classification is a first pass. To move from AI intuition to evidence-backed claims, every non-English book in the library passes through a second verification stage that searches real bibliographic databases using Gemini function calling.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The verification model is given eight tools it can call autonomously:
        </p>

        <ol className="space-y-3 text-secondary mb-8 ml-4 list-decimal list-outside pl-2">
          <li className="leading-relaxed pl-2"><strong>Local translation catalogs</strong> &mdash; a database of ~14,000 records from UNESCO&apos;s <em>Index Translationum</em>, the Loeb Classical Library, Brill&apos;s translations, Penguin Classics, HathiTrust, and other standard translation catalogs</li>
          <li className="leading-relaxed pl-2"><strong>Open Library API</strong> &mdash; searches for English-language editions by title and author, returns ISBNs, publishers, and edition history</li>
          <li className="leading-relaxed pl-2"><strong>Google Books API</strong> &mdash; broad coverage, including out-of-print and academic works with language filtering</li>
          <li className="leading-relaxed pl-2"><strong>Internet Archive</strong> &mdash; searches 30 million+ digitized texts for public domain translations, older academic editions, and reprints that other catalogs miss</li>
          <li className="leading-relaxed pl-2"><strong>OpenAlex</strong> &mdash; an open catalog of 250 million scholarly works, excellent for finding academic press translations (Brill, De Gruyter, Cambridge, Oxford) and translations published in journals or edited volumes</li>
          <li className="leading-relaxed pl-2"><strong>Library of Congress</strong> &mdash; the authoritative US library catalog, catching recent cataloging and translations held by research libraries</li>
          <li className="leading-relaxed pl-2"><strong>Universal Short Title Catalogue (USTC)</strong> &mdash; verifies the identity of the original work in the standard catalog of early printed books</li>
          <li className="leading-relaxed pl-2"><strong>make_determination</strong> &mdash; a structured output tool the model calls when it has gathered enough evidence to render a verdict, citing specific translations found (with URLs) or explaining why none were found</li>
        </ol>

        <p className="text-secondary leading-relaxed mb-6">
          The model decides which tools to call and in what order, typically running 3&ndash;8 searches per book. It evaluates results semantically &mdash; not just checking whether a title appears, but whether the result is actually a translation of the specific work in question, as opposed to a book <em>about</em> the work, a translation of a <em>different</em> work by the same author, or a secondary study that shares a similar title.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          This tool-calling approach replaced an earlier pipeline that used separate catalog search and LLM validation stages. The integrated approach is both more accurate (the model can follow leads across databases) and more efficient (typically 3&ndash;5 API calls per book vs. 6&ndash;9 in the old pipeline).
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Automated catalog verification
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          For each of the 4,300 non-English books in the library, the verification model searches multiple catalog APIs and databases for English-language editions of the same work:
        </p>

        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-stone-50">
                <th className="text-left px-4 py-3 text-primary font-semibold">Source</th>
                <th className="text-left px-4 py-3 text-primary font-semibold">What it searches</th>
                <th className="text-left px-4 py-3 text-primary font-semibold">Strength</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">Translation catalogs</td>
                <td className="px-4 py-3 text-secondary">~14,000 records from UNESCO Index Translationum, Loeb Classical Library, Brill, Penguin Classics, HathiTrust, and other standard catalogs</td>
                <td className="px-4 py-3 text-secondary">Best for canonical translations; includes translator, publisher, and year</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">Open Library</td>
                <td className="px-4 py-3 text-secondary">Title + author search, filtered to English-language results</td>
                <td className="px-4 py-3 text-secondary">Good coverage of published books; includes ISBNs and edition data</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">Google Books</td>
                <td className="px-4 py-3 text-secondary">Title + author search with language filter</td>
                <td className="px-4 py-3 text-secondary">Broad coverage; includes out-of-print and academic works</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">Internet Archive</td>
                <td className="px-4 py-3 text-secondary">Advanced search across 30M+ digitized texts</td>
                <td className="px-4 py-3 text-secondary">Public domain translations, older academic editions, and reprints</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">OpenAlex</td>
                <td className="px-4 py-3 text-secondary">250M+ scholarly works including books, articles, and book chapters</td>
                <td className="px-4 py-3 text-secondary">Academic press translations; finds translations in journals and edited volumes</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">Library of Congress</td>
                <td className="px-4 py-3 text-secondary">Live catalog search filtered to English-language holdings</td>
                <td className="px-4 py-3 text-secondary">Authoritative US library catalog; catches recent cataloging</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-secondary font-medium">USTC</td>
                <td className="px-4 py-3 text-secondary">Early printed book records, verifies identity of the original work</td>
                <td className="px-4 py-3 text-secondary">Standard catalog of pre-1601 books; confirms work identity</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          The search uses both the original-language title and the English display title (when available) to maximize recall. The model evaluates results semantically: a search for Ficino&apos;s <em>De Vita</em> returns dozens of results, most of which are about Ficino rather than translations <em>of</em> Ficino. The model filters these in real time, examining each hit to determine whether it represents an actual English translation of the specific work.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          When a translation is found, the model cites the specific translator, publication year, publisher, and &mdash; when available from catalog searches &mdash; a direct URL to the catalog record. This makes every claim independently verifiable.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Five dispositions
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          After verification, each book receives one of six dispositions:
        </p>

        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-stone-50">
                <th className="text-left px-4 py-3 text-primary font-semibold">Disposition</th>
                <th className="text-left px-4 py-3 text-primary font-semibold">Meaning</th>
                <th className="text-left px-4 py-3 text-primary font-semibold">Badge</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">confirmed_first</td>
                <td className="px-4 py-3 text-secondary">No English translation found in any catalog or database. Strong evidence that this is a first translation.</td>
                <td className="px-4 py-3">
                  <span className="bg-accent-gold text-white text-xs px-2 py-0.5 rounded-full font-medium">First Translation</span>
                </td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">first_complete_translation</td>
                <td className="px-4 py-3 text-secondary">Partial translations exist (excerpts in anthologies, selected chapters, scholarly quotations), but no complete English rendering has been published.</td>
                <td className="px-4 py-3">
                  <span className="bg-accent-gold text-white text-xs px-2 py-0.5 rounded-full font-medium">First Translation</span>
                </td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">first_modern_translation</td>
                <td className="px-4 py-3 text-secondary">An English translation exists, but only from before 1800. This is the first modern translation using current scholarly standards.</td>
                <td className="px-4 py-3">
                  <span className="bg-accent-gold text-white text-xs px-2 py-0.5 rounded-full font-medium">First Modern Translation</span>
                </td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">first_from_source</td>
                <td className="px-4 py-3 text-secondary">English translations exist from a different source language, but not from this specific text. For example, a Latin translation of a Greek work where the Greek has been translated to English but the Latin has not.</td>
                <td className="px-4 py-3">
                  <span className="bg-accent-gold text-white text-xs px-2 py-0.5 rounded-full font-medium">First from Latin</span>
                </td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">translation_found</td>
                <td className="px-4 py-3 text-secondary">At least one verified English translation was found. The book page links to the catalog record.</td>
                <td className="px-4 py-3 text-muted text-sm">No badge</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-secondary font-medium">needs_review</td>
                <td className="px-4 py-3 text-secondary">The model could not reach a confident determination. These books are not badged and require manual review.</td>
                <td className="px-4 py-3 text-muted text-sm">No badge</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          The distinction between <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">confirmed_first</code>, <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">first_complete_translation</code>, and <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">first_modern_translation</code> captures a bibliographic reality that binary first/not-first classifications miss. Many canonical texts have had parts translated &mdash; Ficino&apos;s <em>Opera Omnia</em> has never been fully translated, but individual dialogues within it have been translated separately. Paracelsus&apos;s collected Latin works have never been translated as a whole, but Arthur Edward Waite rendered roughly 30% of them in 1894. All three dispositions receive the first-translation badge because the contribution is genuinely novel.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Why tool calling, not plain prompting
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          An earlier version of this pipeline asked the model a simple question: &ldquo;Do you know of an English translation of this work?&rdquo; The model sometimes produced plausible-looking but fictitious references &mdash; a real translator paired with a nonexistent book, or a real publisher with a fabricated publication year. In our sampling, roughly two-thirds of the model&apos;s unsourced claims could not be verified.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The tool-calling approach solves this by grounding every claim in external evidence. When the model calls <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">search_open_library</code> and gets back a record for &ldquo;Shackleton Bailey, Harvard University Press, 2000,&rdquo; that record exists. When it searches and finds nothing, the empty result set is itself documented evidence. The model cannot hallucinate a catalog entry because the catalogs respond with real data.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          This also catches a subtle class of near-miss hallucinations: the model might &ldquo;know&rdquo; that Stephen Skinner and David Rankine translated something for Golden Hoard Press in 2008, and all of those elements are real, but the actual book is a translation of a <em>different</em> work. When the model searches the catalogs, it finds the real entry and can determine whether it matches the work in question.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          What readers see
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          For books where verification found existing English translations, the book&apos;s bibliographic information panel shows a &ldquo;Known English Translations&rdquo; section. Each entry includes the English title, translator, publication year, publisher, and &mdash; when available from catalog searches &mdash; a link to the record on Open Library, Google Books, or Internet Archive. This allows readers to compare Source Library&apos;s AI translation with existing scholarly translations of the same work.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          For books confirmed as first translations, the panel notes that no prior English translation was found, naming the sources that were checked. This makes the basis for the first-translation claim explicit and auditable.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Known limitations
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          <strong className="text-primary">The model can be wrong.</strong> AI language models have broad but imperfect knowledge of bibliographic history. A translation published in a small-circulation journal in the 1930s, or included in an unpublished PhD thesis, could easily be missed. We expect occasional false positives &mdash; books classified as first translations where an obscure prior translation does exist. We welcome corrections.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong className="text-primary">Partial translations are a grey area.</strong> Many canonical texts have been partially translated &mdash; selected chapters in anthologies, key passages quoted in secondary literature, or abridged versions. The <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">has_partial</code> status captures this, but the line between &ldquo;partial translation&rdquo; and &ldquo;no translation&rdquo; is blurry. A book that has had three pages quoted in a scholarly article is not &ldquo;translated&rdquo; in any meaningful sense, but neither is it entirely unknown to English readers.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong className="text-primary">Confidence is unevenly distributed.</strong> The model is most reliable for texts that are either very famous (it knows the translation history) or very obscure (the absence of any mention is itself strong evidence). It is least reliable for texts of intermediate fame &mdash; well-known enough that a translation <em>might</em> exist, but not so famous that the model can definitively say. These cases are typically classified as <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">uncertain</code> and do not receive the first-translation badge.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          <strong className="text-primary">The classification is a snapshot.</strong> A book classified as a first translation today could have a human translation published tomorrow. The classification reflects the state of knowledge at the time of enrichment. We do not currently re-run the classification automatically, though books that pass through the pipeline again will receive updated assessments.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          <strong className="text-primary">Catalog coverage has limits.</strong> The verification pipeline now searches seven major sources &mdash; including Internet Archive, OpenAlex, and the Library of Congress &mdash; but cannot find translations that exist only in unpublished dissertations, private archives, or out-of-print anthologies with no digital footprint. Our March 2026 accuracy evaluation suggests the false positive rate is under 0.5%, but a small number of edge cases will inevitably be missed.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Why transparency matters
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          Claiming that something is a &ldquo;first translation&rdquo; carries weight in scholarly contexts. We take that seriously. Every first-translation classification in Source Library is:
        </p>

        <ul className="space-y-3 text-secondary mb-8">
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span><strong>Stored with provenance</strong> &mdash; the model used, the confidence level, the reasoning, and the date of classification are all preserved in the book&apos;s metadata record.</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span><strong>Based on actual text analysis</strong> &mdash; the model reads the OCR text, not just the title. This catches cases where a title might suggest familiarity but the actual content is a different or expanded work.</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span><strong>Conservative by default</strong> &mdash; only <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">confirmed_first</code> and <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">likely_first</code> receive the badge. Books classified as <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">uncertain</code> are not badged, even if the balance of probability suggests no prior translation exists.</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span><strong>Correctable</strong> &mdash; if a specialist identifies a prior translation we missed, the classification can be updated. The original text and translation remain valuable regardless.</span>
          </li>
        </ul>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The numbers
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          As of March 2026, the enrichment system has classified every non-English book in the collection, and the tool-calling verification pipeline has processed virtually all 4,300 non-English books. The initial AI classification identified roughly 1,000 first translations. The tool-calling verification significantly refined the picture in both directions:
        </p>

        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-stone-50">
                <th className="text-left px-4 py-3 text-primary font-semibold">Disposition</th>
                <th className="text-right px-4 py-3 text-primary font-semibold">Books</th>
                <th className="text-left px-4 py-3 text-primary font-semibold">What it means</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">Confirmed first translation</td>
                <td className="px-4 py-3 text-secondary text-right font-medium">1,727</td>
                <td className="px-4 py-3 text-secondary">No English translation found in any catalog or database searched</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">First complete translation</td>
                <td className="px-4 py-3 text-secondary text-right font-medium">609</td>
                <td className="px-4 py-3 text-secondary">Partial translations exist, but no complete English rendering published</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">First modern translation</td>
                <td className="px-4 py-3 text-secondary text-right font-medium">119</td>
                <td className="px-4 py-3 text-secondary">Only pre-1800 English translations exist</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">Existing translation found</td>
                <td className="px-4 py-3 text-secondary text-right font-medium">1,527</td>
                <td className="px-4 py-3 text-secondary">At least one verified English translation exists</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-secondary font-medium">Needs review</td>
                <td className="px-4 py-3 text-secondary text-right font-medium">106</td>
                <td className="px-4 py-3 text-secondary">Insufficient evidence for a confident determination</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          2,455 books &mdash; roughly 57% of the non-English collection &mdash; are classified as first translations of some kind. This is significantly higher than the initial AI classification alone (which flagged ~1,000 books) because the tool-calling verification discovered hundreds of new first translations: books where the initial AI enrichment was too conservative, marking them as <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">uncertain</code> when a thorough catalog search would have revealed no prior translation.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The verification also works in the opposite direction: 1,527 books were found to have existing translations that the initial classification had not identified. Several of these were recent publications (2020s) that postdate the training data of any AI model, demonstrating why catalog search is essential &mdash; no amount of parametric knowledge can catch translations published after training cutoff.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Of the 2,455 first translations, 1,276 are now fully translated &mdash; readable from the first page to the last. Another 223 are 80% or more complete. The translations span 670 Latin works, 430 German, 420 Chinese, 182 French, 144 Greek, 135 Sanskrit, and dozens of other languages including Syriac, Dutch, Italian, Armenian, Hebrew, and Arabic.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Accuracy evaluation (March 2026)
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          How reliable are our first-translation claims? We conducted a systematic evaluation in March 2026 to answer this question. The evaluation had two parts: a cross-check against our own catalog data, and a re-verification of flagged cases using an expanded set of catalog sources.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Catalog cross-check
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          We cross-referenced all 5,836 books claiming first-translation status against the 13,862 entries in our translation catalog database. For each book, we checked whether the catalog contained a translation of a plausibly matching work by the same author, using surname matching and title-keyword similarity scoring. The results:
        </p>

        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-8">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">No catalog match at all</td>
                <td className="px-4 py-3 text-secondary text-right font-medium">3,797</td>
                <td className="px-4 py-3 text-secondary">No known translations by this author in any catalog</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">Same author, different work</td>
                <td className="px-4 py-3 text-secondary text-right font-medium">377</td>
                <td className="px-4 py-3 text-secondary">Author has translated works, but not this specific text</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">Surname collision</td>
                <td className="px-4 py-3 text-secondary text-right font-medium">556</td>
                <td className="px-4 py-3 text-secondary">Different person with the same surname</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-secondary font-medium">Probable same work (review needed)</td>
                <td className="px-4 py-3 text-secondary text-right font-medium">77</td>
                <td className="px-4 py-3 text-secondary">Catalog has a translation that may match this specific text</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          77 cases out of 5,836 &mdash; 1.3% &mdash; were flagged for manual review. On inspection, the majority turned out to be correct nuanced classifications: collected works where only excerpts had been translated (<code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">first_complete_translation</code>), or Latin versions of Greek texts where only the Greek had been translated to English (<code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">first_from_source</code>). The tool&apos;s reasoning on these hard cases &mdash; Paracelsus&apos;s collected works, Boccaccio&apos;s Italian <em>volgarizzamento</em>, Mersenne&apos;s French adaptation of Galileo &mdash; was precise and defensible.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Expanded verification pipeline
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          In late March 2026, we expanded the verification pipeline from 4 catalog sources to 7, adding Internet Archive (30M+ digitized texts), OpenAlex (250M scholarly works), and the Library of Congress live catalog. We then re-verified the 77 flagged cases with the expanded pipeline.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The results were significant: 34 out of 77 dispositions changed (44%). Of those, 12 books changed from &ldquo;first translation&rdquo; to &ldquo;translation found&rdquo; &mdash; genuine corrections. Examples:
        </p>

        <ul className="space-y-3 text-secondary mb-8">
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span>Marsilio Ficino&apos;s <em>De Christiana Religione</em> &mdash; Google Books found a 2022 University of Toronto Press translation the old pipeline missed</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span>Leonhard Euler&apos;s <em>Einleitung in die Analysis des Unendlichen</em> &mdash; the German title didn&apos;t match the English catalog entry; with more sources, the tool found Blanton&apos;s translation</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span>Cesare Ripa&apos;s <em>Iconologia</em> &mdash; Open Library surfaced the 1709 English translation that the old pipeline overlooked</span>
          </li>
        </ul>

        <p className="text-secondary leading-relaxed mb-6">
          The new tools are being used heavily: Internet Archive is called on 70% of verifications, OpenAlex on 61%, and Library of Congress on 42%. All three are finding translations that the original four sources miss.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          We are now re-running the full pipeline with the expanded tool set across all previously verified books, starting with the Latin corpus (2,400+ books). The estimated false positive rate for outright errors is under 0.5%. The remaining edge cases are legitimate scholarly judgment calls about what constitutes &ldquo;the same work&rdquo; &mdash; whether a partial anthology counts as a translation, whether a Latin rendering of a Greek text is distinct from the Greek original, and similar questions that reasonable bibliographers could disagree on.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          An invitation
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          This methodology is imperfect by design. No automated system can match the depth of a specialist who has spent years working with a particular corpus. What the system can do is scale: it can classify thousands of books in hours, surfacing the most likely first translations for further review.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          If you are a specialist in any of the fields covered by Source Library &mdash; Renaissance Latin literature, Early Modern German, Sanskrit philosophical traditions, alchemical bibliography &mdash; we would welcome your review of our classifications. If you know of a prior English translation that we missed, or if you can confirm that our classification is correct, that information makes the library more reliable for everyone.
        </p>

        <div className="bg-accent-gold/5 rounded-lg p-6 border border-accent-gold/15 mb-8">
          <p className="text-stone-700 leading-relaxed">
            <strong>Explore:</strong>{' '}
            <Link href="/search?first_translation=true" className="text-accent-rust hover:text-accent-rust underline">Search all first translations</Link>{' '}
            or read the companion post on{' '}
            <Link href="/blog/first-translations" className="text-accent-rust hover:text-accent-rust underline">what these first translations contain</Link>.
            Every book preserves the original text alongside the translation for verification.
          </p>
        </div>

        <div className="border-t border-border-light pt-8 mt-16">
          <p className="text-secondary text-sm leading-relaxed">
            Source Library is a project of the Embassy of the Free Mind. Corrections and feedback are welcome &mdash;{' '}
            <a href="mailto:team@sourcelibrary.org" className="text-accent-rust hover:text-accent-rust underline">team@sourcelibrary.org</a>.
          </p>
        </div>
      </article>

    </ContentPageLayout>
  );
}
