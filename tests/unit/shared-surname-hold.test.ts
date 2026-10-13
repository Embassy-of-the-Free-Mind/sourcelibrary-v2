/**
 * The hold list for surnames several people share (#5950).
 *
 * The list is by hand; these pin its shape (two bearers, two distinct ids, or it has no business
 * holding anything) and how narrowly it matches: only the bare word, only as a person.
 */
import { describe, it, expect } from 'vitest';

import { HELD_SURNAMES, isHeldSurname } from '../../scripts/lib/shared-surname-hold.mjs';

describe('isHeldSurname', () => {
  it('holds the bare surname as a person, whatever the case or accents', () => {
    expect(isHeldSurname('Bacon', 'person')).toBe(true);
    expect(isHeldSurname(' bacon ', 'person')).toBe(true);
    expect(isHeldSurname('SCALIGER', 'person')).toBe(true);
    expect(isHeldSurname('Philalèthes', 'person')).toBe(true);
  });

  it('does not hold a full name, another type, or a name that is not listed', () => {
    expect(isHeldSurname('Roger Bacon', 'person')).toBe(false);
    expect(isHeldSurname('Lord Bacon', 'person')).toBe(false);
    expect(isHeldSurname('Bacon', 'concept')).toBe(false);
    expect(isHeldSurname('Bacon', 'place')).toBe(false);
    expect(isHeldSurname('Baconus', 'person')).toBe(false);
    expect(isHeldSurname('', 'person')).toBe(false);
    expect(isHeldSurname(undefined as unknown as string, 'person')).toBe(false);
  });

  it('leaves alone the single names the mechanical rule would have caught', () => {
    for (const name of ['Aristotle', 'David', 'Adam', 'Paul', 'Thomas', 'Gesner', 'Helmont']) {
      expect(isHeldSurname(name, 'person')).toBe(false);
    }
  });

  it('does not hold a record that claims nobody: its mentions name no one wrongly', () => {
    for (const name of ['Montanus', 'Bruno', 'Fabricius', 'Agrippa']) expect(isHeldSurname(name, 'person')).toBe(false);
  });
});

describe('HELD_SURNAMES', () => {
  it.each(Object.entries(HELD_SURNAMES))('%s is one word, with two bearers under distinct Wikidata ids and a measured error', (surname, entry) => {
    expect(surname).toMatch(/^\p{L}+$/u);
    const ids = new Set(entry.bearers.map(b => b.wikidata_id));
    expect(ids.size).toBeGreaterThanOrEqual(2);
    for (const b of entry.bearers) {
      expect(b.wikidata_id).toMatch(/^Q\d+$/);
      expect(b.name.split(/\s+/).length).toBeGreaterThanOrEqual(2);
    }
    expect(entry.wrong).toMatch(/^\d+ of \d+$/);
    expect(ids.has(entry.bare_record_claims)).toBe(true);
  });
});
