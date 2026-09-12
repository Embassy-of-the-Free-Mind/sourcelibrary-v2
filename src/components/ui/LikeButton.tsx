'use client';

import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { Heart } from 'lucide-react';
import { LikeTargetType } from '@/lib/types';
import { likes } from '@/lib/api-client';
import { useIdentity } from '@/hooks/useIdentity';
import AuthPrompt from '@/components/auth/AuthPrompt';

const LIKES_CACHE_KEY = 'sl_likes_cache';
const ANON_LIKE_COUNT_KEY = 'sl_anon_like_count';
const NUDGE_THRESHOLD = 3;
const NUDGE_DISMISSED_KEY = 'sl_auth_nudge_dismissed';

interface LikeButtonProps {
  targetType: LikeTargetType;
  targetId: string;
  bookId?: string;
  initialCount?: number;
  initialLiked?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showCount?: boolean;
  /** Optional text label shown next to the heart (e.g. "Like this page"). Part of the clickable button. */
  label?: string;
  /**
   * Fires whenever the liked state settles (cache read on mount, status
   * fetch, toggle, error revert) — lets a parent swap surrounding copy
   * ("to save it…" → "Saved to your favorites", #4126) without owning
   * the like state itself.
   */
  onLikedChange?: (liked: boolean) => void;
  className?: string;
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

export default memo(function LikeButton({
  targetType,
  targetId,
  bookId,
  initialCount,
  initialLiked,
  size = 'md',
  showCount = true,
  label,
  onLikedChange,
  className = '',
}: LikeButtonProps) {
  // If parent explicitly passed initialCount (even 0), server provided the data
  const serverProvidedLikes = initialCount !== undefined;
  const identity = useIdentity();
  const [liked, setLiked] = useState(initialLiked ?? false);
  const [count, setCount] = useState(initialCount ?? 0);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const promptRef = useRef<HTMLDivElement>(null);

  const cacheKey = `${targetType}:${targetId}`;

  // Report liked-state changes without making the callback a dependency of
  // the fetch/toggle effects (parents often pass a fresh closure per render).
  const onLikedChangeRef = useRef(onLikedChange);
  useEffect(() => { onLikedChangeRef.current = onLikedChange; });
  useEffect(() => { onLikedChangeRef.current?.(liked); }, [liked]);

  // Close auth prompt on outside click
  useEffect(() => {
    if (!showAuthPrompt) return;
    function handleClickOutside(event: MouseEvent) {
      if (promptRef.current && !promptRef.current.contains(event.target as Node)) {
        setShowAuthPrompt(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAuthPrompt]);

  // Check localStorage on mount and when target changes
  useEffect(() => {
    setMounted(true);
    const cache = getLikesCache();
    setLiked(!!cache[cacheKey]);
    setCount(initialCount ?? 0);
  }, [cacheKey, initialCount]);

  // Fetch real like status from API on mount/target change
  // Skip if parent already provided like data (e.g. gallery API includes likes)
  useEffect(() => {
    if (serverProvidedLikes) return; // Parent provided like data, no need to fetch
    if (!identity.id || !targetId || identity.loading) return;
    let cancelled = false;

    likes.getStatus(
      JSON.stringify([{ type: targetType, id: targetId }]),
      identity.id
    ).then(data => {
      if (cancelled) return;
      const key = `${targetType}:${targetId}`;
      if (data.results?.[key]) {
        setCount(data.results[key].count);
        setLiked(data.results[key].liked);
        setLikeInCache(key, data.results[key].liked);
      }
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [targetType, targetId, identity.id, identity.loading, serverProvidedLikes]);

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (loading) return;

    setLoading(true);

    // Optimistic update
    const newLiked = !liked;
    setLiked(newLiked);
    setCount(prev => newLiked ? prev + 1 : Math.max(0, prev - 1));
    setLikeInCache(cacheKey, newLiked);

    try {
      const data = await likes.toggle(targetType, targetId, identity.id);
      setLiked(data.liked);
      setCount(data.count);
      setLikeInCache(cacheKey, data.liked);

      // Cascade: when liking a page, server also likes the book — sync cache
      if (data.cascade?.book_id) {
        setLikeInCache(`book:${data.cascade.book_id}`, data.cascade.book_liked);
      }

      // Soft nudge: after Nth anonymous like, suggest sign-in (non-blocking)
      if (identity.type === 'anonymous' && newLiked) {
        try {
          const dismissed = localStorage.getItem(NUDGE_DISMISSED_KEY);
          if (!dismissed) {
            const anonCount = parseInt(localStorage.getItem(ANON_LIKE_COUNT_KEY) || '0', 10) + 1;
            localStorage.setItem(ANON_LIKE_COUNT_KEY, String(anonCount));
            if (anonCount >= NUDGE_THRESHOLD) {
              setShowAuthPrompt(true);
            }
          }
        } catch { /* ignore storage errors */ }
      }
    } catch {
      // Revert optimistic update on error
      setLiked(!newLiked);
      setCount(prev => newLiked ? prev - 1 : prev + 1);
      setLikeInCache(cacheKey, !newLiked);
    } finally {
      setLoading(false);
    }
  }, [liked, loading, targetType, targetId, cacheKey, identity]);

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
        {label && <span className={`${textSizes[size]} text-gray-500`}>{label}</span>}
        {showCount && count > 0 && (
          <span className={`${textSizes[size]} text-gray-500`}>{count}</span>
        )}
      </div>
    );
  }

  return (
    <div className="relative inline-flex">
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
              ? 'text-status-error'
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
        {label && (
          <span
            className={`
              ${textSizes[size]} font-medium
              transition-colors duration-200
              ${liked ? 'text-status-error' : 'text-gray-500 group-hover:text-red-400'}
            `}
          >
            {label}
          </span>
        )}
        {showCount && count > 0 && (
          <span
            className={`
              ${textSizes[size]} font-medium
              transition-colors duration-200
              ${liked ? 'text-status-error' : 'text-gray-500'}
            `}
          >
            {count}
          </span>
        )}
      </button>

      {showAuthPrompt && (
        <div ref={promptRef} className="absolute top-full right-0 mt-2 z-50">
          <AuthPrompt
            message="Sign in to save your likes across devices"
            onClose={() => {
              setShowAuthPrompt(false);
              try { localStorage.setItem(NUDGE_DISMISSED_KEY, '1'); } catch {}
            }}
          />
        </div>
      )}
    </div>
  );
});

// Hook to batch-fetch like status for multiple items
export function useLikeStatus(
  targets: Array<{ type: LikeTargetType; id: string }>
): Record<string, { count: number; liked: boolean }> {
  const identity = useIdentity();
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

  useEffect(() => {
    if (targets.length === 0) return;

    let cancelled = false;

    // Fetch from API
    const fetchStatus = async () => {
      try {
        const data = await likes.getStatus(targetsKey, identity.id || undefined);
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
  }, [targetsKey, identity.id]);

  return status;
}
