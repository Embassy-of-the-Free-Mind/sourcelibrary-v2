'use client';

import { RotateCcw, Check, Loader2 } from 'lucide-react';

interface CapturedPageReviewProps {
  imageDataUrl: string;
  pageNumber: number;
  onKeep: () => void;
  onRetake: () => void;
  isUploading: boolean;
}

export default function CapturedPageReview({
  imageDataUrl,
  pageNumber,
  onKeep,
  onRetake,
  isUploading,
}: CapturedPageReviewProps) {
  return (
    <div className="absolute inset-0 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-center px-4 py-3 bg-black/80">
        <h2 className="text-white font-medium">Review Page {pageNumber}</h2>
      </div>

      {/* Image preview */}
      <div className="flex-1 flex items-center justify-center p-4">
        <img
          src={imageDataUrl}
          alt={`Captured page ${pageNumber}`}
          className="max-w-full max-h-full object-contain rounded-lg"
        />
      </div>

      {/* Actions */}
      <div
        className="flex items-center justify-center gap-8 px-4 py-6 bg-black/80"
        style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
      >
        <button
          onClick={onRetake}
          disabled={isUploading}
          className="flex flex-col items-center gap-2 text-white disabled:opacity-50"
        >
          <div className="w-14 h-14 rounded-full bg-stone-700 flex items-center justify-center">
            <RotateCcw className="w-6 h-6" />
          </div>
          <span className="text-sm">Retake</span>
        </button>

        <button
          onClick={onKeep}
          disabled={isUploading}
          className="flex flex-col items-center gap-2 text-white disabled:opacity-50"
        >
          <div className="w-14 h-14 rounded-full bg-green-600 flex items-center justify-center">
            {isUploading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <Check className="w-6 h-6" />
            )}
          </div>
          <span className="text-sm">{isUploading ? 'Saving...' : 'Keep'}</span>
        </button>
      </div>
    </div>
  );
}
