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
  AlertCircle
} from 'lucide-react';
import DownloadButton from './DownloadButton';
import { GEMINI_MODELS, DEFAULT_MODEL } from '@/lib/types';
import { MODEL_PRICING } from '@/lib/ai';
import type { Page, Prompt } from '@/lib/types';

interface BookPagesSectionProps {
  bookId: string;
  bookTitle?: string;
  pages: Page[];
}

type ActionType = 'ocr' | 'translation' | 'summary';
type JobType = 'batch_ocr' | 'batch_translate' | 'batch_summary';

const actionToJobType: Record<ActionType, JobType> = {
  ocr: 'batch_ocr',
  translation: 'batch_translate',
  summary: 'batch_summary',
};

// Retry settings
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const FETCH_TIMEOUT = 120000; // 2 minutes per page

// Fetch with timeout helper
async function fetchWithTimeout(url: string, options: RequestInit, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Sleep helper
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface ProcessingState {
  active: boolean;
  type: ActionType | null;
  currentIndex: number;
  totalPages: number;
  completed: string[];
  failed: string[];
  totalCost: number;
  totalTokens: number;
}

// Estimated token usage per action
const ESTIMATED_TOKENS = {
  ocr: { input: 1500, output: 800 },        // Image (~1000) + prompt (~500), output ~800
  translation: { input: 1000, output: 1000 }, // Input text + prompt, similar output
  summary: { input: 800, output: 200 },      // Shorter input/output
};

// Calculate cost per page based on model
function getEstimatedCost(action: 'ocr' | 'translation' | 'summary', model: string): number {
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

export default function BookPagesSection({ bookId, bookTitle, pages }: BookPagesSectionProps) {
  const router = useRouter();
  const [batchMode, setBatchMode] = useState(false);
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<ActionType>('ocr');
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [concurrency, setConcurrency] = useState(5); // Parallel requests
  const [showPromptSettings, setShowPromptSettings] = useState(false);

  // Prompt library state
  const [prompts, setPrompts] = useState<Record<ActionType, Prompt[]>>({
    ocr: [],
    translation: [],
    summary: []
  });
  const [selectedPromptIds, setSelectedPromptIds] = useState<Record<ActionType, string>>({
    ocr: '',
    translation: '',
    summary: ''
  });
  const [editedPrompts, setEditedPrompts] = useState<Record<ActionType, string>>({
    ocr: '',
    translation: '',
    summary: ''
  });
  const [promptsLoading, setPromptsLoading] = useState(true);

  const [processing, setProcessing] = useState<ProcessingState>({
    active: false,
    type: null,
    currentIndex: 0,
    totalPages: 0,
    completed: [],
    failed: [],
    totalCost: 0,
    totalTokens: 0,
  });
  const stopRequestedRef = useRef(false);
  const lastSelectedIndexRef = useRef<number | null>(null);

  // Calculate stats
  const pagesWithOcr = pages.filter(p => p.ocr?.data).length;
  const pagesWithTranslation = pages.filter(p => p.translation?.data).length;
  const pagesWithSummary = pages.filter(p => p.summary?.data).length;
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

  // Fetch prompts
  useEffect(() => {
    const fetchPrompts = async () => {
      setPromptsLoading(true);
      try {
        const [ocrRes, transRes, sumRes] = await Promise.all([
          fetch('/api/prompts?type=ocr'),
          fetch('/api/prompts?type=translation'),
          fetch('/api/prompts?type=summary')
        ]);

        const loadPrompts = async (res: Response, type: ActionType) => {
          if (res.ok) {
            const data = await res.json();
            const defaultPrompt = data.find((p: Prompt) => p.is_default) || data[0];
            setPrompts(prev => ({ ...prev, [type]: data }));
            if (defaultPrompt) {
              setSelectedPromptIds(prev => ({ ...prev, [type]: defaultPrompt.id || defaultPrompt._id?.toString() || '' }));
              setEditedPrompts(prev => ({ ...prev, [type]: defaultPrompt.content }));
            }
          }
        };

        await Promise.all([
          loadPrompts(ocrRes, 'ocr'),
          loadPrompts(transRes, 'translation'),
          loadPrompts(sumRes, 'summary')
        ]);
      } catch (error) {
        console.error('Error fetching prompts:', error);
      } finally {
        setPromptsLoading(false);
      }
    };
    fetchPrompts();
  }, []);

  const handleSelectPrompt = (type: ActionType, promptId: string) => {
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

  const runBatchProcess = async () => {
    if (selectedPages.size === 0) return;

    const pageIds = Array.from(selectedPages);
    stopRequestedRef.current = false;
    setProcessing({
      active: true,
      type: action,
      currentIndex: 0,
      totalPages: pageIds.length,
      completed: [],
      failed: [],
      totalCost: 0,
      totalTokens: 0,
    });

    const completed: string[] = [];
    const failed: string[] = [];
    let runningCost = 0;
    let runningTokens = 0;
    let processedCount = 0;

    // Get prompt name for job record
    const currentPrompt = prompts[action].find(
      p => (p.id || p._id?.toString()) === selectedPromptIds[action]
    );

    // Create job record
    let jobId: string | null = null;
    try {
      const jobRes = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: actionToJobType[action],
          book_id: bookId,
          book_title: bookTitle,
          page_ids: pageIds,
          model: selectedModel,
          prompt_name: currentPrompt?.name,
        }),
      });
      if (jobRes.ok) {
        const jobData = await jobRes.json();
        jobId = jobData.job?.id;
        // Mark as processing
        if (jobId) {
          await fetch(`/api/jobs/${jobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'processing' }),
          });
        }
      }
    } catch (error) {
      console.error('Failed to create job record:', error);
    }

    // Helper to update job progress (throttled)
    let lastJobUpdate = 0;
    const updateJobProgress = async () => {
      if (!jobId) return;
      const now = Date.now();
      // Only update every 2 seconds to avoid too many requests
      if (now - lastJobUpdate < 2000) return;
      lastJobUpdate = now;

      try {
        await fetch(`/api/jobs/${jobId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            progress: { completed: completed.length, failed: failed.length },
          }),
        });
      } catch {
        // Ignore progress update errors
      }
    };

    // Process a single page with retry logic
    const processPage = async (pageId: string): Promise<void> => {
      if (stopRequestedRef.current) return;

      const page = pages.find(p => p.id === pageId);
      if (!page) {
        failed.push(pageId);
        return;
      }

      let lastError: Error | null = null;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (stopRequestedRef.current) return;

        try {
          const response = await fetchWithTimeout('/api/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pageId,
              action,
              imageUrl: page.photo,
              language: 'Latin',
              targetLanguage: 'English',
              ocrText: action === 'translation' ? page.ocr?.data : undefined,
              translatedText: action === 'summary' ? page.translation?.data : undefined,
              customPrompts: {
                ocr: editedPrompts.ocr,
                translation: editedPrompts.translation,
                summary: editedPrompts.summary
              },
              autoSave: true,
              model: selectedModel
            })
          }, FETCH_TIMEOUT);

          if (response.ok) {
            const data = await response.json();
            if (data.usage) {
              runningCost += data.usage.costUsd || 0;
              runningTokens += data.usage.totalTokens || 0;
            }
            completed.push(pageId);
            lastError = null;
            break; // Success, exit retry loop
          } else {
            const errorText = await response.text().catch(() => 'Unknown error');
            lastError = new Error(`HTTP ${response.status}: ${errorText}`);
            // Don't retry on 4xx errors (client errors)
            if (response.status >= 400 && response.status < 500) {
              break;
            }
          }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Unknown error');
          console.warn(`Attempt ${attempt + 1}/${MAX_RETRIES} failed for page ${pageId}:`, lastError.message);
        }

        // Wait before retrying (exponential backoff)
        if (attempt < MAX_RETRIES - 1 && lastError) {
          const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
          await sleep(delay);
        }
      }

      if (lastError) {
        console.error(`All ${MAX_RETRIES} attempts failed for page ${pageId}:`, lastError.message);
        failed.push(pageId);
      }

      processedCount++;
      setProcessing(prev => ({
        ...prev,
        currentIndex: processedCount,
        completed: [...completed],
        failed: [...failed],
        totalCost: runningCost,
        totalTokens: runningTokens,
      }));

      // Update job progress
      updateJobProgress();
    };

    // Process in parallel batches with delay between batches
    for (let i = 0; i < pageIds.length; i += concurrency) {
      if (stopRequestedRef.current) break;

      const batch = pageIds.slice(i, Math.min(i + concurrency, pageIds.length));
      await Promise.all(batch.map(processPage));

      // Small delay between batches to avoid rate limiting
      if (i + concurrency < pageIds.length && !stopRequestedRef.current) {
        await sleep(500);
      }
    }

    // Final job update
    if (jobId) {
      try {
        const finalStatus = stopRequestedRef.current
          ? 'cancelled'
          : failed.length === pageIds.length
          ? 'failed'
          : 'completed';

        await fetch(`/api/jobs/${jobId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: finalStatus,
            progress: { completed: completed.length, failed: failed.length },
          }),
        });
      } catch (error) {
        console.error('Failed to update job status:', error);
      }
    }

    setProcessing(prev => ({ ...prev, active: false }));
    if (completed.length > 0) router.refresh();
  };

  const actionConfig = {
    ocr: { label: 'OCR', icon: FileText, color: '#3b82f6' },
    translation: { label: 'Translation', icon: Languages, color: '#22c55e' },
    summary: { label: 'Summary', icon: BookOpen, color: '#a855f7' }
  };

  const selectedCount = selectedPages.size;
  // ~30 seconds per page, divided by concurrency
  const estimatedTimeMinutes = Math.ceil((selectedCount * 0.5) / concurrency);
  const estimatedCost = selectedCount * getEstimatedCost(action, selectedModel);

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

      const res = await fetch(`/api/books/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thumbnail: thumbnailUrl })
      });

      if (res.ok) {
        router.refresh();
      }
    } catch (error) {
      console.error('Error setting cover:', error);
    } finally {
      setSettingCover(null);
    }
  };

  const getImageUrl = (page: Page) => {
    const baseUrl = page.photo_original || page.photo;
    if (!baseUrl) return null;
    if (page.crop?.xStart !== undefined && page.crop?.xEnd !== undefined) {
      return `/api/image?url=${encodeURIComponent(baseUrl)}&w=200&q=70&cx=${page.crop.xStart}&cw=${page.crop.xEnd}`;
    }
    return page.thumbnail || `/api/image?url=${encodeURIComponent(baseUrl)}&w=200&q=70`;
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

          {/* Summary stat */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#faf5ff' }}>
              <BookOpen className="w-5 h-5" style={{ color: '#a855f7' }} />
            </div>
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-semibold text-stone-900">{pagesWithSummary}</span>
                <span className="text-sm text-stone-400">/ {totalPages}</span>
              </div>
              <div className="text-xs text-stone-500">Summarized</div>
            </div>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Actions */}
          <div className="flex items-center gap-2">
            {!batchMode ? (
              <>
                <button
                  onClick={() => setBatchMode(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors text-sm font-medium border border-amber-200"
                >
                  <Wand2 className="w-4 h-4" />
                  Batch Process
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
            ) : (
              <button
                onClick={exitBatchMode}
                className="flex items-center gap-2 px-4 py-2 bg-stone-100 text-stone-600 rounded-lg hover:bg-stone-200 transition-colors text-sm"
              >
                <X className="w-4 h-4" />
                Exit
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Batch Mode Controls */}
      {batchMode && (
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 space-y-4">
          {/* Processing progress */}
          {processing.active && (
            <div className="bg-white rounded-lg p-4 border border-amber-200">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                  <span className="text-sm font-medium text-stone-700">
                    {actionConfig[action].label} · Page {processing.currentIndex} of {processing.totalPages}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  {processing.totalCost > 0 && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <DollarSign className="w-3 h-3" />
                      {formatCost(processing.totalCost)}
                    </span>
                  )}
                  <button
                    onClick={() => { stopRequestedRef.current = true; }}
                    className="text-xs text-stone-500 hover:text-stone-700 flex items-center gap-1"
                  >
                    <Square className="w-3 h-3" /> Stop
                  </button>
                </div>
              </div>
              <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${(processing.currentIndex / processing.totalPages) * 100}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-xs text-stone-500">
                <span>{processing.completed.length} done</span>
                <div className="flex gap-3">
                  {processing.totalTokens > 0 && (
                    <span className="text-stone-400">{(processing.totalTokens / 1000).toFixed(1)}K tokens</span>
                  )}
                  {processing.failed.length > 0 && <span className="text-red-500">{processing.failed.length} failed</span>}
                </div>
              </div>
            </div>
          )}

          {/* Completion message with retry option */}
          {!processing.active && processing.totalPages > 0 && (
            <div className={`rounded-lg p-4 border ${processing.failed.length > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {processing.failed.length > 0 ? (
                    <AlertCircle className="w-5 h-5 text-red-500" />
                  ) : (
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  )}
                  <span className={`text-sm font-medium ${processing.failed.length > 0 ? 'text-red-700' : 'text-green-700'}`}>
                    {processing.failed.length > 0
                      ? `Completed with ${processing.failed.length} failed (${processing.completed.length} succeeded)`
                      : `All ${processing.completed.length} pages processed successfully`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {processing.totalCost > 0 && (
                    <span className="text-xs text-stone-500">
                      Cost: {formatCost(processing.totalCost)}
                    </span>
                  )}
                  {processing.failed.length > 0 && (
                    <button
                      onClick={() => {
                        // Select failed pages and start new batch
                        setSelectedPages(new Set(processing.failed));
                        setProcessing({
                          active: false,
                          type: null,
                          currentIndex: 0,
                          totalPages: 0,
                          completed: [],
                          failed: [],
                          totalCost: 0,
                          totalTokens: 0,
                        });
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-xs font-medium"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Retry {processing.failed.length} Failed
                    </button>
                  )}
                  <button
                    onClick={() => setProcessing({
                      active: false,
                      type: null,
                      currentIndex: 0,
                      totalPages: 0,
                      completed: [],
                      failed: [],
                      totalCost: 0,
                      totalTokens: 0,
                    })}
                    className="text-xs text-stone-500 hover:text-stone-700"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Action selector & Selection controls */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-stone-600">Action:</span>
              <div className="flex rounded-lg border border-amber-300 overflow-hidden bg-white">
                {(['ocr', 'translation', 'summary'] as ActionType[]).map(type => {
                  const { label, icon: Icon, color } = actionConfig[type];
                  const isSelected = action === type;
                  return (
                    <button
                      key={type}
                      onClick={() => setAction(type)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                        isSelected ? 'text-white' : 'text-stone-600 hover:bg-stone-50'
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

            {/* Model selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-stone-600">Model:</span>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="px-2 py-1.5 text-sm bg-white border border-amber-300 rounded-lg text-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                {GEMINI_MODELS.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Concurrency selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-stone-600">Parallel:</span>
              <select
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                className="px-2 py-1.5 text-sm bg-white border border-amber-300 rounded-lg text-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value={1}>1x (sequential)</option>
                <option value={3}>3x</option>
                <option value={5}>5x</option>
                <option value={10}>10x</option>
                <option value={15}>15x (max free)</option>
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                showPromptSettings ? 'bg-amber-200 text-amber-800' : 'bg-white text-stone-600 hover:bg-amber-100'
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
            <div className="flex items-center gap-3 text-sm text-stone-500">
              {selectedCount > 0 ? (
                <>
                  <span>~{estimatedTimeMinutes} min for {selectedCount} pages</span>
                  <span className="text-stone-300">·</span>
                  <span className="text-green-600 flex items-center gap-1">
                    <DollarSign className="w-3 h-3" />
                    ~{formatCost(estimatedCost)} est.
                  </span>
                </>
              ) : (
                <span>Select pages to process</span>
              )}
            </div>
            <button
              onClick={runBatchProcess}
              disabled={selectedCount === 0 || processing.active}
              className="flex items-center gap-2 px-5 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium shadow-sm"
            >
              <Play className="w-4 h-4" />
              Run {actionConfig[action].label}
            </button>
          </div>
        </div>
      )}

      {/* Pages Grid */}
      <div>
        <h2 className="text-lg font-semibold text-stone-900 mb-4">Pages</h2>

        {pages.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-stone-200">
            <FileText className="w-12 h-12 text-stone-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-stone-600">No pages yet</h3>
            <p className="text-stone-400 text-sm mt-1">Upload pages to start processing</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-2">
            {pages.map((page, index) => {
              const isSelected = selectedPages.has(page.id);
              const imageUrl = getImageUrl(page);
              const hasOcr = !!page.ocr?.data;
              const hasTranslation = !!page.translation?.data;
              const hasSummary = !!page.summary?.data;

              if (batchMode) {
                return (
                  <button
                    key={page.id}
                    onClick={(e) => togglePage(page.id, index, e)}
                    className="group relative text-left"
                  >
                    <div className={`aspect-[3/4] bg-white rounded-lg overflow-hidden transition-all border-2 ${
                      isSelected ? 'border-amber-500 shadow-md' : 'border-stone-200 hover:border-stone-300'
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
      </div>
    </div>
  );
}
