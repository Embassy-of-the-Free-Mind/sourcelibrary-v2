#!/usr/bin/env node
/**
 * Resolve an author name → canonical Mongo `entities` record → that author's
 * books, via the two authority stores' complementary strengths:
 *
 *   name (any form, incl. Latin index)
 *     │  stem-then-authority reconciliation against Supabase entity_aliases
 *     │  (full surnames + life-dates + viaf_id) — author-reconcile.mjs
 *     ▼
 *   cluster { primary_name (vernacular), viaf_id }
 *     │  bridge to Mongo `entities`:  by viaf_id (exact), else by normalized
 *     │  primary_name (the hard Latin→vernacular step is already done, so this
 *     │  is now an easy exact match)
 *     ▼
 *   author_entity_id  →  books.find({ author_entity_id })  — EXACT join
 *
 * Why this and not surname regex: the entity join separates same-surname people
 * a surname can't — e.g. Giovanni Pico (entity → 12 books) vs his nephew
 * Gianfrancesco (own entity). Reusable anywhere author identity matters:
 * catalog matching, "books by this author", related-works, dedup.
 *
 * Coverage honesty: the Mongo entity store is mostly bare name stubs (only
 * ~1.7% carry aliases, ~0.2% a VIAF id, none have dates). The bridge therefore
 * lands for the resolved head (famous authors — Pico, Erasmus, Bruno); for the
 * long tail with no resolvable entity, callers should fall back to the surname-
 * cluster path (reconcile().expandedSurnames). This module returns enough to do
 * both: entityId when bridged, expandedSurnames always.
 *
 * CLI proof:
 *   set -a; source .env.production.local; set +a
 *   node scripts/lib/entity-resolve.mjs "Picus, Ioannes" 1632
 */
import { loadAuthority, reconcile, norm } from './author-reconcile.mjs';

// Build the resolver once: Supabase authority for reconciliation + two Mongo
// entity lookup indexes (by viaf, by normalized name) for the bridge.
export async function loadResolver(supaGet, db, { dfMax = 30 } = {}) {
  const authority = await loadAuthority(supaGet, { dfMax });
  const byViaf = new Map();
  const byName = new Map();
  const cur = db.collection('entities').find(
    { type: 'person' }, { projection: { name: 1, viaf_id: 1 } });
  for await (const e of cur) {
    if (e.viaf_id) byViaf.set(String(e.viaf_id), String(e._id));
    const n = norm(e.name);
    if (n && !byName.has(n)) byName.set(n, String(e._id));   // first wins; name-only stubs
  }
  return { authority, byViaf, byName };
}

// name → { entityId | null, primary_name, viafId, score, expandedSurnames, via }
export function resolveToEntity(name, { resolver, year } = {}) {
  const rec = reconcile(name, { authority: resolver.authority, year });
  if (!rec) return null;
  let entityId = null, via = null;
  if (rec.viafId && resolver.byViaf.has(String(rec.viafId))) {
    entityId = resolver.byViaf.get(String(rec.viafId)); via = 'viaf';
  } else {
    const byName = resolver.byName.get(norm(rec.primary_name));
    if (byName) { entityId = byName; via = 'name'; }
  }
  return {
    entityId, via,
    primary_name: rec.primary_name,
    viafId: rec.viafId,
    score: rec.score,
    expandedSurnames: rec.expandedSurnames,
  };
}

export async function booksForEntity(db, entityId) {
  if (!entityId) return [];
  return db.collection('books').find(
    { author_entity_id: entityId, visible: { $ne: false } },
    { projection: { title: 1, author: 1, year: 1, slug: 1 } }).toArray();
}

// ─── CLI / proof harness ────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv[2];
  const year = process.argv[3] ? Number(process.argv[3]) : undefined;
  if (!name) { console.error('usage: entity-resolve.mjs "Surname, Given" [year]'); process.exit(1); }

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const supaGet = async (path) => {
    const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };
  const { MongoClient } = await import('mongodb');
  const mc = new MongoClient(process.env.MONGODB_URI);
  await mc.connect();
  const db = mc.db('bookstore');

  console.log(`Query: "${name}"${year ? ` (${year})` : ''}`);
  console.log('Loading resolver (Supabase authority + Mongo entity bridge)…');
  const resolver = await loadResolver(supaGet, db);
  console.log(`  ${resolver.authority.clusters.size} clusters, ${resolver.byViaf.size} viaf-bridged + ${resolver.byName.size} name-bridged entities.\n`);

  const r = resolveToEntity(name, { resolver, year });
  if (!r) { console.log('No confident cluster.'); await mc.close(); process.exit(0); }
  console.log(`reconciled → ${r.primary_name} (VIAF ${r.viafId || '—'}), score ${r.score}`);
  console.log(`entity bridge → ${r.entityId ? `${r.entityId} (via ${r.via})` : 'NONE (fall back to surname expansion)'}`);

  if (r.entityId) {
    const books = await booksForEntity(db, r.entityId);
    console.log(`\nEXACT entity join → ${books.length} books:`);
    for (const b of books.slice(0, 15)) console.log(`   • "${(b.title || '').slice(0, 48)}" — ${b.author} (${b.year ?? '?'})`);
  } else {
    console.log(`\nNo entity; surname-expansion fallback terms: ${r.expandedSurnames.join(', ')}`);
  }
  await mc.close();
}
