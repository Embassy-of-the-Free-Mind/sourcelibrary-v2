'use client';

import { PipelineStepState, PipelineStep } from '@/lib/types';
import { Check, Circle, Loader2, AlertCircle, SkipForward } from 'lucide-react';

interface StepInfo {
  key: PipelineStep;
  label: string;
  description: string;
}

const STEPS: StepInfo[] = [
  { key: 'crop', label: 'Crop Images', description: 'Generate cropped images for split pages' },
  { key: 'ocr', label: 'OCR', description: 'Extract text from page images' },
  { key: 'translate', label: 'Translation', description: 'Translate to English' },
  { key: 'summarize', label: 'Summarize', description: 'Generate book overview' },
  { key: 'edition', label: 'Create Edition', description: 'Prepare for publication' },
];

interface PipelineProgressProps {
  steps: Record<PipelineStep, PipelineStepState>;
  currentStep: PipelineStep | null;
}

function StepIcon({ status }: { status: PipelineStepState['status'] }) {
  switch (status) {
    case 'completed':
      return <Check className="w-5 h-5 text-green-600" />;
    case 'running':
      return <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />;
    case 'failed':
      return <AlertCircle className="w-5 h-5 text-red-600" />;
    case 'skipped':
      return <SkipForward className="w-5 h-5 text-stone-400" />;
    default:
      return <Circle className="w-5 h-5 text-stone-300" />;
  }
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-stone-500 mb-1">
        <span>{completed} / {total}</span>
        <span>{percent}%</span>
      </div>
      <div className="h-2 bg-stone-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-500 transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export default function PipelineProgress({ steps, currentStep }: PipelineProgressProps) {
  return (
    <div className="space-y-4">
      {STEPS.map((step, index) => {
        const state = steps[step.key];
        const isActive = currentStep === step.key;

        return (
          <div
            key={step.key}
            className={`p-4 rounded-lg border transition-colors ${
              isActive
                ? 'border-amber-300 bg-amber-50'
                : state.status === 'completed'
                ? 'border-green-200 bg-green-50'
                : state.status === 'failed'
                ? 'border-red-200 bg-red-50'
                : 'border-stone-200 bg-white'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <div className="w-8 h-8 rounded-full bg-white border border-stone-200 flex items-center justify-center">
                  <StepIcon status={state.status} />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-stone-900">
                    {index + 1}. {step.label}
                  </span>
                  {state.status === 'skipped' && (
                    <span className="text-xs text-stone-500">(skipped)</span>
                  )}
                </div>

                <p className="text-sm text-stone-500 mt-0.5">
                  {step.description}
                </p>

                {state.status === 'running' && state.progress && (
                  <ProgressBar
                    completed={state.progress.completed}
                    total={state.progress.total}
                  />
                )}

                {state.status === 'completed' && typeof state.result?.message === 'string' && (
                  <p className="text-sm text-green-700 mt-2">
                    ✓ {state.result.message}
                  </p>
                )}

                {state.status === 'skipped' && typeof state.result?.message === 'string' && (
                  <p className="text-sm text-stone-500 mt-2">
                    {state.result.message}
                  </p>
                )}

                {state.status === 'failed' && state.error && (
                  <p className="text-sm text-red-600 mt-2">
                    Error: {state.error}
                  </p>
                )}

                {state.status === 'completed' && typeof state.result?.reviewUrl === 'string' && (
                  <a
                    href={state.result.reviewUrl}
                    className="inline-flex items-center gap-1 mt-2 text-sm text-amber-700 hover:text-amber-800 font-medium"
                  >
                    Review & Mint DOI →
                  </a>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
