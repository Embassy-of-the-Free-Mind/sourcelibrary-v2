import type { Db } from 'mongodb';

/**
 * Resolves entity names to their canonical forms using the entity_aliases collection.
 *
 * The entity_aliases collection maps variant names → canonical names.
 * This is populated by the dedup script (scripts/enrichment/dedup-entities.mjs).
 *
 * Usage in sync paths:
 *   const resolver = await loadAliasResolver(db);
 *   const canonicalName = resolver.resolve('St. Augustine', 'person'); // → "Saint Augustine"
 */

interface AliasDoc {
  alias_lower: string;
  canonical_name: string;
  type: string;
}

export interface AliasResolver {
  /** Resolve a name to its canonical form. Returns original name if no alias exists. */
  resolve(name: string, type: string): string;
  /** Number of alias mappings loaded */
  size: number;
}

/**
 * Load all alias mappings into an in-memory map for fast lookups during sync.
 * Call once per sync run — the map is cheap (< 1MB for thousands of entries).
 */
export async function loadAliasResolver(db: Db): Promise<AliasResolver> {
  const docs = await db.collection<AliasDoc>('entity_aliases')
    .find({})
    .project({ alias_lower: 1, canonical_name: 1, type: 1 })
    .toArray();

  // Build lookup: "type:alias_lower" → canonical_name
  const map = new Map<string, string>();
  for (const doc of docs) {
    map.set(`${doc.type}:${doc.alias_lower}`, doc.canonical_name);
  }

  return {
    resolve(name: string, type: string): string {
      return map.get(`${type}:${name.toLowerCase()}`) || name;
    },
    size: map.size,
  };
}
