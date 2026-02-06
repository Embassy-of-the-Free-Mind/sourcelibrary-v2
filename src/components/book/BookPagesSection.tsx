'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  FileText,
  Languages,
  BookOpen,
  Loader2,
  CheckCircle2,
  Square,
  Play,
  Scissors,
  Wand2,
  X,
  Download,
  Settings,
  DollarSign,
  ImageIcon,
  RotateCcw,
  AlertCircle,
  GripVertical,
  ArrowUpDown,
  RefreshCw,
  Info
} from 'lucide-react';
import DownloadButton from '@/components/ui/DownloadButton';
import { GEMINI_MODELS, DEFAULT_MODEL } from '@/lib/types';
import { MODEL_PRICING } from '@/lib/ai';
import type { Page, Prompt } from '@/lib/types';
import type { JobType, Job } from '@/lib/types/job';
import { prompts as promptsApi, jobs, books } from '@/lib/api-client';
import { queueBooks } from '@/lib/api-client/queues';

interface BookPagesSectionProps {
  bookId: string;
  bookTitle?: string;
  pages: Page[];
}

// Estimated token usage per action
const ESTIMATED_TOKENS = {
  ocr: { input: 1500, output: 800 },        // Image (~1000) + prompt (~500), output ~800
  translation: { input: 1000, output: 1000 }, // Input text + prompt, similar output
  summary: { input: 800, output: 200 },      // Shorter input/output
  image_extraction: { input: 1500, output: 800 }, // Similar to OCR (image + prompt)
};

// Calculate cost per page based on model
function getEstimatedCost(action: JobType, model: string): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const tokens = ESTIMATED_TOKENS[action];
  const inputCost = (tokens.input / 1_000_000) * pricing.input;
  const outputCost = (tokens.output / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

// Format relative time
function formatRelativeTime(date: Date | string | undefined): string {
  if (!date) return 'Never';
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
        book.current_job_id = '2k2mJIQ5CmYM';
        if (book.current_job_id) {
          const job = await jobs.get(book.current_job_id);
          // Only set if job is still active
          console.log("Job on fetch:", job);
          console.log("Job status on fetch:", job.status);
          if (['pending', 'processing'].includes(job.status)) {
            setCurrentJob(job);
          }
          console.log('Set current job on mount:', currentJob);
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

    try {
      const response = await queueBooks({
        bookId,
        pageIds: pageIdsToProcess,
        action,
        customPrompt
      });

      // Clear selection and exit batch mode
      setSelectedPages(new Set());
      setBatchMode(false);

      // Refresh to show job status
      router.refresh();
    } catch (error) {
      console.error('Failed to queue job:', error);
      alert(error instanceof Error ? error.message : 'Failed to queue job');
    }
  };

  // Fetch current job status
  const fetchJobStatus = async () => {
    if (!currentJob) return;

    setLoadingJob(true);
    try {
      const job = await jobs.get(currentJob.id);
      setCurrentJob(job);
    } catch (error) {
      console.error('Failed to fetch job status:', error);
    } finally {
      setLoadingJob(false);
    }
  };

  // Cancel current job
  const cancelJob = async () => {
    if (!currentJob) return;

    try {
      await jobs.cancel(currentJob.id);
      setCurrentJob(null);
      router.refresh();
    } catch (error) {
      console.error('Failed to cancel job:', error);
      alert(error instanceof Error ? error.message : 'Failed to cancel job');
    }
  };

  const actionConfig = {
    ocr: { label: 'OCR', icon: FileText, color: '#3b82f6' },
    translation: { label: 'Translation', icon: Languages, color: '#22c55e' },
    summary: { label: 'Summary', icon: BookOpen, color: '#a855f7' },
    image_extraction: { label: 'Images', icon: ImageIcon, color: '#f97316' }
  };

  const selectedCount = selectedPages.size;
  const estimatedCost = selectedCount * getEstimatedCost(action, DEFAULT_MODEL);

  const formatCost = (cost: number) => {
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    if (cost < 1) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
  };

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
      {/* Stats Bar - Clean horizontal layout */}
      <div className="bg-white rounded-xl border border-stone-200 p-4">
        <div className="flex flex-wrap items-center gap-6">
          {/* OCR stat */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#eff6ff' }}>
              <FileText className="w-5 h-5" style={{ color: '#3b82f6' }} />
            </div>
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-semibold text-stone-900">{pagesWithOcr}</span>
                <span className="text-sm text-stone-400">/ {totalPages}</span>
              </div>
              <div className="text-xs text-stone-500">OCR {lastOcrDate ? `· ${formatRelativeTime(lastOcrDate)}` : ''}</div>
            </div>
          </div>

          {/* Translation stat */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#f0fdf4' }}>
              <Languages className="w-5 h-5" style={{ color: '#22c55e' }} />
            </div>
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-semibold text-stone-900">{pagesWithTranslation}</span>
                <span className="text-sm text-stone-400">/ {totalPages}</span>
              </div>
              <div className="text-xs text-stone-500">Translated {lastTranslationDate ? `· ${formatRelativeTime(lastTranslationDate)}` : ''}</div>
            </div>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Actions */}
          <div className="flex items-center gap-2">
            {!batchMode && !reorderMode ? (
              <>
                <button
                  onClick={() => setBatchMode(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors text-sm font-medium border border-amber-200"
                >
                  <Wand2 className="w-4 h-4" />
                  Batch Process
                </button>
                <button
                  onClick={enterReorderMode}
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
                <DownloadButton
                  bookId={bookId}
                  hasTranslations={pagesWithTranslation > 0}
                  hasOcr={pagesWithOcr > 0}
                />
              </>
            ) : batchMode ? (
              <button
                onClick={exitBatchMode}
                className="flex items-center gap-2 px-4 py-2 bg-stone-100 text-stone-600 rounded-lg hover:bg-stone-200 transition-colors text-sm"
              >
                <X className="w-4 h-4" />
                Exit
              </button>
            ) : reorderMode ? (
              <div className="flex items-center gap-2">
                {orderChanged && (
                  <button
                    onClick={savePageOrder}
                    disabled={savingOrder}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-50"
                  >
                    {savingOrder ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Save Order
                  </button>
                )}
                <button
                  onClick={exitReorderMode}
                  className="flex items-center gap-2 px-4 py-2 bg-stone-100 text-stone-600 rounded-lg hover:bg-stone-200 transition-colors text-sm"
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Job Status Banner */}
      {currentJob && (
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-blue-900">
                    {actionConfig[currentJob.type].label} in progress
                  </span>
                  <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                    {currentJob.status}
                  </span>
                </div>
                <div className="text-xs text-blue-700 mt-1">
                  {currentJob.progress.completed} / {currentJob.progress.total} pages completed
                  {currentJob.progress.failed ? ` • ${currentJob.progress.failed} failed` : ''}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchJobStatus}
                disabled={loadingJob}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white text-blue-700 rounded-lg hover:bg-blue-100 border border-blue-300 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingJob ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={cancelJob}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-3 h-2 bg-blue-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{ width: `${(currentJob.progress.completed / currentJob.progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Batch Mode Controls */}
      {batchMode && (
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 space-y-4">
          {/* Action selector & Selection controls */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-stone-600">Action:</span>
              <div className="flex rounded-lg border border-amber-300 overflow-hidden bg-white">
                {(['ocr', 'translation', 'image_extraction'] as JobType[]).map(type => {
                  const { label, icon: Icon, color } = actionConfig[type];
                  const isSelected = action === type;
                  return (
                    <button
                      key={type}
                      onClick={() => setAction(type)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${isSelected ? 'text-white' : 'text-stone-600 hover:bg-stone-50'
                        }`}
                      style={isSelected ? { backgroundColor: color } : {}}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-6 w-px bg-amber-300" />

            {/* Mode selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-stone-600">Mode:</span>
              <select
                value={overwriteMode ? 'all' : 'missing'}
                onChange={(e) => setOverwriteMode(e.target.value === 'all')}
                className="px-2 py-1.5 text-sm bg-white border border-amber-300 rounded-lg text-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="missing">Only Missing</option>
                <option value="all">All (Overwrite)</option>
              </select>
            </div>

            <div className="h-6 w-px bg-amber-300" />

            <div className="flex items-center gap-3 text-sm">
              <span className="text-stone-600">
                <strong>{selectedCount}</strong> selected
              </span>
              <button onClick={selectAll} className="text-amber-700 hover:text-amber-800 font-medium">
                Select all
              </button>
              {selectedCount > 0 && (
                <button onClick={clearSelection} className="text-stone-500 hover:text-stone-700">
                  Clear
                </button>
              )}
            </div>

            <div className="flex-1" />

            {/* Prompt settings toggle */}
            <button
              onClick={() => setShowPromptSettings(!showPromptSettings)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${showPromptSettings ? 'bg-amber-200 text-amber-800' : 'bg-white text-stone-600 hover:bg-amber-100'
                }`}
            >
              <Settings className="w-4 h-4" />
              Prompt Settings
            </button>
          </div>

          {/* Prompt Settings Panel */}
          {showPromptSettings && (
            <div className="bg-white rounded-lg border border-amber-200 p-4 space-y-3">
              <div className="flex items-center gap-4">
                <label className="text-sm text-stone-600">Template:</label>
                <select
                  value={selectedPromptIds[action]}
                  onChange={(e) => handleSelectPrompt(action, e.target.value)}
                  disabled={promptsLoading}
                  className="flex-1 max-w-xs px-3 py-1.5 text-sm border border-stone-200 rounded-lg bg-white"
                >
                  {promptsLoading ? (
                    <option>Loading...</option>
                  ) : (
                    prompts[action].map(p => (
                      <option key={p.id || p._id?.toString()} value={p.id || p._id?.toString()}>
                        {p.name}{p.is_default ? ' (Default)' : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <textarea
                value={editedPrompts[action]}
                onChange={e => setEditedPrompts(prev => ({ ...prev, [action]: e.target.value }))}
                className="w-full h-32 p-3 text-sm border border-stone-200 rounded-lg resize-none font-mono text-stone-700"
                placeholder={`${actionConfig[action].label} prompt...`}
              />
              <p className="text-xs text-stone-400">
                Use {'{language}'} and {'{target_language}'} as placeholders. Changes apply to this batch only.
              </p>
            </div>
          )}

          {/* Run button */}
          <div className="flex items-center justify-between pt-2">
            {/* <div className="flex items-center gap-3 text-sm text-stone-500">
              {selectedCount > 0 ? (
                <>
                  <span>{selectedCount} pages selected</span>
                  <span className="text-stone-300">·</span>
                  <span className="text-green-600 flex items-center gap-1">
                    <DollarSign className="w-3 h-3" />
                    ~{formatCost(estimatedCost)} est.
                  </span>
                </>
              ) : (
                <span>Select pages to process</span>
              )}
            </div> */}
            <button
              onClick={runBatchProcess}
              disabled={selectedCount === 0 || !!currentJob}
              className="flex items-center gap-2 px-5 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium shadow-sm"
              title={currentJob ? 'Another job is already running for this book' : ''}
            >
              <Play className="w-4 h-4" />
              Start Process
            </button>
          </div>
        </div>
      )}

      {/* Reorder Mode Info */}
      {reorderMode && (
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
          <div className="flex items-center gap-3">
            <GripVertical className="w-5 h-5 text-blue-600" />
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-800">Drag pages to reorder them</p>
              <p className="text-xs text-blue-600">Click and drag any page to move it to a new position</p>
            </div>
            {orderChanged && (
              <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">Unsaved changes</span>
            )}
          </div>
        </div>
      )}

      {/* Pages Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-stone-900">Pages</h2>
          <span className="text-sm text-stone-500">
            Showing {Math.min(visibleCount, pages.length)} of {pages.length}
          </span>
        </div>

        {pages.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-stone-200">
            <FileText className="w-12 h-12 text-stone-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-stone-600">No pages yet</h3>
            <p className="text-stone-400 text-sm mt-1">Upload pages to start processing</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-2">
            {pages.slice(0, visibleCount).map((page, index) => {
              const isSelected = selectedPages.has(page.id);
              const imageUrl = getImageUrl(page);
              // Check updated_at since data is excluded from projection for performance
              const hasOcr = !!page.ocr?.updated_at;
              const hasTranslation = !!page.translation?.updated_at;
              const hasSummary = !!page.summary?.updated_at;

              // Reorder mode - draggable pages
              if (reorderMode) {
                const isDragging = draggedPageId === page.id;
                const isDragOver = dragOverPageId === page.id;

                return (
                  <div
                    key={page.id}
                    draggable
                    onDragStart={() => handleDragStart(page.id)}
                    onDragOver={(e) => handleDragOver(e, page.id)}
                    onDragEnd={handleDragEnd}
                    className={`group relative cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-50' : ''}`}
                  >
                    <div className={`aspect-[3/4] bg-white rounded-lg overflow-hidden transition-all border-2 ${isDragOver ? 'border-blue-500 shadow-lg scale-105' : 'border-stone-200 hover:border-blue-300'
                      }`}>
                      {imageUrl && (
                        <img src={imageUrl} alt={`Page ${page.page_number}`} className="w-full h-full object-cover pointer-events-none" />
                      )}
                      {/* Drag handle indicator */}
                      <div className="absolute top-1 left-1 p-1 bg-black/60 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity">
                        <GripVertical className="w-3 h-3" />
                      </div>
                      <div className="absolute bottom-0.5 right-0.5 flex gap-0.5">
                        {hasOcr && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                        {hasTranslation && <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                        {hasSummary && <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />}
                      </div>
                    </div>
                    <div className="text-center text-[10px] text-stone-400 mt-0.5">{page.page_number}</div>
                  </div>
                );
              }

              if (batchMode) {
                return (
                  <button
                    key={page.id}
                    onClick={(e) => togglePage(page.id, index, e)}
                    className="group relative text-left"
                  >
                    <div className={`aspect-[3/4] bg-white rounded-lg overflow-hidden transition-all border-2 ${isSelected ? 'border-amber-500 shadow-md' : 'border-stone-200 hover:border-stone-300'
                      }`}>
                      {imageUrl && (
                        <img src={imageUrl} alt={`Page ${page.page_number}`} className="w-full h-full object-cover" />
                      )}
                      {isSelected && (
                        <div className="absolute inset-0 bg-amber-500/20 flex items-center justify-center">
                          <CheckCircle2 className="w-6 h-6 text-amber-600 drop-shadow" />
                        </div>
                      )}
                      <div className="absolute bottom-0.5 right-0.5 flex gap-0.5">
                        {hasOcr && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                        {hasTranslation && <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                        {hasSummary && <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />}
                      </div>
                    </div>
                    <div className="text-center text-[10px] text-stone-400 mt-0.5">{page.page_number}</div>
                  </button>
                );
              }

              return (
                <div key={page.id} className="group relative">
                  <a href={`/book/${bookId}/page/${page.id}`}>
                    <div className="aspect-[3/4] bg-white border border-stone-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow">
                      {imageUrl && (
                        <img
                          src={imageUrl}
                          alt={`Page ${page.page_number}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                      )}
                      <div className="absolute bottom-0.5 right-0.5 flex gap-0.5">
                        {hasOcr && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" title="OCR" />}
                        {hasTranslation && <div className="w-1.5 h-1.5 rounded-full bg-green-500" title="Translated" />}
                        {hasSummary && <div className="w-1.5 h-1.5 rounded-full bg-purple-500" title="Summarized" />}
                      </div>
                    </div>
                  </a>
                  {/* Set as Cover button */}
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setCoverImage(page);
                    }}
                    disabled={settingCover === page.id}
                    className="absolute top-1 right-1 p-1 bg-black/60 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80 disabled:opacity-50"
                    title="Set as cover image"
                  >
                    {settingCover === page.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <ImageIcon className="w-3 h-3" />
                    )}
                  </button>
                  <div className="text-center text-[10px] text-stone-400 mt-0.5">{page.page_number}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Load More - auto-loads when scrolled into view */}
        {visibleCount < pages.length && (
          <div ref={loadMoreRef} className="mt-6 text-center">
            <button
              onClick={() => setVisibleCount(prev => Math.min(prev + PAGES_PER_LOAD, pages.length))}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 hover:border-stone-400 transition-colors text-sm font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Load more ({pages.length - visibleCount} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
