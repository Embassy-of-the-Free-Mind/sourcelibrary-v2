import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Did the AI Read This? - Research Notes - Source Library',
  description: 'A Bayesian survey of which books in our 16,871-volume OCR\'d corpus are already in frontier-model training data. About 43% are confidently new to AI; about 21% are confidently in training.',
  openGraph: {
    images: [{ url: 'https://images.sourcelibrary.org/archived/9cafe1ee-dd5a-4dcf-ac9a-803ca75f5bb4/12.jpg', alt: 'Title page of Cornelius Drebbel\'s Tractatus duo de Natura Elementorum (Hamburg, 1621)' }],
    title: 'Did the AI Read This?',
    description: 'Mapping which books in the library are in frontier-model training data, with a Bayesian fusion of bibliographic priors and behavioural probes.',
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/9cafe1ee-dd5a-4dcf-ac9a-803ca75f5bb4/12.jpg', alt: 'Title page of Cornelius Drebbel\'s Tractatus duo de Natura Elementorum (Hamburg, 1621)' }],
  },
  alternates: {
    canonical: '/blog/did-the-ai-read-this',
  },
};

export default function DidTheAIReadThisPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Did the AI Read This?"
          subtitle="Mapping which books in the library are in frontier-model training data"
          image="https://images.sourcelibrary.org/archived/9cafe1ee-dd5a-4dcf-ac9a-803ca75f5bb4/12.jpg"
          imageAlt="Title page of Cornelius Drebbel's Tractatus duo de Natura Elementorum (Hamburg, 1621)"
        >
          <p className="text-stone-400 text-sm mt-4">18 May 2026 &middot; 8 min read</p>
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

        {/* --- Lead --- */}
        <p className="text-xl text-secondary leading-relaxed mb-8">
          We asked a frontier language model to quote the opening of Cornelius Drebbel&rsquo;s <em>Tractatus duo de Natura Elementorum</em> (Hamburg, 1621), a rare Latin alchemical treatise we hold. The model produced 680 characters of plausible-looking scholastic Latin beginning &ldquo;Cum omnia, quae sub Luna sunt&hellip;&rdquo; The actual text begins &ldquo;Cum discursus hic in manus tuas peruenerit, Amice Lector&hellip;&rdquo; The model invented the opening with complete confidence. This is the puzzle that motivated a small empirical project: for a digital library of pre-modern and multilingual books, how many are <em>genuinely</em> new to the AI ecosystem, and how would we know?
        </p>

        <p>
          The short answer, after a Bayesian survey of a random sample of 1,000 books drawn from our 16,871 OCR&rsquo;d volumes: <strong>about 43% are confidently new to AI training</strong> (~7,240 books, 95% CI 6,715&ndash;7,778), and <strong>about 21% are confidently already in training</strong> (~3,559 books). The expected fraction in training overall is 39%. The full method, validation, and limitations are in a <a className="text-accent-rust hover:underline" href="/contamination-probe-paper.pdf">short preprint we&rsquo;ve put up</a>.
        </p>

        {/* --- TOC --- */}
        <nav className="bg-warm/50 rounded-lg p-6 mb-12 border border-light">
          <p className="text-sm font-semibold text-primary mb-3 uppercase tracking-wide">Contents</p>
          <ol className="text-secondary space-y-1 list-decimal list-inside text-sm">
            <li><a href="#two-questions" className="text-accent-rust hover:underline">Two questions, not one</a></li>
            <li><a href="#prior" className="text-accent-rust hover:underline">A prior, for free</a></li>
            <li><a href="#probe" className="text-accent-rust hover:underline">The behavioural probe</a></li>
            <li><a href="#numbers" className="text-accent-rust hover:underline">The catalogue numbers</a></li>
            <li><a href="#what-it-doesnt-measure" className="text-accent-rust hover:underline">What this doesn&rsquo;t measure</a></li>
            <li><a href="#why-it-matters" className="text-accent-rust hover:underline">Why it matters</a></li>
          </ol>
        </nav>

        <h2 id="two-questions" className="font-serif text-2xl md:text-3xl text-primary">1. Two questions, not one</h2>

        <p>
          Asking &ldquo;is this book in training&rdquo; quietly conflates two different questions. The first is whether the AI has seen the specific scan, transcription, or printing we hold &mdash; the file. The second is whether the AI has encountered the <em>work</em> through some channel: a modern translation, a critical edition, a Wikipedia summary, a scholarly citation. For most pre-modern multilingual books, the answer to the second is what people actually want to know &mdash; whether the AI ecosystem already &ldquo;has&rdquo; the work in some form &mdash; and the answer to the first is approximately unanswerable with black-box probes.
        </p>

        <p>
          We built our detector to answer the second question carefully and to refuse the first one honestly. A <a className="text-accent-rust hover:underline" href="https://arxiv.org/abs/2601.12937">recent skeptical paper</a> showed that the strongest membership-inference attacks on language models collapse under semantics-preserving paraphrase: their signal is overwhelmingly lexical. We don&rsquo;t fight that. We design around it.
        </p>

        <h2 id="prior" className="font-serif text-2xl md:text-3xl text-primary">2. A prior, for free</h2>

        <p>
          We already maintain a multi-catalogue translation-verification system, described <Link className="text-accent-rust hover:underline" href="/blog/first-translation-methodology">elsewhere on this blog</Link>. For each historical work we hold, it searches twelve catalogues (UNESCO Index Translationum, Loeb, Brill, Penguin, Cambridge, Open Library, Google Books, Internet Archive, OpenAlex&rsquo;s 250-million scholarly records, the Library of Congress live catalogue, and the USTC) and assigns a disposition: <em>confirmed_first</em> (no prior English translation of the underlying work exists), <em>translation_found</em> (multiple English versions exist), and various intermediates.
        </p>

        <p>
          That disposition turns out to be almost exactly what we need as a Bayesian prior for &ldquo;has this work been propagated through derived editions an AI is likely to have seen.&rdquo; A work with no English translation cannot have been encountered in English; a work with Loeb, Penguin, and Oxford translations almost certainly was. We convert the disposition, the translator/publisher list, the IA-scan presence, and the year of the oldest translation into a log-odds prior. On its own, this bibliographic prior agrees with the full Bayesian detector on 88% of books &mdash; the rare-book infrastructure we already had is doing most of the work.
        </p>

        <h2 id="probe" className="font-serif text-2xl md:text-3xl text-primary">3. The behavioural probe</h2>

        <p>
          To check whether the bibliographic prior is right, and to refine the answer for books in its uncertain middle, we ask the model directly. Two questions, batched twenty-eight at a time:
        </p>

        <ul>
          <li><strong>Self-familiarity:</strong> <em>Did you encounter this specific book in your training data &mdash; yes, no, or unsure? Distinguish knowing of a book from seeing its text.</em></li>
          <li><strong>Verbatim opening:</strong> <em>Quote one sentence from the opening in its original language, or write &ldquo;unknown.&rdquo;</em></li>
        </ul>

        <p>
          We probe two models in parallel: Claude Haiku 4.5 and Gemini 3.1 Flash Lite Preview. The interesting empirical finding is that <strong>Haiku is unusually well-calibrated</strong> at the long-tail boundary &mdash; it says &ldquo;no&rdquo; with high reliability on books we know are obscure, and &ldquo;unsure&rdquo; rather than confabulating when it doesn&rsquo;t know. Gemini 3.1 Flash Lite, by contrast, says &ldquo;yes&rdquo; to almost everything and produces confident plausible-fabricated text. (That&rsquo;s the Drebbel story above: Gemini Flash Lite confidently invented Latin; Haiku said it didn&rsquo;t know.) We treat Haiku&rsquo;s response as the stronger likelihood signal and Gemini&rsquo;s only as weak corroboration.
        </p>

        <p>
          Combining the bibliographic prior with the behavioural probe via Bayes&rsquo; rule produces a posterior probability per book, with a credible interval from Monte Carlo. Total cost: about a hundredth of a US cent per book.
        </p>

        <h2 id="numbers" className="font-serif text-2xl md:text-3xl text-primary">4. The catalogue numbers</h2>

        <p>
          Random sample of 1,000 books drawn uniformly from the 16,871 books in the library with at least one OCR&rsquo;d page (the &ldquo;probe-able&rdquo; population &mdash; books for which any text exists for a model to potentially have seen):
        </p>

        <div className="bg-warm/50 border border-light rounded-lg p-6 my-6">
          <table className="w-full text-sm">
            <thead className="border-b border-light">
              <tr>
                <th className="text-left py-2 font-semibold text-primary">Posterior P(in training)</th>
                <th className="text-right py-2 font-semibold text-primary">Sample %</th>
                <th className="text-right py-2 font-semibold text-primary">Across 16,871 books</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-light">
              <tr><td className="py-2">Confidently NOT (&lt; 0.10)</td><td className="text-right">42.9%</td><td className="text-right">~7,240 books</td></tr>
              <tr><td className="py-2">Probably NOT (&lt; 0.25)</td><td className="text-right">52.2%</td><td className="text-right">~8,811 books</td></tr>
              <tr><td className="py-2">Ambiguous (0.25 &ndash; 0.75)</td><td className="text-right">19.2%</td><td className="text-right">~3,238 books</td></tr>
              <tr><td className="py-2">Probably IN (&gt; 0.75)</td><td className="text-right">28.6%</td><td className="text-right">~4,823 books</td></tr>
              <tr><td className="py-2">Confidently IN (&gt; 0.90)</td><td className="text-right">21.1%</td><td className="text-right">~3,559 books</td></tr>
              <tr className="font-semibold"><td className="py-2">Expected fraction IN training</td><td className="text-right">39.0%</td><td className="text-right">~6,586 books</td></tr>
            </tbody>
          </table>
          <p className="text-xs text-muted mt-3">95% bootstrap CIs in the preprint. The Bayesian posterior is bimodal: most books sit at one end of the spectrum, with only about 19% in the ambiguous middle.</p>
        </div>

        <p>
          A second analysis on the 10,911 books that have completed bibliographic verification shows just how strongly disposition predicts the answer. Books judged &ldquo;no prior English translation exists&rdquo; (n=6,306) receive a mean posterior of 0.10, and 77% are classified confidently new to AI. Books judged &ldquo;multiple English translations exist&rdquo; (n=2,866) receive a mean posterior of 0.83, and 69% are classified confidently in training. Almost everything we need to know about a work&rsquo;s training-data status is in its bibliographic propagation history.
        </p>

        <h2 id="what-it-doesnt-measure" className="font-serif text-2xl md:text-3xl text-primary">5. What this doesn&rsquo;t measure</h2>

        <p>
          The honest qualifier: this method measures whether the AI <em>recognises</em> the work as a scholarly object &mdash; whether some channel of derived editions has reached it &mdash; not whether the model has seen our specific scan. We tested the distinction directly. For ten books our detector classified as &ldquo;in training&rdquo; and ten classified as &ldquo;not in training,&rdquo; we provided eighty characters of the actual OCR as a prefix and asked the model to continue. ROUGE-L of the continuation against the next 300 characters averaged 0.099 for &ldquo;in training&rdquo; books and 0.084 for &ldquo;not in training&rdquo; books &mdash; a ratio of 1.17&times;, well below any meaningful discrimination threshold. <strong>Even on books the model recognises, it cannot reproduce our specific OCR.</strong> Recognition is not file exposure, and we make no claim to the second.
        </p>

        <p>
          We also discovered, in passing, a meaningful calibration regression in the smaller Gemini Flash Lite model relative to its bigger sibling Gemini 2.5 Flash. The Drebbel anecdote is reproducible: the smaller model confidently fabricates content for unfamiliar long-tail works where the larger model declines. We use Flash Lite in our enrichment pipeline (it&rsquo;s cheaper) for tasks that ground the model in book text, but never for tasks that ask it to recall facts about works from training memory. The calibration of refusal at the long-tail boundary matters more for production reliability than raw capability.
        </p>

        <h2 id="why-it-matters" className="font-serif text-2xl md:text-3xl text-primary">6. Why it matters</h2>

        <p>
          For the library specifically, the headline finding is that <strong>roughly 7,000 books in our OCR&rsquo;d corpus are confident additions to what frontier AI knows of the world</strong>. Some of these are first translations we&rsquo;ve commissioned of texts that have never appeared in English. Some are obscure 17th-century treatises that haven&rsquo;t been scanned anywhere outside our archive. Some are manuscripts with Vatican or Wolfenb&uuml;ttel shelfmarks whose contents have never been digitised at all. These are the books our work moves into the AI ecosystem; they are what the library&rsquo;s mission concretely produces.
        </p>

        <p>
          For the broader question of AI training-data coverage of long-tail scholarly material, this is a small datapoint with a perhaps-unsurprising conclusion: frontier models cover the canon and miss the periphery, and the periphery is enormous &mdash; thousands of works per specialist collection. The unsurprising part is the rate. The surprising part is how cheap it is to measure: thirty hundredths of a US cent per book, no logprob access, no fine-tuned probes, just a calibrated language model answering a direct question well enough to be useful when fused with a good prior.
        </p>

        <p className="mt-8 text-secondary">
          <strong>Read the preprint:</strong> <a className="text-accent-rust hover:underline" href="/contamination-probe-paper.pdf">Recognition vs.\ Exposure: A Bayesian Detector for Long-Tail Multilingual Book Membership in Frontier Language Models</a> (PDF, 5 pages).
        </p>

      </article>

    </ContentPageLayout>
  );
}
