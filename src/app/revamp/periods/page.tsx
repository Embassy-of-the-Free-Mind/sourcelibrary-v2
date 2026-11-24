import AxisIndex from '../_components/AxisIndex';
import CenturyList from '../_components/CenturyList';
import { HOW_PERIODS } from '../_lib/how';
import { axisSlugs, centuryRows, featuredOf, periodGroups } from '../_lib/axes';

const n = (v: number) => v.toLocaleString('en-GB');


// Centuries: one list in time order with a bar for each century's books (chosen 11 November over picture bands and a list with pictures).
export default function Page() {
  const { groups, books, count } = periodGroups();
  const f = featuredOf(axisSlugs().periods);
  // A mix: the first two pictures of every one, so the wall shows the whole range rather than one item's few pictures repeated.
  const tiles = [...new Set(groups.flatMap((g) => g.narrower.flatMap((x) => x.pics.slice(0, 2).map((p) => p.src))))].slice(0, 48);
  const how = HOW_PERIODS;
  return (
    <AxisIndex title="Centuries" intro="Browse the library by when its texts were written, century by century."
      counts={[`${count} centuries`, `${n(books)} texts with a date`]} tiles={tiles}
      featured={f ? { name: f.name, href: `/revamp/p/${f.slug}` } : null}
      groups={groups} noun={['century', 'centuries']} group={['Span', 'All spans']} placeholder="Search centuries or ask a question"
      orders={[['rev', 'Newest first'], ['theme', 'Oldest first']]}
      how={how}>
      <CenturyList rows={centuryRows()} how={how} thumbs={false} />
    </AxisIndex>
  );
}
