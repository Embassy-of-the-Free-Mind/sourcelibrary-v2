'use client';

/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from 'react';
import { ArrowUpToLine, ChevronDown, ChevronUp, GripVertical, Plus, X } from 'lucide-react';
import SortSelect from '@/components/search-kit/SortSelect';
import { getBookThumbnailUrl } from '@/lib/utils';
import type { Book } from '../_lib/types';
import { SORTS, type CollectionDoc, type DocEntry } from '../_lib/collection-doc';

const field = 'w-full border border-border-medium bg-white px-3 py-2 text-base text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted/70';
const iconBtn = 'w-8 h-8 grid place-items-center text-muted hover:text-primary hover:bg-warm';
const keyOf = (e: DocEntry) => `${e.kind}-${e.id}`;

/**
 * The maker's view of their collection: add works, remove them, drag to reorder (or use the arrows),
 * write a note on any work, put section headings with a line of text between them, and choose the
 * order readers see first. Nothing is saved until Done.
 */
export default function CollectionEditor({ start, original, books, onDone, onCancel }: {
  start: CollectionDoc; original: CollectionDoc; books: Record<string, Book>;
  onDone: (d: CollectionDoc) => void; onCancel: () => void;
}) {
  const [doc, setDoc] = useState<CollectionDoc>(start);
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Book[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const all = { ...books, ...doc.added };
  const inList = new Set(doc.order.filter((e) => e.kind === 'work').map((e) => e.id));
  const works = inList.size;

  const set = (order: DocEntry[]) => setDoc((d) => ({ ...d, order }));
  const move = (from: number, to: number) => {
    if (from === to) return;
    const o = [...doc.order];
    const [x] = o.splice(from, 1);
    o.splice(to > from ? to - 1 : to, 0, x);
    set(o);
  };
  const remove = (i: number) => set(doc.order.filter((_, j) => j !== i));
  const editSection = (i: number, patch: Partial<{ heading: string; text: string }>) =>
    set(doc.order.map((e, j) => (j === i && e.kind === 'section' ? { ...e, ...patch } : e)));
  const addSection = () => set([{ kind: 'section', id: Math.random().toString(36).slice(2, 9), heading: '', text: '' }, ...doc.order]);
  const add = (b: Book) => setDoc((d) => ({ ...d, added: { ...d.added, [b.id!]: b }, order: [...d.order, { kind: 'work', id: b.id! }] }));

  const find = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try { const r = await fetch(`/revamp/api/find?q=${encodeURIComponent(q)}`); setFound((await r.json()).books ?? []); } catch { setFound([]); } finally { setBusy(false); }
  };

  // Dragging by the handle: the drop point is the gap nearest the pointer.
  const startDrag = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    setDrag({ from: i, to: i });
    const over = (y: number) => {
      let to = doc.order.length;
      for (let j = 0; j < rows.current.length; j++) {
        const r = rows.current[j]?.getBoundingClientRect();
        if (r && y < r.top + r.height / 2) { to = j; break; }
      }
      return to;
    };
    const onMove = (ev: PointerEvent) => {
      setDrag({ from: i, to: over(ev.clientY) });
      if (ev.clientY < 60) window.scrollBy(0, -12); else if (ev.clientY > window.innerHeight - 60) window.scrollBy(0, 12);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      move(i, over(ev.clientY));
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <section className="border border-border-medium bg-white p-5 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl sm:text-3xl text-primary font-display">Edit collection</h2>
          <p className="text-[14px] text-muted mt-1">{works.toLocaleString('en-GB')} works. Drag by the handle or use the arrows to change the order. The first arrow moves a work straight to the top.</p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setDoc(original)} className="text-[13.5px] text-muted underline underline-offset-[3px] hover:text-primary">Back to the original</button>
          <button type="button" onClick={onCancel} className="text-[13.5px] text-primary underline underline-offset-[3px]">Cancel</button>
          <button type="button" onClick={() => onDone(doc)} className="h-11 px-5 bg-primary text-cream text-sm font-medium hover:opacity-90">Done</button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div>
          <p className="text-[13.5px] font-semibold text-primary mb-2">Order readers see first</p>
          <SortSelect label="Default order" value={doc.sort} onChange={(v) => setDoc((d) => ({ ...d, sort: v }))} options={SORTS} />
          <p className="text-[13px] text-muted mt-2">They can still change it. Sections show in your order only.</p>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); find(); }}>
          <label htmlFor="ed-find" className="block text-[13.5px] font-semibold text-primary mb-2">Add works</label>
          <div className="flex items-stretch h-11 border border-border-medium bg-white focus-within:border-primary focus-within:ring-1 focus-within:ring-primary" data-catalog-bar>
            <input id="ed-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title or author in the Library" className="flex-1 min-w-0 px-3 text-base text-primary bg-transparent outline-none placeholder:text-muted/70" />
            <button type="submit" className="relative -my-px -mr-px px-4 bg-primary text-cream text-sm">{busy ? 'Finding…' : 'Find'}</button>
          </div>
          {found && (
            <ul className="mt-2 border border-border-light divide-y divide-border-light max-h-[320px] overflow-y-auto">
              {found.length === 0 && <li className="px-3 py-3 text-[13.5px] text-muted">Nothing found.</li>}
              {found.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-3 py-2">
                  <img src={getBookThumbnailUrl(b as never, 'thumb') || ''} alt="" className="w-8 h-11 object-cover bg-warm shrink-0" />
                  <span className="flex-1 min-w-0 text-[14px]"><span className="block text-primary truncate font-serif">{b.display_title || b.title}</span><span className="block text-muted text-[12.5px] truncate">{[b.author, b.year].filter(Boolean).join(', ')}</span></span>
                  {inList.has(b.id!) ? <span className="text-[13px] text-muted">In the collection</span>
                    : <button type="button" onClick={() => add(b)} className="inline-flex items-center gap-1 h-9 px-3 bg-primary text-cream text-[13px]"><Plus className="w-3.5 h-3.5" />Add</button>}
                </li>
              ))}
            </ul>
          )}
        </form>
      </div>

      <button type="button" onClick={addSection} className="inline-flex items-center gap-1.5 h-9 px-3 border border-border-medium bg-white text-[13.5px] text-primary hover:border-primary mb-3"><Plus className="w-3.5 h-3.5" />Add a section heading</button>

      <ol className="border-t border-border-light">
        {doc.order.map((e, i) => {
          const b = e.kind === 'work' ? all[e.id] : null;
          if (e.kind === 'work' && !b) return null;
          const note = e.kind === 'work' ? doc.notes[e.id] ?? '' : '';
          const showNote = e.kind === 'work' && (noteOpen === e.id || note);
          return (
            <li key={keyOf(e)} ref={(el) => { rows.current[i] = el; }}
              className={`relative border-b border-border-light ${drag?.from === i ? 'opacity-40' : ''} ${e.kind === 'section' ? 'bg-warm' : ''}`}>
              {drag && drag.to === i && drag.from !== i && <span aria-hidden className="absolute -top-px inset-x-0 h-0.5 bg-primary" />}
              <div className="flex items-start gap-2 py-2.5 pr-1">
                <button type="button" aria-label="Drag to reorder" onPointerDown={startDrag(i)} className={`${iconBtn} cursor-grab active:cursor-grabbing touch-none shrink-0`}><GripVertical className="w-4 h-4" /></button>
                {b ? (
                  <>
                    <img src={getBookThumbnailUrl(b as never, 'thumb') || ''} alt="" loading="lazy" className="w-8 h-11 object-cover bg-warm shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[14.5px] text-primary font-serif truncate">{b.display_title || b.title}</p>
                      <p className="text-[12.5px] text-muted truncate">{[b.author, b.year, b.language].filter(Boolean).join(', ')}</p>
                      {showNote && (
                        <textarea value={note} autoFocus={noteOpen === e.id && !note} rows={2} placeholder="Why it is here, in a line or two"
                          onChange={(ev) => setDoc((d) => ({ ...d, notes: { ...d.notes, [e.id]: ev.target.value } }))} className={`${field} mt-2 text-[15px] leading-snug`} />
                      )}
                    </div>
                    {!showNote && <button type="button" onClick={() => setNoteOpen(e.id)} className="text-[13px] text-muted underline underline-offset-[3px] hover:text-primary px-2 h-8 shrink-0">Add a note</button>}
                  </>
                ) : e.kind === 'section' && (
                  <div className="flex-1 min-w-0 space-y-2">
                    <input value={e.heading} onChange={(ev) => editSection(i, { heading: ev.target.value })} placeholder="Section heading" className={`${field} font-display text-lg`} />
                    <textarea value={e.text} onChange={(ev) => editSection(i, { text: ev.target.value })} rows={2} placeholder="A line about this section (optional)" className={field} />
                  </div>
                )}
                <div className="flex items-center shrink-0">
                  <button type="button" aria-label="Move to top" title="Move to top" disabled={i === 0} onClick={() => move(i, 0)} className={`${iconBtn} disabled:opacity-30`}><ArrowUpToLine className="w-4 h-4" /></button>
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)} className={`${iconBtn} disabled:opacity-30`}><ChevronUp className="w-4 h-4" /></button>
                  <button type="button" aria-label="Move down" disabled={i === doc.order.length - 1} onClick={() => move(i, i + 2)} className={`${iconBtn} disabled:opacity-30`}><ChevronDown className="w-4 h-4" /></button>
                  <button type="button" aria-label={e.kind === 'section' ? 'Remove section' : 'Remove from the collection'} onClick={() => remove(i)} className={iconBtn}><X className="w-4 h-4" /></button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {drag && drag.to === doc.order.length && <span aria-hidden className="block h-0.5 bg-primary" />}
      <div className="flex justify-end mt-6"><button type="button" onClick={() => onDone(doc)} className="h-11 px-5 bg-primary text-cream text-sm font-medium hover:opacity-90">Done</button></div>
    </section>
  );
}
