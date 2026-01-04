'use client';

import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';

interface BookLoaderProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

const VERBS = ['Opening', 'Gathering', 'Seeking', 'Consulting', 'Retrieving'];

export function BookLoader({ className, size = 'md' }: BookLoaderProps) {
  const [verbIndex, setVerbIndex] = useState(0); // Always starts with "Opening"
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setIsAnimating(true);
      setTimeout(() => {
        // Pick a random verb (excluding current one)
        setVerbIndex((prev) => {
          const availableIndices = VERBS.map((_, i) => i).filter(i => i !== prev);
          return availableIndices[Math.floor(Math.random() * availableIndices.length)];
        });
        setIsAnimating(false);
      }, 300);
    }, 2500);

    return () => clearInterval(timer);
  }, []);

  const sizeClasses = {
    sm: { container: 'w-10 h-10', logo: 'w-10 h-10', text: 'text-sm', gap: 'gap-4' },
    md: { container: 'w-16 h-16', logo: 'w-16 h-16', text: 'text-lg', gap: 'gap-8' },
    lg: { container: 'w-24 h-24', logo: 'w-24 h-24', text: 'text-xl', gap: 'gap-10' },
  };

  const s = sizeClasses[size];

  return (
    <div className={cn('flex flex-col items-center justify-center', s.gap, className)}>
      {/* Animated Source Library logo with emanating rings */}
      <div className={cn('relative', s.container)}>
        {/* Emanating rings that expand outward */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="absolute w-[67%] h-[67%] rounded-full border border-stone-400/50 animate-emanate" style={{ animationDelay: '0ms' }} />
          <div className="absolute w-[67%] h-[67%] rounded-full border border-stone-400/50 animate-emanate" style={{ animationDelay: '700ms' }} />
          <div className="absolute w-[67%] h-[67%] rounded-full border border-stone-400/50 animate-emanate" style={{ animationDelay: '1400ms' }} />
        </div>

        {/* Core logo - concentric circles */}
        <svg
          viewBox="0 0 24 24"
          className={cn('relative z-10 text-stone-700', s.logo)}
        >
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      </div>

      {/* Label with cycling verb */}
      <p
        className={cn('text-stone-500 tracking-wide', s.text)}
        style={{ fontFamily: 'Cormorant Garamond, Georgia, serif' }}
      >
        <span
          className={cn(
            'inline-block transition-all duration-300 ease-out',
            isAnimating ? 'opacity-0 translate-y-2 blur-sm' : 'opacity-100 translate-y-0 blur-0'
          )}
        >
          {VERBS[verbIndex]}
        </span>
        {' the source...'}
      </p>
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
