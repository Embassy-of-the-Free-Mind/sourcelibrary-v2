import Link from 'next/link';
import AxisIndex from '../_components/AxisIndex';
import { featuredLanguage, languageGroups } from '../_lib/axes';

const n = (v: number) => v.toLocaleString('en-GB');

export default function Page() {
  const { groups, books, named, values, unmatched } = languageGroups();
  // The hero shows the featured language's own title pages: real pages with text, checked by eye.
  const f = featuredLanguage();
  return (
    <AxisIndex title="Languages" intro="Browse the library by the language its books are written in."
      counts={[`${named} languages`, `${n(books)} books`]} tiles={f?.pages ?? []}
      featured={f ? { name: f.name, href: `/revamp/l/${f.slug}` } : null}
      groups={groups} noun={['language', 'languages']} group={['', '']} placeholder="Search languages or ask a question" flat listOnly
      orders={[['size', 'Most books first'], ['size-asc', 'Fewest books first'], ['az', 'A to Z'], ['za', 'Z to A']]}
      how={{ title: 'How we name languages', items: [
        'A book is listed under the language of this copy, which can differ from the original’s: a Latin text in English translation is under English.',
        `The catalogue stores ${values} different spellings. Codes such as “De” and “Fr” are matched here to their language, following the ISO 639 language codes; the ${unmatched} that are not one language (such as “Und” or “Latin. German”) are left out here; their books are still in the Library.`,
        <span key="std"><Link href="/revamp/standards" className="text-primary underline underline-offset-[3px]">Every term against its standard</Link></span>,
      ] }} />
  );
}
