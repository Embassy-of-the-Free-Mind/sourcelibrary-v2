/**
 * work-split-plan.mjs — plan the SPLIT of an over-merged work_id (#8293).
 *
 * PRIOR ART: scripts/lib/work-id-remint.mjs planRemintAliases — knows that a
 * split must write no alias for the old id, but only plans aliases for a
 * re-mint, never which books leave or where they go. scripts/lib/work-merge-lib.mjs
 * — plans MERGES (winner/losers); nothing in it can take books OUT of a cluster.
 * scripts/maintenance/apply-verified-work-merges.mjs — the backup + sweep_log
 * shape the writer (apply-reviewed-work-splits.mjs) copies.
 *
 * Input is the reviewed list (scripts/eval/work-recall/split-reviewed-8293.jsonl):
 * one row per cluster a reader judged `different_work`, naming the odd books
 * and where each group goes (`to: "new"` or an existing work_id). The planner
 * is pure: the caller hands it the current carriers and the taken-name sets.
 *
 * The rules, and why:
 *   - The source id stays with the books that do not move. It is still live, so
 *     it is NEVER added to a moved book's work_id_aliases: workAliasTarget()
 *     (src/lib/work-alias.ts) runs BEFORE the editions query and has no liveness
 *     check, so one moved book holding the source id would redirect /work/<source>
 *     — every stayer's address — to the new work.
 *   - An alias already on the cluster's books (a past merge loser, an old slug)
 *     must end up on ONE side, or /work/<alias> resolves to whichever holder
 *     findOne returns. Stayers keep any alias they hold (stayers are never
 *     written); otherwise the moved group holding most of its holders keeps it,
 *     ties to the group that sorts first. A moved book joining an existing id
 *     drops that id from its aliases (it is live again for that book).
 *   - A new id restores the moved books' own retired local id when every book
 *     in the group holds it as an alias, no stayer does, and no book carries it:
 *     /work/<that id> then resolves directly to them, as it did before the
 *     merge. Otherwise it is minted `local:<author part>:<title tokens>` the way
 *     mint-local-work-ids.mjs mints (sorted distinctive tokens), suffixed -2, -3
 *     until no book carries or aliases it.
 *   - A cluster is refused, never partly planned, when its carriers are not the
 *     books the reader saw (hidden included), a named book is not in it, a book
 *     moves twice, nothing stays, or a target id is carried by no book / is
 *     itself split in this run.
 *
 * Hand-fixed rows (the six wrong-Wikidata clusters, #8293) may also carry:
 *   row.dissolve: true       every book may leave (an id that names a work none of
 *                            them is). If all go to ONE id the source becomes an
 *                            alias there (a rename, as planRemintAliases); else none.
 *   row.stay: { title }      retitle the books that keep the id; their slug is
 *                            re-derived from the new title.
 *   move.new_id: '<id>'      with to:'new', the exact id to use (a verified QID no
 *                            book carries yet) instead of a minted local one.
 *   move.slug: 'take'        the group takes the source's slug (the slug names the
 *                            work THEY are); needs row.stay or row.dissolve.
 *   move.slug: 'alias'       the source slug becomes an alias on the group, which
 *                            gets a fresh slug (old URL redirects to them).
 */
import crypto from 'node:crypto';
import { deacc, slug, authorTokens, mintAuthorPart } from './work-id-remint.mjs';

export const SPLIT_SOURCE = 'work-split:reviewed';
export const SPLIT_CONFIDENCE = 'curated';

// mint-local-work-ids.mjs STOP + BOILER (uniformTitle), so a split id reads like a mint
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'with', 'to', 'in', 'for', 'on', 'de', 'von', 'di', 'le', 'la', 'les', 'des', 'du', 'het', 'een',
  'commentary', 'translation', 'translated', 'trans', 'edition', 'edited', 'ed', 'text', 'complete', 'selected',
  'new', 'revised', 'reprint', 'facsimile', 'being', 'containing', 'together', 'his', 'its', 'her', 'their',
  'harvard', 'yenching', 'library', 'sn', 'ms', 'mss', 'cod', 'codex', 'shelf', 'call', 'number', 'sine', 'nomine', 'copy', 'scan',
  'digiti', 'digitized', 'microfilm', 'collection', 'various', 'unknown', 'anonymous', 'google', 'archive', 'internet']);

export function titleTokens(title, author) {
  const at = author ? authorTokens(author) : new Set();
  const toks = deacc(title).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter((w) => (w.length >= 2 || /^[0-9]+$/.test(w)) && !STOP.has(w) && !at.has(w));
  return [...new Set(toks)].sort().slice(0, 12);
}

// assign-work-slugs.mjs slugify + surname, so a split slug reads like the nightly one
export const slugify = (s) => deacc(s).replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');
function surname(author) {
  const a = deacc(author).replace(/\(.*?\)/g, '').replace(/[^a-z ,]/g, ' ').trim();
  if (a.includes(',')) return a.split(',')[0].trim().split(/\s+/).pop() || '';
  const p = a.split(/\s+/).filter(Boolean);
  return p[p.length - 1] || '';
}
export function workSlugFor(title, author) {
  const sn = surname(author || '');
  let base = slugify(title);
  if (sn && !base.includes(slugify(sn))) base = `${slugify(sn)}-${base}`.slice(0, 80).replace(/-+$/, '');
  return base || 'work';
}

const isLocalId = (w) => typeof w === 'string' && w.startsWith('local:');
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const nightlyTop = (vals) => {
  const m = new Map();
  for (const v of vals) if (v) m.set(v, (m.get(v) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] || null;
};
const commonest = (vals) => {
  const m = new Map();
  for (const v of vals) if (v) m.set(v, (m.get(v) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null;
};

/**
 * @param rows      reviewed rows already filtered to the ones to plan
 * @param carriers  Map(work_id -> books[]) for every source AND target id; each
 *                  book {id, work_id, work_title, work_slug, work_id_aliases, author, author_id, visible}
 * @param taken     { ids:Set, slugs:Set, aliases:Set } over the WHOLE books collection
 * @returns { clusters:[...], refused:[{work_id, why}] }
 */
export function planSplits(rows, carriers, taken) {
  const sources = new Set(rows.map((r) => r.work_id));
  const claimedIds = new Set(), claimedSlugs = new Set();
  const free = (id) => !taken.ids.has(id) && !taken.aliases.has(id) && !claimedIds.has(id);
  const freeSlug = (s) => !taken.slugs.has(s) && !taken.ids.has(s) && !taken.aliases.has(s) && !claimedSlugs.has(s);
  const clusters = [], refused = [];
  const mintedHere = new Map(); // new id -> { title, work_slug } claimed by an earlier row of this run

  for (const r of [...rows].sort((a, b) => a.work_id.localeCompare(b.work_id))) {
    const cur = carriers.get(r.work_id) || [];
    const curIds = cur.map((b) => b.id).sort();
    const refuse = (why) => refused.push({ work_id: r.work_id, why });
    if (!cur.length) { refuse('source id carried by no book'); continue; }
    if (r.seen && !sameSet(curIds, [...r.seen].sort())) { refuse(`carriers changed since review (${curIds.length} now, ${r.seen.length} seen)`); continue; }
    const byId = new Map(cur.map((b) => [b.id, b]));
    const moved = new Set();
    let bad = null;
    for (const m of r.moves || []) {
      for (const id of m.books) {
        if (!byId.has(id)) bad = `book ${id} not on ${r.work_id}`;
        else if (moved.has(id)) bad = `book ${id} moves twice`;
        moved.add(id);
      }
      if (m.to !== 'new') {
        if (m.to === r.work_id) bad = 'target is the source id';
        else if (!(carriers.get(m.to) || []).length && !mintedHere.has(m.to)) bad = `target ${m.to} carried by no book`;
        else if (sources.has(m.to)) bad = `target ${m.to} is itself split in this run`;
      }
    }
    if (!bad && !moved.size) bad = 'no book moves';
    if (!bad && moved.size >= cur.length && !r.dissolve) bad = 'every book moves; nothing keeps the source id';
    if (!bad && r.dissolve && moved.size < cur.length) bad = 'dissolve names only some carriers';
    if (!bad && (r.moves || []).some((m) => m.slug) && !(r.stay || r.dissolve)) bad = 'a group takes the source slug but the stayers are not retitled';
    if (!bad) for (const m of r.moves || []) {
      if (m.new_id && (m.to !== 'new' || !free(m.new_id) || (carriers.get(m.new_id) || []).length)) bad = `new_id ${m.new_id} is not free`;
    }
    if (bad) { refuse(bad); continue; }

    const stayers = cur.filter((b) => !moved.has(b.id));
    // stayers' aliases AND their live slugs: a moved book holding the stayers'
    // slug as an alias would redirect /work/<slug> the same way the source id would
    const stayerAliases = new Set(stayers.flatMap((b) => [...(b.work_id_aliases || []), b.work_slug].filter(Boolean)));
    const groups = r.moves.map((m) => ({ ...m, books: [...m.books].sort().map((id) => byId.get(id)) }));
    const sourceSlug = commonest(cur.map((b) => b.work_slug));
    const dests = new Set(groups.map((g) => (g.to === 'new' ? g.new_id || null : g.to)));
    const renameTo = r.dissolve && dests.size === 1 && !dests.has(null) ? [...dests][0] : null;

    // alias ownership across the moved groups (stayers win outright, never written)
    const owner = new Map();
    const holders = new Map();
    groups.forEach((g, gi) => g.books.forEach((b) => (b.work_id_aliases || []).forEach((a) => {
      if (!holders.has(a)) holders.set(a, new Map());
      holders.get(a).set(gi, (holders.get(a).get(gi) || 0) + 1);
    })));
    for (const [a, byG] of holders) {
      if (stayerAliases.has(a) || a === r.work_id) continue; // owner unset -> dropped from movers
      owner.set(a, [...byG].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0]);
    }

    const out = [];
    groups.forEach((g, gi) => {
      let to, to_existed, title, workSlug, restored = null;
      if (g.to !== 'new' && mintedHere.has(g.to)) {
        // joins a work an earlier row of this run creates (rows run in work_id order)
        to = g.to; to_existed = false; ({ title, work_slug: workSlug } = mintedHere.get(g.to));
      } else if (g.to !== 'new') {
        const tb = carriers.get(g.to);
        to = g.to; to_existed = true;
        // assign-work-slugs.mjs's own pick (count, then the longer title), so the books
        // that join do not move the nightly slug of the work they join
        title = nightlyTop(tb.map((b) => (b.work_title || b.display_title || b.title || '').trim())) || g.title;
        workSlug = commonest(tb.map((b) => b.work_slug));
      } else {
        to_existed = false; title = g.title;
        const reuse = g.new_id ? [g.new_id] : [...owner].filter(([a, o]) => o === gi && isLocalId(a) && !taken.ids.has(a) && !claimedIds.has(a)
          && g.books.every((b) => (b.work_id_aliases || []).includes(a))).map(([a]) => a).sort();
        if (g.new_id) to = g.new_id;
        else if (reuse.length) { to = reuse[0]; restored = to; }
        else {
          const lead = g.books.find((b) => mintAuthorPart(b).part) || g.books[0];
          const part = mintAuthorPart(lead).part || 'anon';
          const toks = slug(titleTokens(g.title, lead.author));
          const base = `local:${part}:${toks || `split-${crypto.createHash('sha1').update(g.books.map((b) => b.id).join(',')).digest('hex').slice(0, 8)}`}`;
          to = base;
          for (let n = 2; !free(to); n++) to = `${base}-${n}`;
        }
        claimedIds.add(to);
      }
      if (g.slug === 'take') workSlug = sourceSlug;
      else if (!to_existed && !(g.to !== 'new' && mintedHere.has(g.to))) {
        const sbase = workSlugFor(g.title, g.books[0].author);
        workSlug = sbase;
        for (let n = 2; !freeSlug(workSlug); n++) workSlug = `${sbase}-${n}`;
        claimedSlugs.add(workSlug);
      }
      const extra = [...(g.slug === 'alias' && sourceSlug ? [sourceSlug] : []), ...(renameTo ? [r.work_id] : [])];
      const books = g.books.map((b) => {
        const had = b.work_id_aliases || [];
        const keep = [...new Set([...had.filter((a) => owner.get(a) === gi && a !== to && a !== r.work_id), ...extra])];
        return {
          id: b.id, visible: b.visible ?? null, hidden: b.hidden === true,
          before: { work_id: b.work_id, work_title: b.work_title ?? null, work_slug: b.work_slug ?? null, work_id_aliases: had },
          after: { work_id: to, work_title: title, work_slug: workSlug, work_id_aliases: keep },
          aliases_dropped: had.filter((a) => !keep.includes(a)),
        };
      });
      if (g.to === 'new') mintedHere.set(to, { title, work_slug: workSlug });
      out.push({ to, to_existed, joins_new: g.to !== 'new' && !to_existed, restored, title, work_slug: workSlug, why: g.why, books });
    });
    let stay = null;
    if (r.stay && stayers.length) {
      const sbase = workSlugFor(r.stay.title, stayers[0].author);
      let workSlug = sbase;
      for (let n = 2; !freeSlug(workSlug); n++) workSlug = `${sbase}-${n}`;
      claimedSlugs.add(workSlug);
      stay = { title: r.stay.title, work_slug: workSlug,
        books: stayers.map((b) => ({ id: b.id, visible: b.visible ?? null, before: { work_title: b.work_title ?? null, work_slug: b.work_slug ?? null } })) };
    }
    clusters.push({
      work_id: r.work_id, bar: r.bar, evidence: r.evidence, note: r.note, dissolve: !!r.dissolve, renamed_to: renameTo,
      stays: stayers.map((b) => b.id).sort(), stay, carriers: curIds, moves: out,
    });
  }
  return { clusters, refused };
}

/** The identity fields a plan was made against; apply refuses a cluster when any carrier's differ. */
export function identityOf(b) {
  return JSON.stringify([b.id, b.work_id ?? null, b.work_slug ?? null, [...(b.work_id_aliases || [])].sort()]);
}
