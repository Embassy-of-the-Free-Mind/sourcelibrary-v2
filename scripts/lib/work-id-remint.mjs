/**
 * work-id-remint.mjs — keep the trail when a work_id moves under its books (#4329).
 *
 * PRIOR ART: scripts/lib/work-merge-lib.mjs — plans MERGES (winner/loser across
 * clusters) and merge-work-clusters.mjs writes their aliases inline; neither
 * knows about a RE-MINT, where one cluster's id changes because the title or
 * author it was derived from was repaired. That path wrote no alias at all.
 *
 * A local work id is `local:{a:<author_id>|n:<author-slug>}:<title-slug>` — a
 * function of two mutable fields. Fill in an `author_id` and
 * `local:n:homerus:homeri-odyssea` becomes `local:a:homer:…`; every queue row,
 * URL and citation holding the old id then resolves to nothing, silently
 * (measured 2026-10-11: 742 of the 1,588 ids in the pending `same` slice of
 * `work_merge_queue` are carried by no book, 0 of them recoverable).
 *
 * The rule here makes the move followable: when EVERY book carrying an old id
 * leaves it for the SAME new id, the old id is a retired name for that work and
 * goes into `books.work_id_aliases`, exactly as a merge's loser does. Two cases
 * deliberately write no alias:
 *   - a SPLIT (the old id's books land on more than one new id): the old id was
 *     a fusion of different works, so it names none of them. Aliasing it would
 *     make /work/<old> redirect to an arbitrary half.
 *   - a PARTIAL move (some carriers stay): the old id is still live and still
 *     resolves directly; an alias would point a live id at a different work.
 */

export const deacc = s => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const slug = toks => toks.join('-').replace(/[^a-z0-9-]/g, '').slice(0, 80);

export function authorTokens(a) {
  return new Set(deacc(a).replace(/\(.*?\)|trans\.?|ed\.?|comm\.?|anonymous/g, ' ')
    .replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w.length > 2));
}

/**
 * The author slot of a local mint.
 *   { part: 'a:homer' }            — resolved author thesaurus id
 *   { part: 'n:homerus' }          — normalised byline
 *   { part: null, reason: 'anonymous' }      — no author on the record
 *   { part: null, reason: 'empty-slot' }     — an author exists but normalises to
 *       nothing (CJK, Arabic, Hebrew bylines; "Ed."; two-letter names). Minting
 *       `local:n::<title>` there keys the work on title tokens alone, so strangers
 *       sharing vocabulary cluster, and the id moves again the day the author is
 *       resolved. An id that cannot identify is worse than no id: refuse.
 */
export function mintAuthorPart(bk) {
  if (bk.author_id) return { part: `a:${bk.author_id}` };
  if (!bk.author || !String(bk.author).trim()) return { part: null, reason: 'anonymous' };
  const s = slug([...authorTokens(bk.author)].sort()).slice(0, 24);
  if (!s) return { part: null, reason: 'empty-slot' };
  return { part: `n:${s}` };
}

/**
 * Pure planner. `moves` = [{ id, from, to }] for the books a run will rewrite;
 * `carriers` = Map(old work_id -> how many books carry it in the WHOLE
 * collection right now). Returns Map(book id -> old id to alias) plus a tally.
 */
export function planRemintAliases(moves, carriers) {
  const byOld = new Map(); // old -> { n, targets:Set }
  for (const m of moves) {
    if (!m.from || !m.to || m.from === m.to) continue;
    if (!byOld.has(m.from)) byOld.set(m.from, { n: 0, targets: new Set() });
    const g = byOld.get(m.from);
    g.n++;
    g.targets.add(m.to);
  }
  const renamed = new Set();
  const tally = { renamed: 0, split: 0, partial: 0 };
  for (const [old, g] of byOld) {
    if (g.targets.size > 1) { tally.split++; continue; }
    // carriers is authoritative; an id missing from it is treated as unknown,
    // never as "nobody else carries it".
    if (carriers.get(old) !== g.n) { tally.partial++; continue; }
    renamed.add(old);
    tally.renamed++;
  }
  const aliasFor = new Map();
  for (const m of moves) if (renamed.has(m.from) && m.from !== m.to) aliasFor.set(m.id, m.from);
  return { aliasFor, tally };
}

/**
 * DB half: read the current work_id of every book in `writes` ([{ id, work_id }]),
 * count the carriers of each old id across the whole collection, and plan.
 * Read-only. `aliasFor.get(bookId)` is the id to `$addToSet` into
 * `work_id_aliases` alongside the `$set` of the new work_id.
 */
export async function remintAliasPlan(books, writes) {
  const target = new Map(writes.map(w => [w.id, w.work_id]));
  const ids = [...target.keys()];
  const moves = [];
  for (let i = 0; i < ids.length; i += 1000) {
    const cur = await books.find({ id: { $in: ids.slice(i, i + 1000) } }, { projection: { _id: 0, id: 1, work_id: 1 } }).toArray();
    for (const c of cur) moves.push({ id: c.id, from: c.work_id || null, to: target.get(c.id) });
  }
  const olds = [...new Set(moves.filter(m => m.from && m.from !== m.to).map(m => m.from))];
  const carriers = new Map();
  for (let i = 0; i < olds.length; i += 1000) {
    const agg = await books.aggregate([
      { $match: { work_id: { $in: olds.slice(i, i + 1000) } } },
      { $group: { _id: '$work_id', n: { $sum: 1 } } },
    ]).toArray();
    for (const a of agg) carriers.set(a._id, a.n);
  }
  return { ...planRemintAliases(moves, carriers), moves };
}
