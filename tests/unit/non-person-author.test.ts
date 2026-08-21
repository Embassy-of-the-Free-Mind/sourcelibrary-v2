import { describe, it, expect } from 'vitest';
import { classifyNonPersonAuthor } from '@/lib/non-person-author';
import { resolveCanonicalAuthor } from '@/lib/author-thesaurus';
import AuthorSchema from '@/components/seo/AuthorSchema';

/**
 * #3483 — `is_person: false` was written by a maintenance pass and read by
 * nothing, so 59 quarantined headings rendered with full person framing for the
 * entire life of the flag.
 *
 * Every assertion here exercises behaviour: it calls the classifier, drives the
 * real thesaurus resolver against a fake db, or reads the JSON-LD the schema
 * component actually emits. Nothing asserts that a string appears in a file — a
 * source-shape test would have passed for the whole time this was broken, which
 * is precisely the failure CLAUDE.md records.
 */

// ── the classifier ───────────────────────────────────────────────────────────

describe('classifyNonPersonAuthor', () => {
  it('returns null for a real person, so normal pages are untouched', () => {
    expect(classifyNonPersonAuthor({ is_person: true })).toBeNull();
  });

  it('returns null when the flag is ABSENT — the overwhelming default', () => {
    // 4,766 of 4,825 author docs carry no is_person field at all. A falsy check
    // here (`!doc.is_person`) would strip the person framing from every author
    // on the site; the test exists to make that inversion fail loudly.
    expect(classifyNonPersonAuthor({})).toBeNull();
    expect(classifyNonPersonAuthor({ quarantine_reason: 'institution' })).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(classifyNonPersonAuthor(null)).toBeNull();
    expect(classifyNonPersonAuthor(undefined)).toBeNull();
  });

  it('returns null for a dedup tombstone — the read path follows it to a person', () => {
    // A merged_into doc is resolved to its primary before render, so treating
    // the tombstone's own flag as authoritative would mislabel a real author.
    expect(classifyNonPersonAuthor({
      is_person: false,
      merged_into: 'athanasius-kircher',
    })).toBeNull();
  });

  it('classifies an institution as an Organization', () => {
    const r = classifyNonPersonAuthor({ is_person: false, quarantine_reason: 'institution' });
    expect(r?.kind).toBe('institution');
    expect(r?.schemaEntityType).toBe('Organization');
    expect(r?.label).toBe('Institution');
  });

  it('classifies a work title as no entity at all', () => {
    const r = classifyNonPersonAuthor({ is_person: false, quarantine_reason: 'title-not-author' });
    expect(r?.kind).toBe('work');
    expect(r?.schemaEntityType).toBe('none');
  });

  it('classifies placeholders, series and corpora without asserting an entity', () => {
    for (const [reason, kind] of [
      ['placeholder', 'placeholder'],
      ['press-series', 'series'],
      ['corpus', 'corpus'],
      ['reference', 'work'],
    ] as const) {
      const r = classifyNonPersonAuthor({ is_person: false, quarantine_reason: reason });
      expect(r?.kind, `reason=${reason}`).toBe(kind);
      expect(r?.schemaEntityType, `reason=${reason}`).toBe('none');
    }
  });

  it('falls back to a neutral label when no reason was recorded', () => {
    // 5 of the 59 quarantined docs have no quarantine_reason. Guessing a kind
    // from the name is how a search term became an author (#3434); say only
    // what is known.
    const r = classifyNonPersonAuthor({ is_person: false });
    expect(r?.kind).toBe('other');
    expect(r?.schemaEntityType).toBe('none');
    expect(r?.label).toBe('Not a personal name');
  });
});

// ── the resolver actually carries the flag to the page ────────────────────────

/** Minimal stand-in for the Mongo handle `resolveCanonicalAuthor` expects. */
function fakeDb(authorDoc: Record<string, unknown> | null, books: unknown[] = []) {
  return {
    collection(name: string) {
      switch (name) {
        case 'authors':
          return { findOne: async () => authorDoc };
        case 'books':
          return { find: () => ({ sort: () => ({ toArray: async () => books }) }) };
        case 'entities':
          return { findOne: async () => null };
        case 'system_config':
          return { findOne: async () => null };
        default:
          throw new Error(`unexpected collection: ${name}`);
      }
    },
  };
}

describe('resolveCanonicalAuthor carries the non-person flag', () => {
  it('exposes is_person and quarantine_reason on the resolved doc', async () => {
    // The real regression risk is someone adding a projection to that findOne.
    // This fails the moment the fields stop reaching the page.
    const resolved = await resolveCanonicalAuthor(
      fakeDb(
        { _id: 'british-museum', slug: 'british-museum', canonical_name: 'British Museum',
          is_person: false, quarantine_reason: 'institution' },
        [{ id: 'b1', title: 'Codex Alexandrinus' }],
      ),
      'british-museum',
      { id: 1 },
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.doc.is_person).toBe(false);
    expect(classifyNonPersonAuthor(resolved!.doc)?.kind).toBe('institution');
  });

  it('leaves an ordinary author unclassified end-to-end', async () => {
    const resolved = await resolveCanonicalAuthor(
      fakeDb(
        { _id: 'athanasius-kircher', slug: 'athanasius-kircher', canonical_name: 'Athanasius Kircher' },
        [{ id: 'b2', title: 'Mundus Subterraneus' }],
      ),
      'athanasius-kircher',
      { id: 1 },
    );
    expect(classifyNonPersonAuthor(resolved!.doc)).toBeNull();
  });
});

// ── the JSON-LD the page actually emits ──────────────────────────────────────

/** Call the component and read the JSON-LD it renders. */
function schemaGraph(props: Parameters<typeof AuthorSchema>[0]): Record<string, unknown>[] {
  const el = AuthorSchema(props) as unknown as {
    props: { dangerouslySetInnerHTML: { __html: string } };
  };
  return JSON.parse(el.props.dangerouslySetInnerHTML.__html)['@graph'];
}

const BASE_PROPS = {
  authorName: 'Theatrum Chemicum',
  authorSlug: 'theatrum-chemicum',
  workCount: 4,
  birthDate: '1560-01-01',
  deathDate: '1605-01-01',
  portraitUrl: 'https://example.org/portrait.jpg',
};

describe('AuthorSchema entity type', () => {
  it('defaults to Person, so real author pages are unchanged', () => {
    const graph = schemaGraph({ ...BASE_PROPS, authorName: 'Athanasius Kircher' });
    expect(graph.some(n => n['@type'] === 'Person')).toBe(true);
    expect(graph.some(n => n['@type'] === 'ProfilePage')).toBe(true);
  });

  it('emits NO person or organization node for a work title', () => {
    const graph = schemaGraph({ ...BASE_PROPS, entityType: 'none' });
    expect(graph.some(n => n['@type'] === 'Person')).toBe(false);
    expect(graph.some(n => n['@type'] === 'Organization')).toBe(false);
    // and the page describes itself as a listing, with nothing to point at
    const page = graph.find(n => n['@type'] === 'CollectionPage');
    expect(page).toBeDefined();
    expect(page!.mainEntity).toBeUndefined();
    expect(graph.some(n => n['@type'] === 'ProfilePage')).toBe(false);
  });

  it('emits an Organization without birth/death/portrait for an institution', () => {
    const graph = schemaGraph({
      ...BASE_PROPS, authorName: 'British Museum', entityType: 'Organization',
    });
    const org = graph.find(n => n['@type'] === 'Organization');
    expect(org).toBeDefined();
    expect(graph.some(n => n['@type'] === 'Person')).toBe(false);
    // life dates and a face are claims about a human being
    expect(org!.birthDate).toBeUndefined();
    expect(org!.deathDate).toBeUndefined();
    expect(org!.image).toBeUndefined();
  });

  it('keeps birth/death/portrait on a real person', () => {
    const graph = schemaGraph({ ...BASE_PROPS, authorName: 'Athanasius Kircher' });
    const person = graph.find(n => n['@type'] === 'Person');
    expect(person!.birthDate).toBe('1560-01-01');
    expect(person!.image).toBe('https://example.org/portrait.jpg');
  });
});
