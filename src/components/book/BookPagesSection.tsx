'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import type { Page, Prompt } from '@/lib/types';
import type { JobType, Job } from '@/lib/types/job';
import type { ActionType } from './ProcessingPanel';
import { prompts as promptsApi, jobs, books } from '@/lib/api-client';
import { queueBooks } from '@/lib/api-client/queues';
import { getPageGridUrl } from '@/lib/utils';
import { buildCoverUpdate } from '@/lib/cover-fields';
import JobStatusBanner from './JobStatusBanner';
import ProcessingNotice from './ProcessingNotice';
import { useSession } from 'next-auth/react';
import PagesGrid from './PagesGrid';

interface BookPagesSectionProps {
  bookId: string;
  bookPath?: string;
  bookTitle?: string;
  pages: Page[];
  totalPageCount?: number;
  displayBrightness?: number;
  overviewHref?: string;
  subtitle?: string;
}

const PAGES_PER_LOAD = 20; // 2 rows on the 10-col grid

export default function BookPagesSection({ bookId, bookPath, bookTitle, pages: initialPages, totalPageCount, displayBrightness, overviewHref, subtitle }: BookPagesSectionProps) {
  const [pages, setPages] = useState(initialPages);
  const [allPagesFetched, setAllPagesFetched] = useState(
    !totalPageCount || initialPages.length >= totalPageCount
  );
  const [fetchingMore, setFetchingMore] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<ActionType>('ocr');
  const [brightness, setBrightness] = useState(displayBrightness ?? 1.0);
  // const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [showPromptSettings, setShowPromptSettings] = useState(false);
  const [overwriteMode, setOverwriteMode] = useState(false); // Force re-process pages that already have data
  const [visibleCount, setVisibleCount] = useState(9); // Pagination — mobile default (3×3); desktop bumps to PAGES_PER_LOAD on mount

  // Desktop shows a fuller first screen (2 rows on the 10-col grid); mobile keeps 9.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 640) {
      setVisibleCount(v => (v < PAGES_PER_LOAD ? PAGES_PER_LOAD : v));
    }
  }, []);

  // Fetch remaining pages from API when SSR only sent a partial set
  const fetchRemainingPages = useCallback(async () => {
    if (allPagesFetched || fetchingMore) return;
    setFetchingMore(true);
    try {
      const res = await fetch(`/api/books/${bookId}?pageOffset=${pages.length}&pageLimit=0`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      if (data.pages?.length) {
        setPages(prev => [...prev, ...data.pages]);
      }
      setAllPagesFetched(true);
    } catch (error) {
      console.error('Failed to fetch remaining pages:', error);
    } finally {
      setFetchingMore(false);
    }
  }, [bookId, pages.length, allPagesFetched, fetchingMore]);

  // Load more pages manually via button click (no auto-scroll)
  const handleLoadMore = useCallback(() => {
    const nextVisible = Math.min(visibleCount + PAGES_PER_LOAD, totalPageCount || pages.length);
    // If we're about to show more than we have, fetch the rest first
    if (nextVisible > pages.length && !allPagesFetched) {
      fetchRemainingPages();
    }
    setVisibleCount(nextVisible);
  }, [visibleCount, pages.length, totalPageCount, allPagesFetched, fetchRemainingPages]);

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
        setAllPagesFetched(true);
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
  // What a reader may know: that processing is happening, and of what kind.
  // Comes from /api/books/[id], which is public — unlike /api/jobs/[id], which
  // is authenticated, so anonymous visitors previously saw nothing at all.
  const [publicJobType, setPublicJobType] = useState<string | null>(null);
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isStaff = role === 'admin' || role === 'superadmin' || role === 'editor';
  // Initial job check loading - hide actions until we know if a job is active
  const [checkingActiveJob, setCheckingActiveJob] = useState(true);
  const [loadingJob, setLoadingJob] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const lastSelectedIndexRef = useRef<number | null>(null);

  const totalPages = totalPageCount || pages.length;

  // Fetch current job on mount
  useEffect(() => {
    const fetchCurrentJob = async () => {
      try {
        // Get book to check if there's a current job
        const book = await books.get(bookId);

        if (book.job) {
          setPublicJobType((book.job as { action?: string; job_type?: string }).action
            || (book.job as { job_type?: string }).job_type || null);
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

  const selectAll = () => {
    if (!allPagesFetched) fetchRemainingPages();
    setSelectedPages(new Set(pages.map(p => p.id)));
  };
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
      const update = buildCoverUpdate(page, {
        source: 'manual',
        actor: 'admin',
        method: 'pages-grid-set-cover',
        confidence: 1,
      });
      if (!update) {
        console.error('Set cover: page has no usable image URL', page);
        return;
      }
      await books.update(bookId, update as unknown as Record<string, unknown>);
    } catch (error) {
      console.error('Error setting cover:', error);
    } finally {
      setSettingCover(null);
    }
  };

  const getImageUrl = (page: Page) => getPageGridUrl(page);

  return (
    <div className="space-y-6">
      {/* Operators get the controls; everyone else gets the fact. */}
      {!isStaff && publicJobType && <ProcessingNotice type={publicJobType} />}
      {isStaff && currentJob && (
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

      {/* Pages Grid — hide leading blank pages in normal browsing mode */}
      <PagesGrid
        pages={(() => {
          // Skip leading blank pages (before first substantive content)
          const firstSubstantive = pages.findIndex(p => p.page_type !== 'blank');
          return firstSubstantive > 0 ? pages.slice(firstSubstantive) : pages;
        })()}
        bookId={bookId}
        bookPath={bookPath}
        batchMode={false}
        reorderMode={false}
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
        totalCount={totalPages}
        overviewHref={overviewHref}
        subtitle={subtitle}
      />
    </div>
  );
}
