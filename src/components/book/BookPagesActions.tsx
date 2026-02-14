import Link from 'next/link';
import { Wand2, ArrowUpDown, Scissors, X, CheckCircle2, Loader2 } from 'lucide-react';
import DownloadButton from '@/components/ui/DownloadButton';
import type { Job } from '@/lib/types/job';

interface BookPagesActionsProps {
  bookId: string;
  batchMode: boolean;
  reorderMode: boolean;
  currentJob: Job | null;
  checkingJob?: boolean;
  orderChanged: boolean;
  savingOrder: boolean;
  pagesWithOcr: number;
  pagesWithTranslation: number;
  onBatchClick: () => void;
  onReorderClick: () => void;
  onExitBatch: () => void;
  onExitReorder: () => void;
  onSaveOrder: () => void;
}

export default function BookPagesActions({
  bookId,
  batchMode,
  reorderMode,
  currentJob,
  checkingJob,
  orderChanged,
  savingOrder,
  pagesWithOcr,
  pagesWithTranslation,
  onBatchClick,
  onReorderClick,
  onExitBatch,
  onExitReorder,
  onSaveOrder
}: BookPagesActionsProps) {
  return (
    <div className="flex items-center gap-2">
      {!batchMode && !reorderMode && !currentJob && !checkingJob ? (
        <>
          <button
            onClick={onBatchClick}
            className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors text-sm font-medium border border-amber-200"
          >
            <Wand2 className="w-4 h-4" />
            Batch Process
          </button>
          <button
            onClick={onReorderClick}
            className="flex items-center gap-2 px-4 py-2 bg-stone-100 text-stone-700 rounded-lg hover:bg-stone-200 transition-colors text-sm font-medium"
          >
            <ArrowUpDown className="w-4 h-4" />
            Reorder
          </button>
          <Link
            href={`/book/${bookId}/split`}
            className="flex items-center gap-2 px-4 py-2 bg-stone-100 text-stone-700 rounded-lg hover:bg-stone-200 transition-colors text-sm font-medium"
          >
            <Scissors className="w-4 h-4" />
            Split Pages
          </Link>
        </>
      ) : batchMode ? (
        <button
          onClick={onExitBatch}
          className="flex items-center gap-2 px-4 py-2 bg-stone-100 text-stone-600 rounded-lg hover:bg-stone-200 transition-colors text-sm"
        >
          <X className="w-4 h-4" />
          Exit
        </button>
      ) : reorderMode ? (
        <div className="flex items-center gap-2">
          {orderChanged && (
            <button
              onClick={onSaveOrder}
              disabled={savingOrder}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {savingOrder ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Save Order
            </button>
          )}
          <button
            onClick={onExitReorder}
            className="flex items-center gap-2 px-4 py-2 bg-stone-100 text-stone-600 rounded-lg hover:bg-stone-200 transition-colors text-sm"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
        </div>
      ) : null}
      {/* Download button - always visible */}
      <DownloadButton
        bookId={bookId}
        hasTranslations={pagesWithTranslation > 0}
        hasOcr={pagesWithOcr > 0}
      />
    </div>
  );
}
