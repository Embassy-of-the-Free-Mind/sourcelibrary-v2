'use client';

import { useState } from 'react';
import { ArrowLeft, X, Check, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Page } from '@/lib/types';

interface SplitReviewScreenProps {
  pages: Page[];
  splitPositions: Record<string, number>;
  onUpdatePosition: (pageId: string, position: number) => void;
  onApprove: () => void;
  onBack: () => void;
  onCancel: () => void;
  applying: boolean;
}

export default function SplitReviewScreen({
  pages,
  splitPositions,
  onUpdatePosition,
  onApprove,
  onBack,
  onCancel,
  applying,
}: SplitReviewScreenProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const adjustPosition = (pageId: string, delta: number) => {
    const current = splitPositions[pageId] ?? 500;
    const newPos = Math.max(100, Math.min(900, current + delta));
    onUpdatePosition(pageId, newPos);
  };

  return (
    <div className="fixed inset-0 bg-stone-900 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-stone-800 border-b border-stone-700">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            disabled={applying}
            className="flex items-center gap-2 px-3 py-2 text-stone-300 hover:text-white hover:bg-stone-700 rounded-lg disabled:opacity-50"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="text-white">
            <h2 className="text-lg font-semibold">Review Splits</h2>
            <p className="text-sm text-stone-400">{pages.length} pages to split</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            disabled={applying}
            className="px-4 py-2 text-stone-300 hover:text-white hover:bg-stone-700 rounded-lg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onApprove}
            disabled={applying}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
          >
            {applying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Apply All Splits
              </>
            )}
          </button>
        </div>
      </div>

      {/* Grid of pages */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 max-w-7xl mx-auto">
          {pages.map((page, idx) => {
            const position = splitPositions[page.id] ?? 500;
            const leftPercent = position / 10;
            const imageUrl = page.photo_original || page.photo;

            return (
              <div
                key={page.id}
                className={`bg-stone-800 rounded-xl overflow-hidden border-2 transition-colors ${
                  selectedIndex === idx ? 'border-amber-500' : 'border-stone-700 hover:border-stone-600'
                }`}
                onClick={() => setSelectedIndex(idx)}
              >
                {/* Original image with split line */}
                <div className="relative aspect-[4/3] bg-stone-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/image?url=${encodeURIComponent(imageUrl)}&w=400&q=70`}
                    alt={`Page ${page.page_number}`}
                    className="w-full h-full object-contain"
                  />

                  {/* Split overlays */}
                  <div className="absolute inset-0 pointer-events-none">
                    {/* Left overlay */}
                    <div
                      className="absolute top-0 bottom-0 left-0 bg-blue-500/15"
                      style={{ width: `${leftPercent}%` }}
                    />
                    {/* Right overlay */}
                    <div
                      className="absolute top-0 bottom-0 right-0 bg-green-500/15"
                      style={{ width: `${100 - leftPercent}%` }}
                    />
                    {/* Split line */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                      style={{ left: `${leftPercent}%` }}
                    />
                  </div>
                </div>

                {/* Controls */}
                <div className="p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">Page {page.page_number}</span>
                    <span className="text-xs text-stone-400">{leftPercent.toFixed(0)}% / {(100 - leftPercent).toFixed(0)}%</span>
                  </div>

                  {/* Adjustment buttons */}
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); adjustPosition(page.id, -50); }}
                      disabled={position <= 100}
                      className="p-1.5 bg-stone-700 text-stone-300 rounded hover:bg-stone-600 disabled:opacity-30"
                      title="-5%"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); adjustPosition(page.id, -10); }}
                      disabled={position <= 100}
                      className="p-1 bg-stone-700 text-stone-300 rounded hover:bg-stone-600 disabled:opacity-30 text-xs"
                      title="-1%"
                    >
                      -1%
                    </button>
                    <div className="w-16 text-center">
                      <span className="text-xs text-stone-400">{position / 10}%</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); adjustPosition(page.id, 10); }}
                      disabled={position >= 900}
                      className="p-1 bg-stone-700 text-stone-300 rounded hover:bg-stone-600 disabled:opacity-30 text-xs"
                      title="+1%"
                    >
                      +1%
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); adjustPosition(page.id, 50); }}
                      disabled={position >= 900}
                      className="p-1.5 bg-stone-700 text-stone-300 rounded hover:bg-stone-600 disabled:opacity-30"
                      title="+5%"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Preview thumbnails */}
                  <div className="flex gap-2">
                    <div className="flex-1 aspect-[3/4] bg-stone-900 rounded overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/image?url=${encodeURIComponent(imageUrl)}&w=150&q=60&cx=0&cw=${position + 20}`}
                        alt="Left"
                        className="w-full h-full object-contain"
                      />
                      <div className="text-center text-xs text-blue-400 mt-1">Left</div>
                    </div>
                    <div className="flex-1 aspect-[3/4] bg-stone-900 rounded overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/image?url=${encodeURIComponent(imageUrl)}&w=150&q=60&cx=${position - 20}&cw=1000`}
                        alt="Right"
                        className="w-full h-full object-contain"
                      />
                      <div className="text-center text-xs text-green-400 mt-1">Right</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Instructions */}
      <div className="p-4 bg-stone-800 border-t border-stone-700 text-center text-sm text-stone-400">
        Click on a page to select it. Use the arrows to adjust split position. Each split creates 2 pages with a small overlap.
      </div>
    </div>
  );
}
