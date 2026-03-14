'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { Download, ChevronDown, FileText, Languages, Layers, BookOpen, Columns, Image, Lock } from 'lucide-react';
import { BookDownloadFormats, books } from '@/lib/api-client';

interface DownloadButtonProps {
  bookId: string;
  bookTitle?: string;
  hasTranslations: boolean;
  hasOcr: boolean;
  hasImages?: boolean;
  variant?: 'default' | 'header';
}

export default function DownloadButton({ bookId, bookTitle, hasTranslations, hasOcr, hasImages = true, variant = 'default' }: DownloadButtonProps) {
  const { data: session } = useSession();
  const isMember = (session?.user as any)?.membership != null;
  const [isOpen, setIsOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Check access on mount
  useEffect(() => {
    if (isMember) {
      setHasAccess(true);
      setAccessChecked(true);
      return;
    }
    if (session?.user) {
      fetch(`/api/access?type=book&itemId=${bookId}`)
        .then(r => r.json())
        .then(data => {
          setHasAccess(data.allowed);
          setAccessChecked(true);
        })
        .catch(() => setAccessChecked(true));
    } else {
      setAccessChecked(true);
    }
  }, [bookId, session, isMember]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDownload = async (format: BookDownloadFormats) => {
    setDownloading(format);
    try {
      const response = await books.download(bookId, format);

      // 402 = needs purchase
      if (response.status === 402) {
        setDownloading(null);
        handlePurchase();
        return;
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const defaultExt = format === 'images-zip' ? 'zip' : format.startsWith('epub-') ? 'epub' : 'txt';
      const filename = filenameMatch ? filenameMatch[1] : `download-${format}.${defaultExt}`;

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setIsOpen(false);
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Download failed. Please try again.');
    } finally {
      setDownloading(null);
    }
  };

  const handlePurchase = async () => {
    if (!session?.user) {
      window.location.href = `/auth/signin?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
      return;
    }

    setPurchasing(true);
    try {
      const res = await fetch('/api/stripe/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'book',
          itemId: bookId,
          itemName: bookTitle || bookId,
          returnUrl: window.location.pathname,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || 'Something went wrong');
        setPurchasing(false);
      }
    } catch {
      toast.error('Something went wrong');
      setPurchasing(false);
    }
  };

  // Don't show if no content available
  if (!hasTranslations && !hasOcr && !hasImages) {
    return null;
  }

  const showPrice = accessChecked && !hasAccess;

  const buttonClass = variant === 'header'
    ? "flex items-center gap-2 px-3 py-1.5 text-stone-300 hover:text-white hover:bg-white/10 rounded-lg text-sm transition-colors"
    : "flex items-center gap-2 px-4 py-2 bg-accent-gold/80 hover:bg-accent-rust text-white rounded-lg font-medium text-sm transition-colors";

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => {
          if (showPrice && !isOpen) {
            // First click opens dropdown which shows the purchase option
          }
          setIsOpen(!isOpen);
        }}
        className={buttonClass}
      >
        <Download className="w-4 h-4" />
        Download
        {showPrice && <span className="text-xs opacity-75">$4.99</span>}
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-lg shadow-xl border border-stone-200 py-2 z-50">
          {/* Purchase banner for non-members/non-purchasers */}
          {showPrice && (
            <div className="px-3 py-3 bg-amber-50 border-b border-stone-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-stone-800">Download this book</span>
                <span className="text-sm font-semibold text-stone-900">$4.99</span>
              </div>
              <button
                onClick={handlePurchase}
                disabled={purchasing}
                className="w-full py-2 bg-accent-rust hover:bg-accent-rust/90 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {purchasing ? 'Redirecting...' : 'Purchase — all formats included'}
              </button>
              <p className="mt-2 text-xs text-stone-500 text-center">
                or <a href="/ficino-society" className="underline">join the Ficino Society</a> for unlimited downloads
              </p>
            </div>
          )}

          <div className="px-3 py-2 text-xs font-medium text-stone-500 uppercase tracking-wide border-b border-stone-100">
            Download as TXT
          </div>

          {hasTranslations && (
            <DownloadOption
              format="translation"
              label="English Translation"
              desc="Translated text only"
              icon={<Languages className="w-4 h-4 text-status-success" />}
              onDownload={handleDownload}
              downloading={downloading}
              locked={showPrice}
            />
          )}

          {hasOcr && (
            <DownloadOption
              format="ocr"
              label="Original Text (OCR)"
              desc="Source language transcription"
              icon={<FileText className="w-4 h-4 text-blue-600" />}
              onDownload={handleDownload}
              downloading={downloading}
              locked={showPrice}
            />
          )}

          {hasTranslations && hasOcr && (
            <DownloadOption
              format="both"
              label="Complete (Both)"
              desc="Original + translation per page"
              icon={<Layers className="w-4 h-4 text-purple-600" />}
              onDownload={handleDownload}
              downloading={downloading}
              locked={showPrice}
            />
          )}

          <div className="px-3 py-2 text-xs font-medium text-stone-500 uppercase tracking-wide border-t border-stone-100 mt-2">
            Download as EPUB
          </div>

          {hasTranslations && (
            <DownloadOption
              format="epub-translation"
              label="English Translation"
              desc="E-reader format"
              icon={<BookOpen className="w-4 h-4 text-status-success" />}
              onDownload={handleDownload}
              downloading={downloading}
              locked={showPrice}
            />
          )}

          {hasOcr && (
            <DownloadOption
              format="epub-ocr"
              label="Original Text (OCR)"
              desc="E-reader format"
              icon={<BookOpen className="w-4 h-4 text-blue-600" />}
              onDownload={handleDownload}
              downloading={downloading}
              locked={showPrice}
            />
          )}

          {hasTranslations && hasOcr && (
            <DownloadOption
              format="epub-both"
              label="Complete (Both)"
              desc="E-reader format"
              icon={<BookOpen className="w-4 h-4 text-purple-600" />}
              onDownload={handleDownload}
              downloading={downloading}
              locked={showPrice}
            />
          )}

          {hasTranslations && hasOcr && (
            <DownloadOption
              format="epub-parallel"
              label="Parallel Text"
              desc="OCR + translation facing pages"
              icon={<Columns className="w-4 h-4 text-accent-rust" />}
              onDownload={handleDownload}
              downloading={downloading}
              locked={showPrice}
              className="border-t border-stone-100"
            />
          )}

          {hasTranslations && hasImages && (
            <DownloadOption
              format="epub-facsimile"
              label="Facsimile Edition"
              desc="Page images + translation"
              icon={<Image className="w-4 h-4 text-emerald-700" />}
              onDownload={handleDownload}
              downloading={downloading}
              locked={showPrice}
            />
          )}

          {hasImages && (
            <>
              <div className="px-3 py-2 text-xs font-medium text-stone-500 uppercase tracking-wide border-t border-stone-100 mt-2">
                Images Only
              </div>

              <DownloadOption
                format="epub-images"
                label="EPUB (Images)"
                desc="Page images as e-book"
                icon={<BookOpen className="w-4 h-4 text-stone-600" />}
                onDownload={handleDownload}
                downloading={downloading}
                locked={showPrice}
              />

              <DownloadOption
                format="images-zip"
                label="ZIP (Images)"
                desc="All page images as ZIP"
                icon={<Image className="w-4 h-4 text-stone-600" />}
                onDownload={handleDownload}
                downloading={downloading}
                locked={showPrice}
              />
            </>
          )}

          <div className="border-t border-stone-100 mt-2 pt-2 px-3 pb-1">
            <p className="text-xs text-stone-400">
              Downloads include source attribution and license info.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function DownloadOption({
  format,
  label,
  desc,
  icon,
  onDownload,
  downloading,
  locked,
  className = '',
}: {
  format: BookDownloadFormats;
  label: string;
  desc: string;
  icon: React.ReactNode;
  onDownload: (format: BookDownloadFormats) => void;
  downloading: string | null;
  locked: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={() => onDownload(format)}
      disabled={downloading !== null || locked}
      className={`w-full px-3 py-2.5 flex items-center gap-3 hover:bg-stone-50 transition-colors disabled:opacity-50 ${className}`}
    >
      {locked ? <Lock className="w-4 h-4 text-stone-300" /> : icon}
      <div className="text-left">
        <div className={`text-sm font-medium ${locked ? 'text-stone-400' : 'text-stone-900'}`}>{label}</div>
        <div className="text-xs text-stone-500">{desc}</div>
      </div>
      {downloading === format && (
        <div className="ml-auto w-4 h-4 border-2 border-stone-300 border-t-accent-gold rounded-full animate-spin" />
      )}
    </button>
  );
}
