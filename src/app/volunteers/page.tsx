import Link from 'next/link';
import type { Metadata } from 'next';
import ReviewStats from '@/components/review/ReviewStats';
import SiteHeader from '@/components/layout/SiteHeader';

/**
 * Orphan welcome page for invited volunteers.
 *
 * Not linked from the public site (intentional). Share the URL directly
 * with people we're recruiting in Phase 1 / Phase 2 of #2107. Renders the
 * same queue surface as /review but with invitation-toned copy and a
 * thank-you framing.
 *
 * If/when we open this up publicly, link `/review` from the homepage.
 * `/volunteers` stays as an evergreen direct-link for outreach emails.
 */
export const metadata: Metadata = {
  title: 'Welcome, volunteers — Source Library',
  description: 'You\'ve been invited to help curate Source Library. A few seconds per item, no signup needed.',
  // Don't index — this is a private-share entry point.
  robots: { index: false, follow: false },
};

const QUEUES = [
  {
    slug: 'gallery-quality',
    title: 'Gallery quality',
    blurb:
      "Which extracted illustrations actually deserve to appear in a book's curated gallery? Your judgment calibrates our quality threshold.",
    timePerItem: '~5 seconds',
  },
  {
    slug: 'scan-quality',
    title: 'Scan quality',
    blurb:
      "Pristine color? Bitonal microfilm? Blurry? Classifying digitization quality gives us training data for the rest of the library.",
    timePerItem: '~5 seconds',
  },
  {
    slug: 'hallucination',
    title: 'OCR hallucination check',
    blurb:
      "Our OCR sometimes invents illustrations on stained or blank pages. Compare the AI's description to the page — does it match?",
    timePerItem: '~10 seconds',
  },
];

export default function VolunteersWelcomePage() {
  return (
    <>
    <SiteHeader variant="light" />
    <main className="max-w-3xl mx-auto px-6 py-14">
      <div className="text-sm font-medium text-accent-rust mb-3 tracking-wide uppercase">You're one of the first</div>
      <h1 className="text-4xl font-serif font-bold text-stone-900 mb-4 leading-tight">
        Welcome to Source Library's curation lab.
      </h1>
      <p className="text-stone-700 mb-4 leading-relaxed text-lg">
        Thanks for being here. Source Library reads thousands of historical books with AI — but the AI is wrong
        often enough that real human judgment makes the difference between a great library and a mediocre one,
        especially on the strange, beautiful, hand-printed pages we care most about.
      </p>
      <p className="text-stone-700 mb-4 leading-relaxed text-lg">
        You can pick a queue below and start rating right away. No signup. Every queue is keyboard-driven so
        you can power through a session in minutes — or stop after one click. Your judgments train our filters
        and quality thresholds; when several people agree, the rule changes.
      </p>
      <p className="text-stone-700 mb-10 leading-relaxed text-lg">
        This page is shared by direct link, not from the public site. We're starting small and adjusting fast,
        so please tell us what's confusing, broken, or boring.
      </p>

      <ReviewStats />

      <div className="grid gap-4 mt-8">
        {QUEUES.map(q => (
          <div key={q.slug} className="border border-stone-200 bg-white rounded-lg p-5">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-xl font-semibold text-stone-900">{q.title}</h2>
              <span className="text-xs text-stone-500">{q.timePerItem}</span>
            </div>
            <p className="text-stone-700 mt-2 text-sm leading-relaxed">{q.blurb}</p>
            <Link
              href={`/review/${q.slug}`}
              className="inline-block mt-4 px-4 py-2 rounded-md bg-accent-rust text-white text-sm font-medium hover:opacity-90"
            >
              Start rating &rarr;
            </Link>
          </div>
        ))}
      </div>

      <div className="mt-12 text-sm text-stone-600 leading-relaxed border-t border-stone-200 pt-6 space-y-2">
        <p>
          <b>Privacy:</b> ratings are stored with a per-browser ID. No login, no PII. We log the user-agent
          only for spam detection.
        </p>
        <p>
          <b>Feedback:</b> every queue has a note box — if you can see something the rating buttons
          can't express, write it there and it comes straight to us. For anything longer,{' '}
          <a href="mailto:team@sourcelibrary.org" className="text-accent-rust hover:underline">
            team@sourcelibrary.org
          </a>
          . Bug reports, queue ideas, and "this rating UI made me crazy" notes all welcome.
        </p>
        <p>
          <b>Want to be credited?</b> Say so in a note or an email and we'll add you to the
          contributors page once that lands.
        </p>
      </div>
    </main>
    </>
  );
}
