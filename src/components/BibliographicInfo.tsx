'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Check, ExternalLink, Image as ImageIcon, RotateCcw, AlertTriangle, Loader2, Pencil } from 'lucide-react';
import type { Book, ImageSource } from '@/lib/types';
import { IMAGE_LICENSES } from '@/lib/types';
import BookEditModal from './BookEditModal';
import { useRouter } from 'next/navigation';

interface BibliographicInfoProps {
  book: Book;
  pagesCount: number;
}

export default function BibliographicInfo({ book, pagesCount }: BibliographicInfoProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetMode, setResetMode] = useState<'soft' | 'full'>('soft');
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // Check if full reimport is available (requires IA source)
  const canFullReimport = book.ia_identifier || book.image_source?.provider === 'internet_archive';

  const handleReset = async () => {
    setResetting(true);
    setResetResult(null);
    try {
      const res = await fetch(`/api/books/${book.id}/reimport`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: resetMode })
      });
      const data = await res.json();
      if (res.ok) {
        setResetResult({ success: true, message: data.message });
        // Reload after short delay to show success message
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        setResetResult({ success: false, message: data.error || 'Reset failed' });
      }
    } catch (err) {
      setResetResult({ success: false, message: 'Network error' });
    } finally {
      setResetting(false);
    }
  };

  // Format a bibliographic citation
  const formatCitation = () => {
    const parts: string[] = [];

    // Author (last name first if possible)
    if (book.author) {
      parts.push(book.author);
    }

    // Title in italics (original language)
    if (book.title) {
      parts.push(`_${book.title}_`);
    }

    // Publication info
    const pubParts: string[] = [];
    if (book.place_published) pubParts.push(book.place_published);
    if (book.publisher) pubParts.push(book.publisher);
    if (book.published) pubParts.push(book.published);
    if (pubParts.length > 0) {
      parts.push(pubParts.join(': '));
    }

    // Format
    if (book.format) {
      parts.push(book.format);
    }

    // USTC
    if (book.ustc_id) {
      parts.push(`USTC ${book.ustc_id}`);
    }

    return parts.join('. ') + '.';
  };

  const handleCopy = async () => {
    const citation = formatCitation();
    try {
      await navigator.clipboard.writeText(citation);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const hasExtraInfo = book.place_published || book.publisher || book.format || book.ustc_id;

  return (
    <div className="mt-4">
      {/* Toggle button and Edit */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm text-stone-400 hover:text-stone-200 transition-colors"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          Bibliographic Info
        </button>
        <button
          onClick={() => setShowEditModal(true)}
          className="flex items-center gap-1.5 text-sm text-amber-400 hover:text-amber-300 transition-colors"
          title="Edit metadata"
        >
          <Pencil className="w-3.5 h-3.5" />
          Edit
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-3 p-4 bg-stone-800/50 rounded-lg border border-stone-700">
          <div className="space-y-2 text-sm">
            {/* Original title */}
            <div className="flex gap-2">
              <span className="text-stone-500 w-24 flex-shrink-0">Title:</span>
              <span className="text-stone-200 italic">{book.title}</span>
            </div>

            {/* Display title if different */}
            {book.display_title && book.display_title !== book.title && (
              <div className="flex gap-2">
                <span className="text-stone-500 w-24 flex-shrink-0">English:</span>
                <span className="text-stone-200">{book.display_title}</span>
              </div>
            )}

            {/* Author */}
            <div className="flex gap-2">
              <span className="text-stone-500 w-24 flex-shrink-0">Author:</span>
              <span className="text-stone-200">{book.author}</span>
            </div>

            {/* Language */}
            {book.language && (
              <div className="flex gap-2">
                <span className="text-stone-500 w-24 flex-shrink-0">Language:</span>
                <span className="text-stone-200">{book.language}</span>
              </div>
            )}

            {/* Publication details */}
            {book.place_published && (
              <div className="flex gap-2">
                <span className="text-stone-500 w-24 flex-shrink-0">Place:</span>
                <span className="text-stone-200">{book.place_published}</span>
              </div>
            )}

            {book.publisher && (
              <div className="flex gap-2">
                <span className="text-stone-500 w-24 flex-shrink-0">Publisher:</span>
                <span className="text-stone-200">{book.publisher}</span>
              </div>
            )}

            {book.published && (
              <div className="flex gap-2">
                <span className="text-stone-500 w-24 flex-shrink-0">Date:</span>
                <span className="text-stone-200">{book.published}</span>
              </div>
            )}

            {book.format && (
              <div className="flex gap-2">
                <span className="text-stone-500 w-24 flex-shrink-0">Format:</span>
                <span className="text-stone-200">{book.format}</span>
              </div>
            )}

            {/* Pages */}
            <div className="flex gap-2">
              <span className="text-stone-500 w-24 flex-shrink-0">Pages:</span>
              <span className="text-stone-200">{pagesCount}</span>
            </div>

            {/* USTC with link */}
            {book.ustc_id && (
              <div className="flex gap-2">
                <span className="text-stone-500 w-24 flex-shrink-0">USTC:</span>
                <a
                  href={`https://www.ustc.ac.uk/editions/${book.ustc_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-400 hover:text-amber-300 flex items-center gap-1"
                >
                  {book.ustc_id}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>

          {/* Image Source & License */}
          {book.image_source ? (
            <div className="mt-4 pt-4 border-t border-stone-700">
              <div className="flex items-center gap-2 mb-3">
                <ImageIcon className="w-4 h-4 text-stone-400" />
                <span className="text-sm font-medium text-stone-300">Image Source</span>
              </div>
              <div className="space-y-2 text-sm">
                {book.image_source.provider_name && (
                  <div className="flex gap-2">
                    <span className="text-stone-500 w-24 flex-shrink-0">Source:</span>
                    {book.image_source.source_url ? (
                      <a
                        href={book.image_source.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amber-400 hover:text-amber-300 flex items-center gap-1"
                      >
                        {book.image_source.provider_name}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-stone-200">{book.image_source.provider_name}</span>
                    )}
                  </div>
                )}
                {book.image_source.license && (
                  <div className="flex gap-2">
                    <span className="text-stone-500 w-24 flex-shrink-0">License:</span>
                    <span className="text-stone-200">
                      {IMAGE_LICENSES.find(l => l.id === book.image_source?.license)?.name || book.image_source.license}
                    </span>
                  </div>
                )}
                {book.image_source.attribution && (
                  <div className="flex gap-2">
                    <span className="text-stone-500 w-24 flex-shrink-0">Credit:</span>
                    <span className="text-stone-200">{book.image_source.attribution}</span>
                  </div>
                )}
                {/* Reset to Source button */}
                <div className="mt-3 pt-3 border-t border-stone-600">
                  <button
                    onClick={() => setShowResetModal(true)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-stone-400 hover:text-stone-200 hover:bg-stone-700 rounded-lg transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Reset to Source
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Reset option for books without image source (soft reset only) */
            <div className="mt-4 pt-4 border-t border-stone-700">
              <button
                onClick={() => setShowResetModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-stone-400 hover:text-stone-200 hover:bg-stone-700 rounded-lg transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Reset Content
              </button>
              <p className="text-stone-500 text-xs mt-1">Clear OCR and translation data</p>
            </div>
          )}

          {/* Copy citation button */}
          <div className="mt-4 pt-3 border-t border-stone-700">
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-3 py-1.5 bg-stone-700 hover:bg-stone-600 text-stone-200 rounded-lg text-sm transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-green-400" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy Citation
                </>
              )}
            </button>
            {/* Preview */}
            <p className="mt-2 text-xs text-stone-500 font-mono break-all">
              {formatCitation()}
            </p>
          </div>
        </div>
      )}

      {/* Reset Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-stone-800 rounded-xl max-w-md w-full p-6 border border-stone-700">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-amber-500/20 rounded-lg">
                <AlertTriangle className="w-6 h-6 text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Reset to Source</h3>
            </div>

            <p className="text-stone-300 text-sm mb-4">
              Choose how to reset this book&apos;s content:
            </p>

            <div className="space-y-3 mb-6">
              {/* Soft Reset Option */}
              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  resetMode === 'soft'
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-stone-600 hover:border-stone-500'
                }`}
              >
                <input
                  type="radio"
                  name="resetMode"
                  value="soft"
                  checked={resetMode === 'soft'}
                  onChange={() => setResetMode('soft')}
                  className="mt-1"
                />
                <div>
                  <span className="text-white font-medium">Soft Reset</span>
                  <p className="text-stone-400 text-sm mt-1">
                    Clear all OCR, translations, and summaries. Page images remain unchanged.
                  </p>
                </div>
              </label>

              {/* Full Reset Option */}
              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  !canFullReimport ? 'opacity-50 cursor-not-allowed' : ''
                } ${
                  resetMode === 'full'
                    ? 'border-red-500 bg-red-500/10'
                    : 'border-stone-600 hover:border-stone-500'
                }`}
              >
                <input
                  type="radio"
                  name="resetMode"
                  value="full"
                  checked={resetMode === 'full'}
                  onChange={() => canFullReimport && setResetMode('full')}
                  disabled={!canFullReimport}
                  className="mt-1"
                />
                <div>
                  <span className="text-white font-medium">Full Re-import</span>
                  <p className="text-stone-400 text-sm mt-1">
                    Delete all pages and re-import fresh from Internet Archive.
                  </p>
                  {!canFullReimport && (
                    <p className="text-red-400 text-xs mt-1">
                      Requires Internet Archive source
                    </p>
                  )}
                </div>
              </label>
            </div>

            {/* Result message */}
            {resetResult && (
              <div className={`p-3 rounded-lg mb-4 ${
                resetResult.success ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
              }`}>
                {resetResult.message}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowResetModal(false);
                  setResetResult(null);
                }}
                disabled={resetting}
                className="px-4 py-2 text-stone-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={resetting}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  resetMode === 'full'
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-amber-600 hover:bg-amber-700 text-white'
                }`}
              >
                {resetting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    {resetMode === 'full' ? 'Re-import' : 'Reset'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <BookEditModal
          book={book}
          onClose={() => setShowEditModal(false)}
          onSave={() => router.refresh()}
        />
      )}
    </div>
  );
}
