'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Scissors, Wand2 } from 'lucide-react';
import Link from 'next/link';
import DownloadButton from './DownloadButton';
import BatchProcessPanel from './BatchProcessPanel';
import type { Page } from '@/lib/types';

interface BookStatsProps {
  bookId: string;
  pages: Page[];
  pagesWithOcr: number;
  pagesWithTranslation: number;
  pagesWithSummary: number;
  hasTranslations: boolean;
  hasOcr: boolean;
}

export default function BookStats({
  bookId,
  pages,
  pagesWithOcr,
  pagesWithTranslation,
  pagesWithSummary,
  hasTranslations,
  hasOcr
}: BookStatsProps) {
  const [showBatchPanel, setShowBatchPanel] = useState(false);
  const router = useRouter();

  const totalPages = pages.length;
  const ocrPercent = totalPages > 0 ? Math.round((pagesWithOcr / totalPages) * 100) : 0;
  const translationPercent = totalPages > 0 ? Math.round((pagesWithTranslation / totalPages) * 100) : 0;
  const summaryPercent = totalPages > 0 ? Math.round((pagesWithSummary / totalPages) * 100) : 0;

  const handleComplete = () => {
    router.refresh();
  };

  return (
    <>
      {/* Stats with percentages */}
      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 sm:gap-4 mt-4 sm:mt-6">
        {/* OCR stat */}
        <div className="bg-stone-700/50 rounded-lg px-3 sm:px-4 py-2 sm:py-3 min-w-[80px]">
          <div className="flex items-baseline gap-1">
            <span className="text-xl sm:text-2xl font-bold text-amber-400">{pagesWithOcr}</span>
            <span className="text-xs text-stone-400">/ {totalPages}</span>
          </div>
          <div className="text-xs text-stone-400">OCR</div>
          <div className="mt-1 h-1 bg-stone-600 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${ocrPercent}%` }}
            />
          </div>
          <div className="text-[10px] text-stone-500 mt-0.5">{ocrPercent}%</div>
        </div>

        {/* Translation stat */}
        <div className="bg-stone-700/50 rounded-lg px-3 sm:px-4 py-2 sm:py-3 min-w-[80px]">
          <div className="flex items-baseline gap-1">
            <span className="text-xl sm:text-2xl font-bold text-amber-400">{pagesWithTranslation}</span>
            <span className="text-xs text-stone-400">/ {totalPages}</span>
          </div>
          <div className="text-xs text-stone-400">Translated</div>
          <div className="mt-1 h-1 bg-stone-600 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${translationPercent}%` }}
            />
          </div>
          <div className="text-[10px] text-stone-500 mt-0.5">{translationPercent}%</div>
        </div>

        {/* Summary stat */}
        <div className="bg-stone-700/50 rounded-lg px-3 sm:px-4 py-2 sm:py-3 min-w-[80px]">
          <div className="flex items-baseline gap-1">
            <span className="text-xl sm:text-2xl font-bold text-amber-400">{pagesWithSummary}</span>
            <span className="text-xs text-stone-400">/ {totalPages}</span>
          </div>
          <div className="text-xs text-stone-400">Summarized</div>
          <div className="mt-1 h-1 bg-stone-600 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-all"
              style={{ width: `${summaryPercent}%` }}
            />
          </div>
          <div className="text-[10px] text-stone-500 mt-0.5">{summaryPercent}%</div>
        </div>

        {/* Actions */}
        <div className="w-full sm:w-auto sm:ml-auto mt-2 sm:mt-0 flex items-center justify-center sm:justify-end gap-2 flex-wrap">
          <button
            onClick={() => setShowBatchPanel(true)}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm font-medium"
          >
            <Wand2 className="w-4 h-4" />
            Batch Process
          </button>
          <Link
            href={`/book/${bookId}/prepare`}
            className="flex items-center gap-2 px-4 py-2 bg-stone-600 text-white rounded-lg hover:bg-stone-500 transition-colors text-sm"
          >
            <Scissors className="w-4 h-4" />
            Prepare Pages
          </Link>
          <DownloadButton
            bookId={bookId}
            hasTranslations={hasTranslations}
            hasOcr={hasOcr}
          />
        </div>
      </div>

      {/* Batch Process Panel */}
      {showBatchPanel && (
        <BatchProcessPanel
          bookId={bookId}
          pages={pages}
          onClose={() => setShowBatchPanel(false)}
          onComplete={handleComplete}
        />
      )}
    </>
  );
}
