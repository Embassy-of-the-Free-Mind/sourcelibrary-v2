import Link from 'next/link';
import AxisIndex from '../_components/AxisIndex';
import NameWall from '../_components/NameWall';
import PlateWall from '../_components/PlateWall';
import { axisSlugs, featuredOf, languageGroups, languageNames, languagePages, languageTitles } from '../_lib/axes';

const n = (v: number) => v.toLocaleString('en-GB');

export default async function Page({ searchParams }: { searchParams: Promise<{ hero?: string }> }) {
  // Prototype: A pictures behind the hero, B each language's own name in its own script.
  const HEROES: [string, string][] = [['pictures', 'A Pictures'], ['text', 'B Names'], ['text6', 'C Names, 6 rows'], ['titles', 'D Book titles'], ['pages', 'E Title pages']];
  const hp = (await searchParams).hero ?? 'pictures';
  const hero = HEROES.some(([k]) => k === hp) ? hp : 'pictures';
  const wall = hero === 'text' ? <NameWall names={languageNames()} /> : hero === 'text6' ? <NameWall names={languageNames()} rows={6} /> : hero === 'titles' ? <NameWall names={languageTitles()} rows={6} fontScale={0.8} /> : hero === 'pages' ? <PlateWall tiles={languagePages()} rows={3} still /> : undefined;
  const { groups, books, named, values, unmatched } = languageGroups();
  const f = featuredOf(axisSlugs().languages);
  // A mix: the first two pictures of every one, so the wall shows the whole range rather than one item's few pictures repeated.
  const tiles = [...new Set(groups.flatMap((g) => g.narrower.flatMap((x) => x.pics.slice(0, 2).map((p) => p.src))))].slice(0, 48);
  return (
    <AxisIndex wall={wall}
      switcher={<>Hero{HEROES.map(([k, l]) => <Link key={k} href={`/revamp/languages?hero=${k}`} className={hero === k ? 'text-white underline underline-offset-2' : 'hover:text-white'}>{l}</Link>)}</>}
      title="Languages" intro="Browse the library by the language its books are written in."
      counts={[`${named} languages`, `${n(books)} books`]} tiles={tiles}
      featured={f ? { name: f.name, href: `/revamp/l/${f.slug}` } : null}
      groups={groups} noun={['language', 'languages']} group={['', '']} placeholder="Search languages or ask a question" flat
      orders={[['size', 'Most books first'], ['size-asc', 'Fewest books first'], ['az', 'A to Z'], ['za', 'Z to A']]}
      how={{ title: 'How we name languages', items: [
        'A book is listed under the language of this copy, which can differ from the original’s: a Latin text in English translation is under English.',
        `The catalogue stores ${values} different spellings. Codes such as “De” and “Fr” are matched here to their language, following the ISO 639 language codes; the ${unmatched} that are not one language (such as “Und” or “Latin. German”) are left out here; their books are still in the Library.`,
        <span key="std"><Link href="/revamp/standards" className="text-primary underline underline-offset-[3px]">Every term against its standard</Link></span>,
      ] }} />
  );
}
