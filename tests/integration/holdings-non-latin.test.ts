import { describe, it, expect, beforeEach } from 'vitest';
import type { ObjectId } from 'mongodb';
import { checkHoldings } from '@/lib/holdings-check';
import { buildEditionKey } from '@/lib/edition-key';
import { getTestDb, cleanDb } from '../setup';

// #8084: check_duplicate answered "Likely safe to import" for 本草綱目 + 李時珍 (135 live
// volumes held) and "new" for 史記 + 司馬遷. Han names have an empty surname slot in the
// stored key, and the catalogue title carries the juan, so no key tier matched and the
// "No author" branch skipped the title + author search. Records below copy live ones.

function book(id: string, title: string, author: string, year?: number) {
  const doc = { title, author, ...(year != null ? { year } : {}) };
  return { _id: id as unknown as ObjectId, id, visible: true, pages_count: 120, ...doc, edition_key: buildEditionKey(doc).key };
}

const HELD = [
  book('bencao-1', '本草綱目·卷上之中', '李時珍', 1596),
  book('bencao-2', '本草綱目·卷中之上', '李時珍', 1596),
  book('puji', '普濟方', '朱橚', 1406),
  book('shiji-27', '史記·卷二十七 (Shiji juan 27, Tianguan shu)', '司馬遷 (Sima Qian)'),
  book('shiji-suoyin', '史記索隱', '司馬貞'),
  book('epictetus', 'Ἐπικτήτου Διατριβαί (Epicteti Dissertationes)', 'Epictetus', 1799),
  book('jabr', 'كتاب الجبر والمقابلة (Kitāb al-Jabr)', 'Al-Khwarizmi', 830),
  book('ladhdha', 'جوامع اللذة Jawāmiʿ al-Ladhdha: Encyclopedia of Pleasure', 'Ali ibn Nasr al-Katib (علي بن نصر الكاتب)', 1000),
  book('tengyur-173', 'བསྟན་འགྱུར། སྡེ་དགེ། སྤྲིང་ཡིག ངེ (Derge Tengyur, vol. 173)', '', 1982),
];

const ids = (r: Awaited<ReturnType<typeof checkHoldings>>) => r.candidates.map((c) => c.book_id);

describe('checkHoldings: titles and authors outside the Latin script (#8084)', () => {
  beforeEach(async () => {
    await cleanDb();
    await getTestDb().collection('books').insertMany(HELD);
  });

  it('本草綱目 + 李時珍 finds the held juan, author-confirmed, with no "No author" limit', async () => {
    const res = await checkHoldings(getTestDb(), { title: '本草綱目', author: '李時珍' });
    expect(res.verdict).toBe('other_edition');
    expect(res.candidates[0].reason).toBe('title_author_near');
    expect(ids(res)).toEqual(expect.arrayContaining(['bencao-1', 'bencao-2']));
    expect(ids(res)).not.toContain('puji');
    expect(res.limits.join(' ')).not.toMatch(/author/i);
  });

  it('a stated year makes the same-author juan a possible same edition', async () => {
    const res = await checkHoldings(getTestDb(), { title: '本草綱目', author: '李時珍', year: 1596 });
    expect(res.verdict).toBe('possible_same_edition');
  });

  it('Simplified input (本草纲目 + 李时珍) resolves to the traditional record', async () => {
    const res = await checkHoldings(getTestDb(), { title: '本草纲目', author: '李时珍' });
    expect(res.verdict).toBe('other_edition');
    expect(ids(res)).toContain('bencao-1');
  });

  it('史記 + 司馬遷 finds the Shiji juan; 史記索隱 by 司馬貞 is only a similar title', async () => {
    const res = await checkHoldings(getTestDb(), { title: '史記', author: '司馬遷' });
    expect(res.verdict).toBe('other_edition');
    expect(res.candidates[0].book_id).toBe('shiji-27');
    expect(res.candidates.find((c) => c.book_id === 'shiji-suoyin')?.reason).toBe('near_title');
  });

  it('a Greek title with its romanized catalogue tail is found', async () => {
    const res = await checkHoldings(getTestDb(), { title: 'Ἐπικτήτου Διατριβαί', author: 'Epictetus', year: 1799 });
    expect(res.candidates[0].book_id).toBe('epictetus');
    expect(res.verdict).toBe('possible_same_edition');
  });

  it('an Arabic title is found with a Latin or an Arabic author', async () => {
    const latin = await checkHoldings(getTestDb(), { title: 'كتاب الجبر والمقابلة', author: 'Al-Khwarizmi' });
    expect(latin.candidates[0]?.book_id).toBe('jabr');
    expect(latin.verdict).toBe('other_edition');
    const arabic = await checkHoldings(getTestDb(), { title: 'جوامع اللذة', author: 'علي بن نصر الكاتب' });
    expect(arabic.candidates[0]?.book_id).toBe('ladhdha');
    expect(arabic.verdict).toBe('other_edition');
    expect(arabic.limits.join(' ')).not.toMatch(/author/i);
  });

  it('a Tibetan title with no author is found as a title to check', async () => {
    const res = await checkHoldings(getTestDb(), { title: 'བསྟན་འགྱུར། སྡེ་དགེ།' });
    expect(ids(res)).toContain('tengyur-173');
    expect(res.verdict).toBe('related_title');
  });

  it('a Chinese work we do not hold is still new', async () => {
    const res = await checkHoldings(getTestDb(), { title: '紅樓夢', author: '曹雪芹' });
    expect(res.verdict).toBe('new');
    expect(res.candidates).toEqual([]);
  });

  it('an Arabic particle alone does not confirm an author', async () => {
    const res = await checkHoldings(getTestDb(), { title: 'جوامع اللذة', author: 'محمد بن موسى' });
    expect(res.candidates.find((c) => c.book_id === 'ladhdha')?.reason).toBe('near_title');
  });
});
