import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Quality Control on Four Million Machine-Translated Pages - Research Notes - Source Library',
  description:
    'How we found, measured, and repaired "translation collapse" — pages where the AI returns a fragment instead of a translation — and the two times our measurement was wrong before the model was.',
  openGraph: {
    images: [{ url: 'https://images.sourcelibrary.org/archived/69b2f434f9f1ad2b3b15154a/9.jpg', alt: 'A page from Henri Estienne\'s 1589 edition of the fragments of Dicaearchus' }],
    title: 'Quality Control on Four Million Machine-Translated Pages',
    description:
      'Detecting and repairing translation collapse across a 4.25-million-page corpus, and what it takes to check a generative system at scale.',
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/69b2f434f9f1ad2b3b15154a/9.jpg', alt: 'A page from Henri Estienne\'s 1589 edition of the fragments of Dicaearchus' }],
  },
  alternates: {
    canonical: '/blog/translation-collapse',
  },
};

export default function TranslationCollapsePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Quality control on four million machine-translated pages"
          subtitle="Detecting and repairing translation collapse"
          image="https://images.sourcelibrary.org/archived/69b2f434f9f1ad2b3b15154a/9.jpg"
          imageAlt="A page from Henri Estienne's 1589 edition of the fragments of Dicaearchus"
        >
          <p className="text-stone-400 text-sm mt-4">17 June 2026 &middot; 7 min read</p>
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
          <a className="text-accent-rust hover:underline" href="https://sourcelibrary.org/book/69b2f434f9f1ad2b3b15154a"><em>The Extant Fragments of Dicaearchus</em></a>, printed by Henri Estienne in 1589, contains a page of Latin commentary on the monuments of ancient Athens &mdash; the theatre, the temple of Athena, the Parthenon. On <a className="text-accent-rust hover:underline" href="https://sourcelibrary.org/book/69b2f434f9f1ad2b3b15154a/page/69b2f434f9f1ad2b3b15156c">our copy of that page</a> the source scan is clean, but the English translation read, in full: a note saying &ldquo;continued from previous page,&rdquo; and one word, &ldquo;structure.&rdquo; About twenty lines of Latin and Greek were not translated at all.
        </p>

        <p>
          This is a known failure class. Neural translation systems sometimes produce fluent output detached from the source, including omission, where part of the input is silently dropped (<a className="text-accent-rust hover:underline" href="https://aclanthology.org/2023.eacl-main.75/">Guerreiro, Voita &amp; Martins, 2023</a>). We call the severe form, where a page reduces to a fragment, <em>collapse</em>. We hold about <strong>4.25 million</strong> machine-translated pages and cannot read them all, so the question is not whether the system translates well on average, but how to find the pages it failed on &mdash; and how to keep the detection method from generating errors of its own.
        </p>

        <h2 id="detecting" className="font-serif text-2xl md:text-3xl text-primary">Detecting collapse, and two measurement errors</h2>

        <p>
          Collapse has a simple correlate: the translation is far shorter than its source. Length-based signals are standard in reference-free translation quality estimation precisely because they are cheap and need no gold reference (<a className="text-accent-rust hover:underline" href="https://aclanthology.org/2023.eacl-main.75/">Guerreiro et al., 2023</a>). A first pass flagged <strong>51,227 pages (1.2%)</strong>. That figure was inflated twice over, in instructive ways.
        </p>

        <p>
          <strong>The metric&rsquo;s hidden assumption.</strong> We had also flagged translations much <em>longer</em> than their source as runaway repetition &mdash; a real decoding pathology (<a className="text-accent-rust hover:underline" href="https://arxiv.org/abs/1904.09751">Holtzman et al., 2020</a>). Almost none were. The flag assumed a translation is about as long as its source, which fails on the highest-expansion material: one Chinese character maps to several English words, so a faithful translation runs roughly three times the source&rsquo;s character count. Of 1,258 such flags in our published books, 32 were genuine; the rest were correct translations.
        </p>

        <p>
          <strong>A noisy denominator.</strong> Some flagged short pages had good translations; the defect was in the <em>OCR</em>. One page carried an OCR artifact &mdash; a single combining mark repeated thousands of times &mdash; that inflated the measured source length until the real translation looked tiny beside it. Because OCR error propagates into every measurement built on it (<a className="text-accent-rust hover:underline" href="https://www.turing.ac.uk/news/publications/assessing-impact-ocr-quality-downstream-nlp-tasks">van Strien et al., 2020</a>), a ratio of two noisy quantities compounds rather than cancels their errors.
        </p>

        <p>
          Requiring the translation to be short in <em>absolute</em> terms, not just relative, removed both classes. The corrected estimate is about <strong>25,000 pages (0.59%)</strong>, of which roughly <strong>3,100 are empty</strong>. Half the original alarm was dense pages and OCR noise.
        </p>

        <h2 id="predicts" className="font-serif text-2xl md:text-3xl text-primary">What predicts a collapse</h2>

        <p>
          We expected the cause to be structural &mdash; the Dicaearchus page begins mid-sentence and ends on a catchword, so the model read the whole page as a continuation fragment and translated only the catchword. That story describes that page, but it does not generalize. Against healthy control pages from the same books, collapsed pages were no more likely to start mid-sentence (27% vs 26%), carry a catchword (5.6% vs 5.8%), or contain Greek (0.05 vs 0.06). Content and structure do not predict collapse.
        </p>

        <p>
          One thing does: <strong>length.</strong> Collapsed pages have a median OCR body of <strong>11,374 characters against 1,751 for healthy pages</strong> &mdash; roughly six times longer. On a long, dense page the weaker model is most likely to abandon translation and fall back to summarizing. Two further patterns fit this. Collapses <strong>cluster</strong>: 41% sit within two pages of another collapse, far above their base rate, so they arrive in runs rather than scattered. And they are partly <strong>stochastic</strong> &mdash; the Dicaearchus passage was scanned twice in this volume, and the <a className="text-accent-rust hover:underline" href="https://sourcelibrary.org/book/69b2f434f9f1ad2b3b15154a/page/69b2f434f9f1ad2b3b15155e">second copy</a> translated in full. Same input, different output. Which long page tips over is, at the margin, chance.
        </p>

        <h2 id="worst" className="font-serif text-2xl md:text-3xl text-primary">The worst cases are not translation failures</h2>

        <p>
          The largest single block of collapses &mdash; about 11,800 pages &mdash; is Tibetan, and on inspection it is mostly not a translation problem at all. In a sample of Tibetan collapsed pages, <strong>87% had OCR that was itself a repetition loop</strong>: the OCR step, also a neural model, loops on repetitive liturgical script (mantras, Dzogchen texts) and emits twenty thousand characters of a single repeated syllable instead of the page. The translator receives that and correctly produces nothing. The empty translation is then flagged as collapse.
        </p>

        <p>
          So the chain is: repetitive low-resource script &rarr; OCR loop &rarr; unusable input &rarr; empty translation. The fix is upstream OCR, not re-translation, and re-translating these pages cannot help. It also means the corpus collapse count is still inflated &mdash; the true <em>translation</em>-collapse problem is smaller, and more concentrated in Latin-script text, than the raw number suggests.
        </p>

        <h2 id="comparison" className="font-serif text-2xl md:text-3xl text-primary">A controlled comparison</h2>

        <p>
          Which model collapses is confounded by routing &mdash; we send Latin-script text to a cheaper &ldquo;lite&rdquo; model and harder scripts to a stronger &ldquo;flash&rdquo; one. Holding the language fixed removes the confound. For Latin, where the OCR is clean and the comparison is genuinely about translation:
        </p>

        <div className="my-6 overflow-x-auto rounded-lg border border-light bg-warm/30 p-4">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="border-b border-border-light">
                <th className="text-left py-2 text-muted font-medium">Latin, by model</th>
                <th className="text-right py-2 text-muted font-medium">Pages</th>
                <th className="text-right py-2 text-muted font-medium">Collapse rate</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border-light/50"><td className="py-1.5">lite (legacy)</td><td className="text-right">704,900</td><td className="text-right">0.378%</td></tr>
              <tr className="border-b border-border-light/50"><td className="py-1.5">lite (current)</td><td className="text-right">309,086</td><td className="text-right">0.208%</td></tr>
              <tr><td className="py-1.5">flash</td><td className="text-right">319,435</td><td className="text-right">0.035%</td></tr>
            </tbody>
          </table>
        </div>

        <p>
          On the same language, flash collapses about eleven times less often than the legacy model that produced most of the backlog, and the ordering holds across every language tested. Two effects separate: the model (flash is steadier) and, independently, the script &mdash; on a fixed model, collapse rises from 0.38% on Latin to 1.7% on Hebrew to 5.6% on Tibetan. For non-Latin scripts the comparison is muddier, because much of what looks like collapse is the OCR problem above; the clean translation-model result is the Latin one.
        </p>

        <h2 id="checking" className="font-serif text-2xl md:text-3xl text-primary">What checking a generative system requires</h2>

        <p>Four constraints came out of this, none specific to translation.</p>

        <ul className="space-y-3 my-4">
          <li><strong>A cheap signal triages; a read calibrates.</strong> Both retractions came from reading the flagged pages, not from a better formula. The workable pattern is a cheap filter to reduce millions to thousands, then sampled review to estimate the filter&rsquo;s precision before trusting its count.</li>
          <li><strong>The right threshold depends on the goal.</strong> High recall with modest precision is fine for <em>estimating</em> a defect rate and wrong for <em>repair</em>, where each false positive is wasted compute or an overwritten good page. We ran the detector at two settings on purpose.</li>
          <li><strong>Make remediation non-destructive.</strong> The repair re-translates with the stronger model but writes only when the result is measurably healthier, retains the prior version, and is safe to re-run. An imperfect detector is usable when the fix cannot make things worse.</li>
          <li><strong>Keep the checker independent of the checked.</strong> Automated evaluation risks shared blind spots; LLM judges, for instance, favor outputs from their own model family (<a className="text-accent-rust hover:underline" href="https://arxiv.org/abs/2404.13076">Panickssery, Bowman &amp; Feng, 2024</a>). Length and human reading are independent of the translation model in a way a sibling model is not.</li>
        </ul>

        <p>
          A corollary is to catch the error at generation time rather than in a later sweep: the worker now retries a page that returns as a fragment before saving it, so the error never reaches search, embeddings, or a published edition.
        </p>

        <h2 id="outcome" className="font-serif text-2xl md:text-3xl text-primary">Outcome</h2>

        <p>
          Where the model choice is reliable &mdash; Latin and Greek &mdash; we re-translated under those constraints. <strong>556 collapsed pages in published books were repaired</strong>, the Dicaearchus page among them, with prior versions retained. (You can still find unrepaired collapses elsewhere &mdash; <a className="text-accent-rust hover:underline" href="https://sourcelibrary.org/book/69b52c133dd6d9423027d89c/page/69b52c133dd6d9423027d995">this page of Aelian&rsquo;s <em>On the Nature of Animals</em></a>, held back by a separate content filter.) The remaining backlog is mostly in unpublished books, and its hardest part &mdash; the non-Latin tail &mdash; needs OCR work before any translation model can help.
        </p>

        <p>
          The general point is practical: with millions of machine-generated artifacts, the detection method is itself an instrument that has to be validated, and the first three estimates here were wrong before any was right. The defect rate matters less than knowing how reliably you can measure it.
        </p>

        <h2 id="methods" className="font-serif text-2xl md:text-3xl text-primary">Methods</h2>

        <p>
          The diagnosis, the detection and repair tooling, the measurements, and a first draft of this note were produced by an agentic Claude Opus (Anthropic) session directed by Derek Lomas, as with these research notes generally. This is worth stating given the subject: the system under audit is Google&rsquo;s Gemini, which produced the translations and the OCR, and the auditor was a different model family &mdash; the kind of checker&ndash;checked independence the self-preference result above argues for, and more than a model evaluating its own outputs. It is not full independence; both are large language models and may share failure tendencies. And it does not exempt the auditor &mdash; the two measurement errors here were its own, caught only by reading the pages.
        </p>

        <h2 id="references" className="font-serif text-2xl md:text-3xl text-primary">References</h2>

        <ul className="text-sm text-secondary space-y-2">
          <li>Guerreiro, N. M., Voita, E., &amp; Martins, A. F. T. (2023). <a className="text-accent-rust hover:underline" href="https://aclanthology.org/2023.eacl-main.75/"><em>Looking for a Needle in a Haystack: A Comprehensive Study of Hallucinations in Neural Machine Translation.</em></a> EACL.</li>
          <li>Holtzman, A., Buys, J., Du, L., Forbes, M., &amp; Choi, Y. (2020). <a className="text-accent-rust hover:underline" href="https://arxiv.org/abs/1904.09751"><em>The Curious Case of Neural Text Degeneration.</em></a> ICLR.</li>
          <li>van Strien, D., Beelen, K., Coll Ardanuy, M., Hosseini, K., McGillivray, B., &amp; Colavizza, G. (2020). <a className="text-accent-rust hover:underline" href="https://www.turing.ac.uk/news/publications/assessing-impact-ocr-quality-downstream-nlp-tasks"><em>Assessing the Impact of OCR Quality on Downstream NLP Tasks.</em></a> ICAART.</li>
          <li>Panickssery, A., Bowman, S. R., &amp; Feng, S. (2024). <a className="text-accent-rust hover:underline" href="https://arxiv.org/abs/2404.13076"><em>LLM Evaluators Recognize and Favor Their Own Generations.</em></a> NeurIPS.</li>
        </ul>
      </article>

    </ContentPageLayout>
  );
}
