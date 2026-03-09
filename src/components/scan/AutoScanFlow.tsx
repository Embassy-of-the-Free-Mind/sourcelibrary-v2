'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import Viewfinder from '@/components/scan/Viewfinder';
import type { ViewfinderHandle } from '@/components/scan/Viewfinder';
import ScanControls from '@/components/scan/ScanControls';
import MetadataForm from '@/components/scan/MetadataForm';
import ReviewGrid from '@/components/scan/ReviewGrid';
import { AutoCaptureController } from '@/lib/scan/auto-capture';
import type { CaptureConditions } from '@/lib/scan/auto-capture';
import type { EdgeDetector } from '@/lib/scan/edge-detection-types';
import {
  createSession,
  addPage,
  removePage,
  reorderPages,
  getSession,
  clearSession,
  hasIncompleteSession,
  updateSessionBookId,
} from '@/lib/scan/session-store';
import type { ScanSession } from '@/lib/scan/session-store';
import { UploadQueue } from '@/lib/scan/upload-queue';
import type { UploadProgressEvent, UploadCompleteEvent } from '@/lib/scan/upload-queue';
import { generateThumbnail } from '@/lib/scan/image-utils';
import type { QualityMetrics, ProcessedFile } from '@/lib/scan/image-utils';

type ScanState =
  | 'onboarding'       // walkthrough before camera
  | 'camera'           // initial: capture title page
  | 'title-analyzing'  // analyzing title page via API
  | 'confirm'          // review extracted metadata
  | 'scanning'         // main capture loop
  | 'review'           // review captured pages
  | 'done';            // complete

interface ExtractedMetadata {
  title: string | null;
  author: string | null;
  language: string | null;
  year: number | null;
  ocr_text?: string;
}

interface AutoScanFlowProps {
  edgeDetector: EdgeDetector;
}

export default function AutoScanFlow({ edgeDetector }: AutoScanFlowProps) {
  // -- State --
  const [state, setState] = useState<ScanState>('onboarding');
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [conditions, setConditions] = useState<CaptureConditions>({
    stable: false, sharp: false, exposed: false, pageDetected: false,
  });
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [uploadProgress, setUploadProgress] = useState<{ uploaded: number; total: number } | null>(null);

  // Title page analysis
  const [titleBlob, setTitleBlob] = useState<Blob | null>(null);
  const [titlePreview, setTitlePreview] = useState<string>('');
  const [extractedMetadata, setExtractedMetadata] = useState<ExtractedMetadata | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Session
  const [session, setSession] = useState<ScanSession | null>(null);
  const [bookId, setBookId] = useState<string | null>(null);
  const [bookSlug, setBookSlug] = useState<string | null>(null);

  // Review
  const [reviewFiles, setReviewFiles] = useState<ProcessedFile[]>([]);
  const [uploadDone, setUploadDone] = useState(false);
  const [uploadFailed, setUploadFailed] = useState<string[]>([]);

  // Recovery dialog
  const [showRecovery, setShowRecovery] = useState(false);

  // Refs
  const viewfinderRef = useRef<ViewfinderHandle>(null);
  const uploadQueueRef = useRef<UploadQueue | null>(null);
  const analyzeAbortRef = useRef<AbortController | null>(null);
  const autoCaptureController = useMemo(() => new AutoCaptureController(), []);

  // -- Init edge detector --
  useEffect(() => {
    edgeDetector.init();
    return () => edgeDetector.destroy();
  }, [edgeDetector]);

  // -- Start auto-capture controller --
  useEffect(() => {
    autoCaptureController.start();
    return () => autoCaptureController.stop();
  }, [autoCaptureController]);

  // -- Poll conditions for ScanControls --
  useEffect(() => {
    if (state !== 'camera' && state !== 'scanning') return;
    const id = setInterval(() => {
      setConditions(autoCaptureController.getConditions());
    }, 200);
    return () => clearInterval(id);
  }, [state, autoCaptureController]);

  // -- Session recovery on mount --
  useEffect(() => {
    async function checkRecovery() {
      const incomplete = await hasIncompleteSession();
      if (incomplete) {
        setShowRecovery(true);
      }
    }
    checkRecovery();
  }, []);

  const handleResumeSession = useCallback(async () => {
    setShowRecovery(false);
    const existing = await getSession();
    if (!existing) return;

    setSession(existing);
    setPageCount(existing.pages.length);

    if (existing.bookId) {
      setBookId(existing.bookId);
      setBookSlug(existing.bookSlug ?? null);

      // Start upload queue for recovered session
      const queue = new UploadQueue(existing.bookId);
      uploadQueueRef.current = queue;
      queue.addEventListener('progress', ((e: Event) => {
        const detail = (e as CustomEvent<UploadProgressEvent>).detail;
        setUploadProgress({ uploaded: detail.totalUploaded, total: detail.totalPages });
      }) as EventListener);
      queue.start();

      setState('scanning');
    } else {
      // No bookId yet -- need to redo metadata confirm
      setState('camera');
    }
  }, []);

  const handleDiscardSession = useCallback(async () => {
    setShowRecovery(false);
    await clearSession();
  }, []);

  // -- Capture handler (used for both title page and scanning) --

  const handleCapture = useCallback(async (
    blob: Blob,
    corners: [number, number][] | null,
    quality: QualityMetrics,
  ) => {
    if (state === 'camera') {
      // Title page capture
      setIsCapturing(true);
      setTitleBlob(blob);
      const preview = URL.createObjectURL(blob);
      setTitlePreview(preview);
      setState('title-analyzing');

      try {
        // Analyze title page with 20s timeout
        const formData = new FormData();
        formData.append('file', blob, 'title-page.jpg');
        if (corners) {
          formData.append('corners', JSON.stringify(corners));
        }

        const controller = new AbortController();
        analyzeAbortRef.current = controller;
        const timeout = setTimeout(() => controller.abort(), 20_000);

        try {
          const res = await fetch('/api/scan/analyze-title', {
            method: 'POST',
            body: formData,
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (!res.ok) {
            throw new Error(`Analysis failed: ${res.status}`);
          }

          const data = await res.json();
          setExtractedMetadata({
            title: data.title ?? null,
            author: data.author ?? null,
            language: data.language ?? null,
            year: data.year ?? null,
            ocr_text: data.ocr_text,
          });
        } catch (fetchErr) {
          clearTimeout(timeout);
          if (controller.signal.aborted) {
            setAnalyzeError('Analysis timed out or was skipped');
          } else {
            setAnalyzeError(fetchErr instanceof Error ? fetchErr.message : 'Analysis failed');
          }
          setExtractedMetadata({ title: null, author: null, language: null, year: null });
        } finally {
          analyzeAbortRef.current = null;
        }
        setState('confirm');
      } finally {
        setIsCapturing(false);
      }
    } else if (state === 'scanning') {
      // Regular page capture
      setIsCapturing(true);
      try {
        const page = await addPage(blob, quality);
        setPageCount((c) => c + 1);

        // Notify upload queue
        if (uploadQueueRef.current) {
          uploadQueueRef.current.addPage(page.id);
        }
      } finally {
        setIsCapturing(false);
      }
    }
  }, [state]);

  // -- Metadata confirm --

  const handleConfirmMetadata = useCallback(async (
    metadata: { title: string; author: string; language: string; year: string }
  ) => {
    setIsCreating(true);

    try {
      // Create book via API
      const formData = new FormData();
      formData.append('title', metadata.title);
      formData.append('author', metadata.author);
      formData.append('language', metadata.language);
      formData.append('published', metadata.year);
      if (titleBlob) {
        formData.append('titlePage', titleBlob, 'title-page.jpg');
      }

      const res = await fetch('/api/scan/create', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Create failed: ${res.status}`);
      }

      const data = await res.json();
      setBookId(data.id);
      setBookSlug(data.slug);

      // Create OPFS session
      const newSession = await createSession({
        title: metadata.title,
        author: metadata.author,
        language: metadata.language,
        year: metadata.year,
        ocr_text: extractedMetadata?.ocr_text,
      });
      await updateSessionBookId(data.id, data.slug);
      setSession(newSession);

      // Add title page as page 1
      if (titleBlob) {
        const page = await addPage(titleBlob, { blurScore: 0.5, brightnessScore: 0.8 });
        setPageCount(1);

        // Start upload queue
        const queue = new UploadQueue(data.id);
        uploadQueueRef.current = queue;
        queue.addEventListener('progress', ((e: Event) => {
          const detail = (e as CustomEvent<UploadProgressEvent>).detail;
          setUploadProgress({ uploaded: detail.totalUploaded, total: detail.totalPages });
        }) as EventListener);
        queue.start();
        queue.addPage(page.id);
      }

      setState('scanning');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create book');
    } finally {
      setIsCreating(false);
    }
  }, [titleBlob, extractedMetadata]);

  const handleSkipAnalysis = useCallback(() => {
    if (analyzeAbortRef.current) {
      analyzeAbortRef.current.abort();
    }
    setAnalyzeError('Analysis skipped');
    setExtractedMetadata({ title: null, author: null, language: null, year: null });
    setIsCapturing(false);
    setState('confirm');
  }, []);

  const handleRetake = useCallback(() => {
    if (titlePreview) URL.revokeObjectURL(titlePreview);
    setTitleBlob(null);
    setTitlePreview('');
    setExtractedMetadata(null);
    setAnalyzeError(null);
    setState('camera');
  }, [titlePreview]);

  // -- Manual capture (shutter button) --

  const handleManualCapture = useCallback(() => {
    viewfinderRef.current?.triggerCapture();
  }, []);

  // -- Done (transition to review) --

  const handleDone = useCallback(async () => {
    // Build review files from OPFS session
    const currentSession = await getSession();
    if (!currentSession) {
      setState('review');
      return;
    }

    const files: ProcessedFile[] = [];
    for (const page of currentSession.pages) {
      const { getPageBlob } = await import('@/lib/scan/session-store');
      const blob = await getPageBlob(page.id);
      const thumbnailUrl = blob
        ? await generateThumbnail(new File([blob], page.filename, { type: 'image/jpeg' }))
        : '';

      files.push({
        id: page.id,
        file: new File([blob ?? new Blob()], page.filename, { type: 'image/jpeg' }),
        thumbnailUrl,
        timestamp: page.capturedAt,
        quality: page.quality,
      });
    }

    setReviewFiles(files);
    setState('review');
  }, []);

  // -- Review actions --

  const handleReorderFiles = useCallback(async (files: ProcessedFile[]) => {
    setReviewFiles(files);
    await reorderPages(files.map((f) => f.id));
  }, []);

  const handleDeleteFile = useCallback(async (id: string) => {
    const file = reviewFiles.find((f) => f.id === id);
    if (file?.thumbnailUrl) URL.revokeObjectURL(file.thumbnailUrl);
    setReviewFiles((prev) => prev.filter((f) => f.id !== id));
    await removePage(id);
    setPageCount((c) => Math.max(0, c - 1));
  }, [reviewFiles]);

  const handleFinishUpload = useCallback(() => {
    // Wait for upload queue to complete
    const queue = uploadQueueRef.current;
    if (!queue) {
      setState('done');
      return;
    }

    queue.addEventListener('complete', ((e: Event) => {
      const detail = (e as CustomEvent<UploadCompleteEvent>).detail;
      setUploadFailed(detail.failed);
      setUploadDone(true);
      setState('done');
    }) as EventListener);

    // If already done
    const progress = queue.getProgress();
    if (progress.uploaded >= progress.total && progress.total > 0) {
      setUploadDone(true);
      setUploadFailed(progress.failed);
      setState('done');
    }
  }, []);

  // -- Reset --

  const handleScanAnother = useCallback(async () => {
    // Cleanup
    if (uploadQueueRef.current) {
      uploadQueueRef.current.stop();
      uploadQueueRef.current = null;
    }
    reviewFiles.forEach((f) => { if (f.thumbnailUrl) URL.revokeObjectURL(f.thumbnailUrl); });
    if (titlePreview) URL.revokeObjectURL(titlePreview);

    await clearSession();

    // Reset all state
    setSession(null);
    setBookId(null);
    setBookSlug(null);
    setTitleBlob(null);
    setTitlePreview('');
    setExtractedMetadata(null);
    setAnalyzeError(null);
    setPageCount(0);
    setUploadProgress(null);
    setReviewFiles([]);
    setUploadDone(false);
    setUploadFailed([]);
    setState('camera');
  }, [reviewFiles, titlePreview]);

  // -- Render --

  // Recovery dialog
  if (showRecovery) {
    return (
      <div className="fixed inset-0 bg-dark flex items-center justify-center z-50 px-6">
        <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-lg">
          <h2 className="font-serif text-lg text-primary mb-2">Resume previous scan?</h2>
          <p className="text-sm text-muted mb-5">
            You have an incomplete scan session. Would you like to continue where you left off?
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleDiscardSession}
              className="flex-1 py-2.5 border border-border-medium rounded-lg text-secondary text-sm font-medium"
            >
              Start Fresh
            </button>
            <button
              onClick={handleResumeSession}
              className="flex-1 py-2.5 bg-accent-rust text-white rounded-lg text-sm font-medium"
            >
              Resume
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Onboarding walkthrough
  if (state === 'onboarding') {
    return (
      <div className="min-h-[100dvh] bg-cream flex flex-col">
        <header className="px-4 py-3 border-b border-border-light flex items-center gap-3">
          <a href="/" className="text-accent-rust font-serif text-lg">Source Library</a>
          <span className="text-muted text-sm">/</span>
          <span className="text-secondary font-medium text-sm">Auto Scanner</span>
        </header>
        <main className="flex-1 flex flex-col items-center px-4 py-8">
          <div className="w-full max-w-md mx-auto flex flex-col min-h-[70dvh]">
            {/* Skip */}
            <div className="text-right mb-4">
              <button
                onClick={() => setState('camera')}
                className="text-muted text-sm hover:text-secondary"
              >
                Skip
              </button>
            </div>

            <div className="flex-1 flex flex-col justify-center">
              {onboardingStep === 1 && (
                <div className="text-center space-y-6">
                  <div className="w-20 h-20 mx-auto rounded-2xl bg-accent-rust/10 flex items-center justify-center">
                    <svg className="w-10 h-10 text-accent-rust" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                    </svg>
                  </div>
                  <div>
                    <h1 className="font-serif text-3xl text-primary mb-3">Auto Scanner</h1>
                    <p className="text-secondary text-base leading-relaxed">
                      Live camera with automatic page detection. Just point and hold steady
                      &mdash; the camera fires when it sees a clear page.
                    </p>
                  </div>
                  <div className="bg-warm rounded-xl p-5 text-left space-y-4">
                    <OnboardingStepPreview
                      number="1"
                      title="Point at the title page"
                      description="AI extracts the title, author, and language"
                    />
                    <OnboardingStepPreview
                      number="2"
                      title="Keep scanning pages"
                      description="Auto-capture fires when the page is steady and clear"
                    />
                    <OnboardingStepPreview
                      number="3"
                      title="Review and finish"
                      description="Pages upload in the background as you scan"
                    />
                  </div>
                </div>
              )}

              {onboardingStep === 2 && (
                <div className="text-center space-y-6">
                  <div>
                    <h1 className="font-serif text-3xl text-primary mb-3">How It Works</h1>
                    <p className="text-secondary text-base leading-relaxed">
                      The camera watches for a page and captures automatically.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <OnboardingTip
                      diagram={<DiagramGreenOverlay />}
                      text="Green outline = page detected"
                    />
                    <OnboardingTip
                      diagram={<DiagramHoldSteady />}
                      text="Hold steady to auto-capture"
                    />
                    <OnboardingTip
                      diagram={<DiagramConditionDots />}
                      text="Dots show capture readiness"
                    />
                    <OnboardingTip
                      diagram={<DiagramManualShutter />}
                      text="Tap shutter anytime to force capture"
                    />
                  </div>
                </div>
              )}

              {onboardingStep === 3 && (
                <div className="text-center space-y-6">
                  <div>
                    <h1 className="font-serif text-3xl text-primary mb-3">Scanning Tips</h1>
                    <p className="text-secondary text-base leading-relaxed">
                      A few habits for the best results.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <OnboardingTip
                      diagram={<DiagramEvenLight />}
                      text="Good, even lighting"
                    />
                    <OnboardingTip
                      diagram={<DiagramFlatPages />}
                      text="Hold pages flat"
                    />
                    <OnboardingTip
                      diagram={<DiagramOnePage />}
                      text="One page per capture"
                    />
                    <OnboardingTip
                      diagram={<DiagramContrast />}
                      text="Dark surface behind the book"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Navigation */}
            <div className="pt-8 space-y-3">
              <div className="flex justify-center gap-2">
                {[1, 2, 3].map(s => (
                  <div
                    key={s}
                    className={`w-2 h-2 rounded-full transition-colors ${onboardingStep === s ? 'bg-accent-rust' : 'bg-border-medium'}`}
                  />
                ))}
              </div>
              <button
                onClick={() => {
                  if (onboardingStep < 3) setOnboardingStep(onboardingStep + 1);
                  else setState('camera');
                }}
                className="w-full py-3.5 bg-accent-rust text-white rounded-lg font-medium text-base"
              >
                {onboardingStep === 3 ? 'Start Scanning' : 'Next'}
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Camera / Scanning
  if (state === 'camera' || state === 'scanning') {
    return (
      <div className="fixed inset-0 bg-dark flex flex-col">
        {/* Instruction overlay for title capture */}
        {state === 'camera' && (
          <div className="absolute top-12 left-0 right-0 z-30 pointer-events-none"
            style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
          >
            <p className="text-center text-white text-sm font-medium bg-dark/60 backdrop-blur-sm py-2 mx-8 rounded-full">
              Capture the title page first
            </p>
          </div>
        )}

        {/* Viewfinder fills remaining space */}
        <div className="flex-1 relative">
          <Viewfinder
            ref={viewfinderRef}
            edgeDetector={edgeDetector}
            autoCaptureController={autoCaptureController}
            onCapture={handleCapture}
            enabled={state === 'camera' || state === 'scanning'}
          />
        </div>

        {/* Controls */}
        <ScanControls
          pageCount={pageCount}
          uploadProgress={uploadProgress}
          conditions={conditions}
          onManualCapture={handleManualCapture}
          onDone={state === 'scanning' ? handleDone : () => {}}
          isCapturing={isCapturing}
          autoEnabled={autoEnabled}
          onToggleAuto={() => setAutoEnabled((v) => !v)}
        />
      </div>
    );
  }

  // Title analyzing
  if (state === 'title-analyzing') {
    return (
      <div className="fixed inset-0 bg-cream flex items-center justify-center px-6">
        <div className="text-center space-y-4 max-w-sm">
          {titlePreview && (
            <div className="rounded-lg overflow-hidden border border-border-light mx-auto max-w-[200px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={titlePreview} alt="Title page" className="w-full object-contain" />
            </div>
          )}
          <div className="flex items-center justify-center gap-2">
            <span className="w-5 h-5 border-2 border-accent-rust border-t-transparent rounded-full animate-spin" />
            <span className="text-secondary text-sm">Analyzing title page...</span>
          </div>
          <button
            onClick={handleSkipAnalysis}
            className="text-muted text-sm hover:text-secondary underline"
          >
            Skip — enter details manually
          </button>
        </div>
      </div>
    );
  }

  // Confirm metadata
  if (state === 'confirm') {
    return (
      <div className="min-h-dvh bg-cream px-4 py-6"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)' }}
      >
        {analyzeError && (
          <div className="max-w-md mx-auto mb-4 bg-status-warning/10 border border-status-warning/20 rounded-lg p-3 text-sm text-status-warning">
            Could not auto-detect metadata. Please fill in the details manually.
          </div>
        )}
        <MetadataForm
          initialMetadata={extractedMetadata ?? { title: null, author: null, language: null, year: null }}
          titlePagePreview={titlePreview}
          onConfirm={handleConfirmMetadata}
          onRetake={handleRetake}
          isCreating={isCreating}
        />
      </div>
    );
  }

  // Review
  if (state === 'review') {
    return (
      <div className="min-h-dvh bg-cream px-4 py-6"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)' }}
      >
        <div className="max-w-2xl mx-auto space-y-4">
          <h1 className="font-serif text-xl text-primary">Review Pages</h1>
          <p className="text-sm text-muted">
            {reviewFiles.length} {reviewFiles.length === 1 ? 'page' : 'pages'} captured.
            Tap to reorder. Remove blurry or dark pages.
          </p>

          <ReviewGrid
            files={reviewFiles}
            onReorder={handleReorderFiles}
            onDelete={handleDeleteFile}
          />

          {uploadProgress && uploadProgress.total > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <div className="flex-1 h-1.5 bg-border-light rounded-full overflow-hidden">
                <div
                  className="h-full bg-status-success rounded-full transition-all duration-300"
                  style={{ width: `${(uploadProgress.uploaded / uploadProgress.total) * 100}%` }}
                />
              </div>
              <span className="tabular-nums text-xs">
                {uploadProgress.uploaded}/{uploadProgress.total} uploaded
              </span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setState('scanning')}
              className="flex-1 py-3 border border-border-medium rounded-lg text-secondary text-sm font-medium"
            >
              Scan More
            </button>
            <button
              onClick={handleFinishUpload}
              className="flex-1 py-3 bg-accent-rust text-white rounded-lg text-sm font-medium"
            >
              Finish
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Done
  if (state === 'done') {
    return (
      <div className="min-h-dvh bg-cream flex items-center justify-center px-6">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-16 h-16 mx-auto rounded-full bg-status-success/15 flex items-center justify-center">
            <svg className="w-8 h-8 text-status-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="font-serif text-xl text-primary">Scan Complete</h1>
          <p className="text-sm text-muted">
            {pageCount} {pageCount === 1 ? 'page' : 'pages'} uploaded successfully.
          </p>
          {uploadFailed.length > 0 && (
            <p className="text-sm text-status-warning">
              {uploadFailed.length} {uploadFailed.length === 1 ? 'page' : 'pages'} failed to upload.
            </p>
          )}

          <div className="flex flex-col gap-3 pt-2">
            {bookSlug && (
              <a
                href={`/book/${bookSlug}`}
                className="block py-3 bg-accent-rust text-white rounded-lg text-sm font-medium text-center"
              >
                View Book
              </a>
            )}
            <button
              onClick={handleScanAnother}
              className="py-3 border border-border-medium rounded-lg text-secondary text-sm font-medium"
            >
              Scan Another Book
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// --- Onboarding helper components ---

function OnboardingStepPreview({ number, title, description }: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 shrink-0 rounded-full bg-accent-rust/10 text-accent-rust text-xs font-semibold flex items-center justify-center mt-0.5">
        {number}
      </div>
      <div>
        <p className="text-secondary font-medium text-sm">{title}</p>
        <p className="text-muted text-xs">{description}</p>
      </div>
    </div>
  );
}

function OnboardingTip({ diagram, text }: { diagram: React.ReactNode; text: string }) {
  return (
    <div className="bg-accent-sage/8 border border-accent-sage/20 rounded-xl p-3 flex flex-col items-center gap-2">
      <div className="w-full aspect-[4/3] flex items-center justify-center">{diagram}</div>
      <p className="text-xs text-secondary font-medium leading-snug">{text}</p>
    </div>
  );
}

// --- Onboarding SVG diagrams ---

function DiagramGreenOverlay() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full" fill="none" stroke="currentColor">
      {/* Book page */}
      <rect x="18" y="10" width="44" height="40" rx="1" strokeWidth="1.5" className="stroke-text-secondary" fill="white" />
      {/* Text lines */}
      <line x1="24" y1="18" x2="56" y2="18" strokeWidth="1" className="stroke-border-medium" />
      <line x1="24" y1="23" x2="56" y2="23" strokeWidth="1" className="stroke-border-medium" />
      <line x1="24" y1="28" x2="56" y2="28" strokeWidth="1" className="stroke-border-medium" />
      <line x1="24" y1="33" x2="44" y2="33" strokeWidth="1" className="stroke-border-medium" />
      {/* Green detection overlay */}
      <rect x="16" y="8" width="48" height="44" rx="2" strokeWidth="2.5" className="stroke-status-success" strokeDasharray="4 3" />
      {/* Corner markers */}
      <circle cx="16" cy="8" r="2.5" className="fill-status-success" />
      <circle cx="64" cy="8" r="2.5" className="fill-status-success" />
      <circle cx="16" cy="52" r="2.5" className="fill-status-success" />
      <circle cx="64" cy="52" r="2.5" className="fill-status-success" />
    </svg>
  );
}

function DiagramHoldSteady() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full" fill="none" stroke="currentColor">
      {/* Phone body */}
      <rect x="28" y="4" width="24" height="40" rx="3" strokeWidth="1.5" className="stroke-text-secondary" />
      {/* Camera lens */}
      <circle cx="40" cy="14" r="3" strokeWidth="1" className="stroke-accent-sage-dark" />
      {/* Wavy motion lines (crossed out) */}
      <path d="M12 16 Q16 12 20 16 Q24 20 28 16" strokeWidth="1.2" className="stroke-status-error" opacity="0.5" />
      <line x1="12" y1="12" x2="28" y2="20" strokeWidth="1" className="stroke-status-error" opacity="0.5" />
      {/* Steady lines (good) */}
      <line x1="52" y1="16" x2="68" y2="16" strokeWidth="1.2" className="stroke-status-success" />
      <line x1="52" y1="20" x2="68" y2="20" strokeWidth="1.2" className="stroke-status-success" />
      {/* Check mark under steady */}
      <polyline points="57,24 60,27 65,22" strokeWidth="1.2" className="stroke-status-success" strokeLinecap="round" strokeLinejoin="round" />
      {/* Countdown / timer indicator */}
      <circle cx="40" cy="52" r="5" strokeWidth="1.5" className="stroke-accent-sage-dark" />
      <path d="M40 49 L40 52 L42 53" strokeWidth="1" className="stroke-accent-sage-dark" strokeLinecap="round" />
    </svg>
  );
}

function DiagramConditionDots() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full" fill="none" stroke="currentColor">
      {/* Dark bar background */}
      <rect x="6" y="10" width="68" height="40" rx="8" className="fill-[#1a1612]" />
      {/* Four condition dots with labels */}
      <circle cx="18" cy="24" r="3" className="fill-status-success" />
      <text x="18" y="34" className="fill-white" fontSize="6" textAnchor="middle" fontWeight="500" opacity="0.7">Page</text>
      <circle cx="33" cy="24" r="3" className="fill-status-success" />
      <text x="33" y="34" className="fill-white" fontSize="6" textAnchor="middle" fontWeight="500" opacity="0.7">Stable</text>
      <circle cx="48" cy="24" r="3" className="fill-white" opacity="0.2" />
      <text x="48" y="34" className="fill-white" fontSize="6" textAnchor="middle" fontWeight="500" opacity="0.3">Focus</text>
      <circle cx="63" cy="24" r="3" className="fill-status-success" />
      <text x="63" y="34" className="fill-white" fontSize="6" textAnchor="middle" fontWeight="500" opacity="0.7">Light</text>
      {/* All green = ready indicator */}
      <text x="40" y="46" className="fill-status-success" fontSize="6" textAnchor="middle" fontWeight="600">All green = auto-capture</text>
    </svg>
  );
}

function DiagramManualShutter() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full" fill="none" stroke="currentColor">
      {/* Shutter button */}
      <circle cx="40" cy="28" r="16" strokeWidth="2" className="stroke-text-secondary" />
      <circle cx="40" cy="28" r="12" className="fill-white stroke-text-secondary" strokeWidth="1" />
      {/* Tap indicator — finger */}
      <path d="M54 42 Q56 38 56 34 L56 30 Q56 28 58 28 Q60 28 60 30 L60 44 Q60 50 54 52 L48 52" strokeWidth="1.5" className="stroke-accent-sage-dark" fill="none" />
      {/* Tap rays */}
      <line x1="20" y1="10" x2="24" y2="14" strokeWidth="1" className="stroke-accent-gold" />
      <line x1="40" y1="6" x2="40" y2="10" strokeWidth="1" className="stroke-accent-gold" />
      <line x1="60" y1="10" x2="56" y2="14" strokeWidth="1" className="stroke-accent-gold" />
    </svg>
  );
}

function DiagramEvenLight() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full" fill="none" stroke="currentColor">
      {/* Page */}
      <rect x="20" y="20" width="40" height="32" rx="1" strokeWidth="1.5" className="stroke-text-secondary" fill="white" />
      {/* Text lines */}
      <line x1="26" y1="28" x2="54" y2="28" strokeWidth="1" className="stroke-border-medium" />
      <line x1="26" y1="33" x2="54" y2="33" strokeWidth="1" className="stroke-border-medium" />
      <line x1="26" y1="38" x2="54" y2="38" strokeWidth="1" className="stroke-border-medium" />
      <line x1="26" y1="43" x2="42" y2="43" strokeWidth="1" className="stroke-border-medium" />
      {/* Light rays */}
      <line x1="30" y1="4" x2="30" y2="16" strokeWidth="1" className="stroke-accent-gold" strokeDasharray="2 2" />
      <line x1="40" y1="2" x2="40" y2="16" strokeWidth="1" className="stroke-accent-gold" strokeDasharray="2 2" />
      <line x1="50" y1="4" x2="50" y2="16" strokeWidth="1" className="stroke-accent-gold" strokeDasharray="2 2" />
      {/* Sun */}
      <circle cx="40" cy="6" r="3" strokeWidth="1" className="stroke-accent-gold" />
    </svg>
  );
}

function DiagramFlatPages() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full" fill="none" stroke="currentColor">
      {/* Left page flat */}
      <rect x="8" y="16" width="28" height="36" rx="1" strokeWidth="1.5" className="stroke-text-secondary" fill="white" />
      {/* Right page flat */}
      <rect x="44" y="16" width="28" height="36" rx="1" strokeWidth="1.5" className="stroke-text-secondary" fill="white" />
      {/* Spine */}
      <line x1="40" y1="14" x2="40" y2="54" strokeWidth="1.5" className="stroke-border-medium" strokeDasharray="3 2" />
      {/* Hands pressing down */}
      <path d="M16 12 L16 8 Q16 6 18 6 L24 6 Q26 6 26 8 L26 12" strokeWidth="1.2" className="stroke-accent-sage-dark" />
      <path d="M54 12 L54 8 Q54 6 56 6 L62 6 Q64 6 64 8 L64 12" strokeWidth="1.2" className="stroke-accent-sage-dark" />
      <polyline points="19,8 21,12 23,8" strokeWidth="1" className="stroke-accent-sage-dark" strokeLinejoin="round" />
      <polyline points="57,8 59,12 61,8" strokeWidth="1" className="stroke-accent-sage-dark" strokeLinejoin="round" />
    </svg>
  );
}

function DiagramOnePage() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full" fill="none" stroke="currentColor">
      {/* Single page */}
      <rect x="22" y="6" width="36" height="48" rx="1" strokeWidth="1.5" className="stroke-accent-sage-dark" fill="white" />
      {/* Text lines */}
      <line x1="28" y1="14" x2="52" y2="14" strokeWidth="1" className="stroke-border-medium" />
      <line x1="28" y1="20" x2="52" y2="20" strokeWidth="1" className="stroke-border-medium" />
      <line x1="28" y1="26" x2="52" y2="26" strokeWidth="1" className="stroke-border-medium" />
      <line x1="28" y1="32" x2="42" y2="32" strokeWidth="1" className="stroke-border-medium" />
      {/* Check mark */}
      <polyline points="36,40 40,44 48,36" strokeWidth="1.5" className="stroke-accent-sage-dark" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DiagramContrast() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full" fill="none" stroke="currentColor">
      {/* Dark table surface */}
      <rect x="4" y="4" width="72" height="52" rx="3" className="fill-[#2a2420]" />
      {/* White page on dark background */}
      <rect x="18" y="10" width="44" height="40" rx="1" strokeWidth="1.5" className="stroke-text-secondary" fill="white" />
      {/* Text lines */}
      <line x1="24" y1="18" x2="56" y2="18" strokeWidth="1" className="stroke-border-medium" />
      <line x1="24" y1="23" x2="56" y2="23" strokeWidth="1" className="stroke-border-medium" />
      <line x1="24" y1="28" x2="56" y2="28" strokeWidth="1" className="stroke-border-medium" />
      <line x1="24" y1="33" x2="44" y2="33" strokeWidth="1" className="stroke-border-medium" />
      {/* Contrast arrows */}
      <line x1="10" y1="30" x2="16" y2="30" strokeWidth="1.2" className="stroke-accent-gold" />
      <polyline points="14,27 17,30 14,33" strokeWidth="1" className="stroke-accent-gold" strokeLinejoin="round" />
      <line x1="64" y1="30" x2="70" y2="30" strokeWidth="1.2" className="stroke-accent-gold" />
      <polyline points="66,27 63,30 66,33" strokeWidth="1" className="stroke-accent-gold" strokeLinejoin="round" />
    </svg>
  );
}
