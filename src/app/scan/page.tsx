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
                    <div>
                      <h1 className="font-serif text-3xl text-primary mb-3">Getting Good Scans</h1>
                      <p className="text-secondary text-base leading-relaxed">
                        A few simple habits make a big difference in OCR quality.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <IllustratedTip
                        diagram={<DiagramEvenLighting />}
                        text="Good, even lighting"
                      />
                      <IllustratedTip
                        diagram={<DiagramStraightDown />}
                        text="Shoot straight down"
                      />
                      <IllustratedTip
                        diagram={<DiagramFlattenBook />}
                        text="Hold pages flat"
                      />
                      <IllustratedTip
                        diagram={<DiagramOnePage />}
                        text="One page per photo"
                      />
                    </div>
                  </div>
                )}

                {step === 'onboarding-3' && (
                  <div className="text-center space-y-6">
                    <div>
                      <h1 className="font-serif text-3xl text-primary mb-3">Common Mistakes</h1>
                      <p className="text-secondary text-base leading-relaxed">
                        These will cause the AI to misread or skip text.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <IllustratedMistake
                        diagram={<DiagramShadow />}
                        text="Shadows across text"
                      />
                      <IllustratedMistake
                        diagram={<DiagramAngled />}
                        text="Angled photos"
                      />
                      <IllustratedMistake
                        diagram={<DiagramCurved />}
                        text="Curved near spine"
                      />
                      <IllustratedMistake
                        diagram={<DiagramFingers />}
                        text="Fingers covering text"
                      />
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


// --- Illustrated onboarding components ---

function IllustratedTip({ diagram, text }: { diagram: React.ReactNode; text: string }) {
  return (
    <div className="bg-accent-sage/8 border border-accent-sage/20 rounded-xl p-3 flex flex-col items-center gap-2">
      <div className="w-full aspect-[4/3] flex items-center justify-center">{diagram}</div>
      <p className="text-xs text-secondary font-medium leading-snug">{text}</p>
    </div>
  );
}

function IllustratedMistake({ diagram, text }: { diagram: React.ReactNode; text: string }) {
  return (
    <div className="bg-status-error/6 border border-status-error/15 rounded-xl p-3 flex flex-col items-center gap-2">
      <div className="w-full aspect-[4/3] flex items-center justify-center">{diagram}</div>
      <p className="text-xs text-secondary font-medium leading-snug">{text}</p>
    </div>
  );
}

// Tip diagrams — simple line illustrations of good scanning practices

function DiagramEvenLighting() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full" fill="none" stroke="currentColor">
      {/* Page */}
      <rect x="20" y="20" width="40" height="32" rx="1" strokeWidth="1.5" className="stroke-text-secondary" fill="white" />
      {/* Text lines */}
      <line x1="26" y1="28" x2="54" y2="28" strokeWidth="1" className="stroke-border-medium" />
      <line x1="26" y1="33" x2="54" y2="33" strokeWidth="1" className="stroke-border-medium" />
      <line x1="26" y1="38" x2="54" y2="38" strokeWidth="1" className="stroke-border-medium" />
      <line x1="26" y1="43" x2="42" y2="43" strokeWidth="1" className="stroke-border-medium" />
      {/* Light rays from above */}
      <line x1="30" y1="4" x2="30" y2="16" strokeWidth="1" className="stroke-accent-gold" strokeDasharray="2 2" />
      <line x1="40" y1="2" x2="40" y2="16" strokeWidth="1" className="stroke-accent-gold" strokeDasharray="2 2" />
      <line x1="50" y1="4" x2="50" y2="16" strokeWidth="1" className="stroke-accent-gold" strokeDasharray="2 2" />
      {/* Sun icon */}
      <circle cx="40" cy="6" r="3" strokeWidth="1" className="stroke-accent-gold" />
    </svg>
  );
}

function DiagramStraightDown() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full" fill="none" stroke="currentColor">
      {/* Page */}
      <rect x="20" y="32" width="40" height="24" rx="1" strokeWidth="1.5" className="stroke-text-secondary" fill="white" />
      {/* Text lines on page */}
      <line x1="26" y1="39" x2="54" y2="39" strokeWidth="1" className="stroke-border-medium" />
      <line x1="26" y1="43" x2="54" y2="43" strokeWidth="1" className="stroke-border-medium" />
      <line x1="26" y1="47" x2="54" y2="47" strokeWidth="1" className="stroke-border-medium" />
      {/* Phone */}
      <rect x="32" y="2" width="16" height="10" rx="2" strokeWidth="1.5" className="stroke-accent-sage-dark" />
      <circle cx="40" cy="7" r="2" strokeWidth="1" className="stroke-accent-sage-dark" />
      {/* Arrow straight down */}
      <line x1="40" y1="14" x2="40" y2="28" strokeWidth="1.5" className="stroke-accent-sage-dark" />
      <polyline points="36,24 40,30 44,24" strokeWidth="1.5" className="stroke-accent-sage-dark" strokeLinejoin="round" />
    </svg>
  );
}

function DiagramFlattenBook() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full" fill="none" stroke="currentColor">
      {/* Left page — flat */}
      <rect x="8" y="16" width="28" height="36" rx="1" strokeWidth="1.5" className="stroke-text-secondary" fill="white" />
      {/* Right page — flat */}
      <rect x="44" y="16" width="28" height="36" rx="1" strokeWidth="1.5" className="stroke-text-secondary" fill="white" />
      {/* Spine line */}
      <line x1="40" y1="14" x2="40" y2="54" strokeWidth="1.5" className="stroke-border-medium" strokeDasharray="3 2" />
      {/* Hands pressing down */}
      <path d="M16 12 L16 8 Q16 6 18 6 L24 6 Q26 6 26 8 L26 12" strokeWidth="1.2" className="stroke-accent-sage-dark" />
      <path d="M54 12 L54 8 Q54 6 56 6 L62 6 Q64 6 64 8 L64 12" strokeWidth="1.2" className="stroke-accent-sage-dark" />
      {/* Down arrows on hands */}
      <polyline points="19,8 21,12 23,8" strokeWidth="1" className="stroke-accent-sage-dark" strokeLinejoin="round" />
      <polyline points="57,8 59,12 61,8" strokeWidth="1" className="stroke-accent-sage-dark" strokeLinejoin="round" />
    </svg>
  );
}

function DiagramOnePage() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full" fill="none" stroke="currentColor">
      {/* Single page — centered, emphasized */}
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

// Mistake diagrams — illustrations of common scanning errors

function DiagramShadow() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full" fill="none" stroke="currentColor">
      {/* Page */}
      <rect x="16" y="8" width="48" height="44" rx="1" strokeWidth="1.5" className="stroke-text-secondary" fill="white" />
      {/* Text lines */}
      <line x1="22" y1="16" x2="58" y2="16" strokeWidth="1" className="stroke-border-medium" />
      <line x1="22" y1="22" x2="58" y2="22" strokeWidth="1" className="stroke-border-medium" />
      <line x1="22" y1="28" x2="58" y2="28" strokeWidth="1" className="stroke-border-medium" />
      <line x1="22" y1="34" x2="58" y2="34" strokeWidth="1" className="stroke-border-medium" />
      <line x1="22" y1="40" x2="46" y2="40" strokeWidth="1" className="stroke-border-medium" />
      {/* Shadow diagonal band */}
      <path d="M16 8 L48 8 L16 44 Z" className="fill-text-secondary/15" strokeWidth="0" />
      {/* X mark */}
      <line x1="54" y1="44" x2="60" y2="50" strokeWidth="1.5" className="stroke-status-error" strokeLinecap="round" />
      <line x1="60" y1="44" x2="54" y2="50" strokeWidth="1.5" className="stroke-status-error" strokeLinecap="round" />
    </svg>
  );
}

function DiagramAngled() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full" fill="none" stroke="currentColor">
      {/* Skewed page — trapezoid perspective */}
      <path d="M24 10 L62 6 L58 54 L20 50 Z" strokeWidth="1.5" className="stroke-text-secondary" fill="white" />
      {/* Skewed text lines */}
      <line x1="28" y1="17" x2="58" y2="14" strokeWidth="1" className="stroke-border-medium" />
      <line x1="27" y1="23" x2="58" y2="20" strokeWidth="1" className="stroke-border-medium" />
      <line x1="26" y1="29" x2="58" y2="26" strokeWidth="1" className="stroke-border-medium" />
      <line x1="25" y1="35" x2="58" y2="32" strokeWidth="1" className="stroke-border-medium" />
      <line x1="24" y1="41" x2="44" y2="39" strokeWidth="1" className="stroke-border-medium" />
      {/* X mark */}
      <line x1="8" y1="48" x2="14" y2="54" strokeWidth="1.5" className="stroke-status-error" strokeLinecap="round" />
      <line x1="14" y1="48" x2="8" y2="54" strokeWidth="1.5" className="stroke-status-error" strokeLinecap="round" />
    </svg>
  );
}

function DiagramCurved() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full" fill="none" stroke="currentColor">
      {/* Page with curved left edge (near spine) */}
      <path d="M24 6 L60 6 L60 54 L24 54 Q16 30 24 6 Z" strokeWidth="1.5" className="stroke-text-secondary" fill="white" />
      {/* Curved text lines — bending near spine */}
      <path d="M30 16 Q26 16 28 14" strokeWidth="1" className="stroke-border-medium" fill="none" />
      <line x1="30" y1="16" x2="54" y2="16" strokeWidth="1" className="stroke-border-medium" />
      <path d="M30 24 Q26 24 27 22" strokeWidth="1" className="stroke-border-medium" fill="none" />
      <line x1="30" y1="24" x2="54" y2="24" strokeWidth="1" className="stroke-border-medium" />
      <path d="M30 32 Q26 32 27 30" strokeWidth="1" className="stroke-border-medium" fill="none" />
      <line x1="30" y1="32" x2="54" y2="32" strokeWidth="1" className="stroke-border-medium" />
      <path d="M30 40 Q26 40 27 38" strokeWidth="1" className="stroke-border-medium" fill="none" />
      <line x1="30" y1="40" x2="44" y2="40" strokeWidth="1" className="stroke-border-medium" />
      {/* Spine indicator */}
      <line x1="18" y1="8" x2="18" y2="52" strokeWidth="2" className="stroke-border-medium" strokeDasharray="3 2" />
      {/* X mark */}
      <line x1="62" y1="46" x2="68" y2="52" strokeWidth="1.5" className="stroke-status-error" strokeLinecap="round" />
      <line x1="68" y1="46" x2="62" y2="52" strokeWidth="1.5" className="stroke-status-error" strokeLinecap="round" />
    </svg>
  );
}

function DiagramFingers() {
  return (
    <svg viewBox="0 0 80 60" className="w-full h-full" fill="none" stroke="currentColor">
      {/* Page */}
      <rect x="16" y="6" width="48" height="48" rx="1" strokeWidth="1.5" className="stroke-text-secondary" fill="white" />
      {/* Text lines */}
      <line x1="22" y1="14" x2="58" y2="14" strokeWidth="1" className="stroke-border-medium" />
      <line x1="22" y1="20" x2="58" y2="20" strokeWidth="1" className="stroke-border-medium" />
      <line x1="22" y1="26" x2="58" y2="26" strokeWidth="1" className="stroke-border-medium" />
      <line x1="22" y1="32" x2="58" y2="32" strokeWidth="1" className="stroke-border-medium" />
      {/* Finger shapes on bottom-right corner */}
      <path d="M52 54 Q52 42 56 38 Q58 36 60 38 Q62 40 62 46 L62 54" strokeWidth="1.5" className="stroke-status-error/60" fill="var(--bg-warm)" />
      <path d="M58 54 Q58 44 62 40 Q64 38 66 40 Q68 42 68 48 L68 54" strokeWidth="1.5" className="stroke-status-error/60" fill="var(--bg-warm)" />
      {/* X mark */}
      <line x1="6" y1="48" x2="12" y2="54" strokeWidth="1.5" className="stroke-status-error" strokeLinecap="round" />
      <line x1="12" y1="48" x2="6" y2="54" strokeWidth="1.5" className="stroke-status-error" strokeLinecap="round" />
    </svg>
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
