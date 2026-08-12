#!/usr/bin/env node
/**
 * Author reconciliation for catalog matching — stem-then-authority.
 *
 * Problem (see .claude/docs/author-normalization-method.md): the Index lists
 * authors in Latin ("Picus, Ioannes"); our books and USTC use vernacular
 * ("Pico della Mirandola, Giovanni"). Exact-surname matching misses them, and
 * even authority reconciliation via `entity_aliases` misses them too — because
 * authority records enumerate vernacular/standard variants ("pico", "pic",
 * "mirandula") but NOT every Latin grammatical inflection ("picus", "pici").
 *
 * The fix is an extra morphological layer BEFORE the authority lookup: stem
 * each name token to fold Latin inflections, so "picus" → "pic" meets the
 * cluster's enumerated "pic". Then disambiguate same-stem candidates by given
 * name + life-dates, and expand to the chosen cluster's full surname set.
 *
 *   Index "Picus, Ioannes" (1632)
 *     → stem surname "picus" → {picus, pic}
 *     → entity_aliases clusters containing a surname that stems into that set:
 *          • Giovanni Pico della Mirandola (b1463 d1494) — given "ioannes" ✓
 *          • Andreas Picus (b1543 d1609)               — given "andreas" ✗
 *          • Ranuccio Pico (b1568 d1644)               — given "ranuccio" ✗
 *     → given-name overlap picks Giovanni Pico
 *     → expand to {pico, mirandola, mirandula, mirandulensis, …}
 *     → SL search now finds "Pico della Mirandola, Giovanni" books.
 *
 * Recall vs precision: reconciliation only WIDENS recall (it can surface both
 * the right person and a same-named decoy — e.g. Jean Pic the Carthusian, also
 * "Ioannes Picus"). Precision is still held downstream by the title gate and
 * the Gemini same-person verifier in the backfill scripts.
 *
 * CLI (doubles as the proof / debug tool):
 *   set -a; source .env.production.local; set +a
 *   node scripts/lib/author-reconcile.mjs "Picus, Ioannes" 1632
 */

// ─── Layer 1: string normalization (matches the doc) ──────────────────────
import { foldAccents, foldLongS, PARTICLES, RECALL_ENDINGS } from './latin-morphology.mjs';

export const norm = foldAccents;

// Particles / honorifics that are never the surname — shared, see
// scripts/lib/latin-morphology.mjs.

// ─── Latin morphological stemming ──────────────────────────────────────────
// Fold inflectional endings so picus/pico/pici/picum all reach a common stem.
// Conservative: only strips when ≥3 chars remain. Returns the token plus every
// plausible stem (recall-first; collisions are resolved downstream).
// RECALL_ENDINGS is this module's list, kept deliberately separate from the
// precision-first list used by name-equivalence.mjs — see latin-morphology.mjs
// for why unioning them would be a regression for both callers.
const LATIN_ENDINGS = RECALL_ENDINGS;

export function stems(tokenRaw) {
  const out = new Set();
  const token = norm(tokenRaw);
  if (token.length < 3) return out;
  const bases = new Set([token]);
  // Long-s OCR confusion (ſ→f): "brandeburgenfis" → "brandeburgensis".
  const longS = foldLongS(token);
  if (longS) bases.add(longS);
  for (const base of bases) {
    out.add(base);
    const m = base.match(LATIN_ENDINGS);
    if (m) {
      const stem = base.slice(0, base.length - m[0].length);
      if (stem.length >= 3) out.add(stem);
    }
  }
  return new Set([...out].filter(s => s.length >= 3));
}

function tokens(name) {
  // "Surname, Given" → surname is everything before the first comma.
  const n = norm(name);
  if (!n) return { surnames: [], givens: [] };
  let surnamePart = n, givenPart = '';
  if (name.includes(',')) {
    const [a, b] = name.split(',');
    surnamePart = norm(a);
    givenPart = norm(b);
  }
  const surTokens = surnamePart.split(' ').filter(t => t && !PARTICLES.has(t));
  const givTokens = givenPart.split(' ').filter(t => t && !PARTICLES.has(t));
  // If no comma, the last token is the likely given name in "Given Surname"
  // order — but Index entries are surname-first, so default to treating ALL
  // non-particle tokens as candidate surnames.
  return { surnames: surTokens, givens: givTokens };
}

// ─── Authority index (built once from entity_aliases) ──────────────────────
// entity_aliases.surnames[] mixes true surnames with given-name fragments
// ("ioannes", "john"…). We can't tell them apart per-row, but we can across
// the corpus: a stem that recurs in thousands of clusters is a given name or a
// generic word; a real surname stem is comparatively rare. So we compute each
// stem's document-frequency and treat only LOW-frequency stems as distinctive
// surnames — for both candidate matching and expansion. This is the data-driven
// version of the doc's `len>=4` + ambiguity-guard heuristics.
//
// Returns: { stem2cl: stem→Set(clusterId), clusters: id→meta, stemDF: stem→count }
export async function loadAuthority(supaGet, { dfMax = 30 } = {}) {
  const stem2cl = new Map();
  const clusters = new Map();
  const stemDF = new Map();
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const rows = await supaGet(
      `entity_aliases?select=id,primary_name,surnames,names,birth_year,death_year,viaf_id,wikidata_qid&order=id&limit=${PAGE}&offset=${offset}`);
    if (!rows.length) break;
    for (const r of rows) {
      const surnameStems = new Set();
      const surnameForms = new Set();   // original normalized tokens, for searching
      for (const s of (r.surnames || [])) {
        for (const tok of norm(s).split(' ')) {
          if (tok.length < 3) continue;
          surnameForms.add(tok);
          for (const st of stems(tok)) surnameStems.add(st);
        }
      }
      // Given-name stems: first token of each full name in names[] (Western
      // order) — used only to disambiguate, never to search.
      const givenStems = new Set();
      for (const nm of (r.names || [])) {
        const first = norm(nm).split(' ')[0];
        for (const st of stems(first)) givenStems.add(st);
      }
      clusters.set(r.id, {
        primary_name: r.primary_name,
        surnameStems, surnameForms, givenStems,
        birth: r.birth_year, death: r.death_year,
        viaf: r.viaf_id, wikidata: r.wikidata_qid,
      });
      for (const st of surnameStems) {
        if (!stem2cl.has(st)) stem2cl.set(st, new Set());
        stem2cl.get(st).add(r.id);
        stemDF.set(st, (stemDF.get(st) || 0) + 1);
      }
    }
    if (rows.length < PAGE) break;
    offset += rows.length;
  }
  return { stem2cl, clusters, stemDF, dfMax };
}

// ─── Reconcile one name → best cluster + expanded surname forms ─────────────
export function reconcile(rawName, { authority, year } = {}) {
  const { stem2cl, clusters, stemDF, dfMax = 30 } = authority;
  const distinctive = (st) => (stemDF.get(st) || 0) <= dfMax;
  const { surnames, givens } = tokens(rawName);
  if (!surnames.length) return null;

  const queryStems = new Set();
  for (const t of surnames) for (const st of stems(t)) queryStems.add(st);
  const givenStems = new Set();
  for (const t of givens) for (const st of stems(t)) givenStems.add(st);

  // Candidate clusters. A DISTINCTIVE surname stem (rare across the corpus,
  // e.g. "pic") admits all its clusters. A COMMON stem (e.g. "erasm", which is
  // also a widespread given name) would pull thousands — so for those we admit
  // a cluster only if it ALSO matches the query's given name. This rescues
  // marquee authors with given-name-like surnames (Desiderius *Erasmus*) that
  // the doc's blanket ambiguity-guard dropped, without the blowup.
  const candIds = new Set();
  for (const st of queryStems) {
    const ids = stem2cl.get(st);
    if (!ids) continue;
    if (distinctive(st)) {
      for (const id of ids) candIds.add(id);
    } else if (givenStems.size) {
      for (const id of ids) {
        const c = clusters.get(id);
        if ([...givenStems].some(g => c.givenStems.has(g))) candIds.add(id);
      }
    }
  }
  if (!candIds.size) return null;

  let best = null;
  for (const id of candIds) {
    const c = clusters.get(id);
    // given-name overlap is the strongest disambiguator (Ioannes Pico vs
    // Andreas Picus). Year plausibility: an author can't be banned before birth.
    let givenHit = 0;
    for (const g of givenStems) if (c.givenStems.has(g)) { givenHit = 1; break; }
    let yearOk = 1;
    if (year && c.birth && year < c.birth - 5) yearOk = 0;     // banned before born → no
    const surnameMatches = [...queryStems].filter(s => c.surnameStems.has(s)).length;
    // Score: given-name match dominates, then year plausibility, then surname depth.
    const score = givenHit * 100 + yearOk * 10 + Math.min(surnameMatches, 5);
    if (!best || score > best.score) best = { id, c, score, givenHit, yearOk };
  }
  if (!best) return null;
  // If the entry has a given name but NOTHING matched it, the cluster is a
  // same-surname decoy — refuse rather than mislink (precision floor).
  if (givenStems.size && !best.givenHit && [...candIds].some(id => {
    const c = clusters.get(id);
    return [...givenStems].some(g => c.givenStems.has(g));
  })) {
    return null; // a better-matching given-name cluster exists; this isn't it
  }

  // Expand: the cluster's real surname FORMS, kept only when their (shortest,
  // most aggressive) stem is distinctive — this drops given-name fragments
  // ("john", "ioannes", "count") and keeps {pico, mirandola, mirandula, …} as
  // whole-word search terms (forms, not prefixes).
  const shortestStem = (f) => [...stems(f)].sort((a, b) => a.length - b.length)[0] || f;
  const expanded = new Set(
    [...best.c.surnameForms].filter(f => f.length >= 4 && distinctive(shortestStem(f))));
  // Always include the entry's own literal surname(s): for an author whose
  // surname is itself a common token (Erasmus), the literal form is dropped
  // from the cluster expansion but is exactly what our catalog files him under.
  for (const t of surnames) if (t.length >= 4) expanded.add(t);
  return {
    clusterId: best.id,
    primary_name: best.c.primary_name,
    birth: best.c.birth, death: best.c.death,
    viafId: best.c.viaf || null,
    wikidata: best.c.wikidata || null,
    score: best.score,
    expandedSurnames: [...expanded],
  };
}

// ─── CLI / proof harness ────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv[2];
  const year = process.argv[3] ? Number(process.argv[3]) : undefined;
  if (!name) { console.error('usage: author-reconcile.mjs "Surname, Given" [year]'); process.exit(1); }

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const supaGet = async (path) => {
    const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };

  console.log(`Query: "${name}"${year ? ` (year ${year})` : ''}`);
  console.log(`Surname stems: ${[...new Set([...tokens(name).surnames].flatMap(t => [...stems(t)]))].join(', ')}`);
  console.log('Loading entity_aliases…');
  const authority = await loadAuthority(supaGet);
  console.log(`Loaded ${authority.clusters.size} clusters.\n`);

  // DF calibration for a few telling stems.
  const df = (s) => authority.stemDF.get(s) || 0;
  console.log(`stem DF — pic:${df('pic')} mirandol:${df('mirandol')} mirandul:${df('mirandul')} john:${df('john')} ioann:${df('ioann')} giovann:${df('giovann')}\n`);

  const r = reconcile(name, { authority, year });
  if (!r) { console.log('No confident cluster.'); process.exit(0); }
  console.log(`→ ${r.primary_name} (b${r.birth ?? '?'} d${r.death ?? '?'}), score ${r.score}`);
  console.log(`  expanded surnames: ${r.expandedSurnames.join(', ')}`);

  // Prove SL recall: search Mongo with OLD (literal surname) vs NEW (expanded).
  const { MongoClient } = await import('mongodb');
  const mc = new MongoClient(process.env.MONGODB_URI);
  await mc.connect();
  const db = mc.db('bookstore');
  const litSurname = tokens(name).surnames[0];
  // Whole-word match on real surname forms (not prefixes).
  const mkRe = (terms) => new RegExp(`(^|[^a-z])(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})([^a-z]|$)`, 'i');
  const find = (terms) => db.collection('books').find(
    { author: mkRe(terms), visible: { $ne: false } },
    { projection: { title: 1, author: 1, year: 1, slug: 1 } }).limit(40).toArray();
  const oldHits = await find([litSurname]);
  const newHits = await find(r.expandedSurnames);
  console.log(`\nSL books — OLD (literal "${litSurname}"): ${oldHits.length}`);
  console.log(`SL books — NEW (expanded forms): ${newHits.length}`);
  for (const b of newHits.slice(0, 12)) console.log(`   • "${(b.title || '').slice(0, 50)}" — ${b.author} (${b.year ?? '?'})`);
  await mc.close();
}
