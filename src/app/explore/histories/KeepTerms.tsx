import Link from 'next/link';
import type { KeepTerm } from './histories';

// The words a history leaves untranslated, grouped by language: comparing them across languages is the method
// (Cassin, Untranslatables), so the grouping is the content, and it spares the page one long column.
const LANGUAGE: Record<string, string> = {
  grc: 'Greek', la: 'Latin', zh: 'Chinese', sa: 'Sanskrit', he: 'Hebrew', ar: 'Arabic', de: 'German', fr: 'French',
  bo: 'Tibetan', en: 'English', egy: 'Egyptian', yo: 'Yoruba', mi: 'Māori', pi: 'Pali', yua: 'Yucatec Maya',
  poz: 'Malayo-Polynesian', alg: 'Algonquian', ja: 'Japanese', ru: 'Russian', nv: 'Navajo', haw: 'Hawaiian',
  it: 'Italian', akk: 'Akkadian', nci: 'Classical Nahuatl', qu: 'Quechua', ak: 'Akan',
};

export default function KeepTerms({ terms }: { terms: KeepTerm[] }) {
  const groups = new Map<string, KeepTerm[]>();
  for (const t of terms) {
    const name = (t.lang && LANGUAGE[t.lang]) || 'Other languages';
    groups.set(name, [...(groups.get(name) ?? []), t]);
  }
  return (
    <section className="md:relative md:left-1/2 md:-translate-x-1/2 md:w-[min(calc(100vw-2rem),980px)]">
      <div className="max-w-[576px] md:mx-auto mb-8">
        <h2 className="font-serif text-3xl mb-3" style={{ color: 'var(--text-primary)' }}>Words kept in the original</h2>
        <p className="font-body text-lg leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          This history leaves these words untranslated. Under each one are the English words it usually gets.
        </p>
      </div>
      <div className="md:columns-2 md:gap-12">
        {[...groups].map(([language, words]) => (
          <div key={language}>
            <h3 className="font-serif italic text-xl pt-4 pb-2 mb-3 break-after-avoid" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-medium)' }}>{language}</h3>
            <dl className="mb-6">
              {words.map((k) => {
                const term = <>{k.term}{k.translit && k.translit !== k.term ? <> <em className="text-lg">{k.translit}</em></> : null}</>;
                return (
                  <div key={`${k.term}-${k.lang}`} className="break-inside-avoid mb-4">
                    <dt className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>
                      {k.evidence ? <Link href={k.evidence}>{term}</Link> : term}
                    </dt>
                    {k.gloss && <dd className="font-body leading-snug" style={{ color: 'var(--text-secondary)' }}>{k.gloss}</dd>}
                    {k.avoid.length > 0 && (
                      <dd className="font-body italic text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{k.avoid.map((a) => `“${a}”`).join(', ')}</dd>
                    )}
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
