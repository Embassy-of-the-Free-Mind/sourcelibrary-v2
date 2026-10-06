/**
 * `checkHoldings()` — "do we already hold this?", answered BEFORE an import.
 *
 * PRIOR ART: src/lib/dedup.ts `checkDuplicate()` and src/lib/acquisition-guard.ts
 * `acquisitionGate()` — they decide whether an import may PROCEED (a yes/no gate
 * that writes `dedup_skips` and claims fingerprints). This module answers a
 * different question for a person: WHAT do we hold, and how sure is that? It
 * calls `checkDuplicate()` (with shadow logging off) for the exact tiers instead
 * of re-implementing them, and adds only what a pre-import look needs: input by
 * URL, other editions, the same work, a near-title search, and each match's
 * state (hidden, duplicate_of, pages, translation). Also:
 * src/app/api/books/check-duplicate/route.ts (public; title required, blind to
 * hidden books in its keyword tier, writes shadow rows on every lookup) —
 * superseded by this for the admin and CLI doors, #6019.
 *
 * WHO USES IT. Derek with a library URL or a title, about to import; a Claude
 * session asked "do we have X?". Both need hidden books (imports land hidden),
 * books whose `_id` was re-minted (16,343 — look up by `id` OR `_id`), and
 * copies catalogued differently. Three doors call this one function:
 * scripts/import/check-holdings.ts (CLI), /api/admin/holdings-check (and the
 * /admin/holdings form), and the MCP server.
 *
 * READ-ONLY. Nothing here writes: no `dedup_skips` row, no claim, no shadow row
 * (`dedup_shadow_decisions` is a measurement — a lookup is not a decision).
 *
 * VERDICTS, strongest first:
 *   same_object       the same digital object (book id, source identifier,
 *                     IIIF manifest). Importing again is a re-import.
 *   same_edition      edition key matches and both sides state the same year.
 *   possible_same_edition  edition key matches but a year is missing on one
 *                     side — the reviewable case (81% of edition-key skips).
 *   other_edition     same title + author surname, a different year or
 *                     volume; or the same `work_id`.
 *   related_title     only a near-title search hit. Look, don't conclude.
 *   new               nothing found. A negative is only as good as the input:
 *                     a URL alone cannot find another edition (no title).
 */

import { ObjectId, type Db, type Document } from 'mongodb';
import { checkDuplicate, editionYear, sourceFingerprints, type DedupCandidate, type DedupMatch } from './dedup';
import { buildEditionKey, editionSurname, normalizeEditionTitle } from './edition-key';
import { BOOK_SEARCH_INDEX } from './atlas-search';

export type HoldingsVerdict =
  | 'same_object'
  | 'same_edition'
  | 'possible_same_edition'
  | 'other_edition'
  | 'related_title'
  | 'new';

export type HoldingReason =
  | 'same_book'
  | 'same_source_object'
  | 'same_iiif_manifest'
  | 'same_edition'
  | 'same_edition_year_unknown'
  | 'other_edition'
  | 'same_work'
  | 'same_work_same_year'
  | 'title_author_near_same_year'
  | 'title_author_near'
  | 'near_title';

export interface HoldingsInput {
  /** A library URL (IA, Gallica, e-rara, BSB/MDZ, a IIIF manifest…) or a
   *  sourcelibrary.org book URL. */
  url?: string | null;
  /** A bare identifier: an IA identifier, `bsb…`, `ark:/12148/…`, or one of
   *  our book ids / slugs. */
  identifier?: string | null;
  title?: string | null;
  author?: string | null;
  year?: number | null;
  /** Free-text imprint, e.g. "Amsterdam, 1682" — the year is parsed from it. */
  published?: string | null;
  /** Page count of the copy about to be imported, when known. With the year it
   *  tells a second copy of one edition from another edition of the work. */
  pages?: number | null;
}

export interface HoldingCandidate {
  book_id: string;
  url: string;
  reason: HoldingReason;
  /** One plain sentence: why this record matched. */
  reason_detail: string;
  collection: 'books' | 'books_warehouse';
  title: string;
  author: string | null;
  year: number | null;
  language: string | null;
  visible: boolean;
  hidden: boolean;
  hidden_reason: string | null;
  duplicate_of: string | null;
  work_id: string | null;
  pages_count: number;
  pages_ocr: number;
  pages_translated: number;
  provider: string | null;
}

export interface HoldingsResult {
  verdict: HoldingsVerdict;
  /** One line a person can act on. */
  summary: string;
  candidates: HoldingCandidate[];
  query: {
    fingerprints: string[];
    edition_key: string | null;
    edition_key_quality: string | null;
  };
  /** What the check could NOT look at, given the input. */
  limits: string[];
}

const REASON_RANK: Record<HoldingReason, number> = {
  same_book: 0,
  same_source_object: 1,
  same_iiif_manifest: 1,
  same_edition: 2,
  same_edition_year_unknown: 3,
  other_edition: 4,
  same_work: 5,
  same_work_same_year: 3,
  title_author_near_same_year: 3,
  title_author_near: 5,
  near_title: 6,
};

const REASON_VERDICT: Record<HoldingReason, HoldingsVerdict> = {
  same_book: 'same_object',
  same_source_object: 'same_object',
  same_iiif_manifest: 'same_object',
  same_edition: 'same_edition',
  same_edition_year_unknown: 'possible_same_edition',
  other_edition: 'other_edition',
  same_work: 'other_edition',
  same_work_same_year: 'possible_same_edition',
  title_author_near_same_year: 'possible_same_edition',
  title_author_near: 'other_edition',
  near_title: 'related_title',
};

const BOOK_PROJ = {
  _id: 1, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1,
  visible: 1, hidden: 1, hidden_reason: 1, duplicate_of: 1, work_id: 1, edition_key: 1,
  pages_count: 1, pages_ocr: 1, pages_translated: 1, 'image_source.provider': 1,
};

const SITE = 'https://sourcelibrary.org';
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const idOf = (doc: Document) => String(doc.id || doc._id);

/** A sourcelibrary.org book URL → the id/slug segment, else null. */
export function ourBookRef(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = String(url).match(/sourcelibrary\.org\/(?:[a-z]{2}\/)?book\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Turn the input into the candidate shape `checkDuplicate()` reads. A URL goes
 * in as `source_url` (and as `iiif_manifest` when it is one), so
 * `sourceFingerprints()` derives the provider ids from it — the same rules the
 * gate uses, never a second copy of them.
 */
export function candidateFromInput(input: HoldingsInput): DedupCandidate {
  const cand: DedupCandidate = { title: String(input.title || ''), author: String(input.author || '') };
  if (input.year != null) cand.year = input.year;
  if (input.published) cand.published = input.published;
  const url = input.url?.trim();
  if (url && /^https?:\/\//i.test(url) && !ourBookRef(url)) {
    cand.image_source = { source_url: url };
    if (/manifest/i.test(url)) cand.image_source.iiif_manifest = url;
  }
  const ident = input.identifier?.trim();
  if (ident) {
    if (/^bsb\d{6,}$/i.test(ident)) cand.mdz_id = ident.toLowerCase();
    else if (/^ark:\/12148\//.test(ident)) cand.gallica_ark = ident;
    else if (/^[A-Za-z0-9._-]{5,}$/.test(ident)) cand.ia_identifier = ident;
  }
  return cand;
}

/** Find one of OUR books by `id`, `_id` (string or ObjectId), `slug` or a slug alias. */
async function findOurBook(db: Db, ref: string): Promise<Document | null> {
  const or: Document[] = [{ id: ref }, { _id: ref as unknown as ObjectId }, { slug: ref }, { slug_aliases: ref }];
  if (/^[0-9a-f]{24}$/i.test(ref)) or.push({ _id: new ObjectId(ref) });
  return db.collection('books').findOne({ $or: or }, { projection: BOOK_PROJ });
}

/** Fetch full records for matched ids from one collection, by `id` OR `_id`. */
async function fetchByIds(db: Db, collection: 'books' | 'books_warehouse', ids: string[]): Promise<Map<string, Document>> {
  const out = new Map<string, Document>();
  if (ids.length === 0) return out;
  const oids = ids.filter((i) => /^[0-9a-f]{24}$/i.test(i)).map((i) => new ObjectId(i));
  const rows = await db.collection(collection).find(
    { $or: [{ id: { $in: ids } }, { _id: { $in: [...ids, ...oids] as unknown as ObjectId[] } }] },
    { projection: BOOK_PROJ }
  ).toArray();
  for (const r of rows) {
    out.set(idOf(r), r);
    out.set(String(r._id), r);
  }
  return out;
}

function toCandidate(doc: Document, collection: 'books' | 'books_warehouse', reason: HoldingReason, detail: string): HoldingCandidate {
  const id = idOf(doc);
  return {
    book_id: id,
    url: `${SITE}/book/${encodeURIComponent(id)}`,
    reason,
    reason_detail: detail,
    collection,
    title: String(doc.display_title || doc.title || ''),
    author: doc.author ? String(doc.author) : null,
    year: editionYear(doc as { year?: number | null; published?: string | null }),
    language: doc.language ? String(doc.language) : null,
    visible: doc.visible === true,
    hidden: doc.hidden === true,
    hidden_reason: doc.hidden_reason ? String(doc.hidden_reason) : null,
    duplicate_of: doc.duplicate_of ? String(doc.duplicate_of) : null,
    work_id: doc.work_id ? String(doc.work_id) : null,
    pages_count: Number(doc.pages_count) || 0,
    pages_ocr: Number(doc.pages_ocr) || 0,
    pages_translated: Number(doc.pages_translated) || 0,
    provider: doc.image_source?.provider ? String(doc.image_source.provider) : null,
  };
}

function reasonFromDedup(m: DedupMatch, candYear: number | null): { reason: HoldingReason; detail: string } {
  if (m.matchType === 'source_fingerprint') return { reason: 'same_source_object', detail: 'Same digital object: a source identifier matches.' };
  if (m.matchType === 'iiif_manifest') return { reason: 'same_iiif_manifest', detail: 'Same IIIF manifest URL.' };
  if (m.matchType === 'edition_key') {
    return candYear != null && m.matchedYear != null
      ? { reason: 'same_edition', detail: `Same title, author and year (${m.matchedYear}).` }
      : { reason: 'same_edition_year_unknown', detail: 'Same title and author; a year is missing on one side, so this may be another printing.' };
  }
  return { reason: 'other_edition', detail: 'Same normalized title and author.' };
}

/**
 * Title words for RANKING near-title hits only — never stored, never a dedup
 * key (the keys are `edition_key` and the fingerprints). Built on
 * `normalizeEditionTitle()`; the one addition is folding early-modern spelling
 * variants of one word, because Atlas's asciiFolding turns ß into "ss" but
 * leaves "sz", so Becher's "Weiszheit" (as catalogued) and "Weißheit" (as
 * typed) never meet: ß/sz → ss, then doubled letters collapse.
 */
export function rankingTokens(title: string): Set<string> {
  const folded = normalizeEditionTitle(title.replace(/ß/g, 'ss'))
    .replace(/sz/g, 'ss')
    .replace(/(\p{L})\1+/gu, '$1');
  return new Set(folded.split(' ').filter((t) => t.length >= 3));
}

/** Share of the QUERY's title words found in the candidate's title. A
 *  catalogue title is usually the query plus a long subtitle, so the
 *  candidate's extra words must not count against it. */
export function titleCoverage(query: string, candidate: string): { coverage: number; hits: number } {
  const q = rankingTokens(query);
  if (q.size === 0) return { coverage: 0, hits: 0 };
  const c = rankingTokens(candidate);
  let hits = 0;
  for (const t of q) if (c.has(t)) hits++;
  return { coverage: hits / q.size, hits };
}

interface NearHit { id: string; coverage: number; sameAuthor: boolean }

/** The Atlas search index over `books` (title, display_title, english_title,
 *  author), then re-ranked by title-word coverage + surname. Atlas's raw score
 *  is not usable as a cut-off: an author match plus one shared word outranks
 *  the right book (measured on Becher's Närrische Weiszheit, #6019). No hidden
 *  filter — hidden books are exactly what we must see. */
async function nearTitleHits(db: Db, title: string, author: string, limit: number): Promise<NearHit[]> {
  const should: Document[] = [
    { text: { query: title, path: ['title', 'display_title', 'english_title'], fuzzy: { maxEdits: 1, prefixLength: 2 }, score: { boost: { value: 3 } } } },
  ];
  if (author) should.push({ text: { query: author, path: 'author' } });
  const rows = await db.collection('books').aggregate([
    { $search: { index: BOOK_SEARCH_INDEX, compound: { should, minimumShouldMatch: 1 } } },
    { $limit: 40 },
    { $project: { _id: 1, id: 1, title: 1, display_title: 1, english_title: 1, author: 1 } },
  ], { maxTimeMS: 5000 }).toArray();
  const surname = editionSurname(author);
  const queryWords = rankingTokens(title).size;
  const scored = rows.map((r) => {
    const best = [r.title, r.display_title, r.english_title]
      .map((t) => titleCoverage(title, String(t || '')))
      .reduce((a, b) => (b.coverage > a.coverage ? b : a));
    const sameAuthor = !!surname && editionSurname(String(r.author || '')) === surname;
    return { id: idOf(r), coverage: best.coverage, hits: best.hits, sameAuthor };
  });
  // One shared common word ("Weisheit") is not a match: require two words when
  // the query has two, unless the author agrees too.
  const minHits = Math.min(2, queryWords);
  return scored
    .filter((s) => (s.coverage >= 0.5 && s.hits >= minHits) || (s.sameAuthor && s.hits > 0))
    .sort((a, b) => b.coverage + (b.sameAuthor ? 0.5 : 0) - (a.coverage + (a.sameAuthor ? 0.5 : 0)))
    .slice(0, limit)
    .map(({ id, coverage, sameAuthor }) => ({ id, coverage, sameAuthor }));
}

export async function checkHoldings(
  db: Db,
  input: HoldingsInput,
  opts: { nearTitleLimit?: number; otherEditionLimit?: number } = {}
): Promise<HoldingsResult> {
  const nearLimit = opts.nearTitleLimit ?? 6;
  const otherLimit = opts.otherEditionLimit ?? 15;
  const limits: string[] = [];
  const found = new Map<string, HoldingCandidate>();
  const add = (c: HoldingCandidate) => {
    const prev = found.get(c.book_id);
    if (!prev || REASON_RANK[c.reason] < REASON_RANK[prev.reason]) found.set(c.book_id, c);
  };

  // The record a title-less lookup (a bare URL or id) resolved to. Its title,
  // author and year stand in for the caller's when searching other editions.
  let anchor: Document | null = null;

  // 0. One of OUR records, named directly.
  const ref = ourBookRef(input.url) ?? (input.identifier?.trim() || null);
  if (ref) {
    const ours = await findOurBook(db, ref);
    if (ours) {
      add(toCandidate(ours, 'books', 'same_book', 'This is one of our book records.'));
      anchor = ours;
    }
  }

  const cand = candidateFromInput(input);
  const candYear = editionYear(cand);
  const fingerprints = sourceFingerprints(cand);

  // 1–3. The gate's own tiers, read-only.
  const dedup = await checkDuplicate(db, cand, { shadowLog: false });
  const byColl: Record<'books' | 'books_warehouse', string[]> = { books: [], books_warehouse: [] };
  for (const m of dedup.matches) byColl[m.matchedCollection ?? 'books'].push(m.matchedBookId);
  const docs = {
    books: await fetchByIds(db, 'books', byColl.books),
    books_warehouse: await fetchByIds(db, 'books_warehouse', byColl.books_warehouse),
  };
  for (const m of dedup.matches) {
    const coll = m.matchedCollection ?? 'books';
    const doc = docs[coll].get(m.matchedBookId);
    if (!doc) continue;
    const { reason, detail } = reasonFromDedup(m, candYear);
    add(toCandidate(doc, coll, reason, detail));
    if (!anchor && (reason === 'same_source_object' || reason === 'same_iiif_manifest')) anchor = doc;
  }

  // Without a title from the caller, search other editions from the record
  // the URL/id resolved to — and skip the near-title search, which would
  // only list look-alikes of a book we have already identified.
  const titleFromRecord = !input.title && anchor != null;
  const ek = buildEditionKey(titleFromRecord && anchor
    ? { title: anchor.title, display_title: anchor.display_title, author: anchor.author, year: anchor.year, published: anchor.published }
    : cand);

  // 4. Other editions: same title|surname, vetoed by year or volume.
  if (ek.key && ek.parts.title && ek.parts.author) {
    const prefix = new RegExp(`^${escapeRegex(`${ek.parts.title}|${ek.parts.author}|`)}`);
    for (const coll of ['books', 'books_warehouse'] as const) {
      const rows = await db.collection(coll).find({ edition_key: prefix }, { projection: BOOK_PROJ }).limit(otherLimit).toArray();
      for (const r of rows) {
        if (found.has(idOf(r))) continue;
        // Compared against the edition we are looking for. On the caller's
        // own title these same-edition rows were already found by tier 2; on
        // a record-derived key (URL-only lookup) they were not, so classify.
        const segs = String(r.edition_key || '').split('|');
        const y = segs.length >= 4 && segs[segs.length - 2] !== '' ? parseInt(segs[segs.length - 2], 10) : null;
        const volSeg = segs[segs.length - 1] || 'v';
        const v = volSeg === 'v' ? null : parseInt(volSeg.slice(1), 10);
        const otherVolume = ek.parts.volume != null && v != null && v !== ek.parts.volume;
        const otherYear = ek.parts.year != null && y != null && y !== ek.parts.year;
        if (otherVolume || otherYear) {
          add(toCandidate(r, coll, 'other_edition', otherYear ? `Same title and author, year ${y}.` : `Same title and author, volume ${v}.`));
        } else if (ek.parts.year != null && y != null) {
          add(toCandidate(r, coll, 'same_edition', `Same title, author and year (${y}).`));
        } else {
          add(toCandidate(r, coll, 'same_edition_year_unknown', 'Same title and author; a year is missing on one side, so this may be another printing.'));
        }
      }
    }
  } else if (!ek.key) {
    limits.push('No usable title, so other editions and the same edition were not searched.');
  } else {
    limits.push('No author, so other editions were not searched by title + author.');
  }

  // 5. The same work (`work_id`) — other editions and translations.
  const workIds = [...new Set([...found.values()].map((c) => c.work_id).filter((w): w is string => !!w))];
  if (workIds.length > 0) {
    const rows = await db.collection('books').find({ work_id: { $in: workIds } }, { projection: BOOK_PROJ }).limit(otherLimit * 2).toArray();
    // Same work AND same year (and, when both are known, a page count within
    // 2%) is a second copy of this edition far more often than another
    // edition: the #6019 review found every live same-edition duplicate in its
    // sample as the top candidate, half of them only as `same_work` (Mylius
    // 1746: same author, same year, 678 vs 680 pp).
    const refYear = candYear ?? (anchor ? editionYear(anchor as { year?: number | null; published?: string | null }) : null);
    const refPages = input.pages ?? (anchor ? Number(anchor.pages_count) || null : null);
    for (const r of rows) {
      if (found.has(idOf(r))) continue;
      const y = editionYear(r as { year?: number | null; published?: string | null });
      const p = Number(r.pages_count) || null;
      const pagesClose = refPages == null || p == null || Math.abs(p - refPages) <= Math.max(2, refPages * 0.02);
      if (refYear != null && y === refYear && pagesClose) {
        const pagesNote = refPages != null && p != null ? `, ${p} pp against ${refPages}` : ', page count not compared';
        add(toCandidate(r, 'books', 'same_work_same_year', `Same work and year (${y})${pagesNote}: possibly another copy of this edition.`));
      } else {
        add(toCandidate(r, 'books', 'same_work', 'Same work (work_id): another copy, edition or translation.'));
      }
    }
  }

  // 6. Near title — the catch for records catalogued differently.
  if (!titleFromRecord && cand.title && cand.title.length >= 3) {
    try {
      const hits = (await nearTitleHits(db, cand.title, cand.author, nearLimit)).filter((h) => !found.has(h.id));
      const near = await fetchByIds(db, 'books', hits.map((h) => h.id));
      for (const h of hits) {
        const doc = near.get(h.id);
        if (!doc || found.has(idOf(doc))) continue;
        // Same author and most of the title: the same work catalogued under a
        // different title form — another edition, or this one (#6019: Becher
        // "Weiszheit" vs "Weißheit" never shared an edition key).
        const y = editionYear(doc as { year?: number | null; published?: string | null });
        const p = Number(doc.pages_count) || null;
        // Same author and year with matching page counts is the same-edition
        // signature even when the title words only half overlap (a Latin
        // title against the English one, #6019 review).
        const pagesMatch = input.pages != null && p != null && Math.abs(p - input.pages) <= Math.max(2, input.pages * 0.02);
        if (h.sameAuthor && (h.coverage >= 0.75 || (pagesMatch && candYear != null && y === candYear))) {
          const sameYear = candYear != null && y === candYear;
          add(toCandidate(doc, 'books', sameYear ? 'title_author_near_same_year' : 'title_author_near',
            sameYear
              ? `Same author and year (${y}); the title is catalogued differently — possibly this edition.`
              : `Same author; the title is catalogued differently${y != null ? ` (year ${y})` : ''} — another edition, or this one under a different title form.`));
        } else {
          add(toCandidate(doc, 'books', 'near_title', 'Similar title in the catalogue search — check by eye.'));
        }
      }
    } catch {
      limits.push('The catalogue search (Atlas) did not answer, so near-title matches are missing.');
    }
  }

  if (titleFromRecord) limits.push('Other editions were searched using the matched record\'s title, author and year.');
  if (!input.url && !input.identifier) limits.push('No URL or identifier, so the same scan could only be found through its title.');

  const candidates = [...found.values()].sort((a, b) => REASON_RANK[a.reason] - REASON_RANK[b.reason] || Number(b.visible) - Number(a.visible));
  const verdict: HoldingsVerdict = candidates.length ? REASON_VERDICT[candidates[0].reason] : 'new';
  return {
    verdict,
    summary: summarize(verdict, candidates),
    candidates,
    query: { fingerprints, edition_key: ek.key, edition_key_quality: ek.quality },
    limits,
  };
}

function stateOf(c: HoldingCandidate): string {
  const vis = c.collection === 'books_warehouse' ? 'in the warehouse' : c.visible ? 'visible' : 'hidden';
  const dup = c.duplicate_of ? `, marked duplicate of ${c.duplicate_of}` : '';
  return `${vis}${dup}, ${c.pages_count} pp, ${c.pages_translated} translated`;
}

export function summarize(verdict: HoldingsVerdict, candidates: HoldingCandidate[]): string {
  const top = candidates[0];
  if (!top) return 'New: nothing in our holdings matches.';
  const where = `"${top.title}" (${stateOf(top)}) ${top.url}`;
  const more = candidates.length > 1 ? ` (+${candidates.length - 1} more)` : '';
  switch (verdict) {
    case 'same_object': return `We hold this scan: ${where}${more}.`;
    case 'same_edition': return `We hold this edition: ${where}${more}.`;
    case 'possible_same_edition': return `Possibly this edition (${top.reason_detail.replace(/\.$/, '')}): ${where}${more}.`;
    case 'other_edition': return `We hold another edition: ${where}${more}.`;
    case 'related_title': return `Not found as such; similar titles: ${where}${more}.`;
    default: return 'New: nothing in our holdings matches.';
  }
}
