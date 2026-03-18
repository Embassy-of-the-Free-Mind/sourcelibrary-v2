'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import type { Page, Prompt } from '@/lib/types';
import type { JobType, Job } from '@/lib/types/job';
import type { ActionType } from './ProcessingPanel';
import { prompts as promptsApi, jobs, books } from '@/lib/api-client';
import { queueBooks } from '@/lib/api-client/queues';
import { AuthCheck } from '@/components/auth/AuthCheck';
import BookPagesStats from './BookPagesStats';
import BookPagesActions from './BookPagesActions';
import JobStatusBanner from './JobStatusBanner';
import ProcessingPanel from './ProcessingPanel';
import ReorderModePanel from './ReorderModePanel';
import PagesGrid from './PagesGrid';

interface BookPagesSectionProps {
  bookId: string;
  bookTitle?: string;
  pages: Page[];
  displayBrightness?: number;
}

const PAGES_PER_LOAD = 24; // 2 rows on 12-col grid

export default function BookPagesSection({ bookId, bookTitle, pages: initialPages, displayBrightness }: BookPagesSectionProps) {
  const [pages, setPages] = useState(initialPages);
  const [batchMode, setBatchMode] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<ActionType>('ocr');
  const [brightness, setBrightness] = useState(displayBrightness ?? 1.0);
  // const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [showPromptSettings, setShowPromptSettings] = useState(false);
  const [overwriteMode, setOverwriteMode] = useState(false); // Force re-process pages that already have data
  const [visibleCount, setVisibleCount] = useState(PAGES_PER_LOAD); // Pagination

  // Load more pages manually via button click (no auto-scroll)
  const handleLoadMore = useCallback(() => {
    setVisibleCount(prev => Math.min(prev + PAGES_PER_LOAD, pages.length));
  }, [pages.length]);

  // Reorder mode state
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [dragOverPageId, setDragOverPageId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);

  // Update pages when initialPages changes
  useEffect(() => {
    setPages(initialPages);
  }, [initialPages]);

  // Client-side refresh: fetch updated pages without triggering Suspense
  const refreshPages = useCallback(async () => {
    try {
      const book = await books.get(bookId);
      if ('pages' in book && book.pages) {
        setPages(book.pages);
      }
    } catch (error) {
      console.error('Failed to refresh pages:', error);
    }
  }, [bookId]);

  // Prompt library state
  const [prompts, setPrompts] = useState<Record<JobType, Prompt[]>>({
    ocr: [],
    translation: [],
    summary: [],
    image_extraction: []
  });
  const [selectedPromptIds, setSelectedPromptIds] = useState<Record<JobType, string>>({
    ocr: '',
    translation: '',
    summary: '',
    image_extraction: ''
  });
  const [editedPrompts, setEditedPrompts] = useState<Record<JobType, string>>({
    ocr: '',
    translation: '',
    summary: '',
    image_extraction: ''
  });
  const [promptsLoading, setPromptsLoading] = useState(true);

  // Current job status (fetched from API on-demand)
  const [currentJob, setCurrentJob] = useState<Job | null>(null);
  // Initial job check loading - hide actions until we know if a job is active
  const [checkingActiveJob, setCheckingActiveJob] = useState(true);
  const [loadingJob, setLoadingJob] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const lastSelectedIndexRef = useRef<number | null>(null);

  // Calculate stats (check updated_at since data is excluded from projection)
  const pagesWithOcr = pages.filter(p => p.ocr?.updated_at).length;
  const pagesWithTranslation = pages.filter(p => p.translation?.updated_at).length;
  const totalPages = pages.length;

  // Calculate last activity dates
  const lastOcrDate = pages
    .filter(p => p.ocr?.updated_at)
    .map(p => new Date(p.ocr!.updated_at!))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const lastTranslationDate = pages
    .filter(p => p.translation?.updated_at)
    .map(p => new Date(p.translation!.updated_at!))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  // Fetch current job on mount
  useEffect(() => {
    const fetchCurrentJob = async () => {
      try {
        // Get book to check if there's a current job
        const book = await books.get(bookId);

        if (book.job) {
          if (book.job.type === 'realtime') {
            // Fetch real-time job
            const job = await jobs.get(book.job.job_id);
            // Only set if job is still active
            if (['pending', 'processing'].includes(job.status)) {
              setCurrentJob(job);
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch current job:', error);
      }
      // Mark initial check complete so actions can be shown if no active job
      setCheckingActiveJob(false);
    };
    fetchCurrentJob();
  }, [bookId]);

  // Fetch prompts
  useEffect(() => {
    const fetchPrompts = async () => {
      setPromptsLoading(true);
      try {
        const [ocrData, transData, sumData] = await Promise.all([
          promptsApi.list({ type: 'ocr' }),
          promptsApi.list({ type: 'translation' }),
          promptsApi.list({ type: 'summary' })
        ]);

        const loadPrompts = (promptsList: Prompt[], type: JobType) => {
          const defaultPrompt = promptsList.find((p: Prompt) => p.is_default) || promptsList[0];
          setPrompts(prev => ({ ...prev, [type]: promptsList }));
          if (defaultPrompt) {
            setSelectedPromptIds(prev => ({ ...prev, [type]: defaultPrompt.id || defaultPrompt._id?.toString() || '' }));
            setEditedPrompts(prev => ({ ...prev, [type]: defaultPrompt.content }));
          }
        };

        // Note: image_extraction doesn't have custom prompts (uses built-in), but initialize to empty
        loadPrompts(ocrData, 'ocr');
        loadPrompts(transData, 'translation');
        loadPrompts(sumData, 'summary');
      } catch (error) {
        console.error('Error fetching prompts:', error);
      } finally {
        setPromptsLoading(false);
      }
    };
    fetchPrompts();
  }, []);

  const handleSelectPrompt = (type: JobType, promptId: string) => {
    const prompt = prompts[type].find(p => (p.id || p._id?.toString()) === promptId);
    if (prompt) {
      setSelectedPromptIds(prev => ({ ...prev, [type]: promptId }));
      setEditedPrompts(prev => ({ ...prev, [type]: prompt.content }));
    }
  };

  const togglePage = useCallback((pageId: string, index: number, event?: React.MouseEvent) => {
    const isShiftClick = event?.shiftKey === true;
    const hasAnchor = lastSelectedIndexRef.current !== null;

    if (isShiftClick && hasAnchor) {
      // Shift-click: select range
      const start = Math.min(lastSelectedIndexRef.current!, index);
      const end = Math.max(lastSelectedIndexRef.current!, index);
      setSelectedPages(prev => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          next.add(pages[i].id);
        }
        return next;
      });
    } else {
      // Normal click: toggle single page
      setSelectedPages(prev => {
        const next = new Set(prev);
        if (next.has(pageId)) {
          next.delete(pageId);
        } else {
          next.add(pageId);
        }
        return next;
      });
      // Only update anchor on non-shift clicks
      lastSelectedIndexRef.current = index;
    }
  }, [pages]);

  const selectAll = () => setSelectedPages(new Set(pages.map(p => p.id)));
  const clearSelection = () => setSelectedPages(new Set());

  const exitBatchMode = () => {
    setBatchMode(false);
    setSelectedPages(new Set());
    setShowPromptSettings(false);
  };

  // Reorder mode functions
  const enterReorderMode = () => {
    setReorderMode(true);
    setBatchMode(false);
    setOrderChanged(false);
  };

  const exitReorderMode = () => {
    setReorderMode(false);
    setDraggedPageId(null);
    setDragOverPageId(null);
    // Reset to original order if not saved
    if (orderChanged) {
      setPages(initialPages);
      setOrderChanged(false);
    }
  };

  const handleDragStart = (pageId: string) => {
    setDraggedPageId(pageId);
  };

  const handleDragOver = (e: React.DragEvent, pageId: string) => {
    e.preventDefault();
    if (pageId !== draggedPageId) {
      setDragOverPageId(pageId);
    }
  };

  const handleDragEnd = () => {
    if (draggedPageId && dragOverPageId && draggedPageId !== dragOverPageId) {
      const newPages = [...pages];
      const draggedIndex = newPages.findIndex(p => p.id === draggedPageId);
      const dropIndex = newPages.findIndex(p => p.id === dragOverPageId);

      if (draggedIndex !== -1 && dropIndex !== -1) {
        const [draggedPage] = newPages.splice(draggedIndex, 1);
        newPages.splice(dropIndex, 0, draggedPage);

        // Update page numbers
        newPages.forEach((page, idx) => {
          page.page_number = idx + 1;
        });

        setPages(newPages);
        setOrderChanged(true);
      }
    }
    setDraggedPageId(null);
    setDragOverPageId(null);
  };

  const savePageOrder = async () => {
    setSavingOrder(true);
    try {
      const pageIds = pages.map(p => p.id);
      await books.reorder(bookId, pageIds);
      setOrderChanged(false);
      setReorderMode(false);
    } catch (error) {
      console.error('Failed to save order:', error);
    } finally {
      setSavingOrder(false);
    }
  };

  const runBatchProcess = async () => {
    // Brightness adjustment — save CSS value to book, no image processing needed
    if (action === 'adjust_images') {
      setQueueing(true);
      try {
        const res = await fetch(`/api/books/${bookId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_brightness: brightness }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text.slice(0, 100));
        }
        setBatchMode(false);
      } catch (error) {
        console.error('Failed to save brightness:', error);
        toast.error(error instanceof Error ? error.message : 'Failed to save brightness');
      } finally {
        setQueueing(false);
      }
      return;
    }

    if (selectedPages.size === 0) return;
    const pageIds = Array.from(selectedPages);

    // Filter pages based on overwrite mode - check actual data presence
    let pageIdsToProcess = pageIds;

    if (!overwriteMode) {
      pageIdsToProcess = pageIds.filter(pageId => {
        const page = pages.find(p => p.id === pageId);
        if (!page) return false;

        if (action === 'ocr') {
          // Only process pages without OCR (check updated_at since .data is excluded from projection)
          return !page.ocr?.updated_at;
        } else if (action === 'translation') {
          // Only process pages that have OCR but no translation
          return page.ocr?.updated_at && !page.translation?.updated_at;
        } else if (action === 'image_extraction') {
          // Only process pages without detected images
          return !page.detected_images || page.detected_images.length === 0;
        }
        return false;
      });
    }

    if (pageIdsToProcess.length === 0) {
      toast.error('All selected pages already have data. Enable overwrite mode to re-process.');
      return;
    }

    // Get custom prompt (only for OCR and translation)
    const customPrompt = (action === 'ocr' || action === 'translation')
      ? editedPrompts[action] || undefined
      : undefined;

    setQueueing(true);
    try {
      const response = await queueBooks({
        bookId,
        pageIds: pageIdsToProcess,
        action,
        customPrompt
      });

      // Set current job to show progress UI immediately
      setCurrentJob({
        id: response.jobId,
        type: action,
        status: 'pending',
        progress: {
          total: pageIdsToProcess.length,
          completed: 0,
          failed: 0
        },
        book_id: bookId,
        book_title: bookTitle || '',
        config: {},
        created_at: new Date(),
        updated_at: new Date(),
        initiated_by: 'user'
      });

      // Clear selection and exit batch mode
      setSelectedPages(new Set());
      setBatchMode(false);
    } catch (error) {
      console.error('Failed to queue job:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to queue job');
    } finally {
      setQueueing(false);
    }
  };

  // Fetch current job status
  const fetchJobStatus = async () => {
    if (!currentJob) return;

    setLoadingJob(true);
    try {
      const job = await jobs.get(currentJob.id);

      // If job is completed successfully, hide progress UI and refresh pages
      if (job.status === 'completed' && job.progress.failed === 0) {
        setCurrentJob(null);
        refreshPages();
      } else {
        // Update job state (will show failed/cancelled states)
        setCurrentJob(job);
      }
    } catch (error) {
      console.error('Failed to fetch job status:', error);
    } finally {
      setLoadingJob(false);
    }
  };

  // Retry failed pages
  const retryFailedPages = async () => {
    if (!currentJob) return;

    setRetrying(true);
    try {
      await jobs.retry(currentJob.id);
      // Refresh job status to show retry progress
      await fetchJobStatus();
    } catch (error) {
      console.error('Failed to retry job:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to retry job');
    } finally {
      setRetrying(false);
    }
  };

  // Cancel current job
  const cancelJob = async () => {
    if (!currentJob) return;

    setCancelling(true);
    try {
      await jobs.cancel(currentJob.id);
      setCurrentJob(null);
    } catch (error) {
      console.error('Failed to cancel job:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to cancel job');
    } finally {
      setCancelling(false);
    }
  };

  const selectedCount = selectedPages.size;

  const [settingCover, setSettingCover] = useState<string | null>(null);

  const setCoverImage = async (page: Page) => {
    setSettingCover(page.id);
    try {
      const updates: Record<string, unknown> = {};

      // Set thumbnail_blob from pre-generated CDN thumbnail
      if (page.thumbnail_blob) {
        updates.thumbnail_blob = page.thumbnail_blob;
      }

      // For main thumbnail, prefer archived/cropped photos, fall back to direct source URL.
      // NEVER store /api/image?url= wrappers — they crash Next.js Image during SSR.
      const typedPage = page as Page & { archived_photo?: string; cropped_photo?: string };
      const directUrl = typedPage.cropped_photo || typedPage.archived_photo || page.photo_original || page.photo;
      if (directUrl) {
        updates.thumbnail = directUrl;
      }

      updates.thumbnail_source = 'manual';
      await books.update(bookId, updates);
    } catch (error) {
      console.error('Error setting cover:', error);
    } finally {
      setSettingCover(null);
    }
  };

  const getImageUrl = (page: Page) => {
    const typedPage = page as Page & { archived_photo?: string; cropped_photo?: string };

    // For split pages, prefer pre-cropped Blob image — thumbnail_blob may be from unsplit original
    if (page.crop && typedPage.cropped_photo) {
      return typedPage.cropped_photo;
    }

    // Pre-generated Vercel Blob thumbnail (fast CDN) — only for non-split pages
    if (page.thumbnail_blob) {
      return page.thumbnail_blob;
    }
    if (page.thumbnail) {
      return page.thumbnail;
    }

    const baseUrl = typedPage.archived_photo || page.photo_original || page.photo;
    if (!baseUrl) return null;

    if (page.crop?.xStart !== undefined && page.crop?.xEnd !== undefined) {
      return `/api/image?url=${encodeURIComponent(baseUrl)}&w=150&q=60&cx=${page.crop.xStart}&cw=${page.crop.xEnd}`;
    }

    return `/api/image?url=${encodeURIComponent(baseUrl)}&w=150&q=60`;
  };

  return (
    <div className="space-y-6">
      {/* Stats Bar & Actions */}
      <div className="bg-white rounded-xl border border-stone-200 p-4">
        <div className="flex items-center justify-between">
          <BookPagesStats
            pagesWithOcr={pagesWithOcr}
            pagesWithTranslation={pagesWithTranslation}
            totalPages={totalPages}
            lastOcrDate={lastOcrDate}
            lastTranslationDate={lastTranslationDate}
          />
          <AuthCheck role="admin">
            <BookPagesActions
              bookId={bookId}
              batchMode={batchMode}
              reorderMode={reorderMode}
              currentJob={currentJob}
              checkingJob={checkingActiveJob}
              orderChanged={orderChanged}
              savingOrder={savingOrder}
              pagesWithOcr={pagesWithOcr}
              pagesWithTranslation={pagesWithTranslation}
              onBatchClick={() => setBatchMode(true)}
              onReorderClick={enterReorderMode}
              onExitBatch={exitBatchMode}
              onExitReorder={exitReorderMode}
              onSaveOrder={savePageOrder}
            />
          </AuthCheck>
        </div>
      </div>

      {/* Job Status Banner */}
      {currentJob && (
        <JobStatusBanner
          job={currentJob}
          loading={loadingJob}
          cancelling={cancelling}
          retrying={retrying}
          onRefresh={fetchJobStatus}
          onCancel={cancelJob}
          onRetry={retryFailedPages}
          onClose={() => setCurrentJob(null)}
        />
      )}

      {/* Processing Controls */}
      {batchMode && (
        <ProcessingPanel
          action={action}
          overwriteMode={overwriteMode}
          selectedCount={selectedCount}
          showPromptSettings={showPromptSettings}
          selectedPromptIds={selectedPromptIds}
          editedPrompts={editedPrompts}
          prompts={prompts}
          promptsLoading={promptsLoading}
          currentJob={currentJob}
          queueing={queueing}
          brightness={brightness}
          previewUrl={(() => {
            if (action !== 'adjust_images' || selectedPages.size === 0) return null;
            const firstId = Array.from(selectedPages)[0];
            const page = pages.find(p => p.id === firstId);
            if (!page) return null;
            const baseUrl = page.photo_original || page.photo;
            if (!baseUrl) return null;
            return `/api/image?url=${encodeURIComponent(baseUrl)}&w=200&q=70`;
          })()}
          onActionChange={setAction}
          onOverwriteModeChange={setOverwriteMode}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          onTogglePromptSettings={() => setShowPromptSettings(!showPromptSettings)}
          onSelectPrompt={handleSelectPrompt}
          onEditPrompt={(a, value) => setEditedPrompts(prev => ({ ...prev, [a]: value }))}
          onStartProcess={runBatchProcess}
          onBrightnessChange={setBrightness}
        />
      )}

      {/* Reorder Mode Info */}
      {reorderMode && <ReorderModePanel />}

      {/* Pages Grid — hide leading blank pages in normal browsing mode */}
      <PagesGrid
        pages={batchMode || reorderMode ? pages : (() => {
          // Skip leading blank pages (before first substantive content)
          const firstSubstantive = pages.findIndex(p => p.page_type !== 'blank');
          return firstSubstantive > 0 ? pages.slice(firstSubstantive) : pages;
        })()}
        bookId={bookId}
        batchMode={batchMode}
        reorderMode={reorderMode}
        selectedPages={selectedPages}
        settingCover={settingCover}
        visibleCount={visibleCount}
        draggedPageId={draggedPageId}
        dragOverPageId={dragOverPageId}
        brightness={brightness}
        onPageToggle={togglePage}
        onSetCover={setCoverImage}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onLoadMore={handleLoadMore}
        getImageUrl={getImageUrl}
      />
    </div>
  );
}
