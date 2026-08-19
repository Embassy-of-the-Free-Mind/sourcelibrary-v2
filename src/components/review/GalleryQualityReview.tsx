'use client';

import { useReviewQueue } from './useReviewQueue';
import { QueueShell } from './QueueShell';

type Item = {
  item_id: string;
  gallery_image_id: string;
  book_id: string;
  page_number: number;
  image_url: string;
  full_page_url: string | null;
  page_link: string;
  description: string | null;
  type: string | null;
  gallery_quality: number | null;
  book: { title?: string; author?: string; year?: number; language?: string };
};

export default function GalleryQualityReview() {
  const q = useReviewQueue<Item>({
    queue: 'gallery-quality',
    fetchUrl: '/api/review/gallery-quality/next',
    itemToDetail: it => ({
      gallery_image_id: it.gallery_image_id,
      book_id: it.book_id,
      page_number: it.page_number,
      type: it.type,
      gallery_quality: it.gallery_quality,
    }),
  });

  const body = q.item ? (
    <div className="space-y-4">
      <a href={q.item.page_link} target="_blank" rel="noreferrer" className="block">
        <img
          src={q.item.image_url}
          alt={q.item.description ?? ''}
          className="w-full max-h-[80vh] object-contain bg-white border border-stone-200 rounded-lg"
        />
        <div className="text-xs text-stone-500 mt-2 text-center">Click to open the page on sourcelibrary</div>
      </a>
      <div>
        <div className="text-stone-900 font-semibold">{q.item.book.title || '(untitled)'}</div>
        <div className="text-stone-600 text-sm">
          {q.item.book.author ? `${q.item.book.author} · ` : ''}
          {q.item.book.year ? `${q.item.book.year} · ` : ''}
          {q.item.book.language ? `${q.item.book.language} · ` : ''}
          page {q.item.page_number}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {q.item.type && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded">type: {q.item.type}</span>}
        {q.item.gallery_quality != null && (
          <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded">
            AI quality: {q.item.gallery_quality.toFixed(2)}
          </span>
        )}
      </div>
      {q.item.description && (
        <div className="bg-white border border-stone-200 rounded-md p-3 text-sm text-stone-800 leading-relaxed">
          {q.item.description}
        </div>
      )}
    </div>
  ) : null;

  return (
    <QueueShell
      queueTitle="Gallery quality"
      question="Should this image appear in the book's curated gallery?"
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
