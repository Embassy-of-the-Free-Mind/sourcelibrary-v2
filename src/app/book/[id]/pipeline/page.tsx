'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Play, Pause, RotateCcw, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { usePipeline } from '@/hooks/usePipeline';
import PipelineProgress from '@/components/pipeline/PipelineProgress';
import PipelineConfigForm, { PipelineConfigDisplay } from '@/components/pipeline/PipelineConfig';

interface PipelinePageProps {
  params: Promise<{ id: string }>;
}

export default function PipelinePage({ params }: PipelinePageProps) {
  const [bookId, setBookId] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => setBookId(p.id));
  }, [params]);

  if (!bookId) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  return <PipelineContent bookId={bookId} />;
}

function PipelineContent({ bookId }: { bookId: string }) {
  const { data, loading, error, isRunning, start, pause, resume, reset } = usePipeline(bookId);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Error Loading Pipeline</h1>
          <p className="text-stone-600 mb-4">{error || 'Book not found'}</p>
          <Link href="/" className="text-amber-600 hover:text-amber-700">
            Back to Library
          </Link>
        </div>
      </div>
    );
  }

  const { bookTitle, language, pagesCount, pipeline } = data;
  const hasStarted = pipeline && pipeline.status !== 'idle';
  const isCompleted = pipeline?.status === 'completed';
  const isFailed = pipeline?.status === 'failed';
  const isPaused = pipeline?.status === 'paused';

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <Link
              href={`/book/${bookId}`}
              className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back to Book</span>
            </Link>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              {isRunning && (
                <button
                  onClick={pause}
                  className="inline-flex items-center gap-2 px-4 py-2 text-stone-700 bg-stone-100 rounded-lg hover:bg-stone-200 transition-colors"
                >
                  <Pause className="w-4 h-4" />
                  Pause
                </button>
              )}

              {isPaused && (
                <button
                  onClick={resume}
                  className="inline-flex items-center gap-2 px-4 py-2 text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
                >
                  <Play className="w-4 h-4" />
                  Resume
                </button>
              )}

              {(isCompleted || isFailed) && (
                <button
                  onClick={reset}
                  className="inline-flex items-center gap-2 px-4 py-2 text-stone-700 bg-stone-100 rounded-lg hover:bg-stone-200 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Book info */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <h1 className="text-2xl sm:text-3xl font-serif font-bold">{bookTitle}</h1>
          <div className="flex items-center gap-4 mt-2 text-stone-400 text-sm">
            <span>{language}</span>
            <span>•</span>
            <span>{pagesCount} pages</span>
            {pipeline && (
              <>
                <span>•</span>
                <span className={`capitalize ${isCompleted ? 'text-green-400' :
                  isFailed ? 'text-red-400' :
                    isRunning ? 'text-amber-400' :
                      'text-stone-400'
                  }`}>
                  {pipeline.status}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Status banner */}
        {isCompleted && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-green-900">Pipeline Complete!</h3>
              <p className="text-sm text-green-700 mt-1">
                Your book has been processed and an edition has been created.
                Review it and mint a DOI when ready.
              </p>
              {typeof pipeline?.steps.edition.result?.reviewUrl === 'string' && (
                <a
                  href={pipeline.steps.edition.result.reviewUrl}
                  className="inline-flex items-center gap-1 mt-2 text-sm font-medium text-green-700 hover:text-green-800"
                >
                  Go to Review Page →
                </a>
              )}
            </div>
          </div>
        )}

        {isFailed && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-red-900">Pipeline Failed</h3>
              <p className="text-sm text-red-700 mt-1">
                {pipeline?.error || 'An error occurred during processing. You can reset and try again.'}
              </p>
            </div>
          </div>
        )}

        {/* Configuration or Progress */}
        {!hasStarted ? (
          <div className="bg-white rounded-xl border border-stone-200 p-6">
            <h2 className="text-lg font-semibold text-stone-900 mb-4">
              Configure Pipeline
            </h2>
            <p className="text-stone-600 mb-6">
              This will automatically process your book through all steps: split detection,
              OCR, translation, summarization, and edition creation.
            </p>
            <PipelineConfigForm
              initialLanguage={language}
              onStart={start}
              disabled={isRunning}
            />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Config display */}
            {pipeline?.config && (
              <div className="bg-white rounded-xl border border-stone-200 p-4">
                <PipelineConfigDisplay config={pipeline.config} />
              </div>
            )}

            {/* Progress */}
            {pipeline && (
              <div className="bg-white rounded-xl border border-stone-200 p-6">
                <h2 className="text-lg font-semibold text-stone-900 mb-4">
                  Pipeline Progress
                </h2>
                <PipelineProgress
                  steps={pipeline.steps}
                  currentStep={pipeline.currentStep}
                />
              </div>
            )}
          </div>
        )}

        {/* Info box */}
        <div className="mt-8 p-4 bg-stone-100 rounded-lg">
          <h3 className="font-medium text-stone-900 mb-2">What happens next?</h3>
          <ul className="text-sm text-stone-600 space-y-1">
            <li>1. <strong>Crop</strong> — Generates cropped images for split pages</li>
            <li>2. <strong>OCR</strong> — Extracts text from all page images</li>
            <li>3. <strong>Translation</strong> — Translates the extracted text to English</li>
            <li>4. <strong>Summarize</strong> — Generates a book overview with key quotes</li>
            <li>5. <strong>Edition</strong> — Creates a draft edition with front matter</li>
            <li className="text-amber-700 font-medium">→ Review the edition and mint a DOI when ready</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
