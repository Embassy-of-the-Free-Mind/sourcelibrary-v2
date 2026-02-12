'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Page, Prompt } from '@/lib/types';
import type { JobType, Job } from '@/lib/types/job';
import { prompts as promptsApi, jobs, books, batchJobs } from '@/lib/api-client';
import { queueBooks } from '@/lib/api-client/queues';
import BookPagesStats from './BookPagesStats';
import BookPagesActions from './BookPagesActions';
import JobStatusBanner from './JobStatusBanner';
import BatchJobStatusBanner from './BatchJobStatusBanner';
import BatchModePanel from './BatchModePanel';
import ReorderModePanel from './ReorderModePanel';
import PagesGrid from './PagesGrid';

interface BookPagesSectionProps {
  bookId: string;
  bookTitle?: string;
  pages: Page[];
}

const PAGES_PER_LOAD = 24; // 2 rows on 12-col grid

export default function BookPagesSection({ bookId, bookTitle, pages: initialPages }: BookPagesSectionProps) {
  const router = useRouter();
  const [pages, setPages] = useState(initialPages);
  const [batchMode, setBatchMode] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<JobType>('ocr');
  // const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [showPromptSettings, setShowPromptSettings] = useState(false);
  const [overwriteMode, setOverwriteMode] = useState(false); // Force re-process pages that already have data
  const [visibleCount, setVisibleCount] = useState(PAGES_PER_LOAD); // Pagination
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Auto-load more pages when scrolling near the bottom
  useEffect(() => {
    if (!loadMoreRef.current || visibleCount >= pages.length) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount(prev => Math.min(prev + PAGES_PER_LOAD, pages.length));
        }
      },
      { rootMargin: '200px' } // Load 200px before visible
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [visibleCount, pages.length]);

  // Reorder mode state
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [dragOverPageId, setDragOverPageId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);

  // Update pages when initialPages changes
  useEffect(() => {
    setPages(initialPages);
  }, [initialPages]);

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
  const [loadingJob, setLoadingJob] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Batch mode state (Gemini Batch API)
  const [processingMode, setProcessingMode] = useState<'realtime' | 'batch'>('realtime');
  const [currentBatchJob, setCurrentBatchJob] = useState<any>(null);

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
          } else if (book.job.type === 'batch') {
            // Fetch batch job
            const batchJob = await batchJobs.get(book.job.job_id);
            // Only set if batch job is still active
            if (['pending', 'processing'].includes(batchJob.status)) {
              setCurrentBatchJob(batchJob);
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch current job:', error);
      }
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
      router.refresh();
    } catch (error) {
      console.error('Failed to save order:', error);
    } finally {
      setSavingOrder(false);
    }
  };

  const runBatchProcess = async () => {
    if (selectedPages.size === 0) return;

    const pageIds = Array.from(selectedPages);

    // Filter pages based on overwrite mode - check actual data presence
    let pageIdsToProcess = pageIds;

    if (!overwriteMode) {
      pageIdsToProcess = pageIds.filter(pageId => {
        const page = pages.find(p => p.id === pageId);
        if (!page) return false;

        if (action === 'ocr') {
          // Only process pages without OCR data
          return !page.ocr?.data;
        } else if (action === 'translation') {
          // Only process pages that have OCR but no translation
          return page.ocr?.data && !page.translation?.data;
        } else if (action === 'image_extraction') {
          // Only process pages without detected images
          return !page.detected_images || page.detected_images.length === 0;
        }
        return false;
      });
    }

    if (pageIdsToProcess.length === 0) {
      alert('All selected pages already have data. Enable overwrite mode to re-process.');
      return;
    }

    // Get custom prompt (only for OCR and translation)
    const customPrompt = (action === 'ocr' || action === 'translation')
      ? editedPrompts[action] || undefined
      : undefined;

    setQueueing(true);
    try {
      // Check if we can use batch mode (only OCR and image_extraction)
      const canUseBatch = (action === 'ocr' || action === 'image_extraction');
      const useBatch = canUseBatch && processingMode === 'batch';

      if (!useBatch) {
        // Real-time processing (SQS workers)
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
      } else {
        // Gemini Batch API with parent-child architecture
        const response = await books.batchOcrMulti(bookId, {
          pageIds: pageIdsToProcess,
          action: action as 'ocr' | 'image_extraction',
          overwriteMode
        });

        if (!response.success) {
          throw new Error(response.error || 'Failed to submit batch job');
        }

        // Set batch job for UI tracking
        setCurrentBatchJob({
          id: response.parentJobId,
          type: action,
          status: 'pending',
          total_pages: response.totalPages,
          total_batches: response.totalBatches,
          book_title: bookTitle || '',
          created_at: new Date()
        });
      }

      // Clear selection and exit batch mode
      setSelectedPages(new Set());
      setBatchMode(false);

      // Refresh to show updated job status
      router.refresh();
    } catch (error) {
      console.error('Failed to queue job:', error);
      alert(error instanceof Error ? error.message : 'Failed to queue job');
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

      // If job is completed successfully, hide progress UI and refresh
      if (job.status === 'completed' && job.progress.failed === 0) {
        setCurrentJob(null);
        router.refresh();
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
      alert(error instanceof Error ? error.message : 'Failed to retry job');
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
      router.refresh();
    } catch (error) {
      console.error('Failed to cancel job:', error);
      alert(error instanceof Error ? error.message : 'Failed to cancel job');
    } finally {
      setCancelling(false);
    }
  };

  const selectedCount = selectedPages.size;

  const [settingCover, setSettingCover] = useState<string | null>(null);

  const setCoverImage = async (page: Page) => {
    setSettingCover(page.id);
    try {
      const baseUrl = page.photo_original || page.photo;
      // Use a higher quality thumbnail for the cover
      let thumbnailUrl = baseUrl;
      if (page.crop?.xStart !== undefined && page.crop?.xEnd !== undefined) {
        thumbnailUrl = `/api/image?url=${encodeURIComponent(baseUrl)}&w=400&q=80&cx=${page.crop.xStart}&cw=${page.crop.xEnd}`;
      } else {
        thumbnailUrl = `/api/image?url=${encodeURIComponent(baseUrl)}&w=400&q=80`;
      }

      await books.update(bookId, { thumbnail: thumbnailUrl });
      router.refresh();
    } catch (error) {
      console.error('Error setting cover:', error);
    } finally {
      setSettingCover(null);
    }
  };

  const getImageUrl = (page: Page) => {
    if (page.thumbnail) {
      return page.thumbnail;
    }

    const baseUrl = page.photo_original || page.photo;
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
          <BookPagesActions
            bookId={bookId}
            batchMode={batchMode}
            reorderMode={reorderMode}
            currentJob={currentJob}
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
        </div>
      </div>

      {/* Batch Job Status Banner */}
      {currentBatchJob && (
        <BatchJobStatusBanner
          job={currentBatchJob}
          onClose={() => setCurrentBatchJob(null)}
        />
      )}

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

      {/* Batch Mode Controls */}
      {batchMode && (
        <BatchModePanel
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
          processingMode={processingMode}
          onActionChange={setAction}
          onOverwriteModeChange={setOverwriteMode}
          onProcessingModeChange={setProcessingMode}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          onTogglePromptSettings={() => setShowPromptSettings(!showPromptSettings)}
          onSelectPrompt={handleSelectPrompt}
          onEditPrompt={(action, value) => setEditedPrompts(prev => ({ ...prev, [action]: value }))}
          onStartProcess={runBatchProcess}
        />
      )}

      {/* Reorder Mode Info */}
      {reorderMode && <ReorderModePanel />}

      {/* Pages Grid */}
      <PagesGrid
        pages={pages}
        bookId={bookId}
        batchMode={batchMode}
        reorderMode={reorderMode}
        selectedPages={selectedPages}
        settingCover={settingCover}
        visibleCount={visibleCount}
        draggedPageId={draggedPageId}
        dragOverPageId={dragOverPageId}
        loadMoreRef={loadMoreRef}
        onPageToggle={togglePage}
        onSetCover={setCoverImage}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onLoadMore={() => setVisibleCount(prev => Math.min(prev + PAGES_PER_LOAD, pages.length))}
        getImageUrl={getImageUrl}
      />
    </div>
  );
}
