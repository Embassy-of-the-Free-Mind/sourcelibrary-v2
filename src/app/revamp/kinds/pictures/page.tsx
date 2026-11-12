import AxisIndex from '../../_components/AxisIndex';
import { HOW_PICTURE_KINDS } from '../../_lib/how';
import { featuredOf, typeGroups, typeSlugs } from '../../_lib/axes';

const n = (v: number) => v.toLocaleString('en-GB');

/** Kinds of pictures: what it shows, how it was made, where it sits in the book. */
export default function Page() {
  const { pictureGroups: groups, pictures } = typeGroups();
  const f = featuredOf(typeSlugs().filter((s) => s.startsWith('type-picture-')));
  const tiles = [...new Set(groups.flatMap((g) => g.narrower.flatMap((x) => x.pics.slice(0, 3).map((p) => p.src))))].slice(0, 48);
  const name = f && groups.flatMap((g) => g.narrower).find((x) => x.id === f.slug)?.label;
  const kinds = groups.reduce((a, g) => a + g.narrower.length, 0);
  return (
    <AxisIndex title="Kinds of pictures" intro="Browse the pictures by what they show, how they were made, and where they sit in the book."
      counts={[`${kinds} kinds`, `${n(pictures)} pictures`]} tiles={tiles}
      featured={f && name ? { name, href: `/revamp/t/${f.slug}` } : null}
      groups={groups} noun={['kind', 'kinds']} group={['Question', 'All questions']} placeholder="Search kinds of pictures or ask a question"
      orders={[['theme', 'By question'], ['az', 'A to Z']]}
      how={HOW_PICTURE_KINDS} />
  );
}
