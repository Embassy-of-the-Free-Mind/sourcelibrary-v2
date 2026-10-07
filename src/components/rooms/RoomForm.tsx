'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { lists, type ListSummary } from '@/lib/api-client/lists';
import { apiClient } from '@/lib/api-client/client';
import type { RoomSummary, RoomWrite } from '@/lib/api-client/rooms';
import { ROOM_SLUG_RE, RESERVED_ROOM_SEGMENTS } from '@/lib/reading-rooms-paths';

/**
 * Create / edit form for a reading room (#5266). One component for both so
 * the owner's mental model is one screen: name and URL, which books, how it
 * looks, which sites may frame it.
 *
 * Styling follows src/app/lists/page.tsx (tokens only, no new primitives).
 */

interface CollectionOption { slug: string; name: string; type?: string; book_count?: number }

const FIELD = 'w-full px-3 py-2 rounded-lg text-sm';
const FIELD_STYLE = { border: '1px solid var(--border-medium)', background: 'var(--bg-white)', color: 'var(--text-primary)' } as const;
const LABEL = 'block text-xs uppercase tracking-wide mb-1';
const LABEL_STYLE = { color: 'var(--text-muted)' } as const;
const HELP = 'text-xs mt-1';
const HELP_STYLE = { color: 'var(--text-faint)' } as const;

function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
}

export interface RoomFormProps {
  initial?: RoomSummary | null;
  submitLabel: string;
  saving: boolean;
  error: string | null;
  onSubmit: (body: RoomWrite) => void;
}

export default function RoomForm({ initial, submitLabel, saving, error, onSubmit }: RoomFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(!!initial);
  const [tagline, setTagline] = useState(initial?.tagline ?? '');
  const [sourceType, setSourceType] = useState<'collection' | 'list'>(initial?.source.type ?? 'collection');
  const [collectionSlug, setCollectionSlug] = useState(initial?.source.type === 'collection' ? initial.source.slug : '');
  const [listId, setListId] = useState(initial?.source.type === 'list' ? initial.source.id : '');
  const [logoUrl, setLogoUrl] = useState(initial?.theme.logo_url ?? '');
  const [accent, setAccent] = useState(initial?.theme.accent_hex ?? '');
  const [homeUrl, setHomeUrl] = useState(initial?.theme.home_url ?? '');
  const [homeLabel, setHomeLabel] = useState(initial?.theme.home_label ?? '');
  const [origins, setOrigins] = useState((initial?.allowed_origins ?? []).join('\n'));

  const [collections, setCollections] = useState<CollectionOption[] | null>(null);
  const [myLists, setMyLists] = useState<ListSummary[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await apiClient.get<{ collections: CollectionOption[] }>('/api/collections?limit=300') as unknown as { collections: CollectionOption[] };
        if (alive) setCollections((data.collections || []).filter(c => c.slug && c.name).sort((a, b) => a.name.localeCompare(b.name)));
      } catch { if (alive) setCollections([]); }
      try {
        const data = await lists.getMine();
        if (alive) setMyLists(data.lists);
      } catch { if (alive) setMyLists([]); }
    })();
    return () => { alive = false; };
  }, []);


  const slugProblem = useMemo(() => {
    if (!slug) return null;
    if (!ROOM_SLUG_RE.test(slug)) return '3–48 lowercase letters, digits or hyphens.';
    if (RESERVED_ROOM_SEGMENTS.has(slug)) return 'That word is reserved.';
    return null;
  }, [slug]);

  const canSubmit = name.trim().length >= 2 && !slugProblem && !!slug
    && (sourceType === 'collection' ? !!collectionSlug : !!listId) && !saving;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      name: name.trim(),
      slug,
      tagline: tagline.trim(),
      source: sourceType === 'collection' ? { type: 'collection', slug: collectionSlug } : { type: 'list', id: listId },
      theme: {
        logo_url: logoUrl.trim() || null,
        accent_hex: accent.trim() || null,
        home_url: homeUrl.trim() || null,
        home_label: homeLabel.trim() || null,
      },
      allowed_origins: origins.split(/[\s,]+/).map(s => s.trim()).filter(Boolean),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-8">
      <section className="space-y-4">
        <h2 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>Name</h2>
        <div>
          <label htmlFor="room-name" className={LABEL} style={LABEL_STYLE}>Room name</label>
          <input id="room-name" className={FIELD} style={FIELD_STYLE} value={name} maxLength={80}
            onChange={e => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }}
            placeholder="The Zosimos Reading Room" required />
        </div>
        <div>
          <label htmlFor="room-slug" className={LABEL} style={LABEL_STYLE}>URL name</label>
          <div className="flex items-center gap-2">
            <span className="text-sm shrink-0" style={{ color: 'var(--text-muted)' }}>sourcelibrary.org/rooms/</span>
            <input id="room-slug" className={FIELD} style={FIELD_STYLE} value={slug} maxLength={48}
              onChange={e => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }} required />
          </div>
          {slugProblem ? <p className={HELP} style={{ color: 'var(--status-error)' }}>{slugProblem}</p> : null}
        </div>
        <div>
          <label htmlFor="room-tagline" className={LABEL} style={LABEL_STYLE}>One line under the name (optional)</label>
          <input id="room-tagline" className={FIELD} style={FIELD_STYLE} value={tagline} maxLength={200}
            onChange={e => setTagline(e.target.value)} placeholder="The texts behind season three, readable in the original and in English." />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>Books</h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          A room shows a set of books that already exists: one of Source Library&apos;s collections, or a list you made.
          Change the list later and the room follows.
        </p>
        <div className="flex gap-4 text-sm" style={{ color: 'var(--text-primary)' }}>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="source" checked={sourceType === 'collection'} onChange={() => setSourceType('collection')} /> A collection
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="source" checked={sourceType === 'list'} onChange={() => setSourceType('list')} /> One of my lists
          </label>
        </div>
        {sourceType === 'collection' ? (
          <select className={FIELD} style={FIELD_STYLE} value={collectionSlug} onChange={e => setCollectionSlug(e.target.value)} required>
            <option value="">{collections === null ? 'Loading collections…' : 'Choose a collection'}</option>
            {(collections ?? []).map(c => (
              <option key={c.slug} value={c.slug}>{c.name}{c.book_count ? ` (${c.book_count})` : ''}</option>
            ))}
          </select>
        ) : (
          <>
            <select className={FIELD} style={FIELD_STYLE} value={listId} onChange={e => setListId(e.target.value)} required>
              <option value="">{myLists === null ? 'Loading your lists…' : myLists.length ? 'Choose a list' : 'You have no lists yet'}</option>
              {(myLists ?? []).map(l => (
                <option key={l.id} value={l.id}>{l.title} ({l.items_count})</option>
              ))}
            </select>
            <p className={HELP} style={HELP_STYLE}>
              Only the books on the list appear; pages and images saved to it are skipped. A private list becomes readable through the room.
            </p>
          </>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>Look</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="room-logo" className={LABEL} style={LABEL_STYLE}>Logo image URL (https)</label>
            <input id="room-logo" className={FIELD} style={FIELD_STYLE} value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://example.org/wordmark.svg" />
            <p className={HELP} style={HELP_STYLE}>Shown at 32px tall, left of the room name.</p>
          </div>
          <div>
            <label htmlFor="room-accent" className={LABEL} style={LABEL_STYLE}>Accent colour</label>
            <div className="flex items-center gap-2">
              <input type="color" aria-label="Pick accent colour" value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : '#9e4a3a'}
                onChange={e => setAccent(e.target.value)} className="h-9 w-12 rounded cursor-pointer" style={{ border: '1px solid var(--border-medium)' }} />
              <input id="room-accent" className={FIELD} style={FIELD_STYLE} value={accent} onChange={e => setAccent(e.target.value)} placeholder="#9e4a3a" maxLength={7} />
            </div>
            <p className={HELP} style={HELP_STYLE}>Links and buttons inside the room. Leave empty for Source Library&apos;s rust.</p>
          </div>
          <div>
            <label htmlFor="room-home" className={LABEL} style={LABEL_STYLE}>Link back to your site (https)</label>
            <input id="room-home" className={FIELD} style={FIELD_STYLE} value={homeUrl} onChange={e => setHomeUrl(e.target.value)} placeholder="https://example.org" />
          </div>
          <div>
            <label htmlFor="room-home-label" className={LABEL} style={LABEL_STYLE}>Text of that link</label>
            <input id="room-home-label" className={FIELD} style={FIELD_STYLE} value={homeLabel} maxLength={40} onChange={e => setHomeLabel(e.target.value)} placeholder="Back to the podcast" />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>Your website</h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          To put the room inside a page on your own site, list the site&apos;s hostnames here. Browsers refuse to frame the room from anywhere else.
        </p>
        <textarea className={FIELD} style={{ ...FIELD_STYLE, minHeight: 72, fieldSizing: 'content' } as React.CSSProperties}
          value={origins} onChange={e => setOrigins(e.target.value)} placeholder={'example.org\nwww.example.org'} />
      </section>

      {error ? <p className="text-sm" role="alert" style={{ color: 'var(--status-error)' }}>{error}</p> : null}

      <button type="submit" disabled={!canSubmit}
        className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
        style={{ background: 'var(--accent-rust)', color: '#fff' }}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
        {submitLabel}
      </button>
    </form>
  );
}
