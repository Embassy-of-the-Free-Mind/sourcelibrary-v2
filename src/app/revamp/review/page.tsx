import ReviewTable, { type Rec } from '../_components/ReviewTable';
import { dataFile } from '../_lib/data';

export default function Page() {
  const d = dataFile<{ notes?: string[]; records: Rec[] }>('sorting');
  if (!d) return <main className="max-w-3xl mx-auto px-6 py-14 text-muted">The sorting review isn&apos;t ready yet.</main>;
  return (
    <main className="max-w-[1300px] mx-auto px-6 py-14">
      <h1 className="text-4xl text-primary font-display mb-3">Sorting review</h1>
      <p className="text-secondary max-w-2xl mb-2">Only the groupings the sorting was unsure about are shown. For each: press Right if the suggestion is correct, or pick another option. Each one leaves the list once answered. Your answers stay in this browser until you download them, and nothing touches the site. Untick “Needs review only” to see everything.</p>
      {d.notes?.length ? <details className="text-sm text-muted max-w-2xl mb-6"><summary className="cursor-pointer">How this list was made</summary><ul className="list-disc pl-5 mt-2">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul></details> : null}
      <ReviewTable records={d.records} />
    </main>
  );
}
