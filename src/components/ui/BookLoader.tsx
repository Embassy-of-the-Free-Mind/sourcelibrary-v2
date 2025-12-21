'use client';

import { cn } from '@/lib/utils';

interface BookLoaderProps {
  label?: string;
  className?: string;
}

export function BookLoader({ label = 'Loading...', className }: BookLoaderProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-6', className)}>
      {/* Animated book icon */}
      <div className="relative w-20 h-24">
        {/* Book spine */}
        <div className="absolute left-0 top-0 w-3 h-full bg-amber-700 rounded-l-sm" />

        {/* Book cover */}
        <div className="absolute left-2 top-0 w-16 h-full bg-amber-600 rounded-r shadow-lg animate-book-open origin-left">
          {/* Cover decoration */}
          <div className="absolute inset-2 border border-amber-500/30 rounded-r" />
          <div className="absolute top-4 left-3 right-3 h-0.5 bg-amber-500/40" />
          <div className="absolute top-6 left-3 right-3 h-0.5 bg-amber-500/40" />
          <div className="absolute bottom-4 left-3 right-3 h-0.5 bg-amber-500/40" />
        </div>

        {/* Pages (visible behind cover) */}
        <div className="absolute left-3 top-1 w-14 h-[calc(100%-8px)] bg-stone-100 rounded-r-sm">
          <div className="absolute inset-y-2 left-2 right-1 space-y-1">
            <div className="h-0.5 bg-stone-300 animate-pulse" style={{ animationDelay: '0ms' }} />
            <div className="h-0.5 bg-stone-300 animate-pulse" style={{ animationDelay: '100ms' }} />
            <div className="h-0.5 bg-stone-300 animate-pulse" style={{ animationDelay: '200ms' }} />
            <div className="h-0.5 bg-stone-300 animate-pulse" style={{ animationDelay: '300ms' }} />
            <div className="h-0.5 w-3/4 bg-stone-300 animate-pulse" style={{ animationDelay: '400ms' }} />
          </div>
        </div>

        {/* Glow effect */}
        <div className="absolute -inset-4 bg-amber-500/10 rounded-full blur-xl animate-pulse-glow" />
      </div>

      {/* Label */}
      <div className="text-center">
        <p className="text-stone-600 font-medium">{label}</p>
        <p className="text-stone-400 text-sm mt-1">Preparing your manuscript...</p>
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
