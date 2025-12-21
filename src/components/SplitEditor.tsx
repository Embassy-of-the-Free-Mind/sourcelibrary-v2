'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Check, Loader2 } from 'lucide-react';

interface SplitEditorProps {
  pageId: string;
  imageUrl: string;
  onSplit: (pageId: string, splitPosition: number) => Promise<void>;
  onClose: () => void;
}

export default function SplitEditor({ pageId, imageUrl, onSplit, onClose }: SplitEditorProps) {
  const [splitPosition, setSplitPosition] = useState(500); // 0-1000 scale
  const [isDragging, setIsDragging] = useState(false);
  const [applying, setApplying] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(100, Math.min(900, (x / rect.width) * 1000)); // Limit to 10%-90%
    setSplitPosition(Math.round(percentage));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left;
    const percentage = Math.max(100, Math.min(900, (x / rect.width) * 1000));
    setSplitPosition(Math.round(percentage));
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleMouseUp);
      };
    }
  }, [isDragging]);

  const handleApply = async () => {
    setApplying(true);
    try {
      await onSplit(pageId, splitPosition);
      onClose();
    } catch (error) {
      console.error('Split failed:', error);
      setApplying(false);
    }
  };

  const leftPercent = splitPosition / 10;
  const rightPercent = 100 - leftPercent;

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-black/50">
        <div className="text-white">
          <h2 className="text-lg font-semibold">Adjust Split Position</h2>
          <p className="text-sm text-white/70">Drag the line to set where to split</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-white/70 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={applying}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
          >
            {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Split Here
          </button>
        </div>
      </div>

      {/* Split Preview */}
      <div className="flex-1 flex items-center justify-center p-8 overflow-hidden">
        <div
          ref={containerRef}
          className="relative max-w-4xl max-h-full cursor-col-resize select-none"
        >
          {/* Main image */}
          {!imageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-stone-800">
              <Loader2 className="w-8 h-8 animate-spin text-white/50" />
            </div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Page to split"
            className={`max-h-[70vh] w-auto ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setImageLoaded(true)}
            draggable={false}
          />

          {/* Split line */}
          {imageLoaded && (
            <div
              className="absolute top-0 bottom-0 w-1 bg-red-500 cursor-col-resize"
              style={{ left: `${splitPosition / 10}%`, transform: 'translateX(-50%)' }}
              onMouseDown={handleMouseDown}
              onTouchStart={() => setIsDragging(true)}
            >
              {/* Handle */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-12 bg-red-500 rounded-full flex items-center justify-center shadow-lg">
                <div className="flex gap-0.5">
                  <div className="w-0.5 h-6 bg-white/70 rounded" />
                  <div className="w-0.5 h-6 bg-white/70 rounded" />
                </div>
              </div>
            </div>
          )}

          {/* Overlay showing left/right split */}
          {imageLoaded && (
            <>
              <div
                className="absolute top-0 bottom-0 left-0 bg-blue-500/10 border-r-0 pointer-events-none"
                style={{ width: `${splitPosition / 10}%` }}
              >
                <div className="absolute bottom-2 left-2 px-2 py-1 bg-blue-600 text-white text-xs rounded">
                  Left ({leftPercent.toFixed(0)}%)
                </div>
              </div>
              <div
                className="absolute top-0 bottom-0 right-0 bg-green-500/10 pointer-events-none"
                style={{ width: `${100 - splitPosition / 10}%` }}
              >
                <div className="absolute bottom-2 right-2 px-2 py-1 bg-green-600 text-white text-xs rounded">
                  Right ({rightPercent.toFixed(0)}%)
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Preview thumbnails */}
      {imageLoaded && (
        <div className="p-4 bg-black/50">
          <div className="flex items-center justify-center gap-8">
            <div className="text-center">
              <div className="text-xs text-white/50 mb-2">Left Page (will be first)</div>
              <div className="w-32 h-40 bg-stone-800 rounded overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/image?url=${encodeURIComponent(imageUrl)}&w=200&q=70&cx=0&cw=${splitPosition}`}
                  alt="Left preview"
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-white/50 mb-2">Right Page (will be second)</div>
              <div className="w-32 h-40 bg-stone-800 rounded overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/image?url=${encodeURIComponent(imageUrl)}&w=200&q=70&cx=${splitPosition}&cw=1000`}
                  alt="Right preview"
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
