/**
 * Collection catalog + fuzzy resolver for the Librarian.
 *
 * Two jobs:
 *  1. Give the model a compact list of real collection slugs so it can map a
 *     user's topic ("fungi and mushrooms") to the right collection ("mycology")
 *     and pass it to the `search` tool — no verbatim slug required.
 *  2. Resolve whatever the model (or a collection page) passes — a slug, a name,
 *     or a loose topic phrase — to a canonical collection slug. Soft: returns
 *     null when nothing matches well, and the search falls back to unweighted
 *     global (weighting is a bias, never a hard gate).
 *
 * The catalog is cached in-process for an hour; it changes rarely and a stale
 * entry only affects which collection a search leans toward.
 */

import { getDb } from '@/lib/mongodb';

export interface CollectionEntry {
  slug: string;
  name: string;
  bookCount: number;
}

let cache: { at: number; entries: CollectionEntry[] } | null = null;
const TTL_MS = 60 * 60 * 1000;

export async function getCollectionCatalog(): Promise<CollectionEntry[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.entries;
  try {
    const db = await getDb();
    const rows = await db.collection('collections')
      .find({ visible: { $ne: false }, hidden: { $ne: true }, tenantId: { $in: [null, undefined] } })
      .project({ _id: 0, slug: 1, name: 1, book_count: 1 })
      .toArray();
    const entries: CollectionEntry[] = rows
      .filter(r => r.slug && r.name)
      .map(r => ({ slug: r.slug, name: r.name, bookCount: r.book_count || 0 }))
      .sort((a, b) => b.bookCount - a.bookCount);
    cache = { at: Date.now(), entries };
    return entries;
  } catch {
    return cache?.entries ?? [];
  }
}

/** Compact catalog block for the system prompt: "slug — Name (N)" per line. */
export async function formatCatalogForPrompt(): Promise<string> {
  const entries = await getCollectionCatalog();
  if (entries.length === 0) return '';
  const lines = entries.map(e => `${e.slug} — ${e.name}`).join('\n');
  return lines;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function tokens(s: string): string[] {
  return normalize(s).split(' ').filter(t => t.length > 2);
}

/**
 * Resolve an arbitrary input (slug / name / topic phrase) to a collection slug.
 * Returns null when no confident match — caller then searches unweighted.
 */
export async function resolveCollectionSlug(input: string | null | undefined): Promise<string | null> {
  if (!input || !input.trim()) return null;
  const entries = await getCollectionCatalog();
  if (entries.length === 0) return null;

  const raw = input.trim().toLowerCase();
  const normInput = normalize(input);

  // 1. exact slug
  const bySlug = entries.find(e => e.slug.toLowerCase() === raw || e.slug.toLowerCase() === normInput.replace(/ /g, '-'));
  if (bySlug) return bySlug.slug;

  // 2. exact name (case-insensitive)
  const byName = entries.find(e => e.name.toLowerCase() === raw);
  if (byName) return byName.slug;

  // 3. substring either direction on slug or name
  const sub = entries.find(e => {
    const slugN = normalize(e.slug);
    const nameN = normalize(e.name);
    return slugN === normInput || nameN === normInput ||
      slugN.includes(normInput) || normInput.includes(slugN) ||
      nameN.includes(normInput);
  });
  if (sub) return sub.slug;

  // 4. token-overlap scoring (handles "fungi mushrooms" → "mycology" only weakly;
  //    real topic→collection mapping is the model's job via the prompt catalog,
  //    this is the typo/loose-phrase safety net).
  const inTokens = new Set(tokens(input));
  if (inTokens.size === 0) return null;
  let best: { slug: string; score: number } | null = null;
  for (const e of entries) {
    const cand = new Set([...tokens(e.name), ...tokens(e.slug)]);
    let shared = 0;
    for (const t of inTokens) if (cand.has(t)) shared++;
    const score = shared / Math.max(inTokens.size, 1);
    if (score > 0 && (!best || score > best.score)) best = { slug: e.slug, score };
  }
  // Require a majority token overlap to avoid spurious weighting.
  return best && best.score >= 0.5 ? best.slug : null;
}
