'use client';

import { useState, useRef, useCallback } from 'react';
import { X, GripVertical, ArrowLeftRight } from 'lucide-react';
import type { ProcessedFile } from '@/lib/scan/image-utils';

interface ReviewGridProps {
  files: ProcessedFile[];
  onReorder: (files: ProcessedFile[]) => void;
  onDelete: (id: string) => void;
}

export default function ReviewGrid({ files, onReorder, onDelete }: ReviewGridProps) {
  // Desktop: HTML5 drag-and-drop
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragCounter = useRef(0);
  const justDragged = useRef(false);

  // Mobile: tap-to-select, tap-to-swap
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    justDragged.current = true;
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
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

  // Mobile tap-to-swap: first tap selects, second tap on different card swaps
  const handleTapReorder = useCallback((id: string) => {
    // Suppress click fired after desktop drag-and-drop
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }

    if (!selectedId) {
      setSelectedId(id);
      if (navigator.vibrate) navigator.vibrate(30);
      return;
    }

    if (selectedId === id) {
      // Tapped same card — deselect
      setSelectedId(null);
      return;
    }

    // Swap the two cards
    const fromIndex = files.findIndex(f => f.id === selectedId);
    const toIndex = files.findIndex(f => f.id === id);
    if (fromIndex === -1 || toIndex === -1) {
      setSelectedId(null);
      return;
    }

    const reordered = [...files];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    onReorder(reordered);
    setSelectedId(null);
    if (navigator.vibrate) navigator.vibrate(30);
  }, [selectedId, files, onReorder]);

  if (files.length === 0) return null;

  return (
    <div>
      {/* Mobile reorder hint */}
      {selectedId && (
        <div className="sm:hidden mb-2 text-center text-xs text-accent-rust flex items-center justify-center gap-1.5">
          <ArrowLeftRight className="w-3 h-3" />
          Tap another page to swap positions
        </div>
      )}
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
        {files.map((pf, index) => {
          const isDragging = draggedId === pf.id;
          const isDragOver = dragOverId === pf.id;
          const isSelected = selectedId === pf.id;
          const isSwapTarget = selectedId && selectedId !== pf.id;
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
              onClick={() => handleTapReorder(pf.id)}
              className={`group relative cursor-grab active:cursor-grabbing select-none ${
                isDragging ? 'opacity-40' : ''
              } ${isSelected ? 'ring-2 ring-accent-rust scale-95' : ''
              } ${isSwapTarget ? 'sm:cursor-grab max-sm:cursor-pointer' : ''}`}
            >
              <div
                className={`aspect-[3/4] bg-white rounded-lg overflow-hidden border-2 relative transition-all ${
                  isDragOver
                    ? 'border-accent-rust shadow-lg scale-105'
                    : isSelected
                      ? 'border-accent-rust'
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
                <div className="absolute top-0.5 right-5 p-0.5 bg-black/60 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity max-sm:hidden">
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
    </div>
  );
}
