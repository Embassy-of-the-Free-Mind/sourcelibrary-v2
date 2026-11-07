/**
 * `books.contributors[]`: who made a book, in what role (#7787).
 *
 * PRIOR ART: scripts/lib/variant-shape.mjs classifies and splits the strings
 * (`classifyVariant`, `parseContributor`); scripts/maintenance/
 * backfill-author-canonical-links.mjs links `author_id` by name. Neither
 * proposes a role-bearing list or writes one, so this module does both, and is
 * the ONE writer of the field.
 *
 * Shape of one entry:
 *   { author_id: <authors._id> | null, name: <as printed>, role, source, method }
 *   role    MARC relator code: aut, edt, trl, cmm, ill, prt, pbl, ctb
 *   source  where the evidence came from ('books.author')
 *   method  how it was derived ('split-v1')
 *
 * `author` / `author_id` stay the primary-author projection that every
 * existing reader uses. `writeContributors` sets `contributors` and never
 * changes `author`; it fills a missing `author_id` from the list only when
 * asked (`fillAuthorId`), since that puts the book on an author page. Drift
 * between the two is caught by `contributorsDrift`
 * (scripts/audit/contributors-drift.mjs runs it).
 */
import { buildExtenderIndex, classifyVariant, matchKeyVerdict, parseContributor, splitContributors } from './variant-shape.mjs';
import { NAME_STOP, sameNameForm, stripRelator } from './name-equivalence.mjs';
import { recordSweepAction } from './sweep-log.mjs';

export const CONTRIBUTOR_ROLES = ['aut', 'edt', 'trl', 'cmm', 'ill', 'prt', 'pbl', 'ctb'];
export const METHOD = 'split-v1';

/**
 * Lookup key for a personal name: marks, case, life dates and punctuation off,
 * so "Manuzio, Aldo, 1449 or 50-1515" and "Manuzio, Aldo" meet. Each name is
 * also keyed in swapped order ("Ficino, Marsilio" -> "marsilio ficino").
 */
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(ca|approximately|active|fl|or|b|d)\b\.?/g, ' ')
  .replace(/[\d?]+/g, ' ').replace(/[^\p{L}\s,]/gu, ' ').replace(/\s+/g, ' ').trim();
export function nameKeys(name) {
  const f = fold(name).replace(/\s*,\s*$/, '');
  if (!f) return [];
  const out = new Set([f.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()]);
  const m = f.match(/^([^,]+),\s*([^,]+)/);
  if (m) out.add(`${m[2].trim()} ${m[1].trim()}`);
  return [...out];
}

/**
 * Do two forms of a name give DIFFERENT full given names for the same surname?
 * `sameNameForm` accepts a shared surname alone, which is right for spelling
 * ("Boehme, Jacob" / "Jakob Böhme") and wrong for a family: "Lionel Giles" is
 * not "Herbert Allen Giles". A given name counts only as a full word (initials
 * are compatible with anything); one agreeing pair clears the conflict.
 */
export function givenNameConflict(a, b) {
  const words = (s) => {
    const f = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const m = f.match(/^([^,]+),\s*(.+)$/);
    const ordered = m ? `${m[2]} ${m[1]}` : f;
    return ordered.replace(/\([^)]*\)|\d+/g, ' ').split(/[\s.-]+/).filter(Boolean);
  };
  const A = words(a); const B = words(b);
  if (A.length < 2 || B.length < 2) return false;
  const given = (w, last) => w.filter((t, i) => i < w.length - 1 && t.length >= 3 && t !== last && !NAME_STOP.has(t));
  const ga = given(A, A[A.length - 1]); const gb = given(B, B[B.length - 1]);
  if (!ga.length || !gb.length) return false;
  return !ga.some((x) => gb.some((y) => x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)))));
}

/** Slugs minted from a role-polluted string ("trans-richard-francis-burton"). */
export const POLLUTED_SLUG = /(^|-)(trans|tr|ed|eds|editor|editors|compiler|translator|hrsg|bearb)(-|$)/;

/**
 * Load the thesaurus as a name index. `resolve(name, currentAuthorId, year, role)` returns
 * `{ author_id, candidates }`: a person counts as found only on exactly one
 * doc, through a name form `matchKeyVerdict` allows. Two exceptions, both of
 * which can only confirm the link a book already has: when several docs share
 * the form and the book's `author_id` is one of them, and when the form is one
 * the gate refuses (a bare "Longinus") but it belongs to the book's own doc.
 * Role-polluted docs are never a target.
 */
export async function loadAuthorIndex(db) {
  const extendingPeople = buildExtenderIndex((await db.collection('books').aggregate([
    { $match: { author: { $type: 'string', $nin: ['', null] }, content_type: { $ne: 'artwork' } } },
    { $group: { _id: '$author' } },
  ], { allowDiskUse: true }).toArray()).map((r) => r._id));
  const gated = new Map(); const anyForm = new Map(); const born = new Map(); const died = new Map();
  // The doc's OWN names: canonical_name plus Wikidata labels. `variants` are
  // catalogue strings and carry contamination ("Lionel Giles" on Herbert
  // Giles's doc, "Domitius Calderinus" on Martial's), so a hit is accepted
  // only when the name also agrees with one of these.
  const own = new Map();
  const put = (m, k, slug) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(slug); };
  let docs = 0;
  for await (const a of db.collection('authors').find({ merged_into: { $exists: false } },
    { projection: { canonical_name: 1, variants: 1, aliases: 1, wikidata_birth_year: 1, wikidata_death_year: 1 } }).batchSize(2000)) {
    if (POLLUTED_SLUG.test(a._id)) continue;
    docs++;
    if (Number.isFinite(a.wikidata_birth_year)) born.set(a._id, a.wikidata_birth_year);
    if (Number.isFinite(a.wikidata_death_year)) died.set(a._id, a.wikidata_death_year);
    // Wikidata aliases carry errors too: Herbert Giles (Q713705) has the
    // Hungarian alias "Lionel Giles", his son. An alias whose given name
    // contradicts the canonical name is dropped from every match surface here.
    const aliases = (a.aliases || []).filter((al) => !givenNameConflict(al, a.canonical_name));
    own.set(a._id, [a.canonical_name, ...aliases].filter(Boolean));
    for (const form of [a.canonical_name, ...(a.variants || []), ...aliases]) {
      if (!form) continue;
      const ks = nameKeys(form);
      for (const k of ks) put(anyForm, k, a._id);
      if (matchKeyVerdict(form, a._id, { extendingPeople }).matchable) for (const k of ks) put(gated, k, a._id);
    }
  }
  // Nobody makes a book before they are ten. A name that resolves only to
  // someone born after the book is the wrong person with the right name
  // ("ed. Mitscherlich", 1792, is not the chemist born 1794), so such
  // candidates are dropped before counting. An author may be long dead; an
  // editor, translator or commentator must be alive near the book ("ed.
  // François Noël", 1798, is not the missionary who died in 1729). The 50-year
  // margin lets a reprint carry its original translator.
  const plausible = (slug, year, role) => {
    if (!year) return true;
    if (born.has(slug) && born.get(slug) > year - 10) return false;
    if (role && role !== 'aut' && died.has(slug) && died.get(slug) < year - 50) return false;
    return true;
  };
  // Exact key equality also counts: sameNameForm ignores words under four
  // letters, so "Li Shi" could never agree with itself.
  // A one-word name may not absorb a second full word: "Catullus, Tibullus"
  // (two poets the splitter cannot separate) is not Catullus.
  const fullWords = (s) => fold(s).replace(/,/g, ' ').split(' ').filter((w) => w.length >= 4 && !NAME_STOP.has(w));
  const covered = (name, f) => {
    const fw = fullWords(f);
    if (fw.length !== 1) return true;
    return fullWords(name).every((w) => fw.some((x) => w === x || (Math.min(w.length, x.length) >= 4 && (w.startsWith(x) || x.startsWith(w)))));
  };
  const ownName = (slug, name) => {
    const ks = new Set(nameKeys(name));
    return (own.get(slug) || []).some((f) => nameKeys(f).some((k) => ks.has(k))
      || (sameNameForm(name, f) && !givenNameConflict(name, f) && covered(name, f)));
  };
  function resolve(name, currentAuthorId = null, bookYear = null, role = null) {
    // "Pseudo-Aristotle" is not Aristotle, whatever a variant says. A
    // placeholder ("Anonymous") or bare initials ("K, J. C.") names nobody.
    if (/^\[?pseudo[\s-]/i.test(name) || /^\[?(anonymous|anon|unknown|various|n\.?\s?n)\.?\]?$/i.test(name.trim())
        || !/\p{L}{3,}/u.test(name)) return { author_id: null, candidates: 0 };
    const ks = nameKeys(name);
    const ok = (s) => plausible(s, bookYear, role) && ownName(s, name);
    const slugs = [...new Set(ks.flatMap((k) => [...(gated.get(k) || [])]))].filter(ok);
    if (currentAuthorId && !ok(currentAuthorId)) currentAuthorId = null;
    let pick = slugs.length === 1 ? slugs[0] : null;
    if (!pick && currentAuthorId && slugs.includes(currentAuthorId)) pick = currentAuthorId;
    if (!pick && currentAuthorId && ks.some((k) => anyForm.get(k)?.has(currentAuthorId))) pick = currentAuthorId;
    return { author_id: pick, candidates: slugs.length };
  }
  return { resolve, extendingPeople, docs };
}

/**
 * Propose the contributor list for one book. Returns `{ bucket, proposed }`.
 *
 *   single_clean          one name, no role: no list needed, author_id says it all
 *   single_role_matched   one person with a role, found in the thesaurus
 *   single_role_unmatched
 *   multi_all_matched     every part found on exactly one doc
 *   multi_partial / multi_ambiguous / multi_none
 *   left_alone            script pair, institution, edition note, overlong, bare forename
 *
 * Only `single_role_matched` and `multi_all_matched` are SAFE to write: every
 * entry then names a thesaurus person, so no write can mint a new one.
 */
/** First plausible four-digit year in a `published` string ("1792", "[ca. 1610]"), else null. */
export function bookYear(published) {
  const m = String(published ?? '').match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  return m ? Number(m[1]) : null;
}

export function proposeContributors(author, authorId, index, year = null) {
  const c = classifyVariant(author, { extendingPeople: index.extendingPeople });
  // `classifyVariant` misses roles it has no word for ("(eds.)", "[Bearb.]"),
  // so a clean single name is parsed too and promoted if it carries one.
  const single = c.shape === 'clean' ? parseContributor(author) : null;
  const singleHasRole = !!(single && (single.role || single.extra.length));
  if (c.shape === 'clean' && !singleHasRole) return { bucket: 'single_clean', proposed: [] };
  if (!singleHasRole && !['multi_person', 'role_annotated'].includes(c.shape)) {
    return { bucket: 'left_alone', shape: c.shape, proposed: [] };
  }
  const parts = splitContributors(author);
  // "Helen & Kirsopp Lake": a lone word before "&" and a full name after it is
  // usually a shared surname. The lone word is a given name, so it is left
  // unresolved rather than matched to whoever owns it as a mononym (Helen of
  // Troy). "Lucian & Philostratus" (both lone) is unaffected.
  const lone = (n) => !/[\s,]/.test(n.replace(/^\[|\]$/g, '').trim());
  const sharedSurname = new Set();
  for (let i = 0; i + 1 < parts.length; i++) {
    if (lone(parts[i].name) && !lone(parts[i + 1].name) && /\s&\s|\sand\s|\set\s/.test(author)) sharedSurname.add(i);
  }
  const seen = new Map(); let collided = false;
  const proposed = parts
    .map(({ name, role }, i) => {
      const clean = stripRelator(name);
      const r = sharedSurname.has(i) ? { author_id: null, candidates: 0 } : index.resolve(clean, authorId, year, role ?? 'aut');
      return { author_id: r.author_id, name: clean, role: role ?? 'aut', candidates: r.candidates };
    })
    .filter((p) => {
      if (!p.name) return false;
      const k = `${p.author_id ?? p.name.toLowerCase()}|${p.role}`;
      const prior = seen.get(k);
      if (prior !== undefined) {
        // Two DIFFERENT names on one doc is a contaminated variant pulling a
        // second person in, not a repeat ("Martial; Domitius Calderinus").
        if (p.author_id && !nameKeys(prior).some((x) => nameKeys(p.name).includes(x)) && !sameNameForm(prior, p.name)) collided = true;
        return false;
      }
      seen.set(k, p.name); return true;
    });
  const resolved = proposed.filter((p) => p.author_id).length;
  let bucket;
  if (collided) bucket = 'multi_ambiguous';
  else if (proposed.length === 1) bucket = resolved ? 'single_role_matched' : 'single_role_unmatched';
  else if (proposed.some((p) => !p.author_id && p.candidates > 1)) bucket = 'multi_ambiguous';
  else if (resolved === proposed.length) bucket = 'multi_all_matched';
  else bucket = resolved ? 'multi_partial' : 'multi_none';
  return { bucket, proposed };
}

export const SAFE_BUCKETS = new Set(['single_role_matched', 'multi_all_matched']);

/** The stored entries, without the resolver's working fields. */
export function toStored(proposed) {
  return proposed.map((p) => ({ author_id: p.author_id, name: p.name, role: p.role, source: 'books.author', method: METHOD }));
}

/**
 * The ONE writer of `books.contributors`. Writes the list and logs a
 * sweep_log row with the before values. With `fillAuthorId`, a book with no
 * `author_id` also gets the first author-role entry (else the first entry);
 * off by default, because that lists the book on that person's author page,
 * which should wait until the page can say "as editor". Refuses a role outside the
 * closed vocabulary and an entry with no thesaurus link, so it cannot mint a
 * person. Filters on the `author` string it was given, so a book whose byline
 * changed since the proposal is skipped, not overwritten.
 */
export async function writeContributors(db, book, contributors, { sweep, fillAuthorId = false }) {
  if (!sweep) throw new Error('writeContributors: sweep name required');
  if (!contributors.length) throw new Error(`writeContributors: empty list for ${book._id}`);
  for (const c of contributors) {
    if (!CONTRIBUTOR_ROLES.includes(c.role)) throw new Error(`writeContributors: role ${c.role} not in vocabulary`);
    if (!c.author_id) throw new Error(`writeContributors: unlinked contributor "${c.name}" on ${book._id}`);
  }
  const set = { contributors };
  if (fillAuthorId && !book.author_id) set.author_id = (contributors.find((c) => c.role === 'aut') ?? contributors[0]).author_id;
  const res = await db.collection('books').updateOne({ _id: book._id, author: book.author }, { $set: set });
  if (res.modifiedCount) {
    await recordSweepAction(db, {
      sweep,
      book_id: String(book._id),
      action: 'contributors-set',
      detail: { fields: Object.keys(set), before: { contributors: book.contributors ?? null, author_id: book.author_id ?? null } },
    });
  }
  return res.modifiedCount;
}

/**
 * Does a book's `contributors` still agree with its `author` / `author_id`?
 * Returns null when it does, else the reason. Two ways to drift: the byline
 * was edited after the list was written (the list no longer re-derives from
 * it), or `author_id` moved to someone the list does not name.
 */
export function contributorsDrift(book) {
  const list = book.contributors;
  if (!Array.isArray(list) || !list.length) return null;
  if (book.author_id && !list.some((c) => c.author_id === book.author_id)) return 'author_id-not-in-contributors';
  if (list.every((c) => c.source === 'books.author')) {
    const names = new Set(splitContributors(book.author).map((p) => stripRelator(p.name).toLowerCase()));
    if (!list.every((c) => names.has(c.name.toLowerCase()))) return 'author-string-changed';
  }
  return null;
}
