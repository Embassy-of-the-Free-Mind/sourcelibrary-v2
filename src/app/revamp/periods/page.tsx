import Link from 'next/link';
import AxisIndex from '../_components/AxisIndex';
import CenturyList from '../_components/CenturyList';
import { axisSlugs, centuryRows, featuredOf, periodGroups } from '../_lib/axes';

const n = (v: number) => v.toLocaleString('en-GB');
const HOW = [
        'Each work sits in the century it was written, not the century of the copy we hold: a 1502 printing of Herodotus is in 500–401 BCE.',
        'Centuries are plain date spans, the way library catalogues give dates (FAST). Named eras such as Renaissance mean different years in different places, so they are subjects, not dates.',
        'Some dates come from a record (Wikidata, the author’s dates, the book’s own title page); the rest are estimates, marked as such on the work.',
        <span key="made">When the copy itself was made is a separate filter, Date made, on every list. <Link href="/revamp/standards" className="text-primary underline underline-offset-[3px]">Every term against its standard</Link></span>,
];

export default async function Page({ searchParams }: { searchParams: Promise<{ look?: string }> }) {
  // Prototype: A is the picture bands, B one list of centuries with bars, named Centuries.
  const lp = (await searchParams).look;
  const look = lp === 'b' || lp === 'c' ? lp : 'a';
  const { groups, books, count } = periodGroups();
  const f = featuredOf(axisSlugs().periods);
  // A mix: the first two pictures of every one, so the wall shows the whole range rather than one item's few pictures repeated.
  const tiles = [...new Set(groups.flatMap((g) => g.narrower.flatMap((x) => x.pics.slice(0, 2).map((p) => p.src))))].slice(0, 48);
  const how = { title: 'How we date works', items: HOW };
  const switcher = <>Look{[['a', 'A Periods, in bands'], ['b', 'B Centuries, one list'], ['c', 'C One list, no pictures']].map(([k, l]) => <Link key={k} href={`/revamp/periods?look=${k}`} className={look === k ? 'text-white underline underline-offset-2' : 'hover:text-white'}>{l}</Link>)}</>;
  return (
    <AxisIndex switcher={switcher} title={look === 'a' ? 'Periods' : 'Centuries'} intro="Browse the library by when its works were written, century by century."
      counts={[`${count} centuries`, `${n(books)} books with a date`]} tiles={tiles}
      featured={f ? { name: f.name, href: `/revamp/p/${f.slug}` } : null}
      groups={groups} noun={['century', 'centuries']} group={['Span', 'All spans']} placeholder={look !== 'a' ? 'Search centuries or ask a question' : 'Search periods or ask a question'}
      orders={[['rev', 'Newest first'], ['theme', 'Oldest first']]}
      how={how}>
      {look === 'a' ? undefined : <CenturyList rows={centuryRows()} how={how} thumbs={look === 'b'} />}
    </AxisIndex>
  );
}
