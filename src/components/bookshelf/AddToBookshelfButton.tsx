'use client';

import { useState, useEffect, useRef } from 'react';
import { BookOpen, ChevronDown, Check, X, Loader2 } from 'lucide-react';
import { bookshelf } from '@/lib/api-client';
import type { BookshelfStatus } from '@/lib/types/bookshelf';

const CACHE_KEY = 'sl_bookshelf_cache';

function getCache(): Record<string, BookshelfStatus> {
  if (typeof window === 'undefined') return {};
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
}

function setCache(cache: Record<string, BookshelfStatus>) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

const STATUS_LABELS: Record<BookshelfStatus, string> = {
  want_to_read: 'Want to Read',
  reading: 'Reading',
  completed: 'Completed',
};

interface AddToBookshelfButtonProps {
  bookId: string;
  className?: string;
}

export default function AddToBookshelfButton({ bookId, className = '' }: AddToBookshelfButtonProps) {
  const [status, setStatus] = useState<BookshelfStatus | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Check cache on mount
  useEffect(() => {
    const cache = getCache();
    if (cache[bookId]) {
      setStatus(cache[bookId]);
    }
  }, [bookId]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleStatusChange = async (newStatus: BookshelfStatus) => {
    setLoading(true);
    const previousStatus = status;
    setStatus(newStatus);
    setShowDropdown(false);

    // Optimistic cache update
    const cache = getCache();
    cache[bookId] = newStatus;
    setCache(cache);

    try {
      await bookshelf.add(bookId, newStatus);
    } catch {
      // Revert on failure
      setStatus(previousStatus);
      if (previousStatus) {
        cache[bookId] = previousStatus;
      } else {
        delete cache[bookId];
      }
      setCache(cache);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    setLoading(true);
    const previousStatus = status;
    setStatus(null);
    setShowDropdown(false);

    const cache = getCache();
    delete cache[bookId];
    setCache(cache);

    try {
      await bookshelf.remove(bookId);
    } catch {
      setStatus(previousStatus);
      if (previousStatus) {
        cache[bookId] = previousStatus;
        setCache(cache);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={loading}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
          status
            ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 border border-amber-200'
            : 'bg-stone-100 text-stone-700 hover:bg-stone-200 border border-stone-200'
        } disabled:opacity-50`}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : status ? (
          <Check className="w-4 h-4" />
        ) : (
          <BookOpen className="w-4 h-4" />
        )}
        <span>{status ? STATUS_LABELS[status] : 'Add to Bookshelf'}</span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {showDropdown && (
        <div className="absolute top-full mt-1 left-0 bg-white rounded-lg shadow-lg border border-stone-200 py-1 z-30 min-w-[160px]">
          {(Object.keys(STATUS_LABELS) as BookshelfStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => handleStatusChange(s)}
              className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                status === s
                  ? 'bg-amber-50 text-amber-800'
                  : 'text-stone-700 hover:bg-stone-50'
              }`}
            >
              {status === s && <Check className="w-3 h-3" />}
              <span className={status === s ? '' : 'ml-5'}>{STATUS_LABELS[s]}</span>
            </button>
          ))}
          {status && (
            <>
              <div className="border-t border-stone-100 my-1" />
              <button
                onClick={handleRemove}
                className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors"
              >
                <X className="w-3 h-3" />
                <span>Remove</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
