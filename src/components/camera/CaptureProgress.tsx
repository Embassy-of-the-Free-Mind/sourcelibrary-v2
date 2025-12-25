'use client';

import { RefreshCw, Check } from 'lucide-react';

interface CaptureProgressProps {
  capturedCount: number;
  onFlipCamera: () => void;
  onFinish: () => void;
  canFlip: boolean;
}

export default function CaptureProgress({
  capturedCount,
  onFlipCamera,
  onFinish,
  canFlip,
}: CaptureProgressProps) {
  return (
    <div
      className="flex items-center justify-between px-6 py-4 bg-black/80"
      style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
    >
      {/* Page counter */}
      <div className="flex items-center gap-2 min-w-[80px]">
        <span className="text-white font-medium">
          Page {capturedCount + 1}
        </span>
        {capturedCount > 0 && (
          <span className="text-stone-400 text-sm">
            ({capturedCount} saved)
          </span>
        )}
      </div>

      {/* Flip camera button */}
      {canFlip && (
        <button
          onClick={onFlipCamera}
          className="p-2 text-stone-400 hover:text-white transition-colors"
          aria-label="Switch camera"
        >
          <RefreshCw className="w-6 h-6" />
        </button>
      )}

      {/* Finish button */}
      <button
        onClick={onFinish}
        disabled={capturedCount === 0}
        className={`
          flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors
          ${capturedCount > 0
            ? 'bg-green-600 text-white hover:bg-green-700'
            : 'bg-stone-700 text-stone-400 cursor-not-allowed'
          }
        `}
      >
        <Check className="w-4 h-4" />
        Done
      </button>
    </div>
  );
}
