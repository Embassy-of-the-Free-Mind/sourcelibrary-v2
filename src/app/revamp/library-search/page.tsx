import { dataFile } from '../_lib/data';
import { centuryOfSlug, centuryRows, languageGroups } from '../_lib/axes';
import { TEXT_TYPE_MAP, FORM_MAP } from '../_lib/standards';
import { placeGroups } from '../_lib/places';
import AdvancedSearchV2, { type Opt } from './AdvancedSearchV2';

interface Subj { id: string; label: string; level: number; parents: string[]; bookCount?: number }

/** The Library's advanced search, rebuilt on the new ways in. Prototype: the form only, it does not search. */
export default function Page() {
  const subjects = dataFile<{ subjects: Subj[] }>('subjects')?.subjects ?? [];
  const broad = subjects.filter((s) => s.level === 1).sort((a, b) => a.label.localeCompare(b.label));
  const subjectGroups = broad.map((b) => ({ label: b.label, options: [{ value: b.id, label: `All of ${b.label}` }, ...subjects.filter((s) => s.parents.includes(b.id)).sort((x, y) => x.label.localeCompare(y.label)).map((s) => ({ value: s.id, label: s.label }))] }));
  const centuries: (Opt & { from: number; count: number })[] = centuryRows().map((r) => ({ value: r.id, label: r.label, from: centuryOfSlug(r.id)!.from, count: r.size ?? 0 })).sort((a, b) => a.from - b.from);
  const languages: (Opt & { count: number })[] = languageGroups().groups[0].narrower.map((l) => ({ value: l.label, label: l.label, count: l.size ?? 0 }));
  const kinds = TEXT_TYPE_MAP.map((m) => ({ value: m.ours, label: m.label }));
  const forms = FORM_MAP.map((m) => ({ value: m.ours, label: m.label }));
  const placeOpts = placeGroups().map((g) => ({ label: g.label, options: g.narrower.map((p) => ({ value: p.id, label: p.label })) }));
  return (
    <main className="bg-cream min-h-screen">
      <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12 pt-10 pb-24">
        <p className="text-[12px] uppercase tracking-[0.14em] text-muted mb-2">Prototype · the Library&apos;s advanced search on the new ways in</p>
        <h1 className="font-display text-4xl text-primary mb-2">Advanced search</h1>
        <p className="text-secondary max-w-2xl mb-6">The same panel as on the Library page, regrouped by the five questions: what it is about, when, where, which language, and what kind of text. It only shows the form; it does not search. Place and Written on are not recorded in the catalogue yet.</p>
        <AdvancedSearchV2 subjectGroups={subjectGroups} centuries={centuries} languages={languages} kinds={kinds} forms={forms} places={placeOpts} />
      </div>
    </main>
  );
}
