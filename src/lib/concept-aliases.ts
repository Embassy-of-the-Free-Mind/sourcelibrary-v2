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
