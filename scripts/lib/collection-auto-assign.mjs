/**
 * Which collections the enrich worker's collection tagger (Phase 7.6) may write into, and
 * what it records about the memberships it adds (#4848).
 *
 * A hand-curated collection (a partner's reading list, a commissioned shelf) and the
 * recommender both wrote `books.collections`, and only the human left a record:
 * `forum-of-conscience` was published with 34 chosen members and the tagger grew it past 70,
 * including two books a curator had excluded on evidence (#4653). A collection doc with
 * `auto_assign: false` is now closed to the tagger — it is not offered to the model and a
 * slug the model returns for it anyway is dropped. Absent the flag, behaviour is unchanged.
 *
 * And every membership the tagger adds is named in `collection_scores.added`, so "did a
 * human choose this book for this collection?" is answerable later. `collection_relevance`
 * cannot answer it: it was backfilled across hand-tagged members too.
 *
 * PRIOR ART: scripts/lib/confirmed-copies.mjs — the tagger's other guard (copy pairs), keyed
 * on the BOOK, not the collection; src/lib/further-reading.ts — the read-side symptom fix
 * (#4846), which hides the double listing but cannot stop the write.
 */

/** True when a collection doc has opted out of automatic assignment. */
export function isClosedToAutoAssign(collection) {
  return collection?.auto_assign === false;
}

/** Split collection docs into those the tagger may target and the closed slugs. */
export function autoAssignTargets(collections) {
  const open = [];
  const closed = [];
  for (const c of collections || []) {
    if (isClosedToAutoAssign(c)) { if (c.slug) closed.push(c.slug); } else open.push(c);
  }
  return { open, closed };
}

/** The slugs this pass actually adds: assigned, and not already on the book. */
export function addedSlugs(existing, slugs) {
  const have = new Set(existing || []);
  return [...new Set(slugs)].filter(s => !have.has(s));
}
