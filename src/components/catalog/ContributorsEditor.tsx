'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, Plus, X, Link2, Check } from 'lucide-react';
import { BPH_CONTRIBUTOR_ROLES, type BphContributor } from '@/lib/bph-contributors';

/**
 * Repeatable "Add author" editor for the catalogue (Paul D., 2026-06-24).
 * Each row is a BphContributor with a role; rows can be linked to our canonical
 * author thesaurus (the `authors` collection) via /api/catalog/author-search —
 * the same identity that drives /author/[slug], not VIAF.
 */

interface AuthorMatch {
  author_id: string;
  canonical_name: string;
  viaf_id: string | null;
  wikidata_id: string | null;
  variants: string[];
}

interface Props {
  value: BphContributor[];
  onChange: (next: BphContributor[]) => void;
}

export default function ContributorsEditor({ value, onChange }: Props) {
  const addRow = () =>
    onChange([...value, { role: 'Author', name: '', variant_name: '', author_id: null, canonical_name: null }]);
  const removeRow = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const patchRow = (i: number, patch: Partial<BphContributor>) =>
    onChange(value.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-xs text-muted">
          No additional contributors. Use this for co-authors, editors, translators, engravers, and others beyond the lead author above.
        </p>
      )}

      {value.map((c, i) => (
        <ContributorRow
          key={i}
          contributor={c}
          onPatch={(patch) => patchRow(i, patch)}
          onRemove={() => removeRow(i)}
        />
      ))}

      <button
        type="button"
        onClick={addRow}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border-light text-secondary hover:bg-warm hover:text-primary transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Add author
      </button>
    </div>
  );
}

function ContributorRow({
  contributor,
  onPatch,
  onRemove,
}: {
  contributor: BphContributor;
  onPatch: (patch: Partial<BphContributor>) => void;
  onRemove: () => void;
}) {
  const inputCls =
    'w-full text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30';

  return (
    <div className="p-3 rounded-lg border border-border-light bg-warm/30 space-y-2">
      <div className="flex gap-2">
        <select
          value={contributor.role}
          onChange={(e) => onPatch({ role: e.target.value })}
          className="text-sm border border-border-light rounded-md px-2 py-2 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
          aria-label="Role"
        >
          {BPH_CONTRIBUTOR_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={contributor.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          placeholder="Name (standard form)"
          className={inputCls}
        />
        <button
          type="button"
          onClick={onRemove}
          className="px-2 text-muted hover:text-accent-rust transition-colors"
          aria-label="Remove contributor"
          title="Remove"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <input
        type="text"
        value={contributor.variant_name || ''}
        onChange={(e) => onPatch({ variant_name: e.target.value })}
        placeholder="Name as on title page (optional)"
        className={inputCls}
      />
      <AuthorLink contributor={contributor} onPatch={onPatch} />
    </div>
  );
}

/** Compact per-row search-and-link against our canonical author thesaurus. */
function AuthorLink({
  contributor,
  onPatch,
}: {
  contributor: BphContributor;
  onPatch: (patch: Partial<BphContributor>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AuthorMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounce = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
      if (abortRef.current) abortRef.current.abort();
    },
    [],
  );

  async function doSearch(q: string) {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const res = await fetch(`/api/catalog/author-search?q=${encodeURIComponent(trimmed)}`, { signal: ctrl.signal });
      const json = (await res.json()) as { matches?: AuthorMatch[] };
      setResults(json.matches || []);
      setSearched(true);
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') setResults([]);
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  }

  function onQueryChange(v: string) {
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => doSearch(v), 350);
  }

  // Linked state — show the canonical name + clear.
  if (contributor.author_id) {
    return (
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <Check className="w-3.5 h-3.5" />
          Linked: <span className="font-medium">{contributor.canonical_name || contributor.author_id}</span>
        </span>
        <a
          href={`/author/${contributor.author_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-rust hover:underline"
        >
          view
        </a>
        <button
          type="button"
          onClick={() => onPatch({ author_id: null, canonical_name: null })}
          className="text-muted hover:text-accent-rust underline"
        >
          unlink
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          if (contributor.name.trim().length >= 2) {
            setQuery(contributor.name);
            doSearch(contributor.name);
          }
        }}
        className="inline-flex items-center gap-1.5 text-xs text-secondary hover:text-primary transition-colors"
      >
        <Link2 className="w-3.5 h-3.5" />
        Link to our author index
      </button>
    );
  }

  return (
    <div className="p-2 border border-border-light rounded-md bg-white">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[11px] uppercase tracking-wide text-muted">Search our author index</label>
        <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-primary" aria-label="Close">
          <X className="w-3.5 h-3.5" />
        </button>
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
          placeholder="e.g. Kircher, Athanasius"
          className="flex-1 px-2 py-1 text-sm border border-border-light rounded-md bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
          autoFocus
        />
        <span className="inline-flex items-center px-2 text-muted">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
        </span>
      </div>

      {searched && !loading && results.length === 0 && (
        <p className="mt-2 text-xs text-muted italic">
          No match in our index — leave it as a typed name, or it&rsquo;ll be created as a canonical author later.
        </p>
      )}

      {results.length > 0 && (
        <ul className="mt-2 space-y-1 max-h-56 overflow-y-auto">
          {results.map((m) => (
            <li key={m.author_id}>
              <button
                type="button"
                onClick={() =>
                  onPatch({
                    author_id: m.author_id,
                    canonical_name: m.canonical_name,
                    name: contributor.name.trim() || m.canonical_name,
                  })
                }
                className="w-full text-left px-2 py-1.5 rounded-md bg-white border border-border-light hover:border-accent-rust hover:bg-accent-rust/5 transition-colors"
              >
                <div className="text-sm font-medium text-primary">{m.canonical_name}</div>
                <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5">
                  {m.viaf_id && <span>VIAF {m.viaf_id}</span>}
                  {m.wikidata_id && <span>{m.wikidata_id}</span>}
                  {m.variants.length > 0 && <span className="truncate">also: {m.variants.join(' · ')}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
