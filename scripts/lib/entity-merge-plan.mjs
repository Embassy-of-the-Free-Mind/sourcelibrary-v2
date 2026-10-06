// PRIOR ART: scripts/enrichment/merge-qid-duplicates.mjs — merges only records with the SAME name
// and QID, keeps the first book entry it sees, and DELETES the losers. scripts/enrichment/
// dedup-entities.mjs — writes `entity_aliases` rows (pattern + Gemini), never merges records.
// Neither can plan a by-eye cluster of differently-spelled records without deleting anything.
/**
 * Plan the merge of one cluster of `entities` person records into a survivor (#5888).
 *
 * PURE: takes the cluster's documents, returns the writes that WOULD be made. Nothing here
 * touches the database. The cluster's membership is a by-eye judgement supplied by the caller
 * (explicit `_id`s) — this module never decides that two records are the same person.
 *
 * Rules, each from .claude/docs/invariants/entity-page-attribution.md:
 *   - one `books[]` entry per book_id on the survivor;
 *   - a page number is carried over only where it was already VERIFIED (`page_precision:
 *     'page'`). An unmarked legacy entry is demoted to section precision before merging, so the
 *     merge can never turn a smeared batch range into page citations;
 *   - `book_count` / `total_mentions` are recomputed from the merged array.
 *
 * Losers are never deleted: they keep their document, gain `merged_into`, and give up their
 * `books[]` (which now live on the survivor — keeping both would double every count).
 */
import { dedupeEntityBooks, entityCounters } from './entity-page-match.mjs';

/** Scalar enrichment a survivor may be missing and a same-person loser may carry. */
export const FILLABLE_FIELDS = [
  'wikidata_id', 'description', 'canonical_name', 'wikidata_birth_date', 'wikidata_death_date',
  'viaf_id', 'gnd_id', 'lcnaf_id', 'portrait_url', 'wikipedia_url', 'birth_place', 'death_place',
  'work_places', 'author_slug',
];

/** An entry with no precision marker predates verification: its pages are a smeared range. */
export function normalizeEntityBook(entry) {
  if (entry.page_precision) return entry;
  const pages = entry.pages || [];
  if (pages.length === 0) return { ...entry, page_precision: 'section' };
  return { ...entry, pages: [], page_precision: 'section', page_range: { start: Math.min(...pages), end: Math.max(...pages) } };
}

const distinctBooks = (doc) => new Set((doc.books || []).map(b => b?.book_id).filter(Boolean)).size;
const idOf = (doc) => String(doc._id);

/** Survivor = most distinct books; ties go to the record with a Wikidata id, then the oldest. */
export function chooseSurvivor(docs) {
  return [...docs].sort((a, b) =>
    distinctBooks(b) - distinctBooks(a)
    || (b.wikidata_id ? 1 : 0) - (a.wikidata_id ? 1 : 0)
    || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
    || idOf(a).localeCompare(idOf(b)))[0];
}

/**
 * @param {object[]} docs  the cluster's `entities` documents (survivor included)
 * @param {{ aliasRows?: object[] }} [ctx]  existing `entity_aliases` rows for the cluster's names
 * @returns the plan, or throws if the cluster is not mergeable as given
 */
export function planClusterMerge(docs, ctx = {}) {
  if (!Array.isArray(docs) || docs.length < 2) throw new Error('a cluster needs at least two records');
  const notPerson = docs.filter(d => d.type !== 'person');
  if (notPerson.length) throw new Error(`not person records: ${notPerson.map(d => d.name).join(', ')}`);
  const already = docs.filter(d => d.merged_into);
  if (already.length) throw new Error(`already merged: ${already.map(d => d.name).join(', ')}`);
  const qids = [...new Set(docs.map(d => d.wikidata_id).filter(Boolean))];
  if (qids.length > 1) throw new Error(`two different Wikidata ids in one cluster: ${qids.join(', ')}`);

  const survivor = chooseSurvivor(docs);
  const losers = docs.filter(d => d !== survivor);

  const books = dedupeEntityBooks([survivor, ...losers].flatMap(d => (d.books || []).map(normalizeEntityBook)));
  const counters = entityCounters(books);

  const aliases = [];
  const seen = new Set([survivor.name]);
  for (const name of [...(survivor.aliases || []), ...losers.flatMap(l => [l.name, ...(l.aliases || [])])]) {
    if (typeof name !== 'string' || !name.trim() || seen.has(name)) continue;
    seen.add(name);
    aliases.push(name);
  }

  const filled = {};
  for (const field of FILLABLE_FIELDS) {
    if (survivor[field] != null) continue;
    const donor = losers.find(l => l[field] != null);
    if (donor) filled[field] = { value: donor[field], from: donor.name };
  }

  // Writers resolve a printed name through `entity_aliases` before upserting, so without these
  // rows the next index run recreates every loser.
  const existing = new Map((ctx.aliasRows || []).map(r => [r.alias_lower, r]));
  const aliasRows = [];
  const aliasConflicts = [];
  for (const name of new Set(losers.flatMap(l => [l.name, ...(l.aliases || [])]))) {
    if (typeof name !== 'string' || !name.trim()) continue;
    const alias_lower = name.toLowerCase();
    if (alias_lower === survivor.name.toLowerCase()) continue;
    const row = existing.get(alias_lower);
    if (row && row.canonical_name !== survivor.name) aliasConflicts.push({ alias_lower, existing: row.canonical_name });
    else if (!row) aliasRows.push({ type: 'person', alias_lower, alias_name: name, canonical_name: survivor.name, source: 'merge-5888' });
  }

  const before = { book_count: distinctBooks(survivor), aliases: (survivor.aliases || []).length };
  return {
    survivor: {
      _id: idOf(survivor), name: survivor.name, before,
      set: { aliases, books, ...counters, ...Object.fromEntries(Object.entries(filled).map(([k, v]) => [k, v.value])) },
      filled,
      booksGained: counters.book_count - before.book_count,
    },
    losers: losers.map(l => ({
      _id: idOf(l), name: l.name, books: distinctBooks(l),
      booksNewToSurvivor: [...new Set((l.books || []).map(b => b?.book_id).filter(Boolean))]
        .filter(id => !(survivor.books || []).some(b => b?.book_id === id)).length,
      set: { merged_into: idOf(survivor), books: [], book_count: 0, total_mentions: 0 },
      undo: { books: l.books || [], book_count: l.book_count ?? null, total_mentions: l.total_mentions ?? null },
    })),
    aliasRows,
    aliasConflicts,
  };
}
