'use client';

import { useEffect, useState } from 'react';
import { processing } from '@/lib/api-client/processing';

interface PageDoc {
  id: string;
  book_id: string;
  page_number: number;
  ocr?: { data?: string };
  translation?: { data?: string };
}

/**
 * The page-scoped action on the pipeline page. When the admin arrives from a
 * reader page (`?page=<pageId>`), the thing they want is to translate THAT page
 * again, not to be offered the whole book. Uses the same single-page route the
 * page editor uses (`/api/process`, action 'translation'); no new lane.
 */
export default function PageRetranslateCard({
  bookId,
  pageId,
  language,
}: {
  bookId: string;
  pageId: string;
  language: string;
}) {
  const [page, setPage] = useState<PageDoc | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<'done' | 'failed' | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/pages/${encodeURIComponent(pageId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((p: PageDoc) => {
        // A page id from another book is not this book's page: show nothing.
        if (!cancelled && p.book_id === bookId) setPage(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bookId, pageId]);

  if (!page) return null;

  const ocrText = page.ocr?.data || '';
  const hasTranslation = !!page.translation?.data;
  const verb = hasTranslation ? 'Retranslate' : 'Translate';

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      await processing.process({
        pageId: page.id,
        action: 'translation',
        language,
        targetLanguage: 'English',
        ocrText,
        autoSave: true,
      });
      setResult('done');
    } catch {
      setResult('failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mb-6 p-6 bg-white rounded-xl border-2 border-accent-rust/40">
      <h2 className="text-lg font-semibold text-stone-900 mb-1">
        {verb} page {page.page_number}
      </h2>
      <p className="text-stone-600 text-sm mb-4">
        Only this page is translated again, from its existing OCR text. The rest of the book is untouched.
      </p>
      {!ocrText ? (
        <p className="text-sm text-stone-600">This page has no OCR text yet, so there is nothing to translate.</p>
      ) : (
        <button
          onClick={run}
          disabled={running}
          className="px-4 py-2 text-white bg-accent-rust rounded-lg hover:bg-accent-rust/90 disabled:opacity-50 transition-colors"
        >
          {running ? 'Translating…' : `${verb} page ${page.page_number}`}
        </button>
      )}
      {result === 'done' && (
        <p className="mt-3 text-sm text-green-700">
          Done.{' '}
          <a className="underline" href={`/book/${bookId}?page=${page.page_number}`}>
            Back to page {page.page_number}
          </a>
        </p>
      )}
      {result === 'failed' && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          Translation failed (a human-edited page is not overwritten). Nothing was changed.
        </p>
      )}
    </div>
  );
}
