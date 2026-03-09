'use client';

import type { CaptureConditions } from '@/lib/scan/auto-capture';

interface ScanControlsProps {
  pageCount: number;
  uploadProgress: { uploaded: number; total: number } | null;
  conditions: CaptureConditions;
  onManualCapture: () => void;
  onDone: () => void;
  isCapturing?: boolean;
  autoEnabled?: boolean;
  onToggleAuto?: () => void;
}

export default function ScanControls({
  pageCount,
  uploadProgress,
  conditions,
  onManualCapture,
  onDone,
  isCapturing = false,
  autoEnabled = true,
  onToggleAuto,
}: ScanControlsProps) {
  const allConditionsMet =
    conditions.stable && conditions.sharp && conditions.exposed && conditions.pageDetected;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-dark/85 backdrop-blur-md z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}
    >
      {/* Condition dots + page count */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-2.5">
          <ConditionDot active={conditions.pageDetected} label="Page" />
          <ConditionDot active={conditions.stable} label="Stable" />
          <ConditionDot active={conditions.sharp} label="Focus" />
          <ConditionDot active={conditions.exposed} label="Light" />
        </div>
        <span className="text-white/70 text-xs font-medium tabular-nums">
          {pageCount} {pageCount === 1 ? 'page' : 'pages'}
        </span>
      </div>

      {/* Shutter row */}
      <div className="flex items-center justify-between px-6 py-3">
        {/* Done button */}
        <button
          onClick={onDone}
          disabled={pageCount === 0}
          className="w-16 text-center text-white text-sm font-medium disabled:opacity-30"
        >
          Done
        </button>

        {/* Shutter button */}
        <button
          onClick={onManualCapture}
          className="relative flex items-center justify-center"
          aria-label="Capture page"
        >
          <div className={`w-[68px] h-[68px] rounded-full border-[3px] border-white flex items-center justify-center transition-transform active:scale-90 ${
            isCapturing ? 'scale-90' : ''
          }`}>
            <div className={`w-[56px] h-[56px] rounded-full transition-colors ${
              isCapturing ? 'bg-accent-rust' : 'bg-white'
            }`} />
          </div>
          {/* Pulsing ring when auto-capture is about to fire */}
          {autoEnabled && allConditionsMet && !isCapturing && (
            <div className="absolute inset-0 -m-1 rounded-full border-2 border-status-success animate-ping" />
          )}
        </button>

        {/* Auto toggle */}
        <button
          onClick={onToggleAuto}
          className={`w-16 text-center text-xs font-semibold uppercase tracking-wide rounded-full py-1 transition-colors ${
            autoEnabled
              ? 'bg-status-success/20 text-status-success'
              : 'bg-white/10 text-white/50'
          }`}
        >
          Auto
        </button>
      </div>

      {/* Upload progress */}
      {uploadProgress && uploadProgress.total > 0 && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-status-success rounded-full transition-all duration-300"
                style={{ width: `${(uploadProgress.uploaded / uploadProgress.total) * 100}%` }}
              />
            </div>
            <span className="text-white/50 text-[10px] tabular-nums whitespace-nowrap">
              {uploadProgress.uploaded}/{uploadProgress.total}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ConditionDot({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <div className={`w-1.5 h-1.5 rounded-full transition-colors ${
        active ? 'bg-status-success' : 'bg-white/20'
      }`} />
      <span className={`text-[10px] transition-colors ${
        active ? 'text-white/70' : 'text-white/30'
      }`}>
        {label}
      </span>
    </div>
  );
}
