'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Wand2,
  X,
  FileText,
  Languages,
  CheckCircle2,
  Loader2,
  Play,
  ChevronRight,
  AlertCircle,
  Settings,
} from 'lucide-react';
import { GEMINI_MODELS, DEFAULT_MODEL } from '@/lib/types';
import type { Page, Prompt } from '@/lib/types';

interface ProcessBookWizardProps {
  bookId: string;
  bookTitle: string;
  pages: Page[];
  onClose: () => void;
}

type WorkflowStep = 'ocr' | 'translation';

interface StepStatus {
  enabled: boolean;
  total: number;
  pending: number;
  completed: number;
  failed: number;
  status: 'idle' | 'running' | 'done' | 'error';
}

// Retry settings
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;
const FETCH_TIMEOUT = 120000;

async function fetchWithTimeout(url: string, options: RequestInit, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default function ProcessBookWizard({ bookId, bookTitle, pages, onClose }: ProcessBookWizardProps) {
  const router = useRouter();
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [showSettings, setShowSettings] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState<WorkflowStep | null>(null);
  const stopRequestedRef = useRef(false);

  // Prompts
  const [prompts, setPrompts] = useState<Record<WorkflowStep, Prompt[]>>({
    ocr: [],
    translation: [],
  });
  const [selectedPromptIds, setSelectedPromptIds] = useState<Record<WorkflowStep, string>>({
    ocr: '',
    translation: '',
  });
  const [promptsLoading, setPromptsLoading] = useState(true);

  // Calculate initial counts
  const pagesWithoutOcr = pages.filter(p => !p.ocr?.data);
  const pagesWithoutTranslation = pages.filter(p => !p.translation?.data && p.ocr?.data);

  const [steps, setSteps] = useState<Record<WorkflowStep, StepStatus>>({
    ocr: {
      enabled: pagesWithoutOcr.length > 0,
      total: pages.length,
      pending: pagesWithoutOcr.length,
      completed: 0,
      failed: 0,
      status: 'idle',
    },
    translation: {
      enabled: pagesWithoutTranslation.length > 0 || pagesWithoutOcr.length > 0,
      total: pages.length,
      pending: pagesWithoutTranslation.length + pagesWithoutOcr.length, // Will translate OCR'd pages
      completed: 0,
      failed: 0,
      status: 'idle',
    },
  });

  // Fetch prompts
  useEffect(() => {
    const fetchPrompts = async () => {
      setPromptsLoading(true);
      try {
        const [ocrRes, transRes] = await Promise.all([
          fetch('/api/prompts?type=ocr'),
          fetch('/api/prompts?type=translation'),
        ]);

        const loadPrompts = async (res: Response, type: WorkflowStep) => {
          if (res.ok) {
            const data = await res.json();
            const defaultPrompt = data.find((p: Prompt) => p.is_default) || data[0];
            setPrompts(prev => ({ ...prev, [type]: data }));
            if (defaultPrompt) {
              setSelectedPromptIds(prev => ({
                ...prev,
                [type]: defaultPrompt.id || defaultPrompt._id?.toString() || '',
              }));
            }
          }
        };

        await Promise.all([
          loadPrompts(ocrRes, 'ocr'),
          loadPrompts(transRes, 'translation'),
        ]);
      } catch (error) {
        console.error('Error fetching prompts:', error);
      } finally {
        setPromptsLoading(false);
      }
    };
    fetchPrompts();
  }, []);

  const toggleStep = (step: WorkflowStep) => {
    if (isProcessing) return;
    setSteps(prev => ({
      ...prev,
      [step]: { ...prev[step], enabled: !prev[step].enabled },
    }));
  };

  const getPromptContent = (type: WorkflowStep): string => {
    const prompt = prompts[type].find(
      p => (p.id || p._id?.toString()) === selectedPromptIds[type]
    );
    return prompt?.content || '';
  };

  const processPage = async (
    page: Page,
    action: WorkflowStep,
    ocrText?: string
  ): Promise<{ success: boolean; ocrResult?: string }> => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (stopRequestedRef.current) return { success: false };

      try {
        const response = await fetchWithTimeout('/api/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageId: page.id,
            action,
            imageUrl: page.photo,
            language: 'Latin',
            targetLanguage: 'English',
            ocrText: action === 'translation' ? (ocrText || page.ocr?.data) : undefined,
            customPrompts: {
              ocr: getPromptContent('ocr'),
              translation: getPromptContent('translation'),
            },
            autoSave: true,
            model: selectedModel,
          }),
        }, FETCH_TIMEOUT);

        if (response.ok) {
          const data = await response.json();
          return { success: true, ocrResult: data.ocr };
        } else {
          const errorText = await response.text().catch(() => 'Unknown error');
          lastError = new Error(`HTTP ${response.status}: ${errorText}`);
          if (response.status >= 400 && response.status < 500) break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
      }

      if (attempt < MAX_RETRIES - 1 && lastError) {
        await sleep(INITIAL_RETRY_DELAY * Math.pow(2, attempt));
      }
    }

    console.error(`Failed to process page ${page.id}:`, lastError?.message);
    return { success: false };
  };

  const runWorkflow = async () => {
    setIsProcessing(true);
    stopRequestedRef.current = false;

    // Create job record
    let jobId: string | null = null;
    const enabledSteps = Object.entries(steps)
      .filter(([, s]) => s.enabled)
      .map(([k]) => k);

    try {
      const jobRes = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'batch_ocr', // Primary type
          book_id: bookId,
          book_title: bookTitle,
          page_ids: pages.map(p => p.id),
          model: selectedModel,
          prompt_name: `Workflow: ${enabledSteps.join(' → ')}`,
        }),
      });
      if (jobRes.ok) {
        const jobData = await jobRes.json();
        jobId = jobData.job?.id;
        if (jobId) {
          await fetch(`/api/jobs/${jobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'processing' }),
          });
        }
      }
    } catch (error) {
      console.error('Failed to create job:', error);
    }

    // Track OCR results for translation step
    const ocrResults: Record<string, string> = {};
    let totalCompleted = 0;
    let totalFailed = 0;

    // Step 1: OCR
    if (steps.ocr.enabled && !stopRequestedRef.current) {
      setCurrentStep('ocr');
      setSteps(prev => ({
        ...prev,
        ocr: { ...prev.ocr, status: 'running' },
      }));

      const pagesToOcr = pages.filter(p => !p.ocr?.data);
      let completed = 0;
      let failed = 0;

      for (let i = 0; i < pagesToOcr.length; i++) {
        if (stopRequestedRef.current) break;

        const page = pagesToOcr[i];
        const result = await processPage(page, 'ocr');

        if (result.success) {
          completed++;
          if (result.ocrResult) {
            ocrResults[page.id] = result.ocrResult;
          }
        } else {
          failed++;
        }

        setSteps(prev => ({
          ...prev,
          ocr: { ...prev.ocr, completed, failed, pending: pagesToOcr.length - completed - failed },
        }));

        // Small delay between pages
        if (i < pagesToOcr.length - 1) await sleep(200);
      }

      totalCompleted += completed;
      totalFailed += failed;

      setSteps(prev => ({
        ...prev,
        ocr: { ...prev.ocr, status: failed === pagesToOcr.length ? 'error' : 'done' },
      }));
    }

    // Step 2: Translation
    if (steps.translation.enabled && !stopRequestedRef.current) {
      setCurrentStep('translation');
      setSteps(prev => ({
        ...prev,
        translation: { ...prev.translation, status: 'running' },
      }));

      // Translate pages that have OCR (existing or just processed)
      const pagesToTranslate = pages.filter(p => {
        const hasOcr = p.ocr?.data || ocrResults[p.id];
        const needsTranslation = !p.translation?.data;
        return hasOcr && needsTranslation;
      });

      let completed = 0;
      let failed = 0;

      for (let i = 0; i < pagesToTranslate.length; i++) {
        if (stopRequestedRef.current) break;

        const page = pagesToTranslate[i];
        const ocrText = ocrResults[page.id] || page.ocr?.data;
        const result = await processPage(page, 'translation', ocrText);

        if (result.success) {
          completed++;
        } else {
          failed++;
        }

        setSteps(prev => ({
          ...prev,
          translation: { ...prev.translation, completed, failed, pending: pagesToTranslate.length - completed - failed },
        }));

        if (i < pagesToTranslate.length - 1) await sleep(200);
      }

      totalCompleted += completed;
      totalFailed += failed;

      setSteps(prev => ({
        ...prev,
        translation: { ...prev.translation, status: failed === pagesToTranslate.length ? 'error' : 'done' },
      }));
    }

    // Update job status
    if (jobId) {
      try {
        await fetch(`/api/jobs/${jobId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: stopRequestedRef.current ? 'cancelled' : totalFailed > 0 ? 'completed' : 'completed',
            progress: { completed: totalCompleted, failed: totalFailed },
          }),
        });
      } catch (error) {
        console.error('Failed to update job:', error);
      }
    }

    setCurrentStep(null);
    setIsProcessing(false);
    router.refresh();
  };

  const stepConfig = {
    ocr: { label: 'OCR', icon: FileText, color: '#3b82f6', bgColor: '#eff6ff' },
    translation: { label: 'Translate', icon: Languages, color: '#22c55e', bgColor: '#f0fdf4' },
  };

  const enabledStepsCount = Object.values(steps).filter(s => s.enabled).length;
  const allDone = !isProcessing && Object.values(steps).every(s => !s.enabled || s.status === 'done' || s.status === 'error');
  const hasFailures = Object.values(steps).some(s => s.failed > 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-stone-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <Wand2 className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="font-semibold text-stone-900">Process Book</h2>
              <p className="text-xs text-stone-500 truncate max-w-[250px]">{bookTitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-2 text-stone-400 hover:text-stone-600 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Book stats */}
          <div className="bg-stone-50 rounded-lg p-3 text-sm">
            <div className="flex items-center justify-between text-stone-600">
              <span>{pages.length} pages total</span>
              <span>{pages.length - pagesWithoutOcr.length} with OCR</span>
              <span>{pages.filter(p => p.translation?.data).length} translated</span>
            </div>
          </div>

          {/* Workflow steps */}
          <div className="space-y-2">
            {(['ocr', 'translation'] as WorkflowStep[]).map((step, index) => {
              const config = stepConfig[step];
              const status = steps[step];
              const Icon = config.icon;
              const isActive = currentStep === step;

              return (
                <div key={step}>
                  {index > 0 && (
                    <div className="flex justify-center py-1">
                      <ChevronRight className="w-4 h-4 text-stone-300 rotate-90" />
                    </div>
                  )}
                  <button
                    onClick={() => toggleStep(step)}
                    disabled={isProcessing}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all ${
                      status.enabled
                        ? 'border-stone-300 bg-white'
                        : 'border-stone-200 bg-stone-50 opacity-60'
                    } ${isProcessing ? 'cursor-default' : 'hover:border-stone-400'}`}
                  >
                    {/* Checkbox */}
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        status.enabled ? 'border-amber-500 bg-amber-500' : 'border-stone-300'
                      }`}
                    >
                      {status.enabled && <CheckCircle2 className="w-3 h-3 text-white" />}
                    </div>

                    {/* Icon */}
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: config.bgColor }}
                    >
                      <Icon className="w-4 h-4" style={{ color: config.color }} />
                    </div>

                    {/* Label and status */}
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-stone-800">{config.label}</span>
                        {status.status === 'running' && (
                          <Loader2 className="w-3 h-3 animate-spin text-amber-500" />
                        )}
                        {status.status === 'done' && (
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                        )}
                        {status.status === 'error' && (
                          <AlertCircle className="w-3 h-3 text-red-500" />
                        )}
                      </div>
                      <div className="text-xs text-stone-500">
                        {status.status === 'idle' && `${status.pending} pages to process`}
                        {status.status === 'running' && (
                          <span>
                            {status.completed} done, {status.pending} remaining
                            {status.failed > 0 && <span className="text-red-500"> ({status.failed} failed)</span>}
                          </span>
                        )}
                        {status.status === 'done' && (
                          <span className="text-green-600">
                            {status.completed} completed
                            {status.failed > 0 && <span className="text-red-500"> ({status.failed} failed)</span>}
                          </span>
                        )}
                        {status.status === 'error' && (
                          <span className="text-red-500">All {status.failed} failed</span>
                        )}
                      </div>
                    </div>

                    {/* Progress bar when running */}
                    {isActive && status.status === 'running' && (
                      <div className="w-16 h-1.5 bg-stone-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 transition-all"
                          style={{
                            width: `${((status.completed + status.failed) / (status.completed + status.failed + status.pending)) * 100}%`,
                          }}
                        />
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Settings toggle */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            disabled={isProcessing}
            className="flex items-center gap-2 text-sm text-stone-500 hover:text-stone-700 disabled:opacity-50"
          >
            <Settings className="w-4 h-4" />
            {showSettings ? 'Hide settings' : 'Show settings'}
          </button>

          {/* Settings panel */}
          {showSettings && (
            <div className="space-y-3 p-3 bg-stone-50 rounded-lg">
              <div className="flex items-center gap-3">
                <label className="text-sm text-stone-600 w-16">Model:</label>
                <select
                  value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value)}
                  disabled={isProcessing}
                  className="flex-1 px-2 py-1.5 text-sm border border-stone-300 rounded-lg"
                >
                  {GEMINI_MODELS.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </div>

              {(['ocr', 'translation'] as WorkflowStep[]).map(step => (
                <div key={step} className="flex items-center gap-3">
                  <label className="text-sm text-stone-600 w-16 capitalize">{step}:</label>
                  <select
                    value={selectedPromptIds[step]}
                    onChange={e => setSelectedPromptIds(prev => ({ ...prev, [step]: e.target.value }))}
                    disabled={isProcessing || promptsLoading}
                    className="flex-1 px-2 py-1.5 text-sm border border-stone-300 rounded-lg"
                  >
                    {promptsLoading ? (
                      <option>Loading...</option>
                    ) : (
                      prompts[step].map(p => (
                        <option key={p.id || p._id?.toString()} value={p.id || p._id?.toString()}>
                          {p.name}
                          {p.is_default ? ' (Default)' : ''}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-stone-200 bg-stone-50">
          {allDone ? (
            <>
              <div className="text-sm text-stone-600">
                {hasFailures ? (
                  <span className="text-amber-600">Completed with some failures</span>
                ) : (
                  <span className="text-green-600">All steps completed!</span>
                )}
              </div>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-stone-800 text-white rounded-lg hover:bg-stone-900 text-sm font-medium"
              >
                Done
              </button>
            </>
          ) : isProcessing ? (
            <>
              <div className="text-sm text-stone-500">Processing...</div>
              <button
                onClick={() => {
                  stopRequestedRef.current = true;
                }}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
              >
                Stop
              </button>
            </>
          ) : (
            <>
              <div className="text-sm text-stone-500">
                {enabledStepsCount === 0
                  ? 'Select at least one step'
                  : `${enabledStepsCount} step${enabledStepsCount > 1 ? 's' : ''} selected`}
              </div>
              <button
                onClick={runWorkflow}
                disabled={enabledStepsCount === 0}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                <Play className="w-4 h-4" />
                Start Processing
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
