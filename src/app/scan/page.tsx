'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { perspectiveCorrect, needsCorrection } from '@/lib/perspective-correct';
import { processFiles, sortByTimestamp } from '@/lib/scan/image-utils';
import type { ProcessedFile } from '@/lib/scan/image-utils';
import ReviewGrid from '@/components/scan/ReviewGrid';

type Step =
  | 'onboarding-1'
  | 'onboarding-2'
  | 'onboarding-3'
  | 'title-page'
  | 'analyzing'
  | 'confirm'
  | 'adding-pages'
  | 'review'
  | 'uploading'
  | 'done';

interface Metadata {
  title: string;
  author: string;
  language: string;
  year: string;
  ocr_text: string;
}

type Corners = [number, number][];

const BATCH_SIZE = 5;

export default function ScanPage() {
  const [step, setStep] = useState<Step>('onboarding-1');
  const [titlePageFile, setTitlePageFile] = useState<File | null>(null);
  const [correctedBlob, setCorrectedBlob] = useState<Blob | null>(null);
  const [correctedPreview, setCorrectedPreview] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Metadata>({
    title: '', author: '', language: '', year: '', ocr_text: '',
  });
  const [bookId, setBookId] = useState<string | null>(null);
  const [bookSlug, setBookSlug] = useState<string | null>(null);
  const [pages, setPages] = useState<ProcessedFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processingCount, setProcessingCount] = useState(0);
  const [creating, setCreating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);

  // Warn before leaving with unuploaded files
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pages.length > 0 && step !== 'done') {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [pages.length, step]);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      pages.forEach(p => URL.revokeObjectURL(p.thumbnailUrl));
      if (correctedPreview) URL.revokeObjectURL(correctedPreview);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply perspective correction to the title page
  const correctImage = useCallback(async (
    file: File,
    pageCorners: Corners
  ): Promise<{ blob: Blob; previewUrl: string }> => {
    const img = await loadImage(file);

    if (!needsCorrection(pageCorners)) {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.92)
      );
      return { blob, previewUrl: URL.createObjectURL(blob) };
    }

    const imgW = img.width;
    const imgH = img.height;
    const pxCorners = pageCorners.map(([x, y]) => [x * imgW, y * imgH]);
    const topWidth = Math.hypot(pxCorners[1][0] - pxCorners[0][0], pxCorners[1][1] - pxCorners[0][1]);
    const botWidth = Math.hypot(pxCorners[2][0] - pxCorners[3][0], pxCorners[2][1] - pxCorners[3][1]);
    const leftHeight = Math.hypot(pxCorners[3][0] - pxCorners[0][0], pxCorners[3][1] - pxCorners[0][1]);
    const rightHeight = Math.hypot(pxCorners[2][0] - pxCorners[1][0], pxCorners[2][1] - pxCorners[1][1]);
    const outW = Math.round(Math.max(topWidth, botWidth));
    const outH = Math.round(Math.max(leftHeight, rightHeight));

    const blob = await perspectiveCorrect(img, pageCorners, outW, outH);
    return { blob, previewUrl: URL.createObjectURL(blob) };
  }, []);

  // Step 1: Title page captured
  const handleTitleCapture = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setTitlePageFile(file);
    setStep('analyzing');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/scan/analyze-title', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Analysis failed');

      const data = await res.json();
      setMetadata({
        title: data.title || '',
        author: data.author || '',
        language: data.language || '',
        year: data.year?.toString() || '',
        ocr_text: data.ocr_text || '',
      });

      if (data.corners && data.corners.length === 4) {
        const { blob, previewUrl } = await correctImage(file, data.corners);
        setCorrectedBlob(blob);
        setCorrectedPreview(previewUrl);
      } else {
        setCorrectedPreview(URL.createObjectURL(file));
        setCorrectedBlob(null);
      }

      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze title page');
      setStep('title-page');
    }
  }, [correctImage]);

  // Step 2: Confirm metadata and create book
  const handleConfirmAndCreate = useCallback(async () => {
    if (!metadata.title) return;

    setCreating(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('title', metadata.title);
      formData.append('author', metadata.author || 'Unknown');
      formData.append('language', metadata.language || 'Unknown');
      formData.append('published', metadata.year || 'Unknown');

      if (titlePageFile) {
        const imageToUpload = correctedBlob
          ? new File([correctedBlob], 'title-page.jpg', { type: 'image/jpeg' })
          : titlePageFile;
        formData.append('titlePage', imageToUpload);
      }

      const res = await fetch('/api/scan/create', { method: 'POST', body: formData });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create book');
      }

      const data = await res.json();
      setBookId(data.id);
      setBookSlug(data.slug);
      setStep('adding-pages');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create book');
    } finally {
      setCreating(false);
    }
  }, [metadata, titlePageFile, correctedBlob]);

  // Step 3: Add photos from camera roll
  const handleAddPhotos = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setProcessing(true);
    setProcessingCount(fileList.length);
    setError(null);

    try {
      const newFiles = Array.from(fileList);
      const processed = await processFiles(newFiles);

      setPages(prev => sortByTimestamp([...prev, ...processed]));
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process photos');
    } finally {
      setProcessing(false);
      setProcessingCount(0);
      if (pageInputRef.current) pageInputRef.current.value = '';
    }
  }, []);

  // Reorder pages
  const handleReorder = useCallback((reordered: ProcessedFile[]) => {
    setPages(reordered);
  }, []);

  // Delete a page
  const handleDelete = useCallback((id: string) => {
    setPages(prev => {
      const file = prev.find(p => p.id === id);
      if (file) URL.revokeObjectURL(file.thumbnailUrl);
      return prev.filter(p => p.id !== id);
    });
  }, []);

  // Step 5: Upload all pages
  const handleUploadAll = useCallback(async () => {
    if (!bookId || pages.length === 0) return;

    setStep('uploading');
    setUploadProgress({ done: 0, total: pages.length });
    setError(null);

    let uploaded = 0;

    // Upload in batches of BATCH_SIZE
    for (let i = 0; i < pages.length; i += BATCH_SIZE) {
      const batch = pages.slice(i, i + BATCH_SIZE);
      const formData = new FormData();
      formData.append('bookId', bookId);

      for (const pf of batch) {
        formData.append('files', pf.file);
      }

      try {
        const res = await fetch('/api/scan/upload', { method: 'POST', body: formData });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Upload batch failed (${res.status})`);
        }

        const data = await res.json();
        uploaded += data.uploaded || batch.length;
        setUploadProgress({ done: uploaded, total: pages.length });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
        // Don't return — continue trying remaining batches
      }
    }

    // Clean up thumbnails
    pages.forEach(p => URL.revokeObjectURL(p.thumbnailUrl));
    setStep('done');
  }, [bookId, pages]);

  // Reset everything
  const handleReset = useCallback(() => {
    pages.forEach(p => URL.revokeObjectURL(p.thumbnailUrl));
    if (correctedPreview) URL.revokeObjectURL(correctedPreview);

    setStep('onboarding-1');
    setTitlePageFile(null);
    setCorrectedBlob(null);
    setCorrectedPreview(null);
    setMetadata({ title: '', author: '', language: '', year: '', ocr_text: '' });
    setBookId(null);
    setBookSlug(null);
    setPages([]);
    setUploadProgress({ done: 0, total: 0 });
    setError(null);
    if (titleInputRef.current) titleInputRef.current.value = '';
  }, [pages, correctedPreview]);

  const totalPageCount = pages.length + (titlePageFile ? 1 : 0);

  return (
    <div className="min-h-[100dvh] bg-cream flex flex-col">
      {/* Header */}
      <header className="px-4 py-3 border-b border-border-light flex items-center gap-3">
        <a href="/" className="text-accent-rust font-serif text-lg">Source Library</a>
        <span className="text-muted text-sm">/</span>
        <span className="text-secondary font-medium text-sm">Book Scanner</span>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 py-8">
        <div className="w-full max-w-2xl">
          {error && (
            <div className="mb-4 p-3 bg-status-error/10 border border-status-error/20 rounded-lg text-status-error text-sm">
              {error}
              <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
            </div>
          )}

          {/* Onboarding walkthrough (3 pages) */}
          {(step === 'onboarding-1' || step === 'onboarding-2' || step === 'onboarding-3') && (
            <div className="max-w-md mx-auto flex flex-col min-h-[70dvh]">
              {/* Skip link */}
              <div className="text-right mb-4">
                <button
                  onClick={() => setStep('title-page')}
                  className="text-muted text-sm hover:text-secondary"
                >
                  Skip
                </button>
              </div>

              <div className="flex-1 flex flex-col justify-center">
                {step === 'onboarding-1' && (
                  <div className="text-center space-y-6">
                    <div className="w-20 h-20 mx-auto rounded-2xl bg-accent-rust/10 flex items-center justify-center">
                      <svg className="w-10 h-10 text-accent-rust" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                      </svg>
                    </div>
                    <div>
                      <h1 className="font-serif text-3xl text-primary mb-3">Scan a Book</h1>
                      <p className="text-secondary text-base leading-relaxed">
                        Digitize a rare book using your phone&apos;s camera.
                        AI will handle the OCR and translation automatically.
                      </p>
                    </div>
                    <div className="bg-warm rounded-xl p-5 text-left space-y-4">
                      <StepPreview
                        number="1"
                        title="Photograph the title page"
                        description="AI extracts the title, author, and language"
                      />
                      <StepPreview
                        number="2"
                        title="Photograph each page"
                        description="Use your camera app, then select all photos at once"
                      />
                      <StepPreview
                        number="3"
                        title="Review and upload"
                        description="Check order, remove bad shots, then upload"
                      />
                    </div>
                  </div>
                )}

                {step === 'onboarding-2' && (
                  <div className="text-center space-y-6">
                    <div className="w-20 h-20 mx-auto rounded-2xl bg-accent-sage/15 flex items-center justify-center">
                      <svg className="w-10 h-10 text-accent-sage-dark" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <h1 className="font-serif text-3xl text-primary mb-3">Getting Good Scans</h1>
                      <p className="text-secondary text-base leading-relaxed">
                        A few simple habits make a big difference in OCR quality.
                      </p>
                    </div>
                    <div className="bg-warm rounded-xl p-5 text-left space-y-4">
                      <Tip icon="sun" text="Good, even lighting — natural daylight is best" />
                      <Tip icon="check" text="Shoot straight down, parallel to the page" />
                      <Tip icon="check" text="Flatten the book and hold the spine open" />
                      <Tip icon="check" text="Keep all text in frame with a small margin" />
                      <Tip icon="check" text="One page per photo — not two-page spreads" />
                    </div>
                  </div>
                )}

                {step === 'onboarding-3' && (
                  <div className="text-center space-y-6">
                    <div className="w-20 h-20 mx-auto rounded-2xl bg-status-error/10 flex items-center justify-center">
                      <svg className="w-10 h-10 text-status-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                    </div>
                    <div>
                      <h1 className="font-serif text-3xl text-primary mb-3">Common Mistakes</h1>
                      <p className="text-secondary text-base leading-relaxed">
                        These will cause the AI to misread or skip text.
                      </p>
                    </div>
                    <div className="bg-status-error/5 border border-status-error/15 rounded-xl p-5 text-left space-y-4">
                      <Mistake text="Shadows across the page — blocks of text become unreadable" />
                      <Mistake text="Angled photos — perspective warps the text" />
                      <Mistake text="Curved pages near the spine — text bends and blurs" />
                      <Mistake text="Fingers covering text — hold from the very edges" />
                      <Mistake text="Blurry photos — tap to focus before each shot" />
                    </div>
                  </div>
                )}
              </div>

              {/* Navigation */}
              <div className="pt-8 space-y-3">
                {/* Dots */}
                <div className="flex justify-center gap-2">
                  {(['onboarding-1', 'onboarding-2', 'onboarding-3'] as const).map(s => (
                    <div
                      key={s}
                      className={`w-2 h-2 rounded-full transition-colors ${step === s ? 'bg-accent-rust' : 'bg-border-medium'}`}
                    />
                  ))}
                </div>

                <button
                  onClick={() => {
                    if (step === 'onboarding-1') setStep('onboarding-2');
                    else if (step === 'onboarding-2') setStep('onboarding-3');
                    else setStep('title-page');
                  }}
                  className="w-full py-3.5 bg-accent-rust text-white rounded-lg font-medium text-base"
                >
                  {step === 'onboarding-3' ? 'Start Scanning' : 'Next'}
                </button>
              </div>
            </div>
          )}

          {/* Step 1: Capture title page or enter manually */}
          {step === 'title-page' && (
            <div className="text-center space-y-6 max-w-md mx-auto">
              <div>
                <h1 className="font-serif text-2xl text-primary mb-2">Title Page</h1>
                <p className="text-muted text-sm">
                  Photograph the title page for AI metadata extraction, or enter details manually
                </p>
              </div>

              <label className="block cursor-pointer">
                <div className="border-2 border-dashed border-border-medium rounded-xl p-12 hover:border-accent-rust/40 transition-colors">
                  <div className="space-y-3">
                    <div className="w-12 h-12 mx-auto rounded-full bg-accent-rust/10 flex items-center justify-center">
                      <svg className="w-6 h-6 text-accent-rust" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                      </svg>
                    </div>
                    <p className="text-secondary font-medium">Tap to photograph title page</p>
                    <p className="text-muted text-xs">AI will extract title, author, and language</p>
                  </div>
                </div>
                <input
                  ref={titleInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleTitleCapture}
                />
              </label>

              <div className="flex items-center gap-3">
                <div className="flex-1 border-t border-border-light" />
                <span className="text-muted text-xs">or</span>
                <div className="flex-1 border-t border-border-light" />
              </div>

              <button
                onClick={() => setStep('confirm')}
                className="w-full py-3 border border-border-medium rounded-lg text-secondary font-medium text-sm hover:border-accent-rust/40 transition-colors"
              >
                Enter details manually
              </button>
            </div>
          )}

          {/* Step 1.5: Analyzing */}
          {step === 'analyzing' && (
            <div className="text-center space-y-4 max-w-md mx-auto py-12">
              <div className="w-10 h-10 border-2 border-accent-rust border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-secondary font-medium">Analyzing title page...</p>
              <p className="text-muted text-xs">Extracting title, author, and language</p>
            </div>
          )}

          {/* Step 2: Confirm metadata */}
          {step === 'confirm' && (
            <div className="space-y-5 max-w-md mx-auto">
              <h1 className="font-serif text-xl text-primary">Confirm Book Details</h1>

              {correctedPreview && (
                <div className="rounded-lg overflow-hidden border border-border-light">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={correctedPreview}
                    alt="Title page preview"
                    className="w-full max-h-64 object-contain bg-warm"
                  />
                </div>
              )}

              <div className="space-y-3">
                <Field
                  label="Title"
                  value={metadata.title}
                  onChange={v => setMetadata(m => ({ ...m, title: v }))}
                  required
                />
                <Field
                  label="Author"
                  value={metadata.author}
                  onChange={v => setMetadata(m => ({ ...m, author: v }))}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Language"
                    value={metadata.language}
                    onChange={v => setMetadata(m => ({ ...m, language: v }))}
                  />
                  <Field
                    label="Year"
                    value={metadata.year}
                    onChange={v => setMetadata(m => ({ ...m, year: v }))}
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setStep('title-page');
                    setTitlePageFile(null);
                    setCorrectedBlob(null);
                    if (correctedPreview) URL.revokeObjectURL(correctedPreview);
                    setCorrectedPreview(null);
                    setMetadata({ title: '', author: '', language: '', year: '', ocr_text: '' });
                    if (titleInputRef.current) titleInputRef.current.value = '';
                  }}
                  className="flex-1 py-3 border border-border-medium rounded-lg text-secondary text-sm font-medium"
                >
                  {titlePageFile ? 'Retake' : 'Back'}
                </button>
                <button
                  onClick={handleConfirmAndCreate}
                  disabled={!metadata.title || creating}
                  className="flex-1 py-3 bg-accent-rust text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Continue'}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Add remaining pages */}
          {(step === 'adding-pages' || (step === 'review' && !processing)) && (
            <div className="space-y-6">
              <div className="text-center">
                <h1 className="font-serif text-xl text-primary mb-1">
                  {metadata.title}
                </h1>
                <p className="text-muted text-sm">
                  {pages.length === 0
                    ? 'Add remaining pages from your camera roll'
                    : `${totalPageCount} pages total (1 title + ${pages.length} added)`
                  }
                </p>
              </div>

              {/* Review grid */}
              {pages.length > 0 && (
                <ReviewGrid
                  files={pages}
                  onReorder={handleReorder}
                  onDelete={handleDelete}
                />
              )}

              {/* Processing indicator */}
              {processing && (
                <div className="text-center py-6 space-y-3">
                  <div className="w-8 h-8 border-2 border-accent-rust border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-muted text-sm">
                    Processing {processingCount} {processingCount === 1 ? 'photo' : 'photos'}...
                  </p>
                </div>
              )}

              {/* Action buttons */}
              <div className="space-y-3">
                <label className="block cursor-pointer">
                  <div className="border-2 border-dashed border-border-medium rounded-xl p-6 hover:border-accent-rust/40 transition-colors text-center">
                    <div className="space-y-2">
                      <svg className="w-8 h-8 mx-auto text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      <p className="text-secondary font-medium text-sm">
                        {pages.length === 0 ? 'Add Photos' : 'Add More Photos'}
                      </p>
                      <p className="text-muted text-xs">Select multiple photos from your camera roll</p>
                    </div>
                  </div>
                  <input
                    ref={pageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleAddPhotos}
                    disabled={processing}
                  />
                </label>

                {pages.length > 0 && (
                  <button
                    onClick={handleUploadAll}
                    className="w-full py-3 bg-accent-rust text-white rounded-lg font-medium text-sm"
                  >
                    Upload All ({totalPageCount} pages)
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Step 5: Uploading */}
          {step === 'uploading' && (
            <div className="text-center space-y-6 max-w-md mx-auto py-8">
              <div>
                <h1 className="font-serif text-xl text-primary mb-2">Uploading Pages</h1>
                <p className="text-muted text-sm">
                  {uploadProgress.done} of {uploadProgress.total} pages uploaded
                </p>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-warm rounded-full h-3 overflow-hidden">
                <div
                  className="bg-accent-rust h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${uploadProgress.total > 0 ? (uploadProgress.done / uploadProgress.total) * 100 : 0}%`
                  }}
                />
              </div>

              <p className="text-muted text-xs">
                Do not close this page while uploading
              </p>
            </div>
          )}

          {/* Step 6: Done */}
          {step === 'done' && (
            <div className="text-center space-y-6 max-w-md mx-auto py-8">
              <div className="space-y-2">
                <div className="w-12 h-12 mx-auto rounded-full bg-status-success/10 flex items-center justify-center">
                  <svg className="w-6 h-6 text-status-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <h1 className="font-serif text-2xl text-primary">Book Uploaded</h1>
                <p className="text-secondary">
                  <span className="font-medium">{metadata.title}</span>
                  {' — '}
                  {totalPageCount} {totalPageCount === 1 ? 'page' : 'pages'}
                </p>
                <p className="text-muted text-sm">
                  The AI will OCR and translate your book automatically.
                </p>
              </div>

              <div className="space-y-3">
                {bookSlug && (
                  <a
                    href={`/book/${bookSlug}`}
                    className="block w-full py-3 bg-accent-rust text-white rounded-lg font-medium text-sm text-center"
                  >
                    View Book
                  </a>
                )}
                <button
                  onClick={handleReset}
                  className="block w-full py-3 border border-border-medium rounded-lg text-secondary font-medium text-sm"
                >
                  Scan Another Book
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Field({ label, value, onChange, required }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        className="w-full px-3 py-2.5 border border-border-medium rounded-lg text-primary bg-white text-sm focus:outline-none focus:border-accent-rust/40"
      />
    </div>
  );
}

function StepPreview({ number, title, description }: {
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

function Tip({ text, icon }: { text: string; icon?: 'check' | 'sun' }) {
  return (
    <div className="flex gap-2.5 items-start">
      {icon === 'sun' ? (
        <svg className="w-4 h-4 text-accent-gold-dark shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
        </svg>
      ) : (
        <svg className="w-4 h-4 text-accent-sage-dark shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      )}
      <p>{text}</p>
    </div>
  );
}

function Mistake({ text }: { text: string }) {
  return (
    <div className="flex gap-2.5 items-start">
      <svg className="w-4 h-4 text-status-error shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
      <p>{text}</p>
    </div>
  );
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}
