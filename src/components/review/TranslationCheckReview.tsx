'use client';

import { useReviewQueue } from './useReviewQueue';
import { QueueShell } from './QueueShell';

/**
 * Translation fidelity, judged by someone who reads the original.
 *
 * Modelled on PageCheckReview: the thing being judged is a whole reader page —
 * scan, transcription and English together — so the volunteer opens it, reads
 * it properly, and comes back. Rendering an excerpt here would be worse than
 * useless, because judging a translation means seeing the original beside it at
 * full size, and the scan beside both.
 *
 * The two-layer question is the point (see QUEUE_RATINGS['translation-check']).
 * The instructions say it in the order the layers actually fail: check the
 * transcription against the scan FIRST, because if that is wrong the English
 * cannot be judged at all and the honest verdict is "transcription wrong"
 * rather than "bad translation".
 */
type Item = {
  item_id: string;
  url: string;
  prompt: string;
  label: string;
  campaign: string;
  language: string;
};

export default function TranslationCheckReview() {
  const q = useReviewQueue<Item>({
    queue: 'translation-check',
    fetchUrl: '/api/review/translation-check/next',
    itemToDetail: it => ({ url: it.url, campaign: it.campaign, language: it.language }),
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
          Open the page &rarr;
        </a>

        <div className="text-xs text-stone-500 break-all">{q.item.url}</div>
      </div>

      <ol className="text-sm text-stone-600 space-y-2 list-decimal pl-5">
        <li>
          <b>Look at the scan first.</b> Does our transcription actually say what is printed or
          written on the page?
        </li>
        <li>
          <b>Then the English.</b> Does it say what the original says — no dropped clauses, no
          invented sentences, no lost negation, no changed name or number?
        </li>
        <li>
          If the transcription is wrong, the English cannot be judged: choose{' '}
          <i>transcription wrong</i> rather than blaming the translation for it.
        </li>
      </ol>

      <p className="text-xs text-stone-500">
        Telling us a page is <i>sound</i> is worth exactly as much as telling us it is broken.
        Without it we only ever hear about failures and never learn how much of the library has
        been checked at all.
      </p>
    </div>
  ) : null;

  return (
    <QueueShell
      queueTitle={q.item?.language ? `Translation check — ${q.item.language}` : 'Translation check'}
      question="Does our English say what the original says?"
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
      notePlaceholder="e.g. line 4 renders 'nisi' as 'if' — it should be 'unless', which reverses the sense"
      onNoteChange={q.setNote}
      onNoteSubmit={q.submitNote}
      noteSaved={q.noteSaved}
    />
  );
}
