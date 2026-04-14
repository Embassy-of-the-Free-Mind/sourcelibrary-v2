import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { WordAlignmentDemo } from './WordAlignmentDemo';

export const metadata: Metadata = {
  title:
    'Can AI Show You Exactly Which Latin Words Became Which English Words? - Research Notes - Source Library',
  description:
    'We tested two approaches to word-level alignment between 15th-century Latin and English translation: LLM-generated semantic mapping and embedding-based similarity. The results reveal what AI can and cannot do with pre-modern texts.',
  openGraph: {
    title: 'Can AI Show You Exactly Which Latin Words Became Which English Words?',
    description:
      'Interactive demo: hover over Latin or English text to see translation correspondences highlighted in real time.',
  },
  alternates: {
    canonical: '/blog/word-alignment',
  },
};

export default function WordAlignmentPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Can AI Show You Exactly Which Latin Words Became Which English Words?"
          subtitle="Exploring word-level alignment between 15th-century Latin and AI-generated English translation"
        >
          <p className="text-stone-400 text-sm mt-4">13 April 2026 &middot; 5 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
      maxWidth="wide"
    >
      <div className="mb-6">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Source Library has translated over 10,000 pages of pre-modern Latin, German, Arabic, and
          Hebrew into English. But translation is a lossy process &mdash; a single Latin word might
          expand into a whole English phrase, or three Latin words might collapse into one. What if
          you could see exactly which words produced which?
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Word-level alignment is a well-studied problem in computational linguistics. Google
          Translate has done it internally for years. But the challenge with historical texts is
          different: pre-modern Latin uses abbreviations (&ldquo;c&#x16B;&rdquo; for
          &ldquo;cum&rdquo;), inconsistent spelling, and sentence structures that don&rsquo;t map
          cleanly onto English. We tested two approaches on pages from Marsilio Ficino&rsquo;s{' '}
          <em>De Voluptate</em> (1457) and the Hermetic <em>Pymander</em> in Ficino&rsquo;s 1505
          Latin edition.
        </p>

        <h2 className="text-lg font-semibold text-primary mt-10 mb-4">Try it yourself</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Hover over any word on either side. The corresponding text on the other side lights up
          &mdash; brighter gold means a more direct correspondence, fainter means the meaning was
          restructured or implied. Switch between the two methods to see how they compare.
        </p>
      </article>

      {/* Interactive demo — breaks out of prose width */}
      <div className="mt-8 mb-12">
        <WordAlignmentDemo />
      </div>

      <article className="prose-content max-w-none">
        <h2 className="text-lg font-semibold text-primary mt-2 mb-4">
          Approach 1: LLM Semantic Alignment
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          We asked Gemini 3 Flash to read both the Latin source and English translation and
          produce a mapping between them: which character ranges in the English correspond to which
          character ranges in the Latin, with a confidence weight. The model understands Latin grammar
          &mdash; it knows that &ldquo;animum in duas partes distribuisset&rdquo; maps to &ldquo;when
          he had divided the soul into two parts&rdquo; even though the word order is completely
          different. It handles abbreviations, one-to-many mappings, and implied meanings that
          don&rsquo;t have a direct source word.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          The result: <strong>227 alignment links</strong> for a single page of Ficino, covering
          virtually every content word. The main failure mode is character offset precision &mdash;
          the LLM occasionally miscounts characters, producing spans that are off by a few
          positions. A post-processing step could snap these to word boundaries.
        </p>

        <h2 className="text-lg font-semibold text-primary mt-10 mb-4">
          Approach 2: Embedding Similarity
        </h2>

        <p className="text-secondary leading-relaxed mb-6">
          The second approach uses a simpler signal: do the Latin and English words look similar? Many
          Latin words survive recognizably in English (&ldquo;natura&rdquo; &rarr;
          &ldquo;nature&rdquo;, &ldquo;corpus&rdquo; &rarr; &ldquo;body&rdquo;... well, that one
          doesn&rsquo;t). We implemented a cognate-detection heuristic as a stand-in for full
          multilingual embedding similarity (using models like multilingual-e5, which map words from
          all languages into the same vector space).
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          This approach finds <strong>125 links</strong> &mdash; mostly cognates and known
          vocabulary pairs. It completely misses non-cognate translations
          (&ldquo;c&#x16B;&rdquo; &rarr; &ldquo;when&rdquo;), word reordering, and
          phrase-level correspondences. It also sometimes links the wrong instance of a word when it
          appears multiple times.
        </p>

        <h2 className="text-lg font-semibold text-primary mt-10 mb-4">What we learned</h2>

        <p className="text-secondary leading-relaxed mb-6">
          LLM-based alignment is dramatically better for pre-modern texts. The model&rsquo;s
          understanding of Latin grammar, context, and translation intent produces alignments that
          would take a human Latinist significant effort to match. The cost is minimal &mdash; one
          additional API call per page, which could be folded into the translation step itself.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Embedding similarity is useful as a cheap verification signal (if the embeddings say two
          words are similar, they probably are) but insufficient as a primary alignment method for
          historical texts. The gap between Latin and English is too wide for surface-level
          similarity to bridge.
        </p>

        <p className="text-secondary leading-relaxed mb-12">
          The next step would be to add alignment data to Source Library&rsquo;s translation pipeline
          &mdash; generating it alongside each translation and storing it for interactive reading.
          Imagine being able to trace every word in every translation back to its source, across
          10,000+ pages of rare historical texts.
        </p>
      </article>
    </ContentPageLayout>
  );
}
