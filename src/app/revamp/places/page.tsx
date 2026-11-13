import Link from 'next/link';
import AxisIndex from '../_components/AxisIndex';
import { placeGroups } from '../_lib/places';

/** Places: where a text comes from. Structure only until the catalogue round records place on every book. */
export default function Page() {
  const groups = placeGroups();
  const tiles = groups.flatMap((g) => g.pics.map((p) => p.src)).slice(0, 40);
  const n = groups.reduce((a, g) => a + g.narrower.length, 0);
  return (
    <AxisIndex title="Places" intro="Browse the library by where its texts come from, continent by continent."
      counts={[`${n} places`, 'Not recorded yet']} tiles={tiles} featured={null}
      groups={groups} noun={['place', 'places']} group={['Continent', 'All continents']} placeholder="Search places or ask a question"
      orders={[['theme', 'By continent'], ['az', 'A to Z']]}
      how={{ title: 'How we name places', items: [
        'A place is where a text comes from, not where this copy was printed. Where it was printed will be a filter in the Library.',
        'Every place is linked to Wikidata. Getty’s Thesaurus of Geographic Names and FAST geographic headings are added when place is recorded in the catalogue round.',
        'Groupings that were only a region, such as East Asia or Middle East & Africa, become these places.',
        <span key="std"><Link href="/revamp/standards" className="text-primary underline underline-offset-[3px]">Every term against its standard</Link></span>,
      ] }} />
  );
}
