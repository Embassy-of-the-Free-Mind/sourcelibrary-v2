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
  const [state, setState] = useState<ScanState>('camera');
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
        // Analyze title page
        const formData = new FormData();
        formData.append('file', blob, 'title-page.jpg');
        if (corners) {
          formData.append('corners', JSON.stringify(corners));
        }

        const res = await fetch('/api/scan/analyze-title', {
          method: 'POST',
          body: formData,
        });

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
        setState('confirm');
      } catch (err) {
        setAnalyzeError(err instanceof Error ? err.message : 'Analysis failed');
        // Still go to confirm -- user can fill in manually
        setExtractedMetadata({ title: null, author: null, language: null, year: null });
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
