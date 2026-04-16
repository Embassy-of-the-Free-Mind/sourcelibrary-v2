import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { WordAlignmentDemo } from './WordAlignmentDemo';

export const metadata: Metadata = {
  title: 'Reading Through the Translation - Research Notes - Source Library',
  description:
    'Click any English word to see the Latin it came from. Alignment computed by multilingual BERT embeddings, not guesswork.',
  openGraph: {
    title: 'Reading Through the Translation',
    description:
      'Click any English word to see the Latin it came from.',
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
          subtitle="Click any English word to see the Latin that produced it"
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
          Source Library has AI-translated over 10,000 pages of pre-modern Latin into English.
          What if you could click any English word and see which Latin words produced it &mdash;
          not from a model guessing after the fact, but from the actual learned relationship
          between languages? Below are two experiments aligned using multilingual BERT embeddings
          via{' '}
          <a href="https://github.com/cisnlp/simalign" className="text-accent-gold-dark hover:underline">SimAlign</a>:
          Ficino&rsquo;s Latin and the opening of Aratus&rsquo;s <em>Phaenomena</em> in
          Ancient Greek &mdash; with transliteration. The model maps words from any script
          into the same vector space, so &ldquo;Διὸς&rdquo; lands near &ldquo;Zeus&rdquo;
          and &ldquo;animum&rdquo; lands near &ldquo;soul&rdquo;.
        </p>
      </article>

      <div className="mt-4 mb-12">
        <WordAlignmentDemo />
      </div>
    </ContentPageLayout>
  );
}
