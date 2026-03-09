'use client';

import { useState, useRef, useCallback } from 'react';
import { X, GripVertical } from 'lucide-react';
import type { ProcessedFile } from '@/lib/scan/image-utils';

interface ReviewGridProps {
  files: ProcessedFile[];
  onReorder: (files: ProcessedFile[]) => void;
  onDelete: (id: string) => void;
}

export default function ReviewGrid({ files, onReorder, onDelete }: ReviewGridProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragCounter = useRef(0);

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
    // Required for Firefox
    e.dataTransfer.setData('text/plain', id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== draggedId) {
      setDragOverId(id);
    }
  }, [draggedId]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
  }, []);

  const handleDragLeave = useCallback(() => {
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      setDragOverId(null);
      dragCounter.current = 0;
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOverId(null);
    setDraggedId(null);

    if (!draggedId || draggedId === targetId) return;

    const fromIndex = files.findIndex(f => f.id === draggedId);
    const toIndex = files.findIndex(f => f.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const reordered = [...files];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    onReorder(reordered);
  }, [draggedId, files, onReorder]);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragOverId(null);
    dragCounter.current = 0;
  }, []);

  // Touch-based reorder support
  const [touchDragId, setTouchDragId] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = useCallback((id: string) => {
    longPressTimer.current = setTimeout(() => {
      setTouchDragId(id);
      // Haptic feedback on supported devices
      if (navigator.vibrate) navigator.vibrate(50);
    }, 400);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setTouchDragId(null);
  }, []);

  const handleTouchMove = useCallback(() => {
    // Cancel long press if finger moves
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  if (files.length === 0) return null;

  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
      {files.map((pf, index) => {
        const isDragging = draggedId === pf.id;
        const isDragOver = dragOverId === pf.id;
        const isTouchDragging = touchDragId === pf.id;
        const isBlurry = pf.quality.blurScore < 0.15;
        const isDark = pf.quality.brightnessScore < 0.5;

        return (
          <div
            key={pf.id}
            draggable
            onDragStart={(e) => handleDragStart(e, pf.id)}
            onDragOver={(e) => handleDragOver(e, pf.id)}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, pf.id)}
            onDragEnd={handleDragEnd}
            onTouchStart={() => handleTouchStart(pf.id)}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
            className={`group relative cursor-grab active:cursor-grabbing select-none ${
              isDragging ? 'opacity-40' : ''
            } ${isTouchDragging ? 'ring-2 ring-accent-rust scale-95' : ''}`}
          >
            <div
              className={`aspect-[3/4] bg-white rounded-lg overflow-hidden border-2 relative transition-all ${
                isDragOver
                  ? 'border-accent-rust shadow-lg scale-105'
                  : 'border-border-light'
              }`}
            >
              {/* Thumbnail */}
              {pf.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pf.thumbnailUrl}
                  alt={`Page ${index + 1}`}
                  className="w-full h-full object-cover pointer-events-none"
                  draggable={false}
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] animate-shimmer" />
              )}

              {/* Page number */}
              <div className="absolute top-0.5 left-0.5 bg-black/60 text-white text-[10px] font-medium px-1 rounded">
                {index + 1}
              </div>

              {/* Drag handle (desktop hover) */}
              <div className="absolute top-0.5 right-5 p-0.5 bg-black/60 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity">
                <GripVertical className="w-3 h-3" />
              </div>

              {/* Delete button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(pf.id);
                }}
                className="absolute top-0.5 right-0.5 p-0.5 bg-black/60 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-status-error/80 sm:opacity-0 max-sm:opacity-100"
                aria-label={`Remove page ${index + 1}`}
              >
                <X className="w-3 h-3" />
              </button>

              {/* Quality badges */}
              {(isBlurry || isDark) && (
                <div className="absolute bottom-0.5 left-0.5 right-0.5 flex gap-0.5">
                  {isBlurry && (
                    <span className="bg-status-warning/90 text-white text-[9px] px-1 rounded-sm">
                      Blurry
                    </span>
                  )}
                  {isDark && (
                    <span className="bg-status-warning/90 text-white text-[9px] px-1 rounded-sm">
                      Dark
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
