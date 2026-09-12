'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { trackEvent } from '@/lib/track-event';
import { Download, ChevronDown, FileText, Languages, Layers, BookOpen, Image, GraduationCap, FileType } from 'lucide-react';
import { BookDownloadFormats, books } from '@/lib/api-client';
import { isImageFormat, isPremiumFormat } from '@/lib/download-formats';

type ImageAccess = 'open' | 'nc-free' | 'blocked';

interface DownloadButtonProps {
  bookId: string;
  bookTitle?: string;
  hasTranslations: boolean;
  hasOcr: boolean;
  hasImages?: boolean;
  imageRestricted?: boolean;
  imageAccess?: ImageAccess;
  variant?: 'default' | 'header';
  /** Hide the "Download" label + chevron — show only the icon. */
  iconOnly?: boolean;
  /**
   * Render the format list inline, with no trigger button and no popup. For
   * surfaces that ARE the download surface — the reader's Download drawer is
   * already a panel you opened on purpose, so making you press a button to
   * reveal a menu inside it is one gesture too many.
   */
  inline?: boolean;
}

export default function DownloadButton({ bookId, bookTitle, hasTranslations, hasOcr, hasImages = true, imageRestricted = false, imageAccess = 'open', variant = 'default', iconOnly = false, inline = false }: DownloadButtonProps) {
  const { data: session } = useSession();
  const isMember = (session?.user as any)?.membership != null;
  const [isOpen, setIsOpen] = useState(inline);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // All downloads require sign-in. Anonymous users see a Sign-in prompt
    // instead of the format menu.
    if (!session?.user) {
      setHasAccess(false);
      setAccessChecked(true);
      return;
    }
    if (isMember) {
      setHasAccess(true);
      setAccessChecked(true);
      return;
    }
    fetch(`/api/access?type=book&itemId=${bookId}`)
      .then(r => r.json())
      .then(data => {
        // `allowed` here gates the paid (text + open-image) formats. NC-free
        // image formats bypass this and are handled per-format in handleDownload.
        setHasAccess(!!data.allowed);
        setAccessChecked(true);
      })
      .catch(() => setAccessChecked(true));
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

  const isNcFreeFormat = (f: BookDownloadFormats) =>
    imageAccess === 'nc-free' && isImageFormat(f);

  const goToSignIn = () => {
    window.location.href = `/auth/signin?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
  };

  const handleDownload = async (format: BookDownloadFormats) => {
    // Anonymous → explain the gate, then offer sign-in. A bare redirect here
    // read as "the download errored" (real feedback, 2026-06-19): the page just
    // jumped to a login screen with no reason given. The toast names the gate
    // at the moment of the click and lets them choose to continue.
    if (!session?.user) {
      toast('Sign in to download', {
        description: 'Text formats are free once you sign in. Premium formats (facsimiles, parallel text, scholarly editions) need purchase or membership.',
        action: { label: 'Sign in', onClick: goToSignIn },
      });
      return;
    }

    // Text formats are free for any signed-in user (subject to a daily cap
    // enforced server-side). Only premium formats route through the paid
    // flow — and NC-free image formats are exempt even there.
    if (isPremiumFormat(format) && accessChecked && !hasAccess && !isNcFreeFormat(format)) {
      handlePurchase();
      return;
    }

    setDownloading(format);
    try {
      const response = await books.download(bookId, format);

      if (response.status === 401) {
        setDownloading(null);
        goToSignIn();
        return;
      }
      if (response.status === 402) {
        setDownloading(null);
        handlePurchase();
        return;
      }
      if (response.status === 429) {
        setDownloading(null);
        let message = 'Daily download limit reached (20 books/24h). For bulk or programmatic access, see /licensing.';
        try {
          const data = await response.json();
          if (data?.error) message = data.error;
        } catch {
          // Fall back to the generic message above.
        }
        toast.error(message);
        return;
      }
      // Any other failure (500, gateway 504/524, …) must NOT be saved as the
      // file: blobbing an error body handed users a .zip/.epub containing an
      // HTML error page — "downloaded but won't open" (footer feedback,
      // 2026-07-02).
      if (!response.ok) {
        setDownloading(null);
        toast.error(
          response.status === 504 || response.status === 524
            ? 'This book is taking too long to package — please try again, or pick a lighter format.'
            : 'Download failed. Please try again.'
        );
        return;
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const defaultExt = format === 'images-zip' ? 'zip' : format.startsWith('epub-') ? 'epub' : format.startsWith('pdf-') ? 'pdf' : 'txt';
      const filename = filenameMatch ? filenameMatch[1] : `download-${format}.${defaultExt}`;

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      trackEvent('download', { bookId, format });
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
      goToSignIn();
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

  const isAnonymous = accessChecked && !session?.user;
  const needsPurchase = accessChecked && !!session?.user && !hasAccess;
  const ncImagesFree = imageAccess === 'nc-free';

  const buttonClass = variant === 'header'
    ? "flex items-center gap-2 px-3 py-1.5 text-stone-300 hover:text-white hover:bg-white/10 rounded-lg text-sm transition-colors"
    : "flex items-center gap-2 px-4 py-2 bg-accent-gold/80 hover:bg-accent-rust text-white rounded-lg font-medium text-sm transition-colors";

  return (
    <div className={inline ? '' : 'relative'} ref={dropdownRef}>
      {!inline && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={buttonClass}
        >
          <Download className="w-4 h-4" />
          {!iconOnly && <>Download<ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} /></>}
        </button>
      )}

      {isOpen && (
        <>
        {/* Backdrop (mobile) — tap to dismiss */}
        {!inline && <div onClick={() => setIsOpen(false)} className="fixed inset-0 z-[9998] bg-black/30 sm:hidden" />}
        <div className={inline
          ? 'w-full bg-transparent border-0 shadow-none py-0'
          : 'fixed inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:bottom-auto sm:mt-2 sm:w-72 sm:max-h-[70vh] sm:rounded-lg bg-white shadow-xl border border-stone-200 py-2 z-[9999]'}>
          {/* Header with close (mobile bottom sheet) */}
          <div className="sm:hidden flex items-center justify-between px-4 pb-2 mb-1 border-b border-stone-100">
            <span className="text-[15px] font-semibold text-stone-900">Download</span>
            <button type="button" onClick={() => setIsOpen(false)} className="text-sm font-medium text-stone-500 hover:text-stone-800 px-2 py-1 -mr-2">Close</button>
          </div>

          {/* Sign-in wall — all downloads require an account */}
          {isAnonymous && (
            <div className="px-3 py-3 border-b border-stone-100">
              <button
                onClick={goToSignIn}
                className="w-full min-h-[48px] px-4 py-3.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-[15px] font-semibold transition-colors"
              >
                Sign in to download
              </button>
              <p className="mt-2 text-xs text-stone-400 text-center">
                {ncImagesFree ? 'Text formats and page scans are free once you sign in.' : 'Text formats are free once you sign in — premium formats (facsimiles, parallel text, scholarly editions) need a member account.'}
              </p>
            </div>
          )}

          {/* Quiet purchase prompt for signed-in non-members — text formats
              below are already free and download directly; this only unlocks
              the premium (image/apparatus) formats. */}
          {needsPurchase && (
            <div className="px-3 py-3 border-b border-stone-100">
              <button
                onClick={handlePurchase}
                disabled={purchasing}
                className="w-full py-3 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {purchasing ? 'Redirecting...' : 'Unlock premium formats ($5)'}
              </button>
              <p className="mt-2 text-xs text-stone-400 text-center">
                {ncImagesFree ? 'Page scans are free; scholarly editions included with purchase.' : 'Text formats below are already free — this unlocks facsimiles and scholarly editions.'}
              </p>
            </div>
          )}

          <div className="px-3 py-2 flex items-center justify-between border-b border-stone-100">
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wide">TXT</span>
            <span className="text-[10px] font-medium text-stone-500 uppercase tracking-wide">Free with sign-in</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-1 gap-1.5 sm:gap-0 px-3 sm:px-0 py-1.5 sm:py-0">
          {hasTranslations && (
            <FormatOption format="translation" label="English Translation" desc="Translated text only"
              icon={<Languages className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />}
              onDownload={handleDownload} downloading={downloading} />
          )}
          {hasOcr && (
            <FormatOption format="ocr" label="Original Text (OCR)" desc="Source language transcription"
              icon={<FileText className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />}
              onDownload={handleDownload} downloading={downloading} />
          )}
          {hasTranslations && hasOcr && (
            <FormatOption format="both" label="Complete (Both)" desc="Original + translation per page"
              icon={<Layers className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />}
              onDownload={handleDownload} downloading={downloading} />
          )}
          </div>

          <div className="px-3 py-2 text-xs font-medium text-stone-500 uppercase tracking-wide border-t border-stone-100 mt-2">
            PDF
          </div>

          {hasTranslations && hasImages && !imageRestricted && (
            <FormatOption format="pdf-facsimile" label="Facsimile PDF" desc="Scan facing its translation, like the reader"
              icon={<FileType className="w-4 h-4 text-[var(--text-secondary)]" />}
              onDownload={handleDownload} downloading={downloading} />
          )}
          {hasTranslations && (
            <FormatOption format="pdf-translation" label="English Translation (PDF)" desc="Translated text only"
              icon={<FileType className="w-4 h-4 text-[var(--text-secondary)]" />}
              onDownload={handleDownload} downloading={downloading} />
          )}

          <div className="px-3 py-2 text-xs font-medium text-stone-500 uppercase tracking-wide border-t border-stone-100 mt-2">
            EPUB
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-1 gap-1.5 sm:gap-0 px-3 sm:px-0 py-1.5 sm:py-0">
          {hasTranslations && (
            <FormatOption format="epub-translation" label="English Translation" desc="E-reader format"
              icon={<BookOpen className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />}
              onDownload={handleDownload} downloading={downloading} />
          )}
          {hasOcr && (
            <FormatOption format="epub-ocr" label="Original Text (OCR)" desc="E-reader format"
              icon={<BookOpen className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />}
              onDownload={handleDownload} downloading={downloading} />
          )}
          {/* Menu consolidation (#3920): epub-parallel and epub-parallel-fxl rows
              removed (76 and 5 clicks/90d; both sold the same proposition as
              epub-both, and the facing-page facsimile PDF covers the FXL desire).
              epub-scholarly and epub-bilingual merged into ONE Scholarly row —
              bilingual when the book has OCR, translation-only otherwise. All
              format keys remain valid on the routes for old links and scripts. */}
          {hasTranslations && hasOcr && (
            <FormatOption format="epub-both" label="Complete (Both)" desc="Original + translation, page by page"
              icon={<BookOpen className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />}
              onDownload={handleDownload} downloading={downloading} />
          )}
          {hasTranslations && (
            <FormatOption format={hasOcr ? 'epub-bilingual' : 'epub-scholarly'} label="Scholarly Edition"
              desc={hasOcr ? 'Original + translation with introduction & apparatus' : 'With introduction & apparatus'}
              icon={<GraduationCap className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />}
              onDownload={handleDownload} downloading={downloading} />
          )}
          {hasTranslations && hasImages && !imageRestricted && (
            <FormatOption format="epub-facsimile" label="Facsimile Edition" desc="Page images + translation (fixed layout)"
              icon={<Image className="w-4 h-4 text-[var(--text-secondary)]" />}
              onDownload={handleDownload} downloading={downloading} />
          )}
          </div>

          {hasImages && !imageRestricted && (
            <>
              <div className="px-3 py-2 border-t border-stone-100 mt-2 flex items-center justify-between">
                <span className="text-xs font-medium text-stone-500 uppercase tracking-wide">Page Scans</span>
                {ncImagesFree && (
                  <span className="text-[10px] font-medium text-stone-500 uppercase tracking-wide">Free with sign-in</span>
                )}
              </div>
              {/* epub-images row removed (#3920) — 44 clicks/90d vs 191 for the
                  ZIP; the key stays valid on the routes. */}
              <FormatOption format="images-zip" label="Download Scans (ZIP)" desc="All page images, lossless"
                icon={<Image className="w-4 h-4 text-[var(--text-secondary)]" />}
                onDownload={handleDownload} downloading={downloading} />
            </>
          )}
          {hasImages && imageRestricted && (
            <div className="px-3 py-2 border-t border-stone-100 mt-2">
              <p className="text-xs text-stone-400">
                Image downloads are unavailable: the source institution has not released these scans under a redistributable licence. The images are on the book page.
              </p>
            </div>
          )}

          <div className="border-t border-stone-100 mt-2 pt-2 px-3 pb-1">
            <p className="text-xs text-stone-400">
              Downloads include source attribution and CC BY-SA 4.0 license.
            </p>
          </div>
          <div className="sm:hidden h-[env(safe-area-inset-bottom)]" />
        </div>
        </>
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
      className={`w-full h-full min-h-[54px] sm:min-h-0 px-3.5 py-3 flex items-center justify-start gap-2.5 hover:bg-stone-50 active:bg-stone-100 transition-colors disabled:opacity-50 rounded-lg border border-stone-200 sm:border-0 sm:rounded-none text-left ${className}`}
    >
      {icon}
      <div className="min-w-0">
        <div className="text-[13px] sm:text-sm font-medium text-stone-900 leading-tight">{label}</div>
        <div className="hidden sm:block text-xs text-stone-500">{desc}</div>
      </div>
      {downloading === format && (
        <div className="ml-auto w-4 h-4 border-2 border-stone-300 border-t-accent-gold rounded-full animate-spin" />
      )}
    </button>
  );
}
