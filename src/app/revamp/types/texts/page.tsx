import AxisIndex from '../../_components/AxisIndex';
import { HOW_TEXT_TYPES } from '../../_lib/how';
import { typeGroups } from '../../_lib/axes';

const n = (v: number) => v.toLocaleString('en-GB');

/** Types of texts: what a text is written on, and what kind of writing it is. */
export default function Page() {
  const { bookGroups: groups, texts } = typeGroups();
  const tiles = [...new Set(groups.flatMap((g) => g.narrower.flatMap((x) => x.pics.slice(0, 3).map((p) => p.src))))].slice(0, 48);
  const kinds = groups.reduce((a, g) => a + g.narrower.length, 0);
  return (
    <AxisIndex title="Types of texts" intro="Browse the texts by what kind of writing they are and what they are written on."
      counts={[`${kinds} types`, `${n(texts)} texts`]} tiles={tiles} featured={null}
      groups={groups} noun={['type', 'types']} group={['Type', 'All types']} placeholder="Search types of texts or ask a question"
      orders={[['theme', 'By group'], ['az', 'A to Z']]}
      how={HOW_TEXT_TYPES} />
  );
}
