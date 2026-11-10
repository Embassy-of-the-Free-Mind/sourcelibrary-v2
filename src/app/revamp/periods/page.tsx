import Link from 'next/link';
import AxisIndex from '../_components/AxisIndex';
import { axisSlugs, featuredOf, periodGroups } from '../_lib/axes';

const n = (v: number) => v.toLocaleString('en-GB');

export default function Page() {
  const { groups, books, count } = periodGroups();
  const f = featuredOf(axisSlugs().periods);
  const tiles = f ? f.heroTiles : groups.flatMap((g) => g.pics.map((p) => p.src)).slice(0, 40);
  return (
    <AxisIndex title="Periods" intro="Browse the library by when its works were written, century by century."
      counts={[`${count} centuries`, `${n(books)} books with a date`]} tiles={tiles}
      featured={f ? { name: f.name, href: `/revamp/p/${f.slug}` } : null}
      groups={groups} noun={['century', 'centuries']} group={['Span', 'All spans']} placeholder="Search periods or ask a question"
      orders={[['theme', 'Oldest first'], ['rev', 'Newest first']]}
      how={{ title: 'How we date works', items: [
        'Each work sits in the century it was written, not the century of the copy we hold: a 1502 printing of Herodotus is in 500–401 BCE.',
        'Centuries are plain date spans, the way library catalogues give dates (FAST). Named eras such as Renaissance mean different years in different places, so they are subjects, not dates.',
        'Some dates come from a record (Wikidata, the author’s dates, the book’s own title page); the rest are estimates, marked as such on the work.',
        <span key="made">When the copy itself was made is a separate filter, Date made, on every list. <Link href="/revamp/standards" className="text-primary underline underline-offset-[3px]">Every term against its standard</Link></span>,
      ] }} />
  );
}
