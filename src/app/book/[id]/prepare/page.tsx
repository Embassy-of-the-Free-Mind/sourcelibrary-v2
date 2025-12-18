'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Scissors,
  Trash2,
  RotateCcw,
  Check,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  Wand2,
  RefreshCw,
  GripVertical,
  Settings,
  FileText,
  Languages,
  BookOpen,
  Play,
  Square,
  CheckCircle2,
  Circle,
  AlertCircle
} from 'lucide-react';
import type { Book, Page, Prompt } from '@/lib/types';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface SplitDetection {
  isTwoPageSpread: boolean;
  confidence: string;
  reasoning?: string;
  leftPage?: { xmin: number; xmax: number; ymin: number; ymax: number };
  rightPage?: { xmin: number; xmax: number; ymin: number; ymax: number };
}

interface ProcessingState {
  active: boolean;
  type: 'ocr' | 'translation' | 'summary' | null;
  currentPageId: string | null;
  currentIndex: number;
  totalPages: number;
  completed: string[];
  failed: string[];
  stopped: boolean;
}

export default function PreparePage({ params }: PageProps) {
  const [bookId, setBookId] = useState<string>('');
  const [book, setBook] = useState<Book | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState<string | null>(null);
  const [detectionResults, setDetectionResults] = useState<Record<string, SplitDetection>>({});
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  const [pagesToSplit, setPagesToSplit] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [dragOverPageId, setDragOverPageId] = useState<string | null>(null);

  // Processing state
  const [processing, setProcessing] = useState<ProcessingState>({
    active: false,
    type: null,
    currentPageId: null,
    currentIndex: 0,
    totalPages: 0,
    completed: [],
    failed: [],
    stopped: false
  });
  const stopProcessingRef = useRef(false);

  // Prompt settings
  const [showPromptSettings, setShowPromptSettings] = useState(false);
  const [prompts, setPrompts] = useState<{ ocr: Prompt | null; translation: Prompt | null; summary: Prompt | null }>({
    ocr: null, translation: null, summary: null
  });

  // Fullscreen image viewer
  const [fullscreenImage, setFullscreenImage] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    params.then(({ id }) => setBookId(id));
  }, [params]);

  const fetchBook = useCallback(async () => {
    if (!bookId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/books/${bookId}`);
      if (res.ok) {
        const data = await res.json();
        setBook(data);
        setPages(data.pages || []);

        const results: Record<string, SplitDetection> = {};
        for (const page of data.pages || []) {
          if (page.split_detection) {
            results[page.id] = page.split_detection;
          }
        }
        setDetectionResults(results);
      }
    } catch (error) {
      console.error('Error fetching book:', error);
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    fetchBook();
  }, [fetchBook]);

  // Fetch default prompts
  useEffect(() => {
    const fetchPrompts = async () => {
      try {
        const [ocrRes, transRes, sumRes] = await Promise.all([
          fetch('/api/prompts?type=ocr'),
          fetch('/api/prompts?type=translation'),
          fetch('/api/prompts?type=summary')
        ]);

        if (ocrRes.ok) {
          const ocrPrompts = await ocrRes.json();
          setPrompts(prev => ({ ...prev, ocr: ocrPrompts.find((p: Prompt) => p.is_default) || ocrPrompts[0] }));
        }
        if (transRes.ok) {
          const transPrompts = await transRes.json();
          setPrompts(prev => ({ ...prev, translation: transPrompts.find((p: Prompt) => p.is_default) || transPrompts[0] }));
        }
        if (sumRes.ok) {
          const sumPrompts = await sumRes.json();
          setPrompts(prev => ({ ...prev, summary: sumPrompts.find((p: Prompt) => p.is_default) || sumPrompts[0] }));
        }
      } catch (error) {
        console.error('Error fetching prompts:', error);
      }
    };
    fetchPrompts();
  }, []);

  // Stats
  const pagesWithOcr = pages.filter(p => p.ocr?.data);
  const pagesWithTranslation = pages.filter(p => p.translation?.data);
  const pagesWithSummary = pages.filter(p => p.summary?.data);
  const pagesNeedingOcr = pages.filter(p => !p.ocr?.data);
  const pagesNeedingTranslation = pages.filter(p => p.ocr?.data && !p.translation?.data);
  const pagesNeedingSummary = pages.filter(p => p.translation?.data && !p.summary?.data);
  const pagesWithSplits = pages.filter(p => detectionResults[p.id]?.isTwoPageSpread);

  const togglePageSelection = (pageId: string) => {
    setSelectedPages(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedPages(new Set(pages.map(p => p.id)));
  };

  const clearSelection = () => {
    setSelectedPages(new Set());
  };

  const toggleExpanded = (pageId: string) => {
    setExpandedPages(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  };

  const toggleSplitMark = (pageId: string) => {
    setPagesToSplit(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  };

  const deletePage = async (pageId: string) => {
    if (!confirm('Delete this page? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/pages/${pageId}`, { method: 'DELETE' });
      if (res.ok) {
        setPages(prev => prev.filter(p => p.id !== pageId));
        setSelectedPages(prev => {
          const next = new Set(prev);
          next.delete(pageId);
          return next;
        });
      }
    } catch (error) {
      console.error('Delete error:', error);
    }
  };

  // Batch processing
  const processPages = async (
    type: 'ocr' | 'translation' | 'summary',
    pageIds: string[]
  ) => {
    if (pageIds.length === 0) return;

    stopProcessingRef.current = false;
    setProcessing({
      active: true,
      type,
      currentPageId: null,
      currentIndex: 0,
      totalPages: pageIds.length,
      completed: [],
      failed: [],
      stopped: false
    });

    const completed: string[] = [];
    const failed: string[] = [];

    for (let i = 0; i < pageIds.length; i++) {
      if (stopProcessingRef.current) {
        setProcessing(prev => ({ ...prev, stopped: true }));
        break;
      }

      const pageId = pageIds[i];
      const page = pages.find(p => p.id === pageId);
      if (!page) continue;

      setProcessing(prev => ({
        ...prev,
        currentPageId: pageId,
        currentIndex: i + 1
      }));

      try {
        // Get previous page for context
        const pageIndex = pages.findIndex(p => p.id === pageId);
        const previousPage = pageIndex > 0 ? pages[pageIndex - 1] : null;

        const response = await fetch('/api/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageId,
            action: type,
            imageUrl: page.photo,
            language: book?.language || 'Latin',
            targetLanguage: 'English',
            ocrText: type === 'translation' ? page.ocr?.data : undefined,
            translatedText: type === 'summary' ? page.translation?.data : undefined,
            previousPageId: previousPage?.id,
            customPrompts: {
              ocr: prompts.ocr?.content,
              translation: prompts.translation?.content,
              summary: prompts.summary?.content
            },
            autoSave: true
          })
        });

        if (response.ok) {
          const result = await response.json();
          // Update local page data
          setPages(prev => prev.map(p => {
            if (p.id !== pageId) return p;
            const updated: Page = { ...p };
            if (result.ocr) {
              updated.ocr = {
                data: result.ocr,
                language: p.ocr?.language || book?.language || 'unknown',
                model: p.ocr?.model || 'gemini-2.0-flash'
              };
            }
            if (result.translation) {
              updated.translation = {
                data: result.translation,
                language: p.translation?.language || 'English',
                model: p.translation?.model || 'gemini-2.0-flash'
              };
            }
            if (result.summary) {
              updated.summary = {
                data: result.summary,
                model: p.summary?.model || 'gemini-2.0-flash'
              };
            }
            return updated;
          }));
          completed.push(pageId);
        } else {
          failed.push(pageId);
        }
      } catch (error) {
        console.error(`Processing error for page ${pageId}:`, error);
        failed.push(pageId);
      }

      setProcessing(prev => ({
        ...prev,
        completed: [...completed],
        failed: [...failed]
      }));

      // Rate limiting delay
      if (i < pageIds.length - 1 && !stopProcessingRef.current) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    setProcessing(prev => ({
      ...prev,
      active: false,
      currentPageId: null
    }));
  };

  const stopProcessing = () => {
    stopProcessingRef.current = true;
  };

  const runOcrOnSelected = () => {
    const ids = Array.from(selectedPages);
    processPages('ocr', ids);
  };

  const runOcrOnAll = () => {
    const ids = pagesNeedingOcr.map(p => p.id);
    processPages('ocr', ids);
  };

  const runTranslationOnSelected = () => {
    const ids = Array.from(selectedPages).filter(id => {
      const page = pages.find(p => p.id === id);
      return page?.ocr?.data;
    });
    processPages('translation', ids);
  };

  const runTranslationOnAll = () => {
    const ids = pagesNeedingTranslation.map(p => p.id);
    processPages('translation', ids);
  };

  const runSummaryOnSelected = () => {
    const ids = Array.from(selectedPages).filter(id => {
      const page = pages.find(p => p.id === id);
      return page?.translation?.data;
    });
    processPages('summary', ids);
  };

  const runSummaryOnAll = () => {
    const ids = pagesNeedingSummary.map(p => p.id);
    processPages('summary', ids);
  };

  // Split detection
  const detectSplit = async (pageId: string) => {
    const page = pages.find(p => p.id === pageId);
    if (!page) return;

    setDetecting(pageId);
    try {
      const res = await fetch(`/api/pages/${pageId}/detect-split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: page.photo })
      });

      if (res.ok) {
        const result = await res.json();
        setDetectionResults(prev => ({ ...prev, [pageId]: result }));
      }
    } catch (error) {
      console.error('Detection error:', error);
    } finally {
      setDetecting(null);
    }
  };

  const applyMarkedSplits = async () => {
    if (pagesToSplit.size === 0) return;

    setApplying(true);
    try {
      for (const pageId of pagesToSplit) {
        // For manual splits, split at 50% (middle of page)
        const manualDetection = {
          isTwoPageSpread: true,
          confidence: 'manual',
          leftPage: { xmin: 0, xmax: 500, ymin: 0, ymax: 1000 },
          rightPage: { xmin: 500, xmax: 1000, ymin: 0, ymax: 1000 }
        };
        await fetch(`/api/pages/${pageId}/split`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ detection: manualDetection })
        });
      }
      await fetchBook();
      setSelectedPages(new Set());
      setPagesToSplit(new Set());
    } catch (error) {
      console.error('Apply error:', error);
    } finally {
      setApplying(false);
    }
  };

  const resetBook = async () => {
    if (!confirm('Reset all pages to original state? This will delete all splits and clear detection results.')) return;

    setApplying(true);
    try {
      await fetch(`/api/books/${bookId}/reset`, { method: 'POST' });
      await fetchBook();
      setDetectionResults({});
      setSelectedPages(new Set());
      setPagesToSplit(new Set());
    } catch (error) {
      console.error('Reset error:', error);
    } finally {
      setApplying(false);
    }
  };

  // Drag and drop
  const handleDragStart = (pageId: string) => setDraggedPageId(pageId);
  const handleDragEnd = () => { setDraggedPageId(null); setDragOverPageId(null); };
  const handleDragOver = (e: React.DragEvent, pageId: string) => {
    e.preventDefault();
    if (draggedPageId && draggedPageId !== pageId) setDragOverPageId(pageId);
  };
  const handleDragLeave = () => setDragOverPageId(null);

  const handleDrop = async (e: React.DragEvent, targetPageId: string) => {
    e.preventDefault();
    if (!draggedPageId || draggedPageId === targetPageId) {
      setDraggedPageId(null);
      setDragOverPageId(null);
      return;
    }

    const draggedIndex = pages.findIndex(p => p.id === draggedPageId);
    const targetIndex = pages.findIndex(p => p.id === targetPageId);
    if (draggedIndex === -1 || targetIndex === -1) return;

    const newPages = [...pages];
    const [draggedPage] = newPages.splice(draggedIndex, 1);
    newPages.splice(targetIndex, 0, draggedPage);

    setPages(newPages);
    setDraggedPageId(null);
    setDragOverPageId(null);

    try {
      await fetch(`/api/books/${bookId}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageOrder: newPages.map(p => p.id) })
      });
    } catch (error) {
      console.error('Reorder error:', error);
      await fetchBook();
    }
  };

  // Get image URL with crop support
  const getImageUrl = (page: Page) => {
    if (page.crop?.xStart !== undefined && page.crop?.xEnd !== undefined) {
      return `/api/image?url=${encodeURIComponent(page.photo_original || page.photo)}&w=300&q=70&cx=${page.crop.xStart}&cw=${page.crop.xEnd}`;
    }
    return page.thumbnail || `/api/image?url=${encodeURIComponent(page.photo)}&w=300&q=70`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  if (!book) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <p>Book not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href={`/book/${bookId}`} className="text-stone-600 hover:text-stone-900">
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-lg font-semibold text-stone-900">Prepare & Process</h1>
                <p className="text-sm text-stone-500">{book.display_title || book.title}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowPromptSettings(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg"
              >
                <Settings className="w-4 h-4" />
                Prompts
              </button>
              <button
                onClick={resetBook}
                disabled={applying}
                className="flex items-center gap-2 px-3 py-2 text-sm text-stone-600 hover:text-red-600 hover:bg-red-50 rounded-lg"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Progress Stats */}
        <div className="border-t border-stone-100 bg-stone-50/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex items-center gap-8 text-sm">
              <span className="text-stone-600">
                <strong>{pages.length}</strong> pages
              </span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <div className={`w-2 h-2 rounded-full ${pagesWithOcr.length === pages.length ? 'bg-green-500' : pagesWithOcr.length > 0 ? 'bg-amber-500' : 'bg-stone-300'}`} />
                  <span className="text-stone-600"><strong>{pagesWithOcr.length}</strong> OCR</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className={`w-2 h-2 rounded-full ${pagesWithTranslation.length === pages.length ? 'bg-green-500' : pagesWithTranslation.length > 0 ? 'bg-amber-500' : 'bg-stone-300'}`} />
                  <span className="text-stone-600"><strong>{pagesWithTranslation.length}</strong> translated</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className={`w-2 h-2 rounded-full ${pagesWithSummary.length === pages.length ? 'bg-green-500' : pagesWithSummary.length > 0 ? 'bg-amber-500' : 'bg-stone-300'}`} />
                  <span className="text-stone-600"><strong>{pagesWithSummary.length}</strong> summarized</span>
                </div>
              </div>
              {pagesWithSplits.length > 0 && (
                <span className="text-purple-600">
                  <strong>{pagesWithSplits.length}</strong> spreads detected
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Action Bar */}
      <div className="bg-white border-b border-stone-200 sticky top-[105px] z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between">
            {/* Left side - info and split action */}
            <div className="flex items-center gap-4">
              {pagesToSplit.size > 0 ? (
                <>
                  <span className="text-sm font-medium text-amber-600">
                    {pagesToSplit.size} marked for split
                  </span>
                  <button
                    onClick={() => setPagesToSplit(new Set())}
                    className="text-sm text-stone-500 hover:text-stone-700"
                  >
                    Clear
                  </button>
                  <button
                    onClick={applyMarkedSplits}
                    disabled={applying}
                    className="flex items-center gap-2 px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                  >
                    {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                    Apply Splits
                  </button>
                </>
              ) : (
                <span className="text-sm text-stone-500">
                  Click thumbnails to mark pages for splitting
                </span>
              )}
            </div>

            {/* Right side - process actions (only when pages selected via checkbox) */}
            <div className="flex items-center gap-2">
              {selectedPages.size > 0 ? (
                <>
                  <span className="text-sm text-stone-500 mr-2">{selectedPages.size} selected</span>
                  <button
                    onClick={runOcrOnSelected}
                    disabled={processing.active}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    <FileText className="w-4 h-4" />
                    OCR
                  </button>
                  <button
                    onClick={runTranslationOnSelected}
                    disabled={processing.active}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    <Languages className="w-4 h-4" />
                    Translate
                  </button>
                  <button
                    onClick={runSummaryOnSelected}
                    disabled={processing.active}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  >
                    <BookOpen className="w-4 h-4" />
                    Summarize
                  </button>
                  <button onClick={clearSelection} className="text-sm text-stone-500 hover:text-stone-700 ml-2">
                    Clear
                  </button>
                </>
              ) : (
                /* Batch buttons - less prominent */
                <div className="flex items-center gap-2 text-sm">
                  {pagesNeedingOcr.length > 0 && (
                    <button
                      onClick={runOcrOnAll}
                      disabled={processing.active}
                      className="text-blue-600 hover:text-blue-800 hover:underline disabled:opacity-50"
                    >
                      OCR {pagesNeedingOcr.length} pages
                    </button>
                  )}
                  {pagesNeedingTranslation.length > 0 && (
                    <>
                      <span className="text-stone-300">|</span>
                      <button
                        onClick={runTranslationOnAll}
                        disabled={processing.active}
                        className="text-green-600 hover:text-green-800 hover:underline disabled:opacity-50"
                      >
                        Translate {pagesNeedingTranslation.length}
                      </button>
                    </>
                  )}
                  {pagesNeedingSummary.length > 0 && (
                    <>
                      <span className="text-stone-300">|</span>
                      <button
                        onClick={runSummaryOnAll}
                        disabled={processing.active}
                        className="text-purple-600 hover:text-purple-800 hover:underline disabled:opacity-50"
                      >
                        Summarize {pagesNeedingSummary.length}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Processing Overlay */}
      {processing.active && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full mx-4">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-stone-900 mb-2">
                {processing.type === 'ocr' ? 'Running OCR' :
                 processing.type === 'translation' ? 'Translating' : 'Summarizing'}
              </h3>

              {/* Progress bar */}
              <div className="w-full bg-stone-200 rounded-full h-2 mb-4">
                <div
                  className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(processing.currentIndex / processing.totalPages) * 100}%` }}
                />
              </div>

              <p className="text-sm text-stone-600 mb-4">
                Page {processing.currentIndex} of {processing.totalPages}
              </p>

              {/* Current page thumbnail */}
              {processing.currentPageId && (
                <div className="w-32 h-24 mx-auto mb-4 bg-stone-100 rounded overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getImageUrl(pages.find(p => p.id === processing.currentPageId)!)}
                    alt="Current page"
                    className="w-full h-full object-contain"
                  />
                </div>
              )}

              {processing.failed.length > 0 && (
                <p className="text-sm text-red-600 mb-4">
                  {processing.failed.length} failed
                </p>
              )}

              <button
                onClick={stopProcessing}
                className="flex items-center gap-2 px-4 py-2 mx-auto text-sm bg-stone-100 text-stone-700 rounded-lg hover:bg-stone-200"
              >
                <Square className="w-4 h-4" />
                Stop
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prompt Settings Panel */}
      {showPromptSettings && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-stone-200">
              <h2 className="text-lg font-semibold text-stone-900">Prompt Settings</h2>
              <button onClick={() => setShowPromptSettings(false)} className="text-stone-400 hover:text-stone-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto max-h-[60vh]">
              <p className="text-sm text-stone-600 mb-4">
                These prompts will be used for batch processing. Select a prompt template or edit the content.
              </p>

              {['ocr', 'translation', 'summary'].map((type) => (
                <div key={type} className="border border-stone-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-stone-700 capitalize">{type} Prompt</label>
                    <span className="text-xs text-stone-400">
                      {prompts[type as keyof typeof prompts]?.name || 'Default'}
                    </span>
                  </div>
                  <textarea
                    value={prompts[type as keyof typeof prompts]?.content || ''}
                    onChange={(e) => setPrompts(prev => ({
                      ...prev,
                      [type]: { ...prev[type as keyof typeof prompts], content: e.target.value }
                    }))}
                    className="w-full h-32 p-2 text-sm border border-stone-200 rounded-lg resize-none font-mono"
                    placeholder={`Enter ${type} prompt...`}
                  />
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-stone-200">
              <button
                onClick={() => setShowPromptSettings(false)}
                className="w-full px-4 py-2 bg-stone-800 text-white rounded-lg hover:bg-stone-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pages List */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="space-y-2">
          {pages.map((page, index) => {
            const detection = detectionResults[page.id];
            const isSelected = selectedPages.has(page.id);
            const isExpanded = expandedPages.has(page.id);
            const isDetecting = detecting === page.id;
            const isDragging = draggedPageId === page.id;
            const isDragOver = dragOverPageId === page.id;
            const isSplitPage = !!page.split_from;
            const isProcessing = processing.currentPageId === page.id;
            const markedForSplit = pagesToSplit.has(page.id);

            const hasOcr = !!page.ocr?.data;
            const hasTranslation = !!page.translation?.data;
            const hasSummary = !!page.summary?.data;

            return (
              <div
                key={page.id}
                draggable
                onDragStart={() => handleDragStart(page.id)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, page.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, page.id)}
                className={`bg-white rounded-lg border transition-all ${
                  isDragging ? 'opacity-50 scale-[0.98]' :
                  isDragOver ? 'border-amber-400 ring-2 ring-amber-200' :
                  isSelected ? 'border-amber-400 ring-1 ring-amber-200' :
                  isProcessing ? 'border-blue-400 ring-1 ring-blue-200' :
                  'border-stone-200 hover:border-stone-300'
                }`}
              >
                {/* Main row */}
                <div className="flex items-center gap-2 p-2">
                  {/* Drag handle */}
                  <div className="cursor-grab active:cursor-grabbing text-stone-300 hover:text-stone-500 px-1">
                    <GripVertical className="w-4 h-4" />
                  </div>

                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => togglePageSelection(page.id)}
                    className="w-4 h-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                  />

                  {/* Thumbnail - click to mark for split, double-click to enlarge */}
                  <button
                    onClick={() => {
                      if (!isSplitPage) {
                        toggleSplitMark(page.id);
                      }
                    }}
                    onDoubleClick={() => {
                      // Use medium res for quick preview (not full res)
                      const previewUrl = page.crop?.xStart !== undefined
                        ? `/api/image?url=${encodeURIComponent(page.photo_original || page.photo)}&w=600&q=75&cx=${page.crop.xStart}&cw=${page.crop.xEnd}`
                        : `/api/image?url=${encodeURIComponent(page.photo_original || page.photo)}&w=600&q=75`;
                      setFullscreenImage({ src: previewUrl, alt: `Page ${index + 1}` });
                    }}
                    className={`w-16 h-12 rounded overflow-hidden flex-shrink-0 transition-all ${
                      markedForSplit
                        ? 'ring-2 ring-amber-500 bg-amber-100'
                        : isSplitPage
                          ? 'bg-purple-100'
                          : 'bg-stone-100 hover:ring-2 hover:ring-stone-300'
                    } ${!isSplitPage ? 'cursor-pointer' : ''}`}
                    title={isSplitPage ? 'Already split' : markedForSplit ? 'Click to unmark' : 'Click to mark for split'}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getImageUrl(page)}
                      alt={`Page ${index + 1}`}
                      className="w-full h-full object-contain pointer-events-none"
                      loading="lazy"
                    />
                  </button>

                  {/* Page info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${isSplitPage ? 'text-purple-600' : 'text-stone-700'}`}>
                        Page {index + 1}
                      </span>
                      {isSplitPage && (
                        <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
                          split
                        </span>
                      )}
                      {markedForSplit && (
                        <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">
                          ✂️ to split
                        </span>
                      )}
                      {isProcessing && (
                        <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                      )}
                    </div>
                  </div>

                  {/* Status indicators */}
                  <div className="flex items-center gap-1">
                    <div title={hasOcr ? 'OCR complete' : 'Needs OCR'}>
                      {hasOcr ? (
                        <CheckCircle2 className="w-4 h-4 text-blue-500" />
                      ) : (
                        <Circle className="w-4 h-4 text-stone-300" />
                      )}
                    </div>
                    <div title={hasTranslation ? 'Translated' : 'Needs translation'}>
                      {hasTranslation ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <Circle className="w-4 h-4 text-stone-300" />
                      )}
                    </div>
                    <div title={hasSummary ? 'Summarized' : 'Needs summary'}>
                      {hasSummary ? (
                        <CheckCircle2 className="w-4 h-4 text-purple-500" />
                      ) : (
                        <Circle className="w-4 h-4 text-stone-300" />
                      )}
                    </div>
                  </div>

                  {/* Expand button */}
                  <button
                    onClick={() => toggleExpanded(page.id)}
                    className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded"
                    title={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    {!isSplitPage && (
                      <button
                        onClick={() => detectSplit(page.id)}
                        disabled={isDetecting}
                        className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded"
                        title="Detect split"
                      >
                        <Wand2 className={`w-4 h-4 ${isDetecting ? 'animate-pulse' : ''}`} />
                      </button>
                    )}
                    <button
                      onClick={() => deletePage(page.id)}
                      className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded"
                      title="Delete page"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-stone-100 p-4 bg-stone-50/50">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* OCR */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-stone-500 uppercase">OCR</span>
                          <button
                            onClick={() => processPages('ocr', [page.id])}
                            disabled={processing.active}
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            {hasOcr ? 'Re-run' : 'Run'}
                          </button>
                        </div>
                        <div className="bg-white border border-stone-200 rounded p-2 h-32 overflow-y-auto text-xs text-stone-600">
                          {page.ocr?.data || <span className="text-stone-400 italic">No OCR yet</span>}
                        </div>
                      </div>

                      {/* Translation */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-stone-500 uppercase">Translation</span>
                          <button
                            onClick={() => processPages('translation', [page.id])}
                            disabled={processing.active || !hasOcr}
                            className="text-xs text-green-600 hover:text-green-700 disabled:text-stone-400"
                          >
                            {hasTranslation ? 'Re-run' : 'Run'}
                          </button>
                        </div>
                        <div className="bg-white border border-stone-200 rounded p-2 h-32 overflow-y-auto text-xs text-stone-600">
                          {page.translation?.data || <span className="text-stone-400 italic">No translation yet</span>}
                        </div>
                      </div>

                      {/* Summary */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-stone-500 uppercase">Summary</span>
                          <button
                            onClick={() => processPages('summary', [page.id])}
                            disabled={processing.active || !hasTranslation}
                            className="text-xs text-purple-600 hover:text-purple-700 disabled:text-stone-400"
                          >
                            {hasSummary ? 'Re-run' : 'Run'}
                          </button>
                        </div>
                        <div className="bg-white border border-stone-200 rounded p-2 h-32 overflow-y-auto text-xs text-stone-600">
                          {page.summary?.data || <span className="text-stone-400 italic">No summary yet</span>}
                        </div>
                      </div>
                    </div>

                    {/* Split detection info */}
                    {detection && (
                      <div className="mt-4 pt-4 border-t border-stone-200">
                        <div className="flex items-center gap-2 text-sm">
                          {detection.isTwoPageSpread ? (
                            <>
                              <Scissors className="w-4 h-4 text-teal-600" />
                              <span className="text-teal-700">Two-page spread detected</span>
                              <span className="text-stone-400">({detection.confidence})</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-4 h-4 text-stone-500" />
                              <span className="text-stone-600">Single page</span>
                            </>
                          )}
                        </div>
                        {detection.reasoning && (
                          <p className="mt-1 text-xs text-stone-500">{detection.reasoning}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {pages.length === 0 && (
          <div className="text-center py-16 bg-white rounded-lg border border-stone-200">
            <p className="text-stone-500">No pages to prepare</p>
          </div>
        )}
      </main>

      {/* Quick Image Preview */}
      {fullscreenImage && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 cursor-pointer"
          onClick={() => setFullscreenImage(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fullscreenImage.src}
            alt={fullscreenImage.alt}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setFullscreenImage(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white"
          >
            <X className="w-8 h-8" />
          </button>
        </div>
      )}
    </div>
  );
}
