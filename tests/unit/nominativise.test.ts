/**
 * Genitive → nominative by thesaurus lookup (#3894 item 5 follow-up).
 *
 * `findCandidates` is injected, so these are real behaviour tests with no
 * database. The fixture mirrors real `authors` docs, including the two
 * same-surname collisions that produced wrong bylines on production runs.
 *
 * THE INVARIANT: this resolver may return NOTHING, and nothing is a good
 * answer. Its output feeds a public byline, so the ordering of costs is
 *
 *     wrong person  ≫  no answer  >  correct answer
 *
 * because a wrong nominative is a plausible-looking, curated-looking, entirely
 * false attribution, while no answer just leaves the row for a human. Three
 * separate rules below exist only to force a null, and each one was added after
 * a real false positive:
 *
 *   surname-only matching   "Iacobi Sannazarii" → Jacob of Edessa, "Gasparis
 *                           Contareni" → Gaspard Bauhin (matched the PRAENOMEN)
 *   exact stem equality     "Riccii" → Riccioli, "Curtii" → Curtin,
 *                           "Gentilis" → Gentile (matched a LONGER surname)
 *   given-name corroboration "Bartholomaei Riccii" → Paolo Riccio,
 *                           "Scipii Gentilis" → Giovanni Gentile (right
 *                           surname, wrong man)
 */
import { describe, it, expect } from 'vitest';
import { nominativise, lookupStems } from '../../scripts/lib/nominativise.mjs';

type Doc = { _id: string; canonical_name: string; variants?: string[] };

const AUTHORS: Doc[] = [
  { _id: 'clenard-nicolas', canonical_name: 'Clénard, Nicolas', variants: ['Nicolaus Clenardus'] },
  { _id: 'matteo-gribaldi', canonical_name: 'Matteo Gribaldi' },
  { _id: 'carlo-sigonio', canonical_name: 'Carlo Sigonio' },
  { _id: 'natta-marco-antonio', canonical_name: 'Natta, Marco Antonio' },
  { _id: 'paolo-riccio', canonical_name: 'Paolo Riccio' },
  { _id: 'giovanni-gentile', canonical_name: 'Giovanni Gentile' },
  { _id: 'jacob-of-edessa', canonical_name: 'Jacob of Edessa' },
  { _id: 'gaspard-bauhin', canonical_name: 'Gaspard Bauhin' },
  { _id: 'giovanni-battista-riccioli', canonical_name: 'Giovanni Battista Riccioli' },
  { _id: 'aldus-manutius', canonical_name: 'Aldus Manutius' },
  { _id: 'cicero', canonical_name: 'Cicero', variants: ['M. Tullii Ciceronis Opera, Manutii'] },
];

// Mirrors the audit's Mongo lookup: a loose regex over canonical_name/variants.
const findCandidates = async (stem: string) =>
  AUTHORS.filter((d) => new RegExp(stem, 'i').test([d.canonical_name, ...(d.variants || [])].join(' ')));

describe('resolves a genitive to the curated nominative', () => {
  const OK: Array<[string, string]> = [
    ['Nicolai Clenardi', 'Clénard, Nicolas'],
    ['Matthaei Gribaldi', 'Matteo Gribaldi'],      // Latin/vernacular praenomen
    ['Caroli Sigonii', 'Carlo Sigonio'],           // Latin/vernacular praenomen
    ['Marci Antonii Nattae Astensis', 'Natta, Marco Antonio'],  // trailing toponym dropped
  ];
  for (const [captured, expected] of OK) {
    it(`${captured} → ${expected}`, async () => {
      const hit = await nominativise(captured, findCandidates);
      expect(hit?.nominative).toBe(expected);
      expect(hit?.ambiguous).toBe(false);
    });
  }
});

describe('returns NOTHING rather than the wrong person', () => {
  const NONE: Array<[string, string]> = [
    ['Bartholomaei Riccii', 'right surname, wrong man — Bartolomeo is not Paolo Riccio'],
    ['Scipii Gentilis', 'right surname, wrong man — Scipione is not Giovanni Gentile'],
    ['Iacobi Sannazarii', 'praenomen must not match — this returned Jacob of Edessa'],
    ['Gasparis Contareni', 'praenomen must not match — this returned Gaspard Bauhin'],
  ];
  for (const [captured, why] of NONE) {
    it(`${captured} → null (${why})`, async () => {
      expect(await nominativise(captured, findCandidates)).toBeNull();
    });
  }

  it('an unknown person resolves to null, not a guess', async () => {
    expect(await nominativise('Ignoti Cuiusdam', findCandidates)).toBeNull();
  });

  it('an empty or too-short capture resolves to null', async () => {
    expect(await nominativise('', findCandidates)).toBeNull();
    expect(await nominativise('Di', findCandidates)).toBeNull();
  });
});

describe('lookupStems isolates the surname', () => {
  it('takes the LAST name token, not the first', () => {
    // "Iacobi" is the praenomen; matching on it is what returned Jacob of Edessa.
    expect(lookupStems('Iacobi Sannazarii').surname).toBe('sannazari');
  });
  it('walks back past a toponymic epithet', () => {
    expect(lookupStems('Marci Antonii Nattae Astensis').surname).toBe('natt');
  });
  it('keeps the praenomen as supporting evidence', () => {
    expect(lookupStems('Caroli Sigonii').supporting.length).toBeGreaterThan(0);
  });
  it('yields no surname for an empty capture', () => {
    expect(lookupStems('').surname).toBeNull();
  });
});
