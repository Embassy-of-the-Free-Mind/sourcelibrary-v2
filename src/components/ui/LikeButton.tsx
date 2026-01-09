'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Heart } from 'lucide-react';
import { LikeTargetType } from '@/lib/types';
import { likes } from '@/lib/api-client';

const VISITOR_ID_KEY = 'sl_visitor_id';
const LIKES_CACHE_KEY = 'sl_likes_cache';

interface LikeButtonProps {
  targetType: LikeTargetType;
  targetId: string;
  initialCount?: number;
  initialLiked?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showCount?: boolean;
  className?: string;
}

function getVisitorId(): string {
  if (typeof window === 'undefined') return '';

  let visitorId = localStorage.getItem(VISITOR_ID_KEY);
  if (!visitorId) {
    // Generate a random ID
    visitorId = 'v_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem(VISITOR_ID_KEY, visitorId);
  }
  return visitorId;
}

function getLikesCache(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const cached = localStorage.getItem(LIKES_CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
}

function setLikeInCache(key: string, liked: boolean) {
  if (typeof window === 'undefined') return;
  try {
    const cache = getLikesCache();
    if (liked) {
      cache[key] = true;
    } else {
      delete cache[key];
    }
    localStorage.setItem(LIKES_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage errors
  }
}

export default function LikeButton({
  targetType,
  targetId,
  initialCount = 0,
  initialLiked = false,
  size = 'md',
  showCount = true,
  className = '',
}: LikeButtonProps) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  const cacheKey = `${targetType}:${targetId}`;

  // Check localStorage on mount
  useEffect(() => {
    setMounted(true);
    const cache = getLikesCache();
    if (cache[cacheKey]) {
      setLiked(true);
    }
  }, [cacheKey]);

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (loading) return;

    const visitorId = getVisitorId();
    if (!visitorId) return;

    setLoading(true);

    // Optimistic update
    const newLiked = !liked;
    setLiked(newLiked);
    setCount(prev => newLiked ? prev + 1 : Math.max(0, prev - 1));
    setLikeInCache(cacheKey, newLiked);

    try {
      const data = await likes.toggle(targetType, targetId, visitorId);
      setLiked(data.liked);
      setCount(data.count);
      setLikeInCache(cacheKey, data.liked);
    } catch {
      // Revert optimistic update on error
      setLiked(!newLiked);
      setCount(prev => newLiked ? prev - 1 : prev + 1);
      setLikeInCache(cacheKey, !newLiked);
    } finally {
      setLoading(false);
    }
  }, [liked, loading, targetType, targetId, cacheKey]);

  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  const buttonSizes = {
    sm: 'p-1',
    md: 'p-1.5',
    lg: 'p-2',
  };

  const textSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  // Don't render interactive elements until mounted (avoids hydration mismatch)
  if (!mounted) {
    return (
      <div className={`inline-flex items-center gap-1 ${className}`}>
        <div className={`${buttonSizes[size]} rounded-full`}>
          <Heart className={`${sizeClasses[size]} text-gray-400`} />
        </div>
        {showCount && count > 0 && (
          <span className={`${textSizes[size]} text-gray-500`}>{count}</span>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`
        inline-flex items-center gap-1 group
        transition-all duration-200
        ${loading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
        ${className}
      `}
      title={liked ? 'Unlike' : 'Like'}
      aria-label={liked ? 'Unlike' : 'Like'}
    >
      <div
        className={`
          ${buttonSizes[size]} rounded-full
          transition-all duration-200
          ${liked
            ? 'text-red-500'
            : 'text-gray-400 hover:text-red-400 group-hover:scale-110'
          }
        `}
      >
        <Heart
          className={`${sizeClasses[size]} transition-all duration-200`}
          fill={liked ? 'currentColor' : 'none'}
          strokeWidth={liked ? 0 : 2}
        />
      </div>
      {showCount && count > 0 && (
        <span
          className={`
            ${textSizes[size]} font-medium
            transition-colors duration-200
            ${liked ? 'text-red-500' : 'text-gray-500'}
          `}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// Hook to batch-fetch like status for multiple items
export function useLikeStatus(
  targets: Array<{ type: LikeTargetType; id: string }>
): Record<string, { count: number; liked: boolean }> {
  const targetsKey = JSON.stringify(targets);

  // Build initial status from cache (memoized)
  const initialStatus = useMemo(() => {
    const cache = getLikesCache();
    const initial: Record<string, { count: number; liked: boolean }> = {};
    for (const t of targets) {
      const key = `${t.type}:${t.id}`;
      initial[key] = { count: 0, liked: !!cache[key] };
    }
    return initial;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey]);

  const [status, setStatus] = useState(initialStatus);

  // Re-initialize when targets change
  const prevTargetsKey = useMemo(() => targetsKey, [targetsKey]);
  if (prevTargetsKey !== targetsKey) {
    // This is safe because we're in render phase, not effect
    // React will batch this with the current render
  }

  useEffect(() => {
    if (targets.length === 0) return;

    let cancelled = false;
    const visitorId = getVisitorId();

    // Fetch from API
    const fetchStatus = async () => {
      try {
        const data = await likes.getStatus(targetsKey, visitorId);
        if (!cancelled) {
          setStatus(data.results);

          // Update cache
          for (const [key, value] of Object.entries(data.results)) {
            const { liked } = value as { count: number; liked: boolean };
            setLikeInCache(key, liked);
          }
        }
      } catch {
        // Keep cached state on error
      }
    };

    // Start with initial status from cache, then fetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(initialStatus);
    fetchStatus();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey]);

  return status;
}
