import AxisIndex from '../../_components/AxisIndex';
import { HOW_BOOK_KINDS } from '../../_lib/how';
import { typeGroups } from '../../_lib/axes';

const n = (v: number) => v.toLocaleString('en-GB');

/** Kinds of books: what a text is written on, and what kind of writing it is. */
export default function Page() {
  const { bookGroups: groups, texts } = typeGroups();
  const tiles = [...new Set(groups.flatMap((g) => g.narrower.flatMap((x) => x.pics.slice(0, 3).map((p) => p.src))))].slice(0, 48);
  const kinds = groups.reduce((a, g) => a + g.narrower.length, 0);
  return (
    <AxisIndex title="Kinds of books" intro="Browse the books by what they are written on and what kind of writing they are."
      counts={[`${kinds} kinds`, `${n(texts)} books`]} tiles={tiles} featured={null}
      groups={groups} noun={['kind', 'kinds']} group={['Question', 'All questions']} placeholder="Search kinds of books or ask a question"
      orders={[['theme', 'By question'], ['az', 'A to Z']]}
      how={HOW_BOOK_KINDS} />
  );
}
