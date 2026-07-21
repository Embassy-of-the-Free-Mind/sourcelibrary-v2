import { LIBRARY_PARTNERS } from '@/lib/library-partners';
import type { Collection } from '@/lib/api-client/types/collections';

/**
 * Known-entity search capture (issue #2790).
 *
 * Some queries name a *place in the library*, not a topic — "internet archive" is
 * a library partner, "alchemy" may be a collection. Without this, the query is
 * handed straight to the LLM, which guesses at a topic. matchKnownEntity() does a
 * cheap, exact, case-insensitive lookup against three registries and returns a
 * direct entry so the results page can surface a "go here" card above the AI
 * narration. BESPOKE_ENTITIES is empty today (it held the SHWEP reading room until
 * that page was taken down); keep it for the next hand-maintained landing page.
 *
 * Matching is deliberately STRICT — only an exact normalized or slugified match
 * qualifies — so generic words ("history", "the") never resolve to a collection.
 */
export type KnownEntityKind = 'reading-room' | 'collection' | 'library';

export interface KnownEntity {
  title: string;
  description: string;
  href: string;
  kind: KnownEntityKind;
  /** emoji or short glyph for the card; optional */
  icon?: string;
}

/** Bespoke pages that aren't collections or library partners (hand-maintained). */
const BESPOKE_ENTITIES: Array<KnownEntity & { aliases: string[] }> = [];

const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
const slugify = (s: string) =>
  norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export interface MatchOptions {
  /** Live collections list (from /api/collections) to match against. */
  collections?: Pick<Collection, 'slug' | 'name' | 'description' | 'subtitle'>[];
}

/**
 * Resolve a query to a known library destination, or null. Order: bespoke pages
 * → collections → library partners. Exact normalized/slug match only.
 */
export function matchKnownEntity(query: string, opts: MatchOptions = {}): KnownEntity | null {
  const q = norm(query);
  if (q.length < 2) return null;
  const qs = slugify(query);

  for (const e of BESPOKE_ENTITIES) {
    if (e.aliases.some((a) => norm(a) === q || slugify(a) === qs)) {
      const { aliases: _aliases, ...entity } = e;
      return entity;
    }
  }

  for (const c of opts.collections || []) {
    if (slugify(c.slug || '') === qs || norm(c.name || '') === q || slugify(c.name || '') === qs) {
      return {
        title: c.name,
        description: c.subtitle || c.description || `Browse the ${c.name} collection.`,
        href: `/collections/${c.slug}`,
        kind: 'collection',
      };
    }
  }

  for (const p of Object.values(LIBRARY_PARTNERS)) {
    if (slugify(p.slug) === qs || norm(p.name) === q || norm(p.shortName) === q || slugify(p.name) === qs) {
      return {
        title: p.name,
        description: p.description,
        href: `/libraries/${p.slug}`,
        kind: 'library',
      };
    }
  }

  return null;
}
