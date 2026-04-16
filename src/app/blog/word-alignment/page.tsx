import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { WordAlignmentDemo } from './WordAlignmentDemo';

export const metadata: Metadata = {
  title: 'Reading Through the Translation - Research Notes - Source Library',
  description:
    'Click any English word to see the original language word that produced it. Alignment computed by multilingual BERT embeddings via SimAlign.',
  openGraph: {
    title: 'Reading Through the Translation',
    description:
      'Click any English word to see the original that produced it.',
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
          title="Reading Through the Translation"
          subtitle="Click any English word to see the original that produced it"
        >
          <p className="text-stone-400 text-sm mt-4">16 April 2026</p>
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
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Source Library has AI-translated over 10,000 pages of pre-modern text into English.
          What if you could click any English word and see which original words produced it &mdash;
          not from a model guessing after the fact, but from the actual learned relationship
          between languages? These experiments use multilingual BERT embeddings
          via{' '}
          <a href="https://github.com/cisnlp/simalign" className="text-accent-gold-dark hover:underline">SimAlign</a>
          {' '}to map words from any script into the same vector space.
        </p>

        <h2 className="text-lg font-semibold text-primary mt-10 mb-3">Latin &rarr; English</h2>
        <p className="text-secondary leading-relaxed mb-6">
          Ficino&rsquo;s <em>De Voluptate</em> (1457) &mdash; a treatise on the nature of pleasure.
          The embedding model knows that &ldquo;animum&rdquo; means &ldquo;soul&rdquo; and
          that &ldquo;laeticiam&rdquo; maps to &ldquo;gladness&rdquo; while
          &ldquo;voluptatem&rdquo; maps to &ldquo;pleasure&rdquo; &mdash;
          a distinction Ficino considered important.
        </p>
      </article>

      <div className="mb-12">
        <WordAlignmentDemo pageIndex={0} />
      </div>

      <article className="prose-content max-w-none">
        <h2 className="text-lg font-semibold text-primary mt-2 mb-3">Ancient Greek &rarr; Transliteration &rarr; English</h2>
        <p className="text-secondary leading-relaxed mb-6">
          The opening of Aratus&rsquo;s <em>Phaenomena</em> (~270 BCE) &mdash; a poem about the
          constellations that begins with an invocation of Zeus. The same embedding model crosses
          the script boundary: &ldquo;Διὸς&rdquo; lands near &ldquo;Zeus&rdquo;
          and &ldquo;θάλασσα&rdquo; lands near &ldquo;sea&rdquo;, even though Greek and Latin
          alphabets share almost no visual similarity. The transliteration column shows the
          pronunciation.
        </p>
      </article>

      <div className="mb-12">
        <WordAlignmentDemo pageIndex={1} />
      </div>

      <article className="prose-content max-w-none">
        <h2 className="text-lg font-semibold text-primary mt-2 mb-3">The same text, different embeddings</h2>
        <p className="text-secondary leading-relaxed mb-6">
          The Ficino paragraph again, but aligned with{' '}
          <a href="https://huggingface.co/intfloat/multilingual-e5-base" className="text-accent-gold-dark hover:underline">multilingual-e5</a>
          {' '}instead of mBERT. This is the same embedding model Source Library already uses
          for semantic search &mdash; it runs on our Hetzner server, so there&rsquo;d be zero
          additional infrastructure cost. The alignment is noticeably sparser: e5 was trained
          for passage-level similarity, not word-level alignment, so it&rsquo;s confident on
          cognates and content words (&ldquo;partes&rdquo; &rarr; &ldquo;parts&rdquo;,
          &ldquo;differre&rdquo; &rarr; &ldquo;differ&rdquo;) but misses the non-obvious
          mappings that mBERT catches. Still &mdash; for a model we&rsquo;re already running,
          the results are surprisingly usable.
        </p>
      </article>

      <div className="mb-12">
        <WordAlignmentDemo pageIndex={2} />
      </div>

      <article className="prose-content max-w-none">
        <h2 className="text-lg font-semibold text-primary mt-2 mb-3">Gemini embeddings</h2>
        <p className="text-secondary leading-relaxed mb-6">
          Google&rsquo;s <code className="text-xs bg-stone-100 px-1.5 py-0.5 rounded">gemini-embedding-001</code>{' '}
          &mdash; 3,072 dimensions vs mBERT&rsquo;s 768. The richer representation catches
          correspondences the other models miss: &ldquo;elationem&rdquo; &rarr; &ldquo;elevation&rdquo;,
          &ldquo;modestiam&rdquo; &rarr; &ldquo;moderation&rdquo;,
          &ldquo;suscipitur&rdquo; &rarr; &ldquo;received&rdquo;.
          Since Source Library is already moving to Gemini embeddings for search, this alignment
          would come essentially free &mdash; just run the same model at the word level
          instead of the passage level.
        </p>
      </article>

      <div className="mb-12">
        <WordAlignmentDemo pageIndex={3} />
      </div>
    </ContentPageLayout>
  );
}
