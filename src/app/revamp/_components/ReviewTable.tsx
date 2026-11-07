'use client';

import { useEffect, useMemo, useState } from 'react';

export interface Rec { source: string; slug: string; name: string; kind?: string | null; books?: number | null; images?: number | null; proposed: string; proposed_subject?: string | null; merge_into?: string; confidence: string; reason: string; looks_handmade?: boolean | null }
const TYPES = ['subject', 'collection', 'historic_library', 'merge', 'library_slice', 'retire'];
const LABEL: Record<string, string> = { subject: 'Subject', collection: 'Collection', historic_library: 'Historic library', merge: 'Merge', library_slice: 'Filter', retire: 'Retire' };
const KEY = 'revamp-sorting';

export default function ReviewTable({ records }: { records: Rec[] }) {
  const [src, setSrc] = useState('all');
  const [type, setType] = useState('all');
  const [low, setLow] = useState(false);
  const [q, setQ] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  useEffect(() => { setEdits(JSON.parse(localStorage.getItem(KEY) || '{}')); }, []);
  const key = (r: Rec) => `${r.source}:${r.slug}`;
  const change = (r: Rec, v: string) => { const n = { ...edits, [key(r)]: v }; setEdits(n); localStorage.setItem(KEY, JSON.stringify(n)); };
  const rows = useMemo(() => records.filter((r) => (src === 'all' || r.source === src)
    && (type === 'all' || (edits[key(r)] || r.proposed) === type)
    && (!low || r.confidence !== 'high')
    && r.name.toLowerCase().includes(q.toLowerCase())), [records, src, type, low, q, edits]);
  const counts = TYPES.map((t) => [t, records.filter((r) => (edits[key(r)] || r.proposed) === t).length] as const);
  const exportEdits = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(edits, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'sorting-corrections.json'; a.click();
  };
  const sel = 'border border-border-medium bg-white px-2 py-1.5 text-base';
  return (
    <>
      <p className="text-sm text-muted mb-4">{counts.map(([t, n]) => `${LABEL[t]} ${n}`).join(' · ')}{Object.keys(edits).length ? ` · ${Object.keys(edits).length} corrected` : ''}</p>
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <input type="search" placeholder="Filter by name" aria-label="Filter by name" value={q} onChange={(e) => setQ(e.target.value)} className={sel} />
        <select aria-label="Source" value={src} onChange={(e) => setSrc(e.target.value)} className={sel}><option value="all">Everything</option><option value="collection">Collections</option><option value="gallery">Gallery sets</option></select>
        <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className={sel}><option value="all">All types</option>{TYPES.map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}</select>
        <label className="text-sm flex gap-1.5 items-center"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Unsure only</label>
        <button type="button" onClick={exportEdits} className="text-sm underline underline-offset-2">Download corrections</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b border-primary"><th className="py-2 pr-4 font-medium">Name</th><th className="pr-4 font-medium">Size</th><th className="pr-4 font-medium">Goes to</th><th className="pr-4 font-medium">Under or into</th><th className="font-medium">Why</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={key(r)} className="border-b border-border-light align-top">
                <td className="py-2 pr-4 min-w-[220px]"><span className="text-primary">{r.name}</span><span className="block text-[12px] text-muted">{r.source === 'gallery' ? 'Gallery set' : r.kind || 'No kind'}</span></td>
                <td className="py-2 pr-4 whitespace-nowrap text-muted">{r.books != null ? `${r.books.toLocaleString('en-GB')} books` : ''}{r.images ? ` ${r.images.toLocaleString('en-GB')} images` : ''}</td>
                <td className="py-2 pr-4"><select aria-label={`Type for ${r.name}`} value={edits[key(r)] || r.proposed} onChange={(e) => change(r, e.target.value)} className="border border-border-light bg-white px-1 py-0.5 text-base">{TYPES.map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}</select>{r.confidence !== 'high' && <span className="block text-[12px] text-muted">{r.confidence} confidence</span>}</td>
                <td className="py-2 pr-4 text-muted">{r.merge_into || r.proposed_subject}</td>
                <td className="py-2 text-secondary min-w-[260px]">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
