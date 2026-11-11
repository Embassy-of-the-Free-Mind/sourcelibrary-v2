import Link from 'next/link';
import AxisIndex from '../_components/AxisIndex';
import { featuredOf, typeGroups, typeSlugs } from '../_lib/axes';

const n = (v: number) => v.toLocaleString('en-GB');

export default function Page() {
  const { groups, pictures, texts } = typeGroups();
  const f = featuredOf(typeSlugs().filter((s) => s.startsWith('type-picture-')));
  // A mix: the first two pictures of every one, so the wall shows the whole range rather than one item's few pictures repeated.
  const tiles = [...new Set(groups.flatMap((g) => g.narrower.flatMap((x) => x.pics.slice(0, 2).map((p) => p.src))))].slice(0, 48);
  const name = f && groups.flatMap((g) => g.narrower).find((x) => x.id === f.slug)?.label;
  return (
    <AxisIndex title="Types" intro="Browse the library by what kind of thing it is: engravings and woodcuts, maps and portraits, treatises and letters."
      counts={[`${n(pictures)} pictures`, `${n(texts)} books`]} tiles={tiles}
      featured={f && name ? { name, href: `/revamp/t/${f.slug}` } : null}
      groups={groups} noun={['type', 'types']} group={['Kind', 'Pictures and texts']} placeholder="Search types or ask a question"
      orders={[['theme', 'By kind'], ['az', 'A to Z']]}
      how={{ title: 'How we name types', items: [
        'Picture types are named after the Getty Art & Architecture Thesaurus, the museum standard, which keeps how a picture was made (technique) apart from what it shows.',
        'Text types are named after the Library of Congress genre and form terms, the library standard.',
        'A picture has one type for now, so an engraved portrait is under either Engraving or Portrait, not both. Giving every picture both is the next step.',
        <span key="std"><Link href="/revamp/standards" className="text-primary underline underline-offset-[3px]">Every term against its standard</Link></span>,
      ] }} />
  );
}
