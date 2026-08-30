/**
 * work-merge-lib.mjs — pure cluster-detection + merge-planning logic for
 * work_id consolidation (#3759). No I/O here: everything is unit-testable.
 *
 * Three detection lanes, two confidence tiers:
 *  - canon gold seeds (HIGH): the hand-verified workIds arrays in
 *    src/lib/canon-works.ts, minus ids shared between entries (combined
 *    volumes like Iliad+Odyssey are their OWN work, never merged).
 *  - identical-title (HIGH): same author surname + identical full normalized
 *    title + matching series key. Same-work by construction. Tibetan and
 *    volume-marked titles are excluded (pecha / multi-volume grain hazards),
 *    mirroring the retired merge-duplicate-work-ids.mjs (deleted 2026-08, in git history).
 *  - containment (MEDIUM, queue only): author-anchored title containment —
 *    the work-coverage fit rule applied between two work_id clusters. Never
 *    auto-written; a wrong merge poisons FT counting silently.
 *
 * Winner per cluster is deterministic: Wikidata QID > local:a: > local:n: >
 * other; tiebreak shortest, then lexicographic.
 */
import { norm, sig, seriesKey, surname } from './work-identity-util.mjs';

// ── winner selection ────────────────────────────────────────────────────────
export function rankFormat(w) {
  if (/^Q\d+$/.test(w)) return 0; // Wikidata QID — most canonical
  if (/^local:a:/.test(w)) return 1; // author-resolved mint
  if (/^local:n:/.test(w)) return 2; // anon-resolved mint
  return 3; // legacy clean slug / cjk / other
}

/**
 * Optional `inbound` (work_id -> book count) breaks format ties toward the id
 * more books already carry — fewer rewrites, and the better-established mint
 * survives (#3730 §3). Without it, behaviour is unchanged.
 */
export function pickWinner(wids, inbound) {
  return [...wids].sort((a, b) => {
    const r = rankFormat(a) - rankFormat(b);
    if (r) return r;
    if (inbound) {
      const ib = (inbound.get(b) || 0) - (inbound.get(a) || 0);
      if (ib) return ib;
    }
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : 1;
  })[0];
}

// ── canon gold seeds ────────────────────────────────────────────────────────
/**
 * Extract verified merge sets from the canon registry. An id that appears in
 * MORE THAN ONE entry's workIds is a combined edition (e.g. an Iliad+Odyssey
 * volume) — it is a distinct work_id on purpose and is excluded from every
 * merge set. collectedWorkIds (Opera containers) are never touched.
 */
export function canonGoldClusters(canonWorks) {
  const entryCount = new Map();
  for (const w of canonWorks) {
    for (const id of new Set(w.workIds)) entryCount.set(id, (entryCount.get(id) || 0) + 1);
  }
  const out = [];
  for (const w of canonWorks) {
    const ids = [...new Set(w.workIds)].filter((id) => entryCount.get(id) === 1);
    if (ids.length < 2) continue;
    const winner = pickWinner(ids);
    out.push({ source: 'canon-registry', slug: w.slug, ids, winner, losers: ids.filter((i) => i !== winner) });
  }
  return out;
}

// ── identical-title lane ────────────────────────────────────────────────────
const volRe = /\b(vol|volume|part|tome|band|tomus|tom|pt|bd)\.?\s*[ivxlcdm0-9]/i;
const cjkVolRe = /[巻卷冊册帙]|第[一二三四五六七八九十百0-9]+|[上中下][巻卷冊]?\s*$/;

/** Reps in Tibetan or with volume markers are never auto-merged (grain policy). */
export function isMergeSafeRep(rep) {
  if ((rep.language || '') === 'Tibetan') return false;
  if (volRe.test(rep.title || '') || cjkVolRe.test(rep.title || '')) return false;
  return true;
}

/** Cluster key for the identical-title lane, or null when the rep is unsafe. */
export function identicalTitleKey(rep) {
  if (!isMergeSafeRep(rep)) return null;
  // A representative can only stand for its whole work_id when every book
  // under that id carries the same title. A POLLUTED id (distinct works filed
  // together — e.g. Ellis's Yoruba/Tshi/Ewe volumes under one id) would
  // otherwise be merged wholesale onto whichever work its rep happens to be.
  if ((rep.titleVariants ?? 1) > 1) return null;
  const t = norm(rep.title);
  if (t.split(' ').filter(Boolean).length < 3) return null; // need a substantive title
  return `${surname(rep.author)}||${t}||${seriesKey(rep.title)}`;
}

/**
 * reps: [{ work_id, author, title, language }] — one representative book per
 * distinct work_id. Returns clusters of ≥2 work_ids with identical keys.
 */
export function identicalTitleClusters(reps) {
  const byKey = new Map();
  for (const rep of reps) {
    const k = identicalTitleKey(rep);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, { key: k, rep, ids: new Set() });
    byKey.get(k).ids.add(rep.work_id);
  }
  const out = [];
  for (const { key, rep, ids } of byKey.values()) {
    if (ids.size < 2) continue;
    const arr = [...ids];
    const winner = pickWinner(arr);
    out.push({
      source: 'identical-title', key, ids: arr, winner,
      losers: arr.filter((i) => i !== winner),
      title: rep.title, author: rep.author,
    });
  }
  return out;
}

// ── containment lane (MEDIUM — review queue only) ───────────────────────────
// Generic/container words: a match carried entirely by these proves nothing.
const GENERIC = new Set([
  'letters', 'poems', 'poem', 'life', 'lives', 'works', 'fragments', 'fragment',
  'history', 'hymns', 'odes', 'epistles', 'dialogues', 'treatise', 'commentary',
  'speeches', 'orations', 'elegies', 'epigrams', 'opera', 'tragoediae',
  'comoediae', 'fabulae', 'opuscula', 'carmina', 'poetae', 'poetica', 'libri',
  'liber', 'select', 'selected', 'collected', 'writings',
]);

/** Preferred comparison title for a work_id: the curated work_title, else the raw title. */
export function repTitle(rep) {
  return (rep.work_title || '').trim() || rep.title || '';
}

/**
 * Fit-rule comparison between two work_id representatives (assumed already
 * author-blocked). Returns { cont, inter } when the pair clears every guard,
 * else null. cont = |A∩B| / |smaller token set|.
 */
export function containmentPair(repA, repB, { minCont = 0.8, minInter = 2 } = {}) {
  if (!isMergeSafeRep(repA) || !isMergeSafeRep(repB)) return null;
  const ta = repTitle(repA);
  const tb = repTitle(repB);
  if (!sameSeriesSafe(ta, tb)) return null;
  const A = sig(ta);
  const B = sig(tb);
  if (!A.length || !B.length) return null;
  const [small, large] = A.length <= B.length ? [A, B] : [B, A];
  if (small.every((t) => GENERIC.has(t))) return null; // all-generic anchor proves nothing
  const largeSet = new Set(large);
  const inter = small.filter((t) => largeSet.has(t)).length;
  const cont = inter / small.length;
  if (cont < minCont || inter < minInter) return null;
  return { cont: +cont.toFixed(2), inter };
}

function sameSeriesSafe(a, b) {
  return seriesKey(a) === seriesKey(b);
}

/**
 * reps as above (+ optional author_id, work_title). Blocks by author_id when
 * both sides have one, else by surname; never compares across blocks. Returns
 * candidate PAIRS with evidence — the review queue, never auto-merged.
 */
export function containmentCandidates(reps, opts = {}) {
  const blocks = new Map();
  for (const rep of reps) {
    const key = rep.author_id ? `aid:${rep.author_id}` : `sn:${surname(rep.author)}`;
    if (key === 'sn:') continue; // no author anchor → no candidate
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key).push(rep);
  }
  const out = [];
  for (const [block, members] of blocks) {
    if (members.length < 2 || members.length > 200) continue; // degenerate blocks
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const hit = containmentPair(members[i], members[j], opts);
        if (!hit) continue;
        out.push({
          source: 'containment', block,
          a: members[i].work_id, b: members[j].work_id,
          titleA: repTitle(members[i]), titleB: repTitle(members[j]),
          // >1 means the id holds several distinct titles — the rep may not
          // speak for all of them; reviewers must open the id's book list
          variantsA: members[i].titleVariants ?? 1, variantsB: members[j].titleVariants ?? 1,
          author: members[i].author, ...hit,
        });
      }
    }
  }
  return out;
}

// ── cluster union + safety ──────────────────────────────────────────────────
/**
 * Union overlapping HIGH clusters (a work_id may sit in both a canon seed and
 * an identical-title cluster). Returns final merge plans; any union whose ids
 * span ≥2 canon entries is DEMOTED to the review queue (never auto-merge
 * across canon works — that is how an Iliad edition would silently land on the
 * Odyssey page).
 */
// ── edition-conflict lane (HIGH, #3730 §3) ──────────────────────────────────
/**
 * One edition, two works — the contradiction the edition layer surfaces for
 * free. Auto-mergeable ONLY in the mechanical shape:
 *
 *   - exactly 2 distinct work_ids on one FULL-quality edition_key cluster
 *     (3+-way clusters are where generic titles bridge genuinely different
 *     works — e.g. seven "Hasidic discourses|schneersohn|1850" work_ids that
 *     are different rebbes' discourse collections; always human work);
 *   - both ids are local mints (a QID pair asserts external identity — queue);
 *   - every member book carries the SAME non-null author_id;
 *   - every book under EACH work_id — including books outside this edition
 *     cluster — shares one normalized title (`titleVariants`, Unicode-aware).
 *     This is the guard that stops a merge from propagating beyond the
 *     edition that evidenced it: a work_id with other differently-titled
 *     books is a broader cluster this edition cannot speak for.
 *
 * Typical survivor pair: `local:a:…:curiosa-physica` + `local:n:…:curious-physics`
 * — one edition minted twice from the original title and its English gloss.
 *
 * `clusters`: [{ key, works: string[], authorIds: (string|null)[] }]
 * `titleVariants`: work_id -> count of distinct normalized titles
 * `inbound`: work_id -> book count (winner tiebreak after format rank)
 */
export function editionConflictClusters(clusters, { titleVariants, inbound }) {
  const out = [];
  for (const c of clusters) {
    const wids = [...new Set(c.works)];
    if (wids.length !== 2) continue;
    if (!wids.every((w) => /^local:/.test(w))) continue;
    const auths = [...new Set(c.authorIds || [])];
    if (auths.length !== 1 || !auths[0]) continue;
    if (!wids.every((w) => (titleVariants.get(w) || 0) === 1)) continue;
    const winner = pickWinner(wids, inbound);
    out.push({
      source: 'edition-conflict', key: c.key, ids: wids,
      winner, losers: wids.filter((w) => w !== winner),
    });
  }
  return out;
}

export function unionMergeClusters(clusters, canonSlugByWorkId = new Map(), inbound) {
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const c of clusters) for (const id of c.ids) if (!parent.has(id)) parent.set(id, id);
  for (const c of clusters) for (const id of c.ids.slice(1)) union(c.ids[0], id);

  const groups = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, new Set());
    groups.get(root).add(id);
  }
  const sourcesByRoot = new Map();
  for (const c of clusters) {
    const root = find(c.ids[0]);
    if (!sourcesByRoot.has(root)) sourcesByRoot.set(root, new Set());
    sourcesByRoot.get(root).add(c.source + (c.slug ? `:${c.slug}` : ''));
  }

  const merges = [];
  const demoted = [];
  for (const [root, idSet] of groups) {
    const ids = [...idSet];
    if (ids.length < 2) continue;
    const slugs = new Set(ids.map((id) => canonSlugByWorkId.get(id)).filter(Boolean));
    const plan = {
      ids, winner: pickWinner(ids, inbound),
      sources: [...(sourcesByRoot.get(root) || [])].sort(),
    };
    plan.losers = ids.filter((i) => i !== plan.winner);
    if (slugs.size >= 2) { demoted.push({ ...plan, reason: `spans canon entries: ${[...slugs].join(', ')}` }); continue; }
    merges.push(plan);
  }
  return { merges, demoted };
}
