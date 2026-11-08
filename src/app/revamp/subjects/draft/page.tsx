import Link from 'next/link';
import { dataFile } from '../../_lib/data';

interface Subj {
  id: string; label: string; level: number; parents: string[]; scopeNote?: string | null;
  altLabels?: Record<string, string[]>; confidence?: string; imageCount?: number | null; bookCount?: number | null;
  fast?: { id: string; heading: string; match: string } | null; wikidata?: { id: string; label: string; match: string } | null;
}
interface Doc { method?: string[]; notes?: string[]; stats?: Record<string, unknown>; subjects: Subj[] }

function Links({ s }: { s: Subj }) {
  return (
    <span className="text-[12.5px] text-muted">
      {s.fast ? <a href={`https://id.worldcat.org/fast/${String(s.fast.id).replace(/^fst0*/, '')}`} target="_blank" rel="noreferrer" className="underline underline-offset-2 mr-2">FAST{s.fast.match === 'close' ? ' (close)' : ''}</a> : <span className="mr-2">No FAST</span>}
      {s.wikidata ? <a href={`https://www.wikidata.org/wiki/${s.wikidata.id}`} target="_blank" rel="noreferrer" className="underline underline-offset-2 mr-2">Wikidata{s.wikidata.match === 'close' ? ' (close)' : ''}</a> : <span className="mr-2">No Wikidata</span>}
      {s.imageCount ? `${s.imageCount.toLocaleString('en-GB')} images` : ''}
    </span>
  );
}

export default function Page() {
  const d = dataFile<Doc>('subjects');
  if (!d) return <main className="max-w-3xl mx-auto px-6 py-14 text-muted">The draft subject list isn&apos;t ready yet.</main>;
  const tops = d.subjects.filter((s) => s.level === 1);
  const under = (id: string) => d.subjects.filter((s) => s.level === 2 && s.parents.includes(id));
  return (
    <main className="max-w-5xl mx-auto px-6 py-14">
      <h1 className="text-4xl text-primary font-display mb-3">Draft subject list</h1>
      <p className="text-secondary max-w-2xl mb-3">{d.subjects.length} terms under {tops.length} headings. Nobody has reviewed this yet. Every FAST and Wikidata link came back from their own lookup services, and a term with no good match shows none.</p>
      {d.notes?.length ? <ul className="text-sm text-muted max-w-2xl mb-8 list-disc pl-5">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
      {tops.map((t) => (
        <section key={t.id} id={t.id} className="border-t border-border-medium py-6 scroll-mt-4">
          <h2 className="text-2xl text-primary font-display">{t.label}</h2>
          <p className="mb-3"><Links s={t} /></p>
          {t.scopeNote && <p className="text-sm text-secondary mb-3 max-w-2xl">{t.scopeNote}</p>}
          <div className="grid md:grid-cols-2 gap-x-10">
            {under(t.id).map((s) => (
              <div key={s.id} id={s.parents[0] === t.id ? s.id : undefined} className="border-t border-border-light py-2 scroll-mt-4">
                <span className="block text-[15px] text-primary">{s.label}{s.parents.length > 1 && s.parents[0] !== t.id ? <span className="text-muted text-[12.5px]"> (also under <Link href={`#${s.parents[0]}`} className="underline underline-offset-2">{d.subjects.find((p) => p.id === s.parents[0])?.label}</Link>)</span> : null}</span>
                {s.scopeNote && <span className="block text-[13px] text-secondary">{s.scopeNote}</span>}
                <Links s={s} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
