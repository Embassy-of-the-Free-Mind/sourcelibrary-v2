import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'How We Identify First Translations - Blog - Source Library',
  description: 'The methodology behind Source Library\'s first-translation classification: how AI enrichment, bibliographic heuristics, and human review work together to identify books that have never been translated into English.',
  openGraph: {
    title: 'How We Identify First Translations',
    description: 'The methodology behind Source Library\'s first-translation classification: AI enrichment, bibliographic heuristics, and human review.',
    images: [{ url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6952587bab34727b1f045546/3.jpg', width: 1200, height: 630 }],
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
        >
          <p className="text-stone-400 text-sm mt-4">23 February 2026, updated 26 February 2026 &middot; 18 min read</p>
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
          All posts
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Source Library has identified over 500 books that appear to be first-ever English translations. This is a strong claim, and it deserves a transparent explanation of how we arrive at it. This post describes the methodology &mdash; the AI classification system, the confidence levels, the heuristics it relies on, and the known limitations.
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
          The AI classification is a first pass. For specific collections where precision matters most, we perform deeper bibliographic verification. The{' '}
          <Link href="/collections/astrology" className="text-accent-rust hover:text-accent-rust underline">Astrology &amp; Divination</Link>{' '}
          collection is the best example: each of its 95 identified first translations was reviewed against subject bibliographies, WorldCat, and specialist databases for Indian astrological literature. Of those 95, 85 were confirmed with 80%+ confidence that no prior English translation exists.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Deep verification follows a consistent process:
        </p>

        <ol className="space-y-3 text-secondary mb-8 ml-4 list-decimal list-outside pl-2">
          <li className="leading-relaxed pl-2">Check WorldCat and COPAC for English-language editions of the same work or author</li>
          <li className="leading-relaxed pl-2">Check the <em>Universal Short Title Catalogue</em> (USTC) for the specific edition and any English derivatives</li>
          <li className="leading-relaxed pl-2">Check subject-specific bibliographies (e.g. Ferguson&apos;s <em>Bibliotheca Chemica</em> for alchemical texts, Pingree&apos;s <em>Census of the Exact Sciences in Sanskrit</em> for Indian works)</li>
          <li className="leading-relaxed pl-2">Search Google Scholar and JSTOR for English translations mentioned in secondary literature</li>
          <li className="leading-relaxed pl-2">For anthologized authors, check whether the specific <em>work</em> (not just the author) has been translated</li>
        </ol>

        <p className="text-secondary leading-relaxed mb-8">
          This level of verification has not been performed for all 500+ first translations. It is ongoing. The AI classification provides the initial identification; deep verification confirms or corrects it for priority collections.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Automated catalog verification
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          In February 2026, we added a second layer of verification: automated searches of three major library catalogs for every non-English book in the collection. This moves beyond the AI model&apos;s parametric knowledge to check actual bibliographic records.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Stage 1: Catalog search
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          For each of the 1,370 non-English books in the library, the system searches three catalog APIs for English-language editions of the same work:
        </p>

        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-stone-50">
                <th className="text-left px-4 py-3 text-primary font-semibold">Catalog</th>
                <th className="text-left px-4 py-3 text-primary font-semibold">What it searches</th>
                <th className="text-left px-4 py-3 text-primary font-semibold">Strength</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">Open Library</td>
                <td className="px-4 py-3 text-secondary">Title + author search, filtered to English-language results</td>
                <td className="px-4 py-3 text-secondary">Good coverage of published books; includes ISBNs and edition data</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">Google Books</td>
                <td className="px-4 py-3 text-secondary">Title + author search with language filter</td>
                <td className="px-4 py-3 text-secondary">Broadest coverage; includes out-of-print and academic works</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-secondary font-medium">Internet Archive</td>
                <td className="px-4 py-3 text-secondary">Full-text search across digitized books</td>
                <td className="px-4 py-3 text-secondary">Many translations digitized; includes public domain texts</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          The search uses both the original-language title and the English display title (when available) to maximize recall. Catalog results are stored as structured evidence &mdash; each hit includes the English title, translator name, publication year, publisher, catalog identifier, and a direct link to the catalog record.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Stage 2: Validation
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Catalog search results are noisy. A search for Ficino&apos;s <em>De Vita</em> returns dozens of results, most of which are about Ficino rather than translations <em>of</em> Ficino. Stage 2 uses an AI model (Gemini 2.5 Flash) to evaluate each catalog hit and determine whether it represents an actual English translation of the specific work in question.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The validation follows two parallel paths:
        </p>

        <div className="space-y-4 mb-8">
          <div className="bg-white rounded-xl border border-border-light p-5">
            <p className="font-semibold text-primary mb-2">Path A: Verify catalog claims</p>
            <p className="text-secondary text-sm leading-relaxed">
              For books where the catalog search found potential translations, the model examines each result and asks: &ldquo;Is this actually a translation of this specific work, or is it a different book by the same author, a secondary study, or an unrelated work that happens to share a similar title?&rdquo; Only results that pass this filter are stored as validated translations.
            </p>
          </div>
          <div className="bg-white rounded-xl border border-border-light p-5">
            <p className="font-semibold text-primary mb-2">Path B: LLM knowledge check</p>
            <p className="text-secondary text-sm leading-relaxed">
              For books where no catalog results were found, the model draws on its own training data to check whether it knows of any English translation &mdash; including translations too recent for the catalogs, translations published in journals or anthologies, or translations from publishers not well indexed by Open Library or Google Books. These claims are stored separately and flagged as unverified.
            </p>
          </div>
        </div>

        <h3 className="text-xl text-primary mt-10 mb-4">
          After Stage 2: three dispositions
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          After both stages, each book receives one of three dispositions:
        </p>

        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-stone-50">
                <th className="text-left px-4 py-3 text-primary font-semibold">Disposition</th>
                <th className="text-left px-4 py-3 text-primary font-semibold">Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">confirmed_first</td>
                <td className="px-4 py-3 text-secondary">No English translation found in any catalog, and the model does not know of one either. Strong evidence that this is a first translation.</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">translation_found</td>
                <td className="px-4 py-3 text-secondary">At least one verified English translation was found in library catalogs. The book page now links to the catalog record.</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-secondary font-medium">needs_review</td>
                <td className="px-4 py-3 text-secondary">No catalog evidence, but the model claims to know of a translation. These claims have a high hallucination rate (~67% in our sampling) and are not displayed to readers.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 className="text-xl text-primary mt-10 mb-4">
          The hallucination problem
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          The <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">needs_review</code> disposition deserves special attention. When asked &ldquo;Do you know of an English translation of this work?&rdquo;, the model sometimes produces plausible-looking but fictitious references &mdash; a real translator paired with a nonexistent book, or a real publisher with a fabricated publication year. In our sampling, roughly two-thirds of the model&apos;s claims in this category could not be verified against any catalog or bibliographic record.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          This is a known failure mode of large language models: they generate text that looks like a correct answer, drawing on real bibliographic patterns, but the specific combination is invented. Catalog-verified translations (<code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">translation_found</code>) always link directly to the external catalog record, so readers can verify the claim independently. But the <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">needs_review</code> category &mdash; originally 580 books &mdash; needed a way to separate real translations from hallucinated ones.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Stage 3: Google Search Grounding
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The hallucination problem led us to add a third verification stage that goes beyond both catalog APIs and the model&apos;s parametric knowledge: Google Search Grounding.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Google&apos;s Gemini API offers a &ldquo;search grounding&rdquo; feature that allows the model to perform real-time web searches as part of its reasoning. Unlike Stage 1 (which queries specific catalog APIs) or Stage 2 (which relies on the model&apos;s training data), search grounding gives the model access to live search results &mdash; academic databases, library catalogs, publisher websites, dissertations, journal articles, and bookseller listings.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          For each book, the system constructs a detailed research prompt: the original-language title, author, publication date, language, the first 10 pages of OCR text, and any prior LLM-generated translation claims that need verification. The model then runs 10&ndash;20 targeted searches, evaluating each result for relevance. Typical search queries include:
        </p>

        <ul className="space-y-2 text-secondary mb-8 ml-4">
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span><code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-xs">&quot;De Hermetica Medicina&quot; English translation</code></span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span><code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-xs">&quot;Hermann Conring&quot; Hermetica translator</code></span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span><code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-xs">&quot;De Hermetica Medicina&quot; dissertation English</code></span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1.5 shrink-0">&bull;</span>
            <span><code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-xs">&quot;Hermann Conring&quot; Hermetic medicine excerpts English</code></span>
          </li>
        </ul>

        <p className="text-secondary leading-relaxed mb-6">
          The model explicitly self-filters: any results pointing to Source Library&apos;s own translations are excluded, so it only finds independent prior translations. When it does find a translation, it extracts the translator name, publication year, publisher, and crucially, whether the translation is complete, partial, or only excerpts.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Catching hallucinations
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          The most valuable function of search grounding is not finding translations &mdash; it is <em>disconfirming</em> hallucinated ones. The LLM knowledge check from Stage 2 might claim that a book was translated by &ldquo;Stephen Skinner and David Rankine, 2008, Golden Hoard Press.&rdquo; Search grounding can verify that Skinner and Rankine are real translators and Golden Hoard Press is a real publisher, but their 2008 book is actually a translation of a <em>different</em> work &mdash; a medieval Latin geomancy text, not the 17th-century German compilation in question.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          This kind of near-miss hallucination is the hardest for catalog searches to catch: all the bibliographic elements are real, just wrongly combined. Search grounding catches it because it can read the actual descriptions and tables of contents that appear in search results.
        </p>

        <h3 className="text-xl text-primary mt-10 mb-4">
          Complete vs. partial: a meaningful distinction
        </h3>

        <p className="text-secondary leading-relaxed mb-6">
          Search grounding reveals a nuance that catalog searches largely miss: many &ldquo;untranslated&rdquo; books have actually had parts translated. Ficino&apos;s <em>Opera Omnia</em> has never been fully translated, but individual dialogues within it have been translated separately by scholars like Michael J. B. Allen and Sears Jayne. Paracelsus&apos;s collected Latin works have never been translated as a whole, but Arthur Edward Waite rendered roughly 30% of them in 1894.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The system classifies each found translation as <strong>complete</strong>, <strong>partial</strong>, or <strong>excerpts</strong>. A book where only partial translations exist still receives <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">translation_found</code> as its disposition &mdash; translations do exist &mdash; but <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">is_first_translation</code> remains true because no complete translation has been published. This distinction lets us accurately say, for example, that Source Library&apos;s translation of the <em>Theatrum Chemicum</em> is the first complete English rendering of the anthology, even though individual tracts within it have been translated over the centuries.
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
          <strong className="text-primary">Web search coverage has limits.</strong> Google Search Grounding dramatically improved coverage over catalog APIs alone, but web search still cannot find translations that exist only in unpublished dissertations, private archives, or out-of-print anthologies with no digital footprint. The three-stage pipeline &mdash; catalog APIs, LLM knowledge, and live web search &mdash; catches the vast majority of published translations, but a small number of edge cases will inevitably be missed.
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
          As of February 2026, the enrichment system has classified every book in the collection. The initial AI classification:
        </p>

        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-stone-50">
                <th className="text-left px-4 py-3 text-primary font-semibold">Classification</th>
                <th className="text-right px-4 py-3 text-primary font-semibold">Books</th>
                <th className="text-left px-4 py-3 text-primary font-semibold">Badge shown?</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary">confirmed_first + likely_first</td>
                <td className="px-4 py-3 text-secondary text-right font-medium">529</td>
                <td className="px-4 py-3">
                  <span className="bg-accent-gold text-white text-xs px-2 py-0.5 rounded-full font-medium">First Translation</span>
                </td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary">has_translation / not_applicable / uncertain / has_partial</td>
                <td className="px-4 py-3 text-secondary text-right font-medium">3,896</td>
                <td className="px-4 py-3 text-muted text-sm">No badge</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          529 books &mdash; roughly 12% of the collection &mdash; are classified as first translations. This is consistent with what we would expect from a collection focused on pre-1800 Latin, German, and Sanskrit texts in fields like alchemy, astrology, and Christian mysticism, where English translation rates have historically been very low.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The subsequent verification refined this picture significantly. After all three stages &mdash; catalog search, LLM validation, and search grounding:
        </p>

        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-stone-50">
                <th className="text-left px-4 py-3 text-primary font-semibold">Verification result</th>
                <th className="text-right px-4 py-3 text-primary font-semibold">Books</th>
                <th className="text-left px-4 py-3 text-primary font-semibold">What it means</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">Confirmed first translation</td>
                <td className="px-4 py-3 text-secondary text-right font-medium">~680</td>
                <td className="px-4 py-3 text-secondary">No English translation found via catalogs, LLM knowledge, or live web search</td>
              </tr>
              <tr className="border-b border-border-light">
                <td className="px-4 py-3 text-secondary font-medium">Existing translation found</td>
                <td className="px-4 py-3 text-secondary text-right font-medium">~360</td>
                <td className="px-4 py-3 text-secondary">At least one English translation verified (complete or partial), shown on book page</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-secondary font-medium">Awaiting verification</td>
                <td className="px-4 py-3 text-secondary text-right font-medium">~410</td>
                <td className="px-4 py-3 text-secondary">Not yet processed by search grounding; gradually resolving as the system runs</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6">
          The most significant change from the initial catalog-only verification: search grounding resolved what had been 580 <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">needs_review</code> books into definitive dispositions. Many of the LLM&apos;s original translation claims turned out to be hallucinations &mdash; books were promoted to <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">confirmed_first</code>. Others were confirmed as real &mdash; the model had correctly identified obscure translations that the catalog APIs missed, and search grounding found the evidence.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Of the ~360 books where translations were found, about 300 have complete English translations available. The remaining ~60 have only partial translations or scholarly excerpts &mdash; selected chapters in anthologies, passages quoted in academic studies, or abridged versions. These books are still marked <code className="text-accent-rust bg-accent-gold/8 px-1.5 py-0.5 rounded text-sm">is_first_translation</code> because no complete English rendering has been published.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The 680 confirmed first translations are a stronger claim than the original 529 from the AI classification alone. They have been checked against three catalog APIs, evaluated by an LLM with access to its full training data, and verified through live web search. The ~360 books where translations were found demonstrate that the verification process works in both directions &mdash; surfacing existing translations is just as valuable as confirming their absence. Several of the found translations were to recent publications (2020s) that postdate the model&apos;s training data, catching cases that no amount of parametric knowledge could have identified.
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
            Source Library is a project of the Embassy of the Free Mind. Everything in the collection is CC0 public domain. Corrections and feedback are welcome &mdash;{' '}
            <a href="mailto:derek@ancientwisdomtrust.org" className="text-accent-rust hover:text-accent-rust underline">derek@ancientwisdomtrust.org</a>.
          </p>
        </div>
      </article>

      <BlogComments slug="first-translation-methodology" />
    </ContentPageLayout>
  );
}
