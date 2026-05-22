'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, Search, ExternalLink, X } from 'lucide-react';
import type { AuthorAuthorityMatch, AuthorAuthorityResult } from '@/lib/author-authority';

/**
 * Inline picker that lets a cataloguer look up canonical author identity
 * (VIAF cluster + Wikidata Q-id) for a free-text author string.
 *
 * Mirrors the existing USTC search affordance in `BookEditModal` so the
 * mental model carries between the two editors:
 *   1. Type a name (or accept the prefill from the author field).
 *   2. See top VIAF candidates with dates + Wikidata link if known.
 *   3. Click "Use this" — the parent gets {viaf_id, wikidata_qid, canonical_name}
 *      and stores it on `author_entity_id` (Atlas) or `bph_works.author_entity_id`
 *      (Supabase).
 *
 * If a canonical id is already set, the picker shows "Canonical: <name>"
 * with a "Change" button instead of the search box — the common case is a
 * stable identity that never needs lookup.
 *
 * Issue #1921 (P3).
 */

export interface AuthorAuthoritySelection {
  /** Entity's MongoDB `_id` (string) — the value to write to author_entity_id. */
  entity_id: string;
  viaf_id: string;
  wikidata_qid: string | null;
  canonical_name: string;
  short_name: string;
  birth_year: number | null;
  death_year: number | null;
}

interface Props {
  /** Free-text author currently on the form — used as the default search query. */
  authorText: string;
  /** If already linked, what's on file (so we can show + offer Change). */
  current?: {
    viaf_id?: string | null;
    wikidata_qid?: string | null;
    canonical_name?: string | null;
  } | null;
  onSelect: (sel: AuthorAuthoritySelection) => void;
  onClear?: () => void;
  /** Debounce delay (ms) — defaults to 400ms which is comfortable for VIAF. */
  debounceMs?: number;
}

export default function AuthorAuthorityPicker({
  authorText,
  current,
  onSelect,
  onClear,
  debounceMs = 400,
}: Props) {
  const hasCanonical = !!(current?.viaf_id || current?.wikidata_qid);
  const [open, setOpen] = useState(!hasCanonical);
  const [query, setQuery] = useState(authorText);
  const [results, setResults] = useState<AuthorAuthorityMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Re-sync query when parent prop changes (e.g. user edits the author field).
  useEffect(() => {
    setQuery(authorText);
  }, [authorText]);

  useEffect(() => () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (abortRef.current) abortRef.current.abort();
  }, []);

  async function doSearch(q: string) {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    // Abort any in-flight request so the latest keystroke wins.
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/authority/author/search?q=${encodeURIComponent(trimmed)}`;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || `Lookup failed (${res.status})`);
        setResults([]);
      } else {
        const json = (await res.json()) as AuthorAuthorityResult;
        setResults(json.matches || []);
      }
      setSearched(true);
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      setError((err as Error).message || 'Lookup failed');
      setResults([]);
    } finally {
      // Only clear loading if this request wasn't superseded.
      if (abortRef.current === ctrl) setLoading(false);
    }
  }

  function onQueryChange(v: string) {
    setQuery(v);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      doSearch(v);
    }, debounceMs);
  }

  async function handleSelect(m: AuthorAuthorityMatch) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/authority/author/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match: m }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || `Link failed (${res.status})`);
        return;
      }
      const { entity_id } = (await res.json()) as { entity_id: string };
      onSelect({
        entity_id,
        viaf_id: m.viaf_id,
        wikidata_qid: m.wikidata_qid,
        canonical_name: m.canonical_name,
        short_name: m.short_name,
        birth_year: m.birth_year,
        death_year: m.death_year,
      });
      setOpen(false);
    } catch (err) {
      setError((err as Error).message || 'Link failed');
    } finally {
      setLoading(false);
    }
  }

  // Compact "already linked" view.
  if (!open && hasCanonical) {
    return (
      <div className="text-xs text-stone-600 dark:text-stone-400 flex items-center gap-2 flex-wrap">
        <span className="font-medium">Canonical:</span>
        <span>{current?.canonical_name || '(linked)'}</span>
        {current?.viaf_id && (
          <a
            href={`https://viaf.org/viaf/${current.viaf_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-accent-rust hover:underline"
          >
            VIAF {current.viaf_id}
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}
        {current?.wikidata_qid && (
          <a
            href={`https://www.wikidata.org/wiki/${current.wikidata_qid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-accent-rust hover:underline"
          >
            {current.wikidata_qid}
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-stone-500 hover:text-stone-800 underline"
        >
          Change
        </button>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-stone-500 hover:text-accent-rust underline"
            title="Clear canonical link"
          >
            Clear
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-1 p-2 border border-stone-200 dark:border-stone-700 rounded-md bg-stone-50/50 dark:bg-stone-900/40">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[11px] uppercase tracking-wide text-stone-500">
          Look up canonical author (VIAF)
        </label>
        {hasCanonical && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-stone-500 hover:text-stone-800"
            aria-label="Close picker"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              doSearch(query);
            }
          }}
          placeholder="e.g. Boccalini, Trajano"
          className="flex-1 px-2 py-1 text-sm border border-stone-300 dark:border-stone-700 rounded-md bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus-visible:ring-accent-rust"
        />
        <button
          type="button"
          onClick={() => doSearch(query)}
          disabled={loading || query.trim().length < 2}
          className="px-2 py-1 text-sm bg-accent-rust text-white rounded-md hover:bg-accent-rust/90 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Search
        </button>
      </div>

      {error && (
        <div className="mt-2 text-xs text-accent-rust">{error}</div>
      )}

      {searched && !loading && results.length === 0 && !error && (
        <div className="mt-2 text-xs text-stone-500 italic">
          No VIAF matches for &ldquo;{query}&rdquo;.
        </div>
      )}

      {results.length > 0 && (
        <ul className="mt-2 space-y-1 max-h-64 overflow-y-auto">
          {results.map((m) => (
            <li key={`${m.viaf_id}-${m.wikidata_qid}`}>
              <button
                type="button"
                onClick={() => handleSelect(m)}
                className="w-full text-left px-2 py-1.5 rounded-md bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 hover:border-accent-rust hover:bg-accent-rust/5 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
                    {m.short_name || m.canonical_name}
                  </span>
                  <span className="text-[11px] text-stone-500 whitespace-nowrap">
                    {m.birth_year || ''}
                    {(m.birth_year || m.death_year) && '–'}
                    {m.death_year || ''}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-stone-500">
                  {m.viaf_id && (
                    <span className="inline-flex items-center gap-0.5">
                      VIAF {m.viaf_id}
                    </span>
                  )}
                  {m.wikidata_qid && (
                    <span className="inline-flex items-center gap-0.5">
                      {m.wikidata_qid}
                    </span>
                  )}
                  {m.source_authorities && m.source_authorities.length > 0 && (
                    <span className="text-stone-400">{m.source_authorities.slice(0, 3).join(' · ')}</span>
                  )}
                </div>
                {m.alternate_names && m.alternate_names.length > 0 && (
                  <div className="text-[11px] text-stone-400 mt-0.5 truncate" title={m.alternate_names.join(' · ')}>
                    also: {m.alternate_names.slice(0, 2).join(' · ')}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
