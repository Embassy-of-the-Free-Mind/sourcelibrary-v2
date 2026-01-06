'use client';

import { useState, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface SplitModeOverlayProps {
  splitPosition: number; // 0-1000 scale
  onAdjust: (delta: number) => void;
  onSetPosition: (position: number) => void;
}

export default function SplitModeOverlay({
  splitPosition,
  onAdjust,
  onSetPosition,
}: SplitModeOverlayProps) {
  const leftPercent = splitPosition / 10;
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = moveEvent.clientX - rect.left;
      const percent = (x / rect.width) * 1000;
      const clamped = Math.max(100, Math.min(900, percent));
      onSetPosition(Math.round(clamped));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Click on grey zone: left side moves left, right side moves right
  const handleZoneClick = (e: React.MouseEvent, side: 'left' | 'right') => {
    e.stopPropagation();
    onAdjust(side === 'left' ? -5 : 5); // 0.5%
  };

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none">
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

      {/* Grey click zone - 4% total width (2% each side) */}
      <div
        className="absolute top-0 bottom-0 flex pointer-events-auto"
        style={{ left: `${leftPercent - 2}%`, width: '4%' }}
      >
        {/* Left click zone */}
        <div
          className="w-1/2 h-full bg-stone-400/20 cursor-pointer hover:bg-stone-400/30"
          onClick={(e) => handleZoneClick(e, 'left')}
        />
        {/* Right click zone */}
        <div
          className="w-1/2 h-full bg-stone-400/20 cursor-pointer hover:bg-stone-400/30"
          onClick={(e) => handleZoneClick(e, 'right')}
        />
      </div>

      {/* Split line - very thin, draggable */}
      <div
        className="absolute top-0 bottom-0 w-6 cursor-ew-resize pointer-events-auto flex items-center justify-center"
        style={{ left: `${leftPercent}%`, transform: 'translateX(-50%)' }}
        onMouseDown={handleMouseDown}
      >
        <div className={`w-px h-full ${isDragging ? 'bg-red-600' : 'bg-red-500'}`} />
      </div>

      {/* Arrow buttons */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAdjust(-5);
        }}
        disabled={splitPosition <= 100}
        className="absolute left-1 top-1/2 -translate-y-1/2 p-1.5 bg-white/95 rounded-lg shadow-md hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed pointer-events-auto border border-stone-200"
      >
        <ChevronLeft className="w-5 h-5 text-stone-700" />
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onAdjust(5);
        }}
        disabled={splitPosition >= 900}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 bg-white/95 rounded-lg shadow-md hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed pointer-events-auto border border-stone-200"
      >
        <ChevronRight className="w-5 h-5 text-stone-700" />
      </button>
    </div>
  );
}
