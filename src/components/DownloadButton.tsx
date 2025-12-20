'use client';

import { useState, useRef, useEffect } from 'react';
import { Download, ChevronDown, FileText, Languages, Layers, BookOpen } from 'lucide-react';

interface DownloadButtonProps {
  bookId: string;
  hasTranslations: boolean;
  hasOcr: boolean;
}

export default function DownloadButton({ bookId, hasTranslations, hasOcr }: DownloadButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const handleDownload = async (format: 'translation' | 'ocr' | 'both' | 'epub-translation' | 'epub-ocr' | 'epub-both') => {
    setDownloading(format);
    try {
      const response = await fetch(`/api/books/${bookId}/download?format=${format}`);
      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const defaultExt = format.startsWith('epub-') ? 'epub' : 'txt';
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
      alert('Download failed. Please try again.');
    } finally {
      setDownloading(null);
    }
  };

  // Don't show if no content available
  if (!hasTranslations && !hasOcr) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors"
      >
        <Download className="w-4 h-4" />
        Download
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-lg shadow-xl border border-stone-200 py-2 z-50">
          <div className="px-3 py-2 text-xs font-medium text-stone-500 uppercase tracking-wide border-b border-stone-100">
            Download as TXT
          </div>

          {hasTranslations && (
            <button
              onClick={() => handleDownload('translation')}
              disabled={downloading !== null}
              className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-stone-50 transition-colors disabled:opacity-50"
            >
              <Languages className="w-4 h-4 text-green-600" />
              <div className="text-left">
                <div className="text-sm font-medium text-stone-900">English Translation</div>
                <div className="text-xs text-stone-500">Translated text only</div>
              </div>
              {downloading === 'translation' && (
                <div className="ml-auto w-4 h-4 border-2 border-stone-300 border-t-amber-500 rounded-full animate-spin" />
              )}
            </button>
          )}

          {hasOcr && (
            <button
              onClick={() => handleDownload('ocr')}
              disabled={downloading !== null}
              className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-stone-50 transition-colors disabled:opacity-50"
            >
              <FileText className="w-4 h-4 text-blue-600" />
              <div className="text-left">
                <div className="text-sm font-medium text-stone-900">Original Text (OCR)</div>
                <div className="text-xs text-stone-500">Source language transcription</div>
              </div>
              {downloading === 'ocr' && (
                <div className="ml-auto w-4 h-4 border-2 border-stone-300 border-t-amber-500 rounded-full animate-spin" />
              )}
            </button>
          )}

          {hasTranslations && hasOcr && (
            <button
              onClick={() => handleDownload('both')}
              disabled={downloading !== null}
              className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-stone-50 transition-colors disabled:opacity-50"
            >
              <Layers className="w-4 h-4 text-purple-600" />
              <div className="text-left">
                <div className="text-sm font-medium text-stone-900">Complete (Both)</div>
                <div className="text-xs text-stone-500">Original + translation per page</div>
              </div>
              {downloading === 'both' && (
                <div className="ml-auto w-4 h-4 border-2 border-stone-300 border-t-amber-500 rounded-full animate-spin" />
              )}
            </button>
          )}

          <div className="px-3 py-2 text-xs font-medium text-stone-500 uppercase tracking-wide border-t border-stone-100 mt-2">
            Download as EPUB
          </div>

          {hasTranslations && (
            <button
              onClick={() => handleDownload('epub-translation')}
              disabled={downloading !== null}
              className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-stone-50 transition-colors disabled:opacity-50"
            >
              <BookOpen className="w-4 h-4 text-green-600" />
              <div className="text-left">
                <div className="text-sm font-medium text-stone-900">English Translation</div>
                <div className="text-xs text-stone-500">E-reader format</div>
              </div>
              {downloading === 'epub-translation' && (
                <div className="ml-auto w-4 h-4 border-2 border-stone-300 border-t-amber-500 rounded-full animate-spin" />
              )}
            </button>
          )}

          {hasOcr && (
            <button
              onClick={() => handleDownload('epub-ocr')}
              disabled={downloading !== null}
              className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-stone-50 transition-colors disabled:opacity-50"
            >
              <BookOpen className="w-4 h-4 text-blue-600" />
              <div className="text-left">
                <div className="text-sm font-medium text-stone-900">Original Text (OCR)</div>
                <div className="text-xs text-stone-500">E-reader format</div>
              </div>
              {downloading === 'epub-ocr' && (
                <div className="ml-auto w-4 h-4 border-2 border-stone-300 border-t-amber-500 rounded-full animate-spin" />
              )}
            </button>
          )}

          {hasTranslations && hasOcr && (
            <button
              onClick={() => handleDownload('epub-both')}
              disabled={downloading !== null}
              className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-stone-50 transition-colors disabled:opacity-50"
            >
              <BookOpen className="w-4 h-4 text-purple-600" />
              <div className="text-left">
                <div className="text-sm font-medium text-stone-900">Complete (Both)</div>
                <div className="text-xs text-stone-500">E-reader format</div>
              </div>
              {downloading === 'epub-both' && (
                <div className="ml-auto w-4 h-4 border-2 border-stone-300 border-t-amber-500 rounded-full animate-spin" />
              )}
            </button>
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
