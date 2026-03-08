'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { perspectiveCorrect, needsCorrection } from '@/lib/perspective-correct';

type Step = 'title-page' | 'confirm' | 'scanning' | 'done';

interface Metadata {
  title: string;
  author: string;
  language: string;
  year: string;
  ocr_text: string;
}

type Corners = [number, number][];

export default function ScanPage() {
  const [step, setStep] = useState<Step>('title-page');
  const [titlePageFile, setTitlePageFile] = useState<File | null>(null);
  const [correctedBlob, setCorrectedBlob] = useState<Blob | null>(null);
  const [correctedPreview, setCorrectedPreview] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [metadata, setMetadata] = useState<Metadata>({
    title: '', author: '', language: '', year: '', ocr_text: '',
  });
  const [corners, setCorners] = useState<Corners | null>(null);
  const [bookId, setBookId] = useState<string | null>(null);
  const [bookSlug, setBookSlug] = useState<string | null>(null);
  const [capturedCount, setCapturedCount] = useState(0);
  const [showTips, setShowTips] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);

  // Show tips on first visit
  useEffect(() => {
    if (!localStorage.getItem('scan-tips-seen')) {
      setShowTips(true);
    }
  }, []);

  const dismissTips = useCallback(() => {
    setShowTips(false);
    localStorage.setItem('scan-tips-seen', '1');
  }, []);

  // Apply perspective correction to an image file
  const correctImage = useCallback(async (
    file: File,
    pageCorners: Corners
  ): Promise<{ blob: Blob; previewUrl: string }> => {
    const img = await loadImage(file);

    if (!needsCorrection(pageCorners)) {
      // No significant distortion — just pass through as JPEG
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

    // Calculate output dimensions from corner positions
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
    setAnalyzing(true);
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
      setCorners(data.corners || null);

      // Apply perspective correction if corners detected
      if (data.corners && data.corners.length === 4) {
        const { blob, previewUrl } = await correctImage(file, data.corners);
        setCorrectedBlob(blob);
        setCorrectedPreview(previewUrl);
      } else {
        // No corners — show original
        setCorrectedPreview(URL.createObjectURL(file));
        setCorrectedBlob(null);
      }

      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze title page');
    } finally {
      setAnalyzing(false);
    }
  }, [correctImage]);

  // Step 2: Confirm and create book
  const handleConfirmAndCreate = useCallback(async () => {
    if (!metadata.title || !titlePageFile) return;

    setCreating(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('title', metadata.title);
      formData.append('author', metadata.author || 'Unknown');
      formData.append('language', metadata.language || 'Unknown');
      formData.append('published', metadata.year || 'Unknown');

      // Upload corrected image if available, otherwise original
      const imageToUpload = correctedBlob
        ? new File([correctedBlob], 'title-page.jpg', { type: 'image/jpeg' })
        : titlePageFile;
      formData.append('titlePage', imageToUpload);

      const res = await fetch('/api/scan/create', { method: 'POST', body: formData });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create book');
      }

      const data = await res.json();
      setBookId(data.id);
      setBookSlug(data.slug);
      setCapturedCount(1); // Title page counts as page 1
      setStep('scanning');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create book');
    } finally {
      setCreating(false);
    }
  }, [metadata, titlePageFile, correctedBlob]);

  // Step 3: Scan additional pages
  const handlePageCapture = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !bookId) return;

    setUploading(true);
    setError(null);

    try {
      // Detect corners
      const cornerFormData = new FormData();
      cornerFormData.append('file', file);
      const cornerRes = await fetch('/api/scan/detect-corners', { method: 'POST', body: cornerFormData });
      let pageCorners: Corners | null = null;
      if (cornerRes.ok) {
        const cornerData = await cornerRes.json();
        pageCorners = cornerData.corners;
      }

      // Apply perspective correction if corners found
      let imageToUpload: File;
      if (pageCorners && pageCorners.length === 4 && needsCorrection(pageCorners)) {
        const { blob } = await correctImage(file, pageCorners);
        imageToUpload = new File([blob], `page-${Date.now()}.jpg`, { type: 'image/jpeg' });
      } else {
        imageToUpload = file;
      }

      // Upload via existing upload route
      const uploadFormData = new FormData();
      uploadFormData.append('bookId', bookId);
      uploadFormData.append('files', imageToUpload);
      const uploadRes = await fetch('/api/upload', { method: 'POST', body: uploadFormData });
      if (!uploadRes.ok) throw new Error('Upload failed');

      setCapturedCount(c => c + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload page');
    } finally {
      setUploading(false);
      // Reset input so same file can be re-selected
      if (pageInputRef.current) pageInputRef.current.value = '';
    }
  }, [bookId, correctImage]);

  return (
    <div className="min-h-[100dvh] bg-cream flex flex-col">
      {/* Header */}
      <header className="px-4 py-3 border-b border-border-light flex items-center gap-3">
        <a href="/" className="text-accent-rust font-serif text-lg">Source Library</a>
        <span className="text-muted text-sm">/</span>
        <span className="text-secondary font-medium text-sm">Book Scanner</span>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        {/* Scanning Tips Overlay */}
        {showTips && (
          <div className="fixed inset-0 bg-dark/60 z-50 flex items-center justify-center p-6">
            <div className="bg-cream rounded-xl max-w-sm w-full p-6 space-y-4">
              <h2 className="font-serif text-xl text-primary">Scanning Tips</h2>
              <ul className="space-y-3 text-sm text-secondary">
                <li className="flex gap-3">
                  <span className="text-lg leading-none">📐</span>
                  <span>Hold your phone directly above the page</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-lg leading-none">💡</span>
                  <span>Use even lighting — avoid shadows</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-lg leading-none">📖</span>
                  <span>Keep the page flat and fill the frame</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-lg leading-none">👆</span>
                  <span>Tap to focus before shooting</span>
                </li>
              </ul>
              <button
                onClick={dismissTips}
                className="w-full py-3 bg-accent-rust text-white rounded-lg font-medium text-sm"
              >
                Got it
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="w-full max-w-md mb-4 p-3 bg-status-error/10 border border-status-error/20 rounded-lg text-status-error text-sm">
            {error}
          </div>
        )}

        {/* Step 1: Capture title page */}
        {step === 'title-page' && (
          <div className="w-full max-w-md text-center space-y-6">
            <div>
              <h1 className="font-serif text-2xl text-primary mb-2">Scan a Book</h1>
              <p className="text-muted text-sm">
                Start by photographing the title page
              </p>
            </div>

            <label className="block cursor-pointer">
              <div className="border-2 border-dashed border-border-medium rounded-xl p-12 hover:border-accent-rust/40 transition-colors">
                {analyzing ? (
                  <div className="space-y-3">
                    <div className="w-8 h-8 border-2 border-accent-rust border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-muted text-sm">Analyzing title page...</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-4xl">📷</div>
                    <p className="text-secondary font-medium">Tap to photograph title page</p>
                    <p className="text-muted text-xs">The AI will extract title, author, and language</p>
                  </div>
                )}
              </div>
              <input
                ref={titleInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleTitleCapture}
                disabled={analyzing}
              />
            </label>
          </div>
        )}

        {/* Step 2: Confirm metadata */}
        {step === 'confirm' && (
          <div className="w-full max-w-md space-y-5">
            <h1 className="font-serif text-xl text-primary">Confirm Book Details</h1>

            {/* Corrected preview */}
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
                  setCorrectedPreview(null);
                  if (titleInputRef.current) titleInputRef.current.value = '';
                }}
                className="flex-1 py-3 border border-border-medium rounded-lg text-secondary text-sm font-medium"
              >
                Retake
              </button>
              <button
                onClick={handleConfirmAndCreate}
                disabled={!metadata.title || creating}
                className="flex-1 py-3 bg-accent-rust text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Continue Scanning'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Scan remaining pages */}
        {step === 'scanning' && (
          <div className="w-full max-w-md text-center space-y-6">
            <div>
              <h1 className="font-serif text-xl text-primary mb-1">
                Scanning: {metadata.title}
              </h1>
              <p className="text-accent-rust font-medium text-lg">
                {capturedCount} {capturedCount === 1 ? 'page' : 'pages'} captured
              </p>
            </div>

            <label className="block cursor-pointer">
              <div className="border-2 border-dashed border-border-medium rounded-xl p-10 hover:border-accent-rust/40 transition-colors">
                {uploading ? (
                  <div className="space-y-3">
                    <div className="w-8 h-8 border-2 border-accent-rust border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-muted text-sm">Processing page...</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-4xl">📷</div>
                    <p className="text-secondary font-medium">Tap to scan next page</p>
                  </div>
                )}
              </div>
              <input
                ref={pageInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handlePageCapture}
                disabled={uploading}
              />
            </label>

            <button
              onClick={() => setStep('done')}
              className="w-full py-3 border-2 border-accent-rust text-accent-rust rounded-lg font-medium text-sm"
            >
              Done Scanning
            </button>
          </div>
        )}

        {/* Step 4: Done */}
        {step === 'done' && (
          <div className="w-full max-w-md text-center space-y-6">
            <div className="space-y-2">
              <div className="text-4xl">✓</div>
              <h1 className="font-serif text-2xl text-primary">Book Scanned</h1>
              <p className="text-secondary">
                <span className="font-medium">{metadata.title}</span>
                {' — '}
                {capturedCount} {capturedCount === 1 ? 'page' : 'pages'}
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
                onClick={() => {
                  setStep('title-page');
                  setTitlePageFile(null);
                  setCorrectedBlob(null);
                  setCorrectedPreview(null);
                  setMetadata({ title: '', author: '', language: '', year: '', ocr_text: '' });
                  setCorners(null);
                  setBookId(null);
                  setBookSlug(null);
                  setCapturedCount(0);
                  setError(null);
                  if (titleInputRef.current) titleInputRef.current.value = '';
                }}
                className="block w-full py-3 border border-border-medium rounded-lg text-secondary font-medium text-sm"
              >
                Scan Another Book
              </button>
            </div>
          </div>
        )}
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

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    const url = URL.createObjectURL(file);
    img.src = url;
  });
}
