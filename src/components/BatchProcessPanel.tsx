'use client';

import { useState, useEffect } from 'react';
import {
  X,
  FileText,
  Languages,
  BookOpen,
  Loader2,
  CheckCircle2,
  Circle,
  Square,
  Play,
  Clock,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import type { Page, Prompt } from '@/lib/types';

interface BatchProcessPanelProps {
  bookId: string;
  pages: Page[];
  onClose: () => void;
  onComplete: () => void;
}

type ActionType = 'ocr' | 'translation' | 'summary';

interface ProcessingState {
  active: boolean;
  type: ActionType | null;
  currentIndex: number;
  totalPages: number;
  completed: string[];
  failed: string[];
}

export default function BatchProcessPanel({
  bookId,
  pages,
  onClose,
  onComplete
}: BatchProcessPanelProps) {
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<ActionType>('ocr');
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [prompts, setPrompts] = useState<{ ocr: string; translation: string; summary: string }>({
    ocr: '',
    translation: '',
    summary: ''
  });
  const [processing, setProcessing] = useState<ProcessingState>({
    active: false,
    type: null,
    currentIndex: 0,
    totalPages: 0,
    completed: [],
    failed: []
  });
  const [stopRequested, setStopRequested] = useState(false);

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
          const data = await ocrRes.json();
          const defaultPrompt = data.find((p: Prompt) => p.is_default) || data[0];
          if (defaultPrompt) setPrompts(prev => ({ ...prev, ocr: defaultPrompt.content }));
        }
        if (transRes.ok) {
          const data = await transRes.json();
          const defaultPrompt = data.find((p: Prompt) => p.is_default) || data[0];
          if (defaultPrompt) setPrompts(prev => ({ ...prev, translation: defaultPrompt.content }));
        }
        if (sumRes.ok) {
          const data = await sumRes.json();
          const defaultPrompt = data.find((p: Prompt) => p.is_default) || data[0];
          if (defaultPrompt) setPrompts(prev => ({ ...prev, summary: defaultPrompt.content }));
        }
      } catch (error) {
        console.error('Error fetching prompts:', error);
      }
    };
    fetchPrompts();
  }, []);

  // Filter pages based on action
  const getEligiblePages = () => {
    switch (action) {
      case 'ocr':
        return pages.filter(p => !p.ocr?.data);
      case 'translation':
        return pages.filter(p => p.ocr?.data && !p.translation?.data);
      case 'summary':
        return pages.filter(p => p.translation?.data && !p.summary?.data);
    }
  };

  const eligiblePages = getEligiblePages();
  const selectedCount = selectedPages.size;
  const estimatedTimeMinutes = Math.ceil(selectedCount * 0.5); // ~30 sec per page

  const selectAll = () => {
    setSelectedPages(new Set(eligiblePages.map(p => p.id)));
  };

  const clearSelection = () => {
    setSelectedPages(new Set());
  };

  const togglePage = (pageId: string) => {
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

  const runBatchProcess = async () => {
    if (selectedPages.size === 0) return;

    const pageIds = Array.from(selectedPages);
    setStopRequested(false);
    setProcessing({
      active: true,
      type: action,
      currentIndex: 0,
      totalPages: pageIds.length,
      completed: [],
      failed: []
    });

    const completed: string[] = [];
    const failed: string[] = [];

    for (let i = 0; i < pageIds.length; i++) {
      if (stopRequested) break;

      const pageId = pageIds[i];
      const page = pages.find(p => p.id === pageId);
      if (!page) continue;

      setProcessing(prev => ({
        ...prev,
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
            action,
            imageUrl: page.photo,
            language: 'Latin', // TODO: get from book
            targetLanguage: 'English',
            ocrText: action === 'translation' ? page.ocr?.data : undefined,
            translatedText: action === 'summary' ? page.translation?.data : undefined,
            previousPageId: previousPage?.id,
            customPrompts: {
              ocr: prompts.ocr,
              translation: prompts.translation,
              summary: prompts.summary
            },
            autoSave: true
          })
        });

        if (response.ok) {
          completed.push(pageId);
        } else {
          failed.push(pageId);
        }
      } catch (error) {
        console.error(`Error processing page ${pageId}:`, error);
        failed.push(pageId);
      }

      setProcessing(prev => ({
        ...prev,
        completed: [...completed],
        failed: [...failed]
      }));

      // Rate limiting
      if (i < pageIds.length - 1 && !stopRequested) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    setProcessing(prev => ({
      ...prev,
      active: false
    }));

    if (completed.length > 0) {
      onComplete();
    }
  };

  const actionLabels = {
    ocr: { label: 'OCR', icon: FileText, color: 'blue' },
    translation: { label: 'Translation', icon: Languages, color: 'green' },
    summary: { label: 'Summary', icon: BookOpen, color: 'purple' }
  };

  const ActionIcon = actionLabels[action].icon;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-stone-200">
          <div>
            <h2 className="text-lg font-semibold text-stone-900">Batch Process</h2>
            <p className="text-sm text-stone-500">Select pages and run processing in bulk</p>
          </div>
          <button onClick={onClose} className="p-2 text-stone-400 hover:text-stone-600 rounded-lg hover:bg-stone-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Processing overlay */}
        {processing.active && (
          <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center z-10">
            <Loader2 className="w-12 h-12 animate-spin text-amber-600 mb-4" />
            <h3 className="text-lg font-semibold text-stone-900 mb-2">
              Running {actionLabels[action].label}...
            </h3>
            <div className="w-64 bg-stone-200 rounded-full h-2 mb-4">
              <div
                className="bg-amber-500 h-2 rounded-full transition-all"
                style={{ width: `${(processing.currentIndex / processing.totalPages) * 100}%` }}
              />
            </div>
            <p className="text-sm text-stone-600 mb-2">
              Page {processing.currentIndex} of {processing.totalPages}
            </p>
            <p className="text-xs text-stone-500 mb-4">
              {processing.completed.length} completed, {processing.failed.length} failed
            </p>
            <button
              onClick={() => setStopRequested(true)}
              className="flex items-center gap-2 px-4 py-2 bg-stone-100 text-stone-700 rounded-lg hover:bg-stone-200"
            >
              <Square className="w-4 h-4" />
              Stop
            </button>
          </div>
        )}

        {/* Action selector */}
        <div className="p-4 border-b border-stone-100 bg-stone-50">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-stone-700">Action:</span>
            <div className="flex gap-2">
              {(['ocr', 'translation', 'summary'] as ActionType[]).map(type => {
                const { label, icon: Icon, color } = actionLabels[type];
                const isSelected = action === type;
                return (
                  <button
                    key={type}
                    onClick={() => {
                      setAction(type);
                      setSelectedPages(new Set());
                    }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isSelected
                        ? `bg-${color}-100 text-${color}-700 ring-2 ring-${color}-500`
                        : 'bg-white text-stone-600 hover:bg-stone-100 border border-stone-200'
                    }`}
                    style={isSelected ? {
                      backgroundColor: color === 'blue' ? '#dbeafe' : color === 'green' ? '#dcfce7' : '#f3e8ff',
                      color: color === 'blue' ? '#1d4ed8' : color === 'green' ? '#15803d' : '#7e22ce'
                    } : {}}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Page selection */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <span className="text-sm text-stone-600">
                {eligiblePages.length} pages need {actionLabels[action].label.toLowerCase()}
              </span>
              <button onClick={selectAll} className="text-sm text-amber-600 hover:text-amber-700">
                Select all
              </button>
              {selectedCount > 0 && (
                <button onClick={clearSelection} className="text-sm text-stone-500 hover:text-stone-700">
                  Clear ({selectedCount})
                </button>
              )}
            </div>
          </div>

          {eligiblePages.length === 0 ? (
            <div className="text-center py-12 bg-stone-50 rounded-lg">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <p className="text-stone-600">All pages have {actionLabels[action].label.toLowerCase()}!</p>
            </div>
          ) : (
            <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2">
              {eligiblePages.map(page => {
                const isSelected = selectedPages.has(page.id);
                const imageUrl = page.crop?.xStart !== undefined
                  ? `/api/image?url=${encodeURIComponent(page.photo_original || page.photo)}&w=100&q=60&cx=${page.crop.xStart}&cw=${page.crop.xEnd}`
                  : `/api/image?url=${encodeURIComponent(page.photo)}&w=100&q=60`;

                return (
                  <button
                    key={page.id}
                    onClick={() => togglePage(page.id)}
                    className={`relative aspect-[3/4] rounded overflow-hidden border-2 transition-all ${
                      isSelected ? 'border-amber-500 ring-2 ring-amber-200' : 'border-stone-200 hover:border-stone-300'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl} alt={`Page ${page.page_number}`} className="w-full h-full object-cover" />
                    {isSelected && (
                      <div className="absolute inset-0 bg-amber-500/20 flex items-center justify-center">
                        <CheckCircle2 className="w-6 h-6 text-amber-600" />
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs py-0.5 text-center">
                      {page.page_number}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Prompt editor */}
        <div className="border-t border-stone-200">
          <button
            onClick={() => setShowPromptEditor(!showPromptEditor)}
            className="w-full flex items-center justify-between p-3 text-sm text-stone-600 hover:bg-stone-50"
          >
            <span>Edit {actionLabels[action].label} Prompt</span>
            {showPromptEditor ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showPromptEditor && (
            <div className="p-4 pt-0">
              <textarea
                value={prompts[action]}
                onChange={e => setPrompts(prev => ({ ...prev, [action]: e.target.value }))}
                className="w-full h-32 p-3 text-sm border border-stone-200 rounded-lg resize-none font-mono"
                placeholder={`Enter ${actionLabels[action].label.toLowerCase()} prompt...`}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-stone-200 bg-stone-50">
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <Clock className="w-4 h-4" />
            {selectedCount > 0 ? (
              <span>Estimated time: ~{estimatedTimeMinutes} min for {selectedCount} pages</span>
            ) : (
              <span>Select pages to process</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-stone-600 hover:text-stone-900"
            >
              Cancel
            </button>
            <button
              onClick={runBatchProcess}
              disabled={selectedCount === 0 || processing.active}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              <Play className="w-4 h-4" />
              Run {actionLabels[action].label} on {selectedCount} pages
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
