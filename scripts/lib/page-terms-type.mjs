// PRIOR ART: src/lib/entity-aliases.ts (variant → canonical NAME, one type at a time, no
// weighting, no ambiguity verdict); src/lib/author-thesaurus.ts (`norm()` — NFD-strip +
// lowercase on every script, which the non-Latin invariant forbids for our keys);
// scripts/enrichment/dedup-entities.mjs (groups entity names into aliases; does not type a
// free string). None answers "is this page term a person, a place, or a concept?".
/**
 * Type a page term (#4695, "type the terms — no model"). A folded term_key is joined
 * against the three name tables we already hold — `canonical_entities` (Wikidata-backed
 * person/place/concept), `entities` (per-book extractions, noisy, 1M rows) and `authors`
 * (the thesaurus) — and the verdict is one of:
 *
 *   person | place   the name tables agree, by weight (book counts), that this is a name
 *   concept          matched a concept-typed entity, OR matched nothing (`source: unmatched`
 *                    — absence from the name tables is weak evidence, and a consumer reads
 *                    `type_source` to tell the two apart)
 *   unknown          the operation could not judge: the tables DISAGREE and neither type
 *                    dominates (Mercury the god vs the metal; Sophia the person vs wisdom),
 *                    or the key is too short to compare (Latin < 3 chars) or has no letters.
 *
 * `unknown` is its own bucket on purpose (non-latin-text-operations.md): an ambiguous or
 * unjudgeable key must not be folded into either verdict.
 *
 * Folding: NFC everywhere; lowercase + diacritic-strip for Latin script ONLY — the same
 * `termKey()` the harvest used, so the join is exact on both sides. Names of the shape
 * "Last, First" are also indexed as "First Last".
 */
import { termKey, isLatinScript } from './page-terms-parse.mjs';

/** Weight needed for one type to win over the runner-up (3:1). Below it → unknown. */
export const DOMINANCE = 3;
export const TYPES = ['person', 'place', 'concept'];

/** Every folded key a name record should be found under. */
export function nameKeys(name) {
  if (!name || typeof name !== 'string') return [];
  const out = new Set();
  const k = termKey(name);
  if (k) out.add(k);
  const m = name.match(/^([^,()]+),\s*([^,()]+)$/); // "Cicero, Marcus Tullius" → "Marcus Tullius Cicero"
  if (m) { const inv = termKey(`${m[2]} ${m[1]}`); if (inv) out.add(inv); }
  return [...out];
}

/**
 * Build the lookup from name records. Each record: { source, id, type, names: [], weight }.
 * The index is Map<foldedKey, Map<type, { weight, source, id, name }>> — per type the
 * summed weight and the heaviest contributing record.
 */
export function buildNameIndex(records) {
  const index = new Map();
  let indexed = 0;
  for (const rec of records) {
    if (!TYPES.includes(rec.type)) continue;
    const w = Math.max(1, Number(rec.weight) || 1);
    for (const name of rec.names || []) {
      for (const key of nameKeys(name)) {
        let byType = index.get(key);
        if (!byType) { byType = new Map(); index.set(key, byType); }
        const cur = byType.get(rec.type);
        if (!cur) byType.set(rec.type, { weight: w, source: rec.source, id: rec.id, name, top: w });
        else { cur.weight += w; if (w > cur.top) { cur.top = w; cur.source = rec.source; cur.id = rec.id; cur.name = name; } }
        indexed++;
      }
    }
  }
  return { index, indexed, keys: index.size };
}

/** True when the key has too little signal to compare against a name table. */
export function isUnjudgeable(termKeyStr) {
  const s = String(termKeyStr || '');
  if (!/[\p{L}\p{N}]/u.test(s)) return true; // punctuation, symbols
  if (isLatinScript(s) && s.replace(/[^\p{L}\p{N}]/gu, '').length < 3) return true; // "ab", "x"
  return false;
}

/**
 * @returns {{ type, source, id?, name?, weight?, alt? }}
 *   source: canonical_entities | entities | authors | unmatched | ambiguous | unjudgeable
 */
export function typeTerm(termKeyStr, nameIndex) {
  if (isUnjudgeable(termKeyStr)) return { type: 'unknown', source: 'unjudgeable' };
  const byType = nameIndex.index.get(termKeyStr);
  if (!byType) return { type: 'concept', source: 'unmatched' };
  const ranked = [...byType.entries()].sort((a, b) => b[1].weight - a[1].weight);
  const [topType, top] = ranked[0];
  const second = ranked[1]?.[1].weight || 0;
  const alt = Object.fromEntries(ranked.map(([t, v]) => [t, v.weight]));
  if (ranked.length > 1 && top.weight < DOMINANCE * second) return { type: 'unknown', source: 'ambiguous', weight: top.weight, alt };
  return { type: topType, source: top.source, id: top.id, name: top.name, weight: top.weight, ...(ranked.length > 1 ? { alt } : {}) };
}
