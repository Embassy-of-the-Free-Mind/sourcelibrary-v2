import Link from 'next/link';
import AxisIndex from '../_components/AxisIndex';
import { axisSlugs, featuredOf, languageGroups } from '../_lib/axes';

const n = (v: number) => v.toLocaleString('en-GB');

export default function Page() {
  const { groups, books, named, values, unmatched } = languageGroups();
  const f = featuredOf(axisSlugs().languages);
  const tiles = f ? f.heroTiles : groups.flatMap((g) => g.pics.map((p) => p.src)).slice(0, 40);
  return (
    <AxisIndex title="Languages" intro="Browse the library by the language its books are written in."
      counts={[`${named} languages`, `${n(books)} books`]} tiles={tiles}
      featured={f ? { name: f.name, href: `/revamp/l/${f.slug}` } : null}
      groups={groups} noun={['language', 'languages']} group={['Family', 'All language families']} placeholder="Search languages or ask a question"
      orders={[['theme', 'By family, largest first'], ['az', 'A to Z']]}
      how={{ title: 'How we name languages', items: [
        'A book is listed under the language of this copy, which can differ from the original’s: a Latin text in English translation is under English.',
        'Languages are grouped into their families, as linguists classify them.',
        `The catalogue stores ${values} different spellings. Codes such as “De” and “Fr” are matched here to their language, following the ISO 639 language codes; the ${unmatched} that can’t be matched with certainty are listed last, unmerged.`,
        <span key="std"><Link href="/revamp/standards" className="text-primary underline underline-offset-[3px]">Every term against its standard</Link></span>,
      ] }} />
  );
}
