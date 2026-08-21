'use client';

import { useReviewQueue } from './useReviewQueue';
import { QueueShell } from './QueueShell';

/**
 * The generic queue. An item is a page and a question; the answer is prose.
 *
 * Every other queue renders the thing being judged inside the page — a scan, an
 * illustration, a pair of strings. This one deliberately does not. The thing
 * being judged is a whole page of the live site, so the volunteer goes and looks
 * at it, comes back, and writes what they saw. That is why adding a task type
 * here is inserting a row rather than writing a component, and it is the shape
 * that fits most of what we actually want checked: a blog post, a collection
 * intro, a Spanish page, a book's metadata.
 *
 * The link opens in a new tab on purpose — losing the queue on every item would
 * mean re-finding your place, and the session counter is most of the reward.
 */
type Item = {
  item_id: string;
  url: string;
  prompt: string;
  label: string;
  campaign: string;
};

export default function PageCheckReview() {
  const q = useReviewQueue<Item>({
    queue: 'page-check',
    fetchUrl: '/api/review/page-check/next',
    itemToDetail: it => ({ url: it.url, campaign: it.campaign, label: it.label }),
  });

  const body = q.item ? (
    <div className="max-w-2xl mx-auto space-y-6">
      {q.item.campaign && (
        <div className="text-xs uppercase tracking-wider text-stone-500">{q.item.campaign}</div>
      )}

      <div className="bg-white border border-stone-200 rounded-lg p-6 space-y-4">
        <p
          className="text-xl leading-snug text-stone-900"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
        >
          {q.item.prompt}
        </p>

        <a
          href={q.item.url}
          target="_blank"
          rel="noreferrer"
          className="inline-block px-4 py-2 rounded-md bg-accent-rust text-white text-sm font-medium hover:opacity-90"
        >
          Open {q.item.label || 'the page'} &rarr;
        </a>

        <div className="text-xs text-stone-500 break-all">{q.item.url}</div>
      </div>

      <p className="text-xs text-stone-500">
        Open it, read it, come back. If something is off, the box below is the important
        part &mdash; the buttons only tell us the page has been looked at.
      </p>
    </div>
  ) : null;

  return (
    <QueueShell
      queueTitle="Page check"
      question="Have a look at this page. Is anything wrong with it?"
      ratings={q.ratings}
      sessionCount={q.sessionCount}
      loading={q.loading}
      error={q.error}
      onRate={q.submit}
      onSkip={q.skipItem}
      onRetry={() => q.fetchNext(q.volunteerId)}
      body={body}
      submitting={q.submitting}
      canSubmit={q.canSubmit}
      authStatus={q.authStatus}
      note={q.note}
      notePlaceholder="e.g. the third paragraph says 1623 but the title page says 1633"
      onNoteChange={q.setNote}
      onNoteSubmit={q.submitNote}
      noteSaved={q.noteSaved}
    />
  );
}
