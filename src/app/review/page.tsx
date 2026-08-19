import Link from 'next/link';
import type { Metadata } from 'next';
import ReviewStats from '@/components/review/ReviewStats';

export const metadata: Metadata = {
  title: 'Help curate — Source Library',
  description: 'Spot AI mistakes in our image-extraction pipeline. A few seconds per page.',
};

const QUEUES = [
  {
    slug: 'page-check',
    title: 'Page check',
    blurb:
      'We point you at a page — a blog post, a collection, a book record — and you tell us ' +
      'whether anything is wrong with it. No expertise needed beyond reading it carefully.',
    status: 'live',
    timePerItem: '~2 minutes',
  },
  {
    slug: 'spanish-copy',
    title: 'Spanish copy',
    blurb:
      'The site speaks Spanish, but no Spanish speaker has ever read it. ' +
      'Tell us whether each translated phrase says what the English says and reads like a person wrote it.',
    status: 'live',
    timePerItem: '~10 seconds',
  },
  {
    slug: 'gallery-quality',
    title: 'Gallery quality',
    blurb:
      "We extract thousands of illustrations from historical books. " +
      "Which of them actually belong in a curated gallery? Your judgment calibrates our quality threshold.",
    status: 'live',
    timePerItem: '~5 seconds',
  },
  {
    slug: 'scan-quality',
    title: 'Scan quality',
    blurb:
      "Pristine color scan? Bitonal microfilm? Blurry mess? Classifying the digitization quality of a page " +
      "gives us training data for the rest of the library.",
    status: 'live',
    timePerItem: '~5 seconds',
  },
  {
    slug: 'hallucination',
    title: 'OCR hallucination check',
    blurb:
      "Our OCR sometimes invents illustrations on stained or blank pages. " +
      "Compare the AI's description to the page image — does it match?",
    status: 'live',
    timePerItem: '~10 seconds',
  },
  {
    slug: 'duplicates',
    title: 'Duplicate detection',
    blurb: "Two engravings, one book vs another: same plate or different printings? Helps us tune deduplication.",
    status: 'coming-soon',
    timePerItem: '~5 seconds',
  },
  {
    slug: 'page-type',
    title: 'Page type',
    blurb: "Is this page really a frontispiece? A title page? Decorative? Helps our page-classifier learn.",
    status: 'coming-soon',
    timePerItem: '~5 seconds',
  },
];

export default function ReviewLandingPage() {
  return (
    <main className="max-w-4xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-serif font-bold text-stone-900 mb-3">Help curate Source Library</h1>
      <p className="text-stone-700 mb-2 leading-relaxed">
        Our AI pipeline reads thousands of historical books, but it makes mistakes — especially on the
        beautiful, weird, hand-printed pages we care most about. Five minutes of human judgment goes
        a long way.
      </p>
      <p className="text-stone-700 mb-8 leading-relaxed">
        Pick a queue below. Sign in so your work is credited to you. Keyboard-driven, and you can stop anytime.
      </p>

      <ReviewStats />

      <div className="grid gap-4 mt-8">
        {QUEUES.map(q => (
          <div
            key={q.slug}
            className={`border rounded-lg p-5 ${
              q.status === 'live' ? 'border-stone-200 bg-white' : 'border-stone-200 bg-stone-50 opacity-60'
            }`}
          >
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-xl font-semibold text-stone-900">{q.title}</h2>
              <span className="text-xs text-stone-500">{q.timePerItem}</span>
            </div>
            <p className="text-stone-700 mt-2 text-sm leading-relaxed">{q.blurb}</p>
            {q.status === 'live' ? (
              <Link
                href={`/review/${q.slug}`}
                className="inline-block mt-4 px-4 py-2 rounded-md bg-accent-rust text-white text-sm font-medium hover:opacity-90"
              >
                Start rating &rarr;
              </Link>
            ) : (
              <span className="inline-block mt-4 text-xs text-stone-500">Coming soon</span>
            )}
          </div>
        ))}
      </div>

      <div className="mt-12 text-sm text-stone-600 leading-relaxed border-t border-stone-200 pt-6">
        <p className="mb-2">
          <b>What we do with your ratings:</b> when several people agree on a judgment, it becomes part of
          our filter rules and quality signals. Your judgments are recorded against your account, so we can credit your work and come back to you about it.
        </p>
        <p>
          Every queue also has a free-text box: if you can see something the buttons can&apos;t
          express, write it there. Those notes are read.{' '}
          <a href="mailto:team@sourcelibrary.org" className="text-accent-rust hover:underline">
            Or email us
          </a>
          .
        </p>
      </div>
    </main>
  );
}
