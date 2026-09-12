'use client';

import { useCallback, useEffect, useState } from 'react';
import { GripVertical, EyeOff, Eye, X, Loader2 } from 'lucide-react';

/**
 * Editor-only panel for curating a collection's hero collage and gallery preview.
 *
 * Both surfaces otherwise order by quality score, which puts decorative
 * frontispieces first and, on a subject collection, can surface plates that are
 * not of the subject at all. Here an editor drags to pin an order and hides the
 * ones that should not appear — per surface, because the hero wants a handful of
 * strong images and the gallery wants breadth.
 *
 * Anything left unpinned keeps its scored position behind the pinned ones, so a
 * collection that grows does not need re-curating to stay sensible.
 */
type Surface = 'hero' | 'gallery';
interface Candidate { id: string; url: string; description: string; book_title: string; quality: number }
interface Curation { order: string[]; hidden: string[] }

export default function CollectionImageCurator({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [surface, setSurface] = useState<Surface>('hero');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [curation, setCuration] = useState<Record<Surface, Curation>>({ hero: { order: [], hidden: [] }, gallery: { order: [], hidden: [] } });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/collections/${slug}/image-curation`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d) => { if (!live) return; setCandidates(d.candidates || []); setCuration(d.curation); })
      .catch((e) => live && setNote(`Could not load: ${e.message}`))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [slug]);

  const cur = curation[surface];
  // Pinned first in their stored order, then the rest as scored — exactly what
  // the surface will render, so the panel is a preview and not a guess.
  const ordered = [
    ...cur.order.map((id) => candidates.find((c) => c.id === id)).filter((c): c is Candidate => !!c),
    ...candidates.filter((c) => !cur.order.includes(c.id)),
  ];

  const update = (next: Partial<Curation>) => setCuration((p) => ({ ...p, [surface]: { ...p[surface], ...next } }));

  const toggleHidden = (id: string) =>
    update({ hidden: cur.hidden.includes(id) ? cur.hidden.filter((x) => x !== id) : [...cur.hidden, id] });

  const drop = useCallback((targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = ordered.map((c) => c.id);
    const from = ids.indexOf(dragId), to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    // Pin everything up to the furthest moved item; beyond that, scored order
    // still applies and does not need freezing.
    update({ order: ids.slice(0, Math.max(to, from) + 1) });
    setDragId(null);
  }, [dragId, ordered]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true); setNote('');
    try {
      const r = await fetch(`/api/admin/collections/${slug}/image-curation`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface, order: cur.order, hidden: cur.hidden }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      setNote('Saved. The collage rebuilds on the next request.');
    } catch (e) { setNote(`Save failed: ${(e as Error).message}`); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6" style={{ background: 'rgba(20,16,12,0.55)' }}>
      <div className="w-full max-w-[1080px] bg-cream border border-border-light shadow-xl">
        <header className="flex items-center justify-between px-6 py-4 border-b border-border-light">
          <div>
            <h2 className="font-display text-[20px]" style={{ color: '#2b2620' }}>Curate images</h2>
            <p className="text-xs" style={{ color: '#8a8170' }}>Drag to order, click the eye to hide. Unpinned images keep their scored position.</p>
          </div>
          <div className="flex items-center gap-2">
            {(['hero', 'gallery'] as Surface[]).map((s) => (
              <button key={s} onClick={() => setSurface(s)}
                className="text-xs px-3 py-1.5 border capitalize"
                style={s === surface
                  ? { background: '#1a1612', color: '#fff', borderColor: '#1a1612' }
                  : { color: '#6b6560', borderColor: '#d4cfc4' }}>{s}</button>
            ))}
            <button onClick={onClose} aria-label="Close" className="ml-2 p-1.5" style={{ color: '#6b6560' }}><X className="w-4 h-4" /></button>
          </div>
        </header>

        <div className="p-6">
          {loading ? (
            <p className="text-sm flex items-center gap-2" style={{ color: '#8a8170' }}><Loader2 className="w-4 h-4 animate-spin" /> Loading candidates…</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-3">
              {ordered.map((c, i) => {
                const hidden = cur.hidden.includes(c.id);
                const pinned = cur.order.includes(c.id);
                return (
                  <figure key={c.id} draggable
                    onDragStart={() => setDragId(c.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => drop(c.id)}
                    title={`${c.description}\n${c.book_title}`}
                    className="m-0 relative cursor-grab active:cursor-grabbing"
                    style={{ opacity: hidden ? 0.32 : 1 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.url} alt="" className="w-full h-[104px] object-cover border"
                      style={{ borderColor: pinned ? '#9e4a3a' : '#e8e4dc' }} />
                    <figcaption className="flex items-center justify-between mt-1">
                      <span className="text-[10px] flex items-center gap-0.5" style={{ color: '#8a8170' }}>
                        <GripVertical className="w-3 h-3" />{pinned ? `#${i + 1}` : '—'}
                      </span>
                      <button onClick={() => toggleHidden(c.id)} aria-label={hidden ? 'Show' : 'Hide'}
                        style={{ color: hidden ? '#9e4a3a' : '#8a8170' }}>
                        {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between px-6 py-4 border-t border-border-light">
          <span className="text-xs" style={{ color: '#8a8170' }}>
            {note || `${cur.order.length} pinned · ${cur.hidden.length} hidden · ${candidates.length} candidates`}
          </span>
          <div className="flex gap-2">
            <button onClick={() => update({ order: [], hidden: [] })} className="text-xs px-3 py-2 border" style={{ color: '#6b6560', borderColor: '#d4cfc4' }}>Reset</button>
            <button onClick={save} disabled={saving} className="text-xs px-4 py-2 rounded-lg text-white" style={{ background: '#1a1612' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
