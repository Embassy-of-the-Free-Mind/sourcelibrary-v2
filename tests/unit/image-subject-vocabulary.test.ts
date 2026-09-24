import { describe, it, expect } from 'vitest';
import vocabulary from '@/data/image-subjects.json';
import subjectMap from '@/data/image-subject-map.json';
import { SUBJECT_CATEGORIES, topicLabel } from '@/lib/image-subjects';
import { subjectStringsForTopic } from '@/lib/image-subject-map';

// The browse vocabulary (#4856): every mapped id must exist, or a raw subject string
// silently falls out of every category.
describe('image subject vocabulary', () => {
  const termIds = new Set(vocabulary.categories.flatMap((c) => c.terms.map((t) => t.id)));
  const catIds = vocabulary.categories.map((c) => c.id);

  it('has unique category and term ids, and each term sits under its category', () => {
    expect(new Set(catIds).size).toBe(catIds.length);
    const allTerms = vocabulary.categories.flatMap((c) => c.terms.map((t) => t.id));
    expect(new Set(allTerms).size).toBe(allTerms.length);
    for (const c of vocabulary.categories) for (const t of c.terms) expect(t.id.startsWith(`${c.id}.`)).toBe(true);
  });

  it('maps raw strings only onto term ids that exist', () => {
    const unknown = Object.values(subjectMap.map as Record<string, string[]>).flat().filter((id) => !termIds.has(id));
    expect(unknown).toEqual([]);
  });

  it('expands a category to the union of its terms, and a term to its own strings', () => {
    const medicinal = subjectStringsForTopic('plants.medicinal');
    expect(medicinal).toContain('herbalism');
    const plants = subjectStringsForTopic('plants');
    expect(plants).toEqual(expect.arrayContaining([...medicinal, 'botany']));
  });

  it('returns no strings for an unknown topic, so the filter matches nothing', () => {
    expect(subjectStringsForTopic('not-a-topic')).toEqual([]);
    expect(topicLabel('not-a-topic')).toBeNull();
  });

  it('gives every term at least one mapped string', () => {
    const empty = SUBJECT_CATEGORIES.flatMap((c) => c.terms).filter((t) => subjectStringsForTopic(t.id).length === 0);
    expect(empty.map((t) => t.id)).toEqual([]);
  });
});
