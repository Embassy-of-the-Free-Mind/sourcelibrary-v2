'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Check, ExternalLink, Image as ImageIcon } from 'lucide-react';
import type { Book, ImageSource } from '@/lib/types';
import { IMAGE_LICENSES } from '@/lib/types';

interface BibliographicInfoProps {
  book: Book;
  pagesCount: number;
}

export default function BibliographicInfo({ book, pagesCount }: BibliographicInfoProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

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
      {/* Toggle button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm text-stone-400 hover:text-stone-200 transition-colors"
      >
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        Bibliographic Info
      </button>

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
          {book.image_source && (
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
              </div>
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
    </div>
  );
}
