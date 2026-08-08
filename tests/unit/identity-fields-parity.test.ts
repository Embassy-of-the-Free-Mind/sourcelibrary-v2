import { describe, it, expect } from 'vitest';
import { computeIdentityFields } from '@/lib/identity-fields';
import { normalizeTitle as dedupTitle, normalizeAuthor as dedupAuthor } from '@/lib/dedup';
import * as twin from '../../scripts/lib/identity-fields.mjs';

/**
 * The identity worker runs the .mjs twin under plain node on Hetzner; imports
 * run the TS side. If they disagree, the same book gets different identity
 * depending on which door it came through — the exact three-implementations
 * disease the identity layer exists to end. This suite fails CI on any drift.
 * (Twin convention: cf. r2-key.test.ts, chapter-endpages-levels.test.ts.)
 */

const FIXTURES = [
  // Latin, complete
  { title: 'De Mysteriis Aegyptiorum', author: 'Iamblichus', year: 1607 },
  { title: 'The Chymical Wedding of Christian Rosenkreutz', author: 'Andreae, Johann Valentin (1586-1654)', year: 1616 },
  // volumes: arabic, roman, Latin ordinal
  { title: 'Opera omnia', display_title: 'Opera omnia, Tomus II', author: 'Ficino, Marsilio', year: 1576 },
  { title: 'Theatrum chemicum, Vol. 3', author: 'Zetzner, Lazarus', published: 'Strasbourg, 1659' },
  { title: 'Aristotelis Opera, Tomus primus', author: 'Aristotle', year: 1831 },
  // year only via `published`; year absent entirely
  { title: 'Amphitheatrum sapientiae aeternae', author: 'Khunrath, Heinrich', published: 'Hanau, 1609' },
  { title: 'Amphitheatrum sapientiae aeternae', author: 'Khunrath, Heinrich' },
  // anonymous; nothing at all
  { title: 'Rosarium philosophorum', year: 1550 },
  { title: 'Rosarium philosophorum' },
  // non-Latin scripts — normalized_title '' (dedup ASCII semantics), edition_key real
  { title: '營造法式 (Yingzao Fashi) · 卷一~卷四', author: 'Li Jie (李誡)', year: 1145 },
  { title: '營造法式', author: '李誡', year: 1145 },
  { title: 'བཀའ་འགྱུར', author: '', year: 1700 },
  { title: 'كتاب الشفاء', author: 'Ibn Sina', year: 1027 },
  { title: 'Ἰλιάς', author: 'Homer', year: 1488 },
  { title: 'Тайная доктрина', author: 'Blavatsky, Helena', year: 1888 },
  // mixed-script, diacritics, name-order variants
  { title: 'حي بن يقظان / Philosophus Autodidactus', author: 'Ibn Tufayl', year: 1671 },
  { title: "L'Alchimie et les alchimistes", author: 'Figuier, Louis', year: 1854 },
  { title: 'Böhmes Werke, Band 2', author: 'Jakob Böhme', year: 1730 },
  // stubs and hostile input
  { title: 'MS', author: 'Anon' },
  { title: 'untitled', author: '' },
  { title: '', author: 'Somebody', year: 1600 },
  { title: null as unknown as string, author: null as unknown as string },
];

describe('identity-fields twin parity (TS canonical vs .mjs worker port)', () => {
  it('computeIdentityFields agrees on every fixture', () => {
    for (const f of FIXTURES) {
      expect(twin.computeIdentityFields(f), JSON.stringify(f.title)).toEqual(computeIdentityFields(f));
    }
  });

  it('twin normalizeTitle/normalizeAuthor agree with dedup.ts exactly', () => {
    // normalized_title/author keep dedup's stored semantics — the twin must
    // reproduce them, ASCII warts included (non-Latin → '' is deliberate here).
    for (const f of FIXTURES) {
      expect(twin.normalizeTitle(String(f.title || ''))).toBe(dedupTitle(String(f.title || '')));
      expect(twin.normalizeAuthor(String(f.author || ''))).toBe(dedupAuthor(String(f.author || '')));
    }
  });

  it('writes the full convention: null means computed-and-unkeyable, never undefined', () => {
    const stub = computeIdentityFields({ title: 'MS', author: 'Anon' });
    expect(stub.edition_key).toBeNull();
    expect(stub.edition_key_quality).toBeNull();
    expect(Object.keys(stub).sort()).toEqual(
      ['edition_key', 'edition_key_quality', 'normalized_author', 'normalized_title'],
    );
  });
});
