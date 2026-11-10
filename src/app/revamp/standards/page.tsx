import { FORMAT_MAP, PERIOD_MAP, PICTURE_TYPE_MAP, TEXT_TYPE_MAP, type Mapping } from '../_lib/standards';

const MATCH = { exact: 'Same', close: 'Close', none: 'None found' };

function Table({ title, intro, rows, kind }: { title: string; intro: string; rows: (Mapping & { kind?: string })[]; kind?: boolean }) {
  return (
    <section className="mt-12">
      <h2 className="text-2xl sm:text-3xl text-primary font-display">{title}</h2>
      <p className="mt-2 text-[15px] text-secondary max-w-3xl">{intro}</p>
      <div className="mt-5 overflow-x-auto border border-border-light bg-white">
        <table className="w-full text-[14px] text-left">
          <thead className="bg-warm text-primary"><tr>
            <th className="px-4 py-2.5 font-medium">Ours</th>{kind && <th className="px-4 py-2.5 font-medium">Kind</th>}
            <th className="px-4 py-2.5 font-medium">Match</th><th className="px-4 py-2.5 font-medium">Standard term</th><th className="px-4 py-2.5 font-medium">Note</th>
          </tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.ours} className="border-t border-border-light align-top">
              <td className="px-4 py-2.5 text-primary whitespace-nowrap">{r.label}</td>{kind && <td className="px-4 py-2.5 text-secondary whitespace-nowrap">{r.kind}</td>}
              <td className="px-4 py-2.5 text-secondary whitespace-nowrap">{MATCH[r.match]}</td>
              <td className="px-4 py-2.5">{r.terms.length ? r.terms.map((t) => <a key={t.uri} href={t.uri} className="block text-primary underline underline-offset-[3px] decoration-border-medium hover:decoration-primary">{t.label} <span className="text-muted">({t.scheme})</span></a>) : <span className="text-muted">None</span>}</td>
              <td className="px-4 py-2.5 text-secondary">{r.note}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

export default function Page() {
  return (
    <div className="bg-cream min-h-screen">
      <div className="max-w-[1200px] mx-auto px-6 md:px-12 py-12 md:py-16">
        <h1 className="font-serif text-[36px] md:text-[52px] text-primary leading-[1.05] tracking-tight">Our filters against the standards</h1>
        <p className="mt-4 text-[17px] text-secondary max-w-3xl">Each value in the Type, Format, Period and Picture type menus, with the matching term in the Library of Congress Genre/Form Terms (LCGFT) or the Getty Art &amp; Architecture Thesaurus (AAT). Every link was looked up on 10 November 2026.</p>
        <Table title="Type of text" intro="Libraries describe this with LCGFT." rows={TEXT_TYPE_MAP} />
        <Table title="Printed or manuscript" intro="Library records already split these by record type." rows={FORMAT_MAP} />
        <Table title="Picture type" intro="Museums describe this with AAT, which keeps technique apart from what a picture shows." rows={PICTURE_TYPE_MAP} kind />
        <Table title="Period" intro="AAT period names are mostly European. FAST, the library standard, uses plain date spans instead." rows={PERIOD_MAP} />
      </div>
    </div>
  );
}
