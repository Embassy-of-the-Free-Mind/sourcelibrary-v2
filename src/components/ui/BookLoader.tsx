'use client';

import { cn } from '@/lib/utils';

interface BookLoaderProps {
  label?: string;
  className?: string;
}

export function BookLoader({ label = 'Loading...', className }: BookLoaderProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-8', className)}>
      {/* Animated Source Library logo with emanating rings */}
      <div className="relative w-16 h-16">
        {/* Emanating rings that expand outward - matching logo circle proportions */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="absolute w-[67%] h-[67%] rounded-full border border-stone-400/50 animate-emanate" style={{ animationDelay: '0ms' }} />
          <div className="absolute w-[67%] h-[67%] rounded-full border border-stone-400/50 animate-emanate" style={{ animationDelay: '700ms' }} />
          <div className="absolute w-[67%] h-[67%] rounded-full border border-stone-400/50 animate-emanate" style={{ animationDelay: '1400ms' }} />
        </div>

        {/* Core logo - concentric circles matching logo.svg exactly */}
        <svg
          viewBox="0 0 24 24"
          className="w-16 h-16 relative z-10"
        >
          {/* Outer ring - r=10, matching logo */}
          <circle
            cx="12" cy="12" r="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="text-stone-700"
          />
          {/* Middle ring - r=7, matching logo */}
          <circle
            cx="12" cy="12" r="7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="text-stone-600"
          />
          {/* Inner ring - r=4, matching logo */}
          <circle
            cx="12" cy="12" r="4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="text-stone-500"
          />
        </svg>
      </div>

      {/* Label */}
      <div className="text-center">
        <p
          className="text-stone-500 text-lg tracking-wide"
          style={{ fontFamily: 'Cormorant Garamond, Georgia, serif' }}
        >
          Opening the source...
        </p>
      </div>
    </div>
  );
}

export function PageTurnLoader({ label = 'Loading page...', className }: BookLoaderProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4', className)}>
      {/* Animated pages */}
      <div className="relative w-16 h-20">
        {/* Stack of pages */}
        <div className="absolute inset-0 bg-stone-200 rounded shadow-sm" />
        <div className="absolute inset-0 bg-stone-100 rounded shadow-sm -translate-x-0.5 -translate-y-0.5" />
        <div className="absolute inset-0 bg-white rounded shadow-md -translate-x-1 -translate-y-1 animate-page-turn origin-left">
          {/* Page content lines */}
          <div className="p-2 space-y-1.5">
            <div className="h-1 bg-stone-200 rounded animate-shimmer bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%]" />
            <div className="h-1 bg-stone-200 rounded animate-shimmer bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%]" style={{ animationDelay: '100ms' }} />
            <div className="h-1 w-3/4 bg-stone-200 rounded animate-shimmer bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%]" style={{ animationDelay: '200ms' }} />
            <div className="h-1 bg-stone-200 rounded animate-shimmer bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%]" style={{ animationDelay: '300ms' }} />
            <div className="h-1 w-1/2 bg-stone-200 rounded animate-shimmer bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%]" style={{ animationDelay: '400ms' }} />
          </div>
        </div>
      </div>

      {/* Label */}
      <p className="text-stone-600 text-sm">{label}</p>
    </div>
  );
}
