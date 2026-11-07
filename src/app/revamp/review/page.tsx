import ReviewTable, { type Rec } from '../_components/ReviewTable';
import { dataFile } from '../_lib/data';

export default function Page() {
  const d = dataFile<{ notes?: string[]; records: Rec[] }>('sorting');
  if (!d) return <main className="max-w-3xl mx-auto px-6 py-14 text-muted">The sorting review isn&apos;t ready yet.</main>;
  return (
    <main className="max-w-[1300px] mx-auto px-6 py-14">
      <h1 className="text-4xl text-primary font-display mb-3">Sorting review</h1>
      <p className="text-secondary max-w-2xl mb-2">Each public record, sorted into the new types by reading its name and description. Change any you disagree with. Your changes stay in this browser until you download them, and nothing touches the site.</p>
      {d.notes?.length ? <ul className="text-sm text-muted max-w-2xl mb-6 list-disc pl-5">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
      <ReviewTable records={d.records} />
    </main>
  );
}
