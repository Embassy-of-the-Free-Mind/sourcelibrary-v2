'use client';

import { useReviewQueue } from './useReviewQueue';
import { QueueShell } from './QueueShell';

type Item = {
  item_id: string;
  page_id: string;
  book_id: string;
  page_number: number;
  page_type: string | null;
  image_url: string;
  page_link: string;
  existing_scan_quality: { score?: number; scan_class?: string } | null;
  book: { title?: string; author?: string; year?: number; language?: string };
};

export default function ScanQualityReview() {
  const q = useReviewQueue<Item>({
    queue: 'scan-quality',
    fetchUrl: '/api/review/scan-quality/next',
    itemToDetail: it => ({
      page_id: it.page_id,
      book_id: it.book_id,
      page_number: it.page_number,
      page_type: it.page_type,
      existing_scan_quality: it.existing_scan_quality,
    }),
  });

  const body = q.item ? (
    <div className="space-y-4">
      <a href={q.item.page_link} target="_blank" rel="noreferrer" className="block">
        <img
          src={q.item.image_url}
          alt=""
          className="w-full max-h-[85vh] object-contain bg-white border border-stone-200 rounded-lg"
        />
        <div className="text-xs text-stone-500 mt-2 text-center">Click to open the actual page</div>
      </a>
      <div>
        <div className="text-stone-900 font-semibold">{q.item.book.title || '(untitled)'}</div>
        <div className="text-stone-600 text-sm">
          {q.item.book.author ? `${q.item.book.author} · ` : ''}
          {q.item.book.year ? `${q.item.book.year} · ` : ''}
          {q.item.book.language ? `${q.item.book.language} · ` : ''}
          page {q.item.page_number}
          {q.item.page_type ? ` · page_type=${q.item.page_type}` : ''}
        </div>
      </div>
      {q.item.existing_scan_quality && (
        <div className="bg-white border border-stone-200 rounded-md p-3 text-xs text-stone-700">
          <b>AI already labelled this:</b>{' '}
          {q.item.existing_scan_quality.scan_class}
          {q.item.existing_scan_quality.score != null && ` · score ${q.item.existing_scan_quality.score}`}
        </div>
      )}
    </div>
  ) : null;

  return (
    <QueueShell
      queueTitle="Scan quality"
      question="How clean is this page scan?"
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
      onNoteChange={q.setNote}
      onNoteSubmit={q.submitNote}
      noteSaved={q.noteSaved}
    />
  );
}
