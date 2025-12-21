'use client';

import { ChevronLeft, ChevronRight, Loader2, X, Check } from 'lucide-react';
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
  applying
}: SplitReviewScreenProps) {
  return (
    <div className="fixed inset-0 bg-stone-100 z-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Review Splits</h2>
          <p className="text-sm text-stone-500">
            {pages.length} page{pages.length !== 1 ? 's' : ''} will be split (2% overlap on each side)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-4 py-2 text-sm text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <button
            onClick={onCancel}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-stone-200 text-stone-700 rounded-lg hover:bg-stone-300"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
          <button
            onClick={onApprove}
            disabled={applying}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
          >
            {applying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {applying ? 'Splitting...' : 'Apply Splits'}
          </button>
        </div>
      </div>

      {/* Content - Simple grid with larger images */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 max-w-7xl mx-auto">
          {pages.map((page, idx) => {
            const position = splitPositions[page.id] ?? 500;
            const imageUrl = page.photo_original || page.photo;
            const leftPercent = position / 10;

            return (
              <div key={page.id} className="bg-white rounded-xl border border-stone-200 p-4 shadow-sm">
                {/* Page header */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-stone-700">
                    Page {page.page_number}
                  </span>
                  <span className="text-xs text-stone-500">
                    {leftPercent.toFixed(1)}%
                  </span>
                </div>

                {/* Image with split line */}
                <div className="relative aspect-[4/3] bg-stone-100 rounded-lg overflow-hidden mb-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/image?url=${encodeURIComponent(imageUrl)}&w=200&q=60`}
                    alt={`Page ${page.page_number}`}
                    className="w-full h-full object-contain"
                    loading="eager"
                  />
                  {/* Left overlay */}
                  <div
                    className="absolute top-0 bottom-0 left-0 bg-blue-500/20"
                    style={{ width: `${leftPercent}%` }}
                  />
                  {/* Right overlay */}
                  <div
                    className="absolute top-0 bottom-0 right-0 bg-green-500/20"
                    style={{ width: `${100 - leftPercent}%` }}
                  />
                  {/* Split line */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                    style={{ left: `${leftPercent}%`, transform: 'translateX(-50%)' }}
                  />
                </div>

                {/* Position controls */}
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => onUpdatePosition(page.id, Math.max(100, position - 5))}
                    disabled={position <= 100}
                    className="p-1.5 bg-stone-100 rounded hover:bg-stone-200 disabled:opacity-30"
                  >
                    <ChevronLeft className="w-4 h-4 text-stone-600" />
                  </button>
                  <span className="text-sm font-medium text-stone-700 w-14 text-center">
                    {leftPercent.toFixed(1)}%
                  </span>
                  <button
                    onClick={() => onUpdatePosition(page.id, Math.min(900, position + 5))}
                    disabled={position >= 900}
                    className="p-1.5 bg-stone-100 rounded hover:bg-stone-200 disabled:opacity-30"
                  >
                    <ChevronRight className="w-4 h-4 text-stone-600" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
