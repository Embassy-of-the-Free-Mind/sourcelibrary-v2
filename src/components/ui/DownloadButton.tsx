'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { Download, ChevronDown, FileText, Languages, Layers, BookOpen, Columns, Image } from 'lucide-react';
import { BookDownloadFormats, books } from '@/lib/api-client';

interface DownloadButtonProps {
  bookId: string;
  bookTitle?: string;
  hasTranslations: boolean;
  hasOcr: boolean;
  hasImages?: boolean;
  imageRestricted?: boolean;
  variant?: 'default' | 'header';
}

export default function DownloadButton({ bookId, bookTitle, hasTranslations, hasOcr, hasImages = true, imageRestricted = false, variant = 'default' }: DownloadButtonProps) {
  const { data: session } = useSession();
  const isMember = (session?.user as any)?.membership != null;
  const [isOpen, setIsOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check if payments are enabled; if not, everyone gets free access
    fetch('/api/config').then(r => r.json()).then(cfg => {
      if (!cfg.payments) {
        setHasAccess(true);
        setAccessChecked(true);
        return;
      }
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
    }).catch(() => {
      // Config fetch failed — default to free access
      setHasAccess(true);
      setAccessChecked(true);
    });
  }, [bookId, session, isMember]);

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
    // If no access, redirect to purchase
    if (accessChecked && !hasAccess) {
      handlePurchase();
      return;
    }

    setDownloading(format);
    try {
      const response = await books.download(bookId, format);

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

  if (!hasTranslations && !hasOcr && !hasImages) {
    return null;
  }

  const needsPurchase = accessChecked && !hasAccess;

  const buttonClass = variant === 'header'
    ? "flex items-center gap-2 px-3 py-1.5 text-stone-300 hover:text-white hover:bg-white/10 rounded-lg text-sm transition-colors"
    : "flex items-center gap-2 px-4 py-2 bg-accent-gold/80 hover:bg-accent-rust text-white rounded-lg font-medium text-sm transition-colors";

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={buttonClass}
      >
        <Download className="w-4 h-4" />
        Download
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-lg shadow-xl border border-stone-200 py-2 z-50">

          {/* Quiet download prompt for non-members */}
          {needsPurchase && (
            <div className="px-3 py-3 border-b border-stone-100">
              <button
                onClick={handlePurchase}
                disabled={purchasing}
                className="w-full py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {purchasing ? 'Redirecting...' : 'Download this book — $5'}
              </button>
              <p className="mt-2 text-xs text-stone-400 text-center">
                All formats included
              </p>
            </div>
          )}

          <div className="px-3 py-2 text-xs font-medium text-stone-500 uppercase tracking-wide border-b border-stone-100">
            TXT
          </div>

          {hasTranslations && (
            <FormatOption format="translation" label="English Translation" desc="Translated text only"
              icon={<Languages className="w-4 h-4 text-status-success" />}
              onDownload={handleDownload} downloading={downloading} />
          )}
          {hasOcr && (
            <FormatOption format="ocr" label="Original Text (OCR)" desc="Source language transcription"
              icon={<FileText className="w-4 h-4 text-blue-600" />}
              onDownload={handleDownload} downloading={downloading} />
          )}
          {hasTranslations && hasOcr && (
            <FormatOption format="both" label="Complete (Both)" desc="Original + translation per page"
              icon={<Layers className="w-4 h-4 text-purple-600" />}
              onDownload={handleDownload} downloading={downloading} />
          )}

          <div className="px-3 py-2 text-xs font-medium text-stone-500 uppercase tracking-wide border-t border-stone-100 mt-2">
            EPUB
          </div>

          {hasTranslations && (
            <FormatOption format="epub-translation" label="English Translation" desc="E-reader format"
              icon={<BookOpen className="w-4 h-4 text-status-success" />}
              onDownload={handleDownload} downloading={downloading} />
          )}
          {hasOcr && (
            <FormatOption format="epub-ocr" label="Original Text (OCR)" desc="E-reader format"
              icon={<BookOpen className="w-4 h-4 text-blue-600" />}
              onDownload={handleDownload} downloading={downloading} />
          )}
          {hasTranslations && hasOcr && (
            <FormatOption format="epub-both" label="Complete (Both)" desc="E-reader format"
              icon={<BookOpen className="w-4 h-4 text-purple-600" />}
              onDownload={handleDownload} downloading={downloading} />
          )}
          {hasTranslations && hasOcr && (
            <FormatOption format="epub-parallel" label="Parallel Text" desc="Facing pages"
              icon={<Columns className="w-4 h-4 text-accent-rust" />}
              onDownload={handleDownload} downloading={downloading} className="border-t border-stone-100" />
          )}
          {hasTranslations && hasImages && !imageRestricted && (
            <FormatOption format="epub-facsimile" label="Facsimile Edition" desc="Page images + translation"
              icon={<Image className="w-4 h-4 text-emerald-700" />}
              onDownload={handleDownload} downloading={downloading} />
          )}

          {hasImages && !imageRestricted && (
            <>
              <div className="px-3 py-2 text-xs font-medium text-stone-500 uppercase tracking-wide border-t border-stone-100 mt-2">
                Images
              </div>
              <FormatOption format="epub-images" label="EPUB (Images)" desc="Page images as e-book"
                icon={<BookOpen className="w-4 h-4 text-stone-600" />}
                onDownload={handleDownload} downloading={downloading} />
              <FormatOption format="images-zip" label="ZIP (Images)" desc="All page images as ZIP"
                icon={<Image className="w-4 h-4 text-stone-600" />}
                onDownload={handleDownload} downloading={downloading} />
            </>
          )}
          {hasImages && imageRestricted && (
            <div className="px-3 py-2 border-t border-stone-100 mt-2">
              <p className="text-xs text-stone-400">
                Image downloads unavailable &mdash; source institution&rsquo;s non-commercial license.
                View images on the book page.
              </p>
            </div>
          )}

          <div className="border-t border-stone-100 mt-2 pt-2 px-3 pb-1">
            <p className="text-xs text-stone-400">
              Downloads include source attribution and CC BY-SA 4.0 license.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function FormatOption({
  format, label, desc, icon, onDownload, downloading, className = '',
}: {
  format: BookDownloadFormats;
  label: string;
  desc: string;
  icon: React.ReactNode;
  onDownload: (format: BookDownloadFormats) => void;
  downloading: string | null;
  className?: string;
}) {
  return (
    <button
      onClick={() => onDownload(format)}
      disabled={downloading !== null}
      className={`w-full px-3 py-2.5 flex items-center gap-3 hover:bg-stone-50 transition-colors disabled:opacity-50 ${className}`}
    >
      {icon}
      <div className="text-left">
        <div className="text-sm font-medium text-stone-900">{label}</div>
        <div className="text-xs text-stone-500">{desc}</div>
      </div>
      {downloading === format && (
        <div className="ml-auto w-4 h-4 border-2 border-stone-300 border-t-accent-gold rounded-full animate-spin" />
      )}
    </button>
  );
}
