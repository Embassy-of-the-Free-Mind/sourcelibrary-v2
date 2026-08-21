'use client';

import { useReviewQueue } from './useReviewQueue';
import { QueueShell } from './QueueShell';

/**
 * The only queue that reviews OUR words rather than a scanned page.
 *
 * A volunteer sees the English string and the Spanish we currently ship, plus
 * where it appears, and says whether the Spanish means the same thing and reads
 * like a person wrote it. No image, no book, no page.
 *
 * Two deliberate choices in the layout:
 *
 *  - The Spanish is shown FIRST and larger. The reviewer is judging the Spanish;
 *    the English is the reference. Putting English first invites reading it as a
 *    translation exercise ("how would I say this?") instead of a proof-read
 *    ("does this work?"), which produces rewrites rather than verdicts.
 *  - Strings render in the same serif the site uses, not a monospace code font.
 *    These are sentences a reader will meet, and monospace makes people evaluate
 *    them as data.
 */
type Item = {
  item_id: string;
  key: string;
  en: string;
  es: string;
  where: string;
};

export default function SpanishCopyReview() {
  const q = useReviewQueue<Item>({
    queue: 'spanish-copy',
    fetchUrl: '/api/review/spanish-copy/next',
    itemToDetail: it => ({ key: it.key, en: it.en, es: it.es, where: it.where }),
  });

  const body = q.item ? (
    <div className="max-w-2xl mx-auto space-y-6">
      {q.item.where && (
        <div className="text-xs uppercase tracking-wider text-stone-500">{q.item.where}</div>
      )}

      <div className="bg-white border border-stone-200 rounded-lg p-6">
        <div className="text-xs uppercase tracking-wider text-stone-400 mb-2">Español</div>
        <p
          className="text-2xl leading-snug text-stone-900"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
          lang="es"
        >
          {q.item.es}
        </p>
      </div>

      <div className="bg-stone-100 border border-stone-200 rounded-lg p-4">
        <div className="text-xs uppercase tracking-wider text-stone-400 mb-2">English original</div>
        <p
          className="text-base leading-snug text-stone-700"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
          lang="en"
        >
          {q.item.en}
        </p>
      </div>

      <p className="text-xs text-stone-500">
        If it is wrong or awkward, please use the note box below to say what it should be
        &mdash; that is far more useful to us than the rating on its own.
      </p>
    </div>
  ) : null;

  return (
    <QueueShell
      queueTitle="Spanish copy"
      question="Does this Spanish say what the English says, and read like a person wrote it?"
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
      notePlaceholder="e.g. 'sugerir' is odd here — a reader would say 'proponer'"
      note={q.note}
      onNoteChange={q.setNote}
      onNoteSubmit={q.submitNote}
      noteSaved={q.noteSaved}
    />
  );
}
