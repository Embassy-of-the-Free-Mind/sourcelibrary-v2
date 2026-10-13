// PRIOR ART: src/lib/entity-aliases.ts (person/place NAME variants → canonical, from the dedup
// script; no concepts, no glosses); src/lib/author-thesaurus.ts (authors only);
// src/app/api/search/ai-expand/route.ts (per-query LLM expansion, cached in process memory, never
// reviewed). None holds a curated, evidence-backed CONCEPT vocabulary across scripts and languages.
/**
 * Curated concept aliases (#4695) — the vocabulary a reader's search term should expand to.
 *
 * Built from the per-page `<vocab>` / `<term>` / `<gloss>` / `<note original>` tags the OCR and
 * translation prompts already write (harvested over 38,287 books), then judged per
 * `.claude/docs/concept-aliases/JUDGE-RUBRIC.md` by eight Claude judges with a second pass by
 * the session lead; every accepted row carries a confidence and a one-line reason citing page
 * evidence. Provenance: `.claude/docs/concept-aliases/verdicts-2026-09-11.jsonl`.
 *
 * Three tiers, and the distinction is the whole point:
 *   variant    — the same word (script, spelling, inflection): samādhi / samadhi / 三昧.
 *                Expand SILENTLY.
 *   equivalent — a translator's rendering in another language: prima materia / first matter,
 *                dhikr / remembrance of God. Expand, but LABEL the hit — another translator
 *                chose a different word.
 *   related    — adjacent concept or cross-tradition analogue (hesychia ↔ śamatha). Graph
 *                only; NEVER used for expansion, or a search for stillness returns Daoist texts
 *                as if they used the Greek word.
 *
 * Caveat carried from the data: single CJK characters (占, 卜, 德, 夢) must be matched on word
 * boundaries by any consumer; substring-matching them hits every compound they occur in.
 */
import data from '@/data/concept-aliases.json';

export type AliasTier = 'variant' | 'equivalent' | 'related';

export interface AliasRow {
  term: string;
  confidence: number;
  reason: string;
  note?: string;
}

export interface ConceptEntry {
  concept: string;
  theme?: string;
  tradition?: string;
  variants: AliasRow[];
  equivalents: AliasRow[];
  related: AliasRow[];
  rejected: number;
}

const CONCEPTS: ConceptEntry[] = (data as { concepts: ConceptEntry[] }).concepts;

/** Fold for lookup: NFC, lowercase, strip combining marks — Latin only; other scripts NFC. */
export function foldTerm(s: string): string {
  const nfc = s.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (/[^\p{Script=Latin}\p{P}\p{N}\s]/u.test(nfc)) return nfc;
  return nfc.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
}

const INDEX = new Map<string, { entry: ConceptEntry; tier: AliasTier | 'concept' }>();
for (const entry of CONCEPTS) {
  INDEX.set(foldTerm(entry.concept), { entry, tier: 'concept' });
  for (const r of entry.variants) INDEX.set(foldTerm(r.term), { entry, tier: 'variant' });
  for (const r of entry.equivalents) if (!INDEX.has(foldTerm(r.term))) INDEX.set(foldTerm(r.term), { entry, tier: 'equivalent' });
}

export function allConcepts(): ConceptEntry[] {
  return CONCEPTS;
}

/** The concept a query term names, if any (by headword, variant, or equivalent). */
export function conceptFor(term: string): { entry: ConceptEntry; tier: AliasTier | 'concept' } | null {
  return INDEX.get(foldTerm(term)) ?? null;
}

export interface Expansion {
  concept: string;
  /** Expand silently: the same word in other scripts/spellings. Includes the headword. */
  silent: string[];
  /** Expand with a label: other-language renderings. */
  labelled: string[];
}

/**
 * Expansion set for a query term. Returns null when the term names no curated concept, so a
 * caller falls through to whatever it did before. `related` is deliberately not returned.
 */
export function expandTerm(term: string, opts: { minConfidence?: number } = {}): Expansion | null {
  const hit = conceptFor(term);
  if (!hit) return null;
  const min = opts.minConfidence ?? 0.7;
  const e = hit.entry;
  const silent = Array.from(new Set([e.concept, ...e.variants.filter((r) => r.confidence >= min).map((r) => r.term)]));
  const labelled = e.equivalents.filter((r) => r.confidence >= min).map((r) => r.term).filter((t) => !silent.includes(t));
  return { concept: e.concept, silent, labelled };
}

export interface ConceptVocabulary {
  concept: string;
  /** The words of the query that named the concept. */
  matched: string;
  tradition?: string;
  /** variant tier: the same word in other spellings, scripts, inflections. */
  same_word: string[];
  /** equivalent tier: another translator's rendering. */
  other_renderings: string[];
  /** related tier: adjacent concepts and other traditions' analogues. NOT synonyms. */
  related: string[];
}

const RELATED_FLOOR = 0.6;
const RELATED_CAP = 40;

function vocabularyOf(entry: ConceptEntry, matched: string, min: number): ConceptVocabulary {
  const x = expandTerm(entry.concept, { minConfidence: min })!;
  const taken = new Set([...x.silent, ...x.labelled]);
  const related = entry.related
    .filter((r) => r.confidence >= RELATED_FLOOR && !taken.has(r.term))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, RELATED_CAP)
    .map((r) => r.term);
  return { concept: entry.concept, matched, ...(entry.tradition ? { tradition: entry.tradition } : {}), same_word: x.silent, other_renderings: x.labelled, related };
}

/**
 * The curated vocabulary of the concept(s) a query NAMES (#4251) — all three tiers, kept apart.
 *
 * This is for SHOWING a searcher which words each tradition files a concept under, so they can
 * search those words themselves; it is not an expansion set (`expandTerm` is, and it still
 * never returns `related`). The whole query is tried first, then its word runs, longest first,
 * so "remembrance of God in Sufi practice" finds dhikr. Words are matched whole, never as
 * substrings — the single-CJK-character caveat above. At most `max` concepts.
 */
export function conceptsInQuery(query: string, opts: { minConfidence?: number; max?: number } = {}): ConceptVocabulary[] {
  const min = opts.minConfidence ?? 0.7;
  const max = opts.max ?? 2;
  const words = query.normalize('NFC').split(/\s+/).map((w) => w.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')).filter(Boolean);
  if (!words.length || words.length > 40) return [];
  const out: ConceptVocabulary[] = [];
  const used = new Array<boolean>(words.length).fill(false);
  for (let n = Math.min(words.length, 4); n >= 1 && out.length < max; n--) {
    for (let i = 0; i + n <= words.length && out.length < max; i++) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      const run = words.slice(i, i + n).join(' ');
      const hit = conceptFor(run);
      if (!hit || out.some((v) => v.concept === hit.entry.concept)) continue;
      out.push(vocabularyOf(hit.entry, run, min));
      used.fill(true, i, i + n);
    }
  }
  return out;
}
