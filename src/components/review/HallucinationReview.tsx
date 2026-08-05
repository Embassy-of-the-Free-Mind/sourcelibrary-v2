'use client';

import { useReviewQueue } from './useReviewQueue';
import { QueueShell } from './QueueShell';

type Item = {
  item_id: string;
  book_id: string;
  page_number: number;
  page_type: string | null;
  image_url: string;
  page_link: string;
  book: { title?: string; author?: string; year?: number; language?: string; slug?: string } | null;
  descriptions: Array<{
    type: string | null;
    significance: string | null;
    size: string | null;
    description: string;
  }>;
};

export default function HallucinationReview() {
  const q = useReviewQueue<Item>({
    queue: 'hallucination',
    fetchUrl: '/api/review/hallucination/next',
    itemToDetail: it => ({
      book_id: it.book_id,
      page_number: it.page_number,
      page_type: it.page_type,
      n_descriptions: it.descriptions.length,
      tag_types: it.descriptions.map(d => `${d.type}/${d.significance}`),
    }),
  });

  const body = q.item ? (
    <div className="space-y-4">
      <a href={q.item.page_link} target="_blank" rel="noreferrer" className="block">
        <img
          src={q.item.image_url}
          alt=""
          className="w-full max-h-[80vh] object-contain bg-white border border-stone-200 rounded-lg"
        />
        <div className="text-xs text-stone-500 mt-2 text-center">Click to open the actual page</div>
      </a>
      <div>
        <div className="text-stone-900 font-semibold">{q.item.book?.title || '(untitled)'}</div>
        <div className="text-stone-600 text-sm">
          {q.item.book?.author ? `${q.item.book.author} · ` : ''}
          {q.item.book?.year ? `${q.item.book.year} · ` : ''}
          {q.item.book?.language ? `${q.item.book.language} · ` : ''}
          page {q.item.page_number}
          {q.item.page_type ? ` · page_type=${q.item.page_type}` : ''}
        </div>
      </div>
      <div>
        <div className="text-stone-700 text-sm mb-2 font-medium">
          OCR said this page contains {q.item.descriptions.length} illustration
          {q.item.descriptions.length === 1 ? '' : 's'}:
        </div>
        <div className="space-y-2">
          {q.item.descriptions.map((d, i) => (
            <div key={i} className="bg-white border border-stone-200 rounded-md p-3 text-sm">
              <div className="flex gap-2 mb-1.5 text-xs text-stone-600">
                {d.type && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded">{d.type}</span>}
                {d.significance && (
                  <span
                    className={`px-2 py-0.5 rounded ${
                      d.significance === 'high' ? 'bg-amber-50 text-amber-700' : 'bg-stone-100 text-stone-600'
                    }`}
                  >
                    sig: {d.significance}
                  </span>
                )}
                {d.size && <span className="px-2 py-0.5 bg-stone-100 text-stone-600 rounded">{d.size}</span>}
              </div>
              <div className="text-stone-800 leading-relaxed">{d.description}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <QueueShell
      queueTitle="OCR hallucination check"
      question="Does the description match something actually visible on the page?"
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
      notePlaceholder="e.g. not a hallucination — it's bleed-through from the facing leaf"
      note={q.note}
      onNoteChange={q.setNote}
      onNoteSubmit={q.submitNote}
      noteSaved={q.noteSaved}
    />
  );
}
