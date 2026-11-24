import AxisIndex from '../_components/AxisIndex';
import { howLanguages } from '../_lib/how';
import { featuredLanguage, languageGroups } from '../_lib/axes';

const n = (v: number) => v.toLocaleString('en-GB');

export default function Page() {
  const { groups, books, named, values, unmatched } = languageGroups();
  // The hero shows the featured language's own title pages: real pages with text, checked by eye.
  const f = featuredLanguage();
  return (
    <AxisIndex title="Languages" intro="Browse the library by the language its books are written in."
      counts={[`${named} languages`, `${n(books)} texts`]} tiles={f?.pages ?? []}
      featured={f ? { name: f.name, href: `/revamp/l/${f.slug}` } : null}
      groups={groups} noun={['language', 'languages']} group={['', '']} placeholder="Search languages or ask a question" flat listOnly
      orders={[['size', 'Most books first'], ['size-asc', 'Fewest books first'], ['az', 'A to Z'], ['za', 'Z to A']]}
      how={howLanguages(values, unmatched)} />
  );
}
