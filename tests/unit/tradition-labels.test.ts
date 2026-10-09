import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
// @ts-expect-error — untyped .mjs maintenance script
import { LABELS, cleanLabels, parseAnswer, bookLine, SYSTEM_PROMPT } from '../../scripts/maintenance/tradition-4773.mjs';

// books.tradition is a CLOSED list (#4773): what the model answers is cut to
// it before anything is stored, and the list the search re-rank reads is the
// same file the labeller prompts with.
const vocab = JSON.parse(readFileSync(path.resolve(__dirname, '../../src/lib/taxonomy/traditions.json'), 'utf8')) as { labels: { label: string; family: string; period?: boolean }[] };

describe('tradition labels (#4773)', () => {
  it('the vocabulary is the 31 map labels, each with a family', () => {
    expect(LABELS).toHaveLength(31);
    expect(new Set(LABELS).size).toBe(31);
    expect(vocab.labels.every((l) => l.family && /^[a-z-]+$/.test(l.family))).toBe(true);
    expect(vocab.labels.filter((l) => l.period).map((l) => l.label).sort()).toEqual(['Medieval Latin', 'Modern European', 'Renaissance & Early Modern Europe']);
  });

  it('the prompt lists every label, exactly', () => {
    for (const l of LABELS) expect(SYSTEM_PROMPT).toContain(`- ${l}\n`);
  });

  it('drops a label outside the list and keeps at most two, in order', () => {
    expect(cleanLabels(['Indian', 'Atlantean', 'Buddhist', 'Tibetan'])).toEqual({ labels: ['Indian', 'Buddhist'], dropped: ['Atlantean'] });
    expect(cleanLabels(['Indian', 'Indian'])).toEqual({ labels: ['Indian'], dropped: [] });
    expect(cleanLabels(undefined)).toEqual({ labels: [], dropped: [] });
    expect(cleanLabels('Indian')).toEqual({ labels: [], dropped: [] });
  });

  it('reads a fenced or bare JSON array and refuses anything else', () => {
    expect(parseAnswer('```json\n[{"i":0,"t":["Greek"]}]\n```')).toEqual([{ i: 0, t: ['Greek'] }]);
    expect(parseAnswer('[{"i":0,"t":[]}]')).toEqual([{ i: 0, t: [] }]);
    expect(parseAnswer('{"i":0}')).toBeNull();
    expect(parseAnswer('I cannot')).toBeNull();
  });

  it('gives the model the record a cataloguer would read', () => {
    const line = bookLine({ title: 'Bhagavad Gita', display_title: 'The Song of the Lord', author: 'tr. Schlegel', year: 1823, language: 'Latin', original_language: 'Sanskrit', collections: ['indic-traditions'], summary: { data: 'A Latin translation.' } }, 3);
    expect(line).toBe('3. Bhagavad Gita | EN: The Song of the Lord | by tr. Schlegel | (1823) | lang: Latin | orig: Sanskrit | tags: indic-traditions | about: A Latin translation.');
  });
});
