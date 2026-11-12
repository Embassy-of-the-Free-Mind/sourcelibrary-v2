'use client';

import { useEffect, useMemo, useState, Fragment } from 'react';

export interface Rec { source: string; slug: string; name: string; kind?: string | null; books?: number | null; images?: number | null; proposed: string; proposed_subject?: string | null; merge_into?: string; confidence: string; reason: string; looks_handmade?: boolean | null }
const TYPES = ['subject', 'collection', 'type', 'historic_library', 'merge', 'library_slice', 'hidden', 'retire'];
// Plain actions, not category names: each option says what happens to the grouping.
const LABEL: Record<string, string> = { subject: 'Make it a subject', collection: 'Keep as a collection', type: 'Make it a type of picture', historic_library: 'Keep as a historic library', merge: 'Fold into another', library_slice: 'Turn into a filter', hidden: 'Keep hidden', retire: 'Remove it' };
const MEANS: [string, string][] = [
  ['Make it a subject', 'only when it matches a standard subject (FAST or Wikidata), like Alchemy: it gets a subject page listing everything on it'],
  ['Keep as a collection', 'everything that is not a standard subject or type: a set someone chose, like Music of the Spheres'],
  ['Make it a type of picture', 'only when it matches a standard type (Getty or Library of Congress), like Maps or Portraits'],
  ['Fold into another', 'it covers the same ground as another grouping (shown under “Joins”): its pictures move there and its address redirects'],
  ['Turn into a filter', 'no page of its own, just a filter in the Library, such as one library’s books'],
  ['Keep as a historic library', 'the books of a real past library, like Jung’s'],
  ['Keep hidden', 'out of lists and search, but its address still works for anyone with the link'],
  ['Remove it', 'empty, a duplicate, or not a real grouping'],
];
const KEY = 'revamp-sorting';

export default function ReviewTable({ records }: { records: Rec[] }) {
  const [src, setSrc] = useState('all');
  const [type, setType] = useState('all');
  // Opens on what still needs a person: the unsure ones you have not answered yet.
  const [low, setLow] = useState(true);
  const [q, setQ] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  useEffect(() => { setEdits(JSON.parse(localStorage.getItem(KEY) || '{}')); }, []);
  const key = (r: Rec) => `${r.source}:${r.slug}`;
  const change = (r: Rec, v: string) => { const n = { ...edits, [key(r)]: v }; setEdits(n); localStorage.setItem(KEY, JSON.stringify(n)); };
  const rows = useMemo(() => records.filter((r) => (src === 'all' || r.source === src)
    && (type === 'all' || (edits[key(r)] || r.proposed) === type)
    && (!low || (r.confidence !== 'high' && !edits[key(r)]))
    && r.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.confidence === 'low' ? 0 : 1) - (b.confidence === 'low' ? 0 : 1) || a.proposed.localeCompare(b.proposed) || a.name.localeCompare(b.name)), [records, src, type, low, q, edits]);
  const left = records.filter((r) => r.confidence !== 'high' && !edits[key(r)]).length;
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
        <label className="text-sm flex gap-1.5 items-center"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Needs review only ({left} left)</label>
        <button type="button" onClick={exportEdits} className="text-sm underline underline-offset-2">Download corrections</button>
      </div>
      <details open className="mb-5 text-sm max-w-3xl"><summary className="cursor-pointer text-muted">What the choices mean</summary><dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">{MEANS.map(([k, v]) => <Fragment key={k}><dt className="font-medium text-primary">{k}</dt><dd className="text-secondary">{v}</dd></Fragment>)}</dl></details>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b border-primary"><th className="py-2 pr-4 font-medium">Name</th><th className="pr-4 font-medium">Size</th><th className="pr-4 font-medium">Suggestion</th><th className="pr-4 font-medium">Joins</th><th className="font-medium">Why</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={key(r)} className="border-b border-border-light align-top">
                <td className="py-2 pr-4 min-w-[220px]"><span className="text-primary">{r.name}</span><span className="block text-[12px] text-muted">{r.source === 'gallery' ? 'Gallery set' : r.kind || 'No kind'}</span></td>
                <td className="py-2 pr-4 whitespace-nowrap text-muted">{r.books != null ? `${r.books.toLocaleString('en-GB')} books` : ''}{r.images ? ` ${r.images.toLocaleString('en-GB')} images` : ''}</td>
                <td className="py-2 pr-4"><select aria-label={`Type for ${r.name}`} value={edits[key(r)] || r.proposed} onChange={(e) => change(r, e.target.value)} className="border border-border-light bg-white px-1 py-0.5 text-base">{TYPES.map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}</select>{!edits[key(r)] && r.confidence !== 'high' && <button type="button" onClick={() => change(r, r.proposed)} className="ml-2 h-7 px-2.5 bg-primary text-cream text-[12.5px]" title="The suggestion is right">Right</button>}{r.confidence !== 'high' && <span className="block text-[12px] text-muted">{r.confidence} confidence</span>}</td>
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
