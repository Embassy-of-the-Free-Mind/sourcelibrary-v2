'use client';

import { useState } from 'react';
import Link from 'next/link';

export interface Passage {
  label: string;
  original?: string;
  translation: string;
  citation?: string;
  bookUrl?: string;
  language?: string;
}

interface PassageComparisonProps {
  passages: Passage[];
  commentary?: string;
  title?: string;
  showOriginal?: boolean;
}

const SCRIPT_FONTS: Record<string, string> = {
  Greek: 'font-serif',
  Latin: 'font-serif italic',
  Arabic: 'font-serif',
  Sanskrit: 'font-serif',
  Hebrew: 'font-serif',
};

export default function PassageComparison({
  passages,
  commentary,
  title,
  showOriginal: initialShowOriginal = false,
}: PassageComparisonProps) {
  const [showOriginal, setShowOriginal] = useState(initialShowOriginal);
  const hasOriginals = passages.some((p) => p.original);

  return (
    <div className="my-12">
      {/* Header */}
      {(title || hasOriginals) && (
        <div className="flex items-baseline justify-between mb-4 gap-4 flex-wrap">
          {title && (
            <h3 className="text-lg font-medium text-stone-700">{title}</h3>
          )}
          {hasOriginals && (
            <button
              onClick={() => setShowOriginal(!showOriginal)}
              className="text-xs text-stone-400 hover:text-stone-600 transition-colors border border-stone-200 rounded-full px-3 py-1"
            >
              {showOriginal ? 'Hide original' : 'Show original'}
            </button>
          )}
        </div>
      )}

      {/* Passage cards */}
      <div
        className={`grid gap-4 ${
          passages.length === 2
            ? 'md:grid-cols-2'
            : passages.length === 3
              ? 'lg:grid-cols-3'
              : 'md:grid-cols-2'
        }`}
      >
        {passages.map((passage, i) => (
          <div
            key={i}
            className="border border-stone-200 rounded-xl p-5 bg-white"
          >
            {/* Label */}
            <div className="text-xs text-stone-400 uppercase tracking-wider mb-3 flex items-center justify-between">
              <span>{passage.label}</span>
              {passage.bookUrl && passage.citation && (
                <Link
                  href={passage.bookUrl}
                  className="text-amber-700/60 hover:text-amber-700 transition-colors normal-case tracking-normal"
                >
                  {passage.citation} &rarr;
                </Link>
              )}
            </div>

            {/* Original text */}
            {showOriginal && passage.original && (
              <div className="mb-4 pb-4 border-b border-stone-100">
                <p
                  className={`text-sm leading-relaxed text-stone-500 ${
                    SCRIPT_FONTS[passage.language || ''] || 'font-serif'
                  }`}
                  dir={passage.language === 'Arabic' || passage.language === 'Hebrew' ? 'rtl' : 'ltr'}
                >
                  {passage.original}
                </p>
              </div>
            )}

            {/* Translation */}
            <p className="text-sm leading-relaxed text-stone-700 font-body">
              {passage.translation}
            </p>
          </div>
        ))}
      </div>

      {/* Commentary */}
      {commentary && (
        <div className="mt-6 text-sm text-stone-500 leading-relaxed font-body border-l-2 border-amber-700/20 pl-4">
          {commentary}
        </div>
      )}
    </div>
  );
}
