import { Db } from 'mongodb';

/**
 * Greek dictionary lookup (#3823 Phase 3): LSJ 9th ed. (lsj9, CC BY 4.0)
 * entries + a form→lemma map regenerated with the MPL-2.0 Morpheus engine
 * over OUR corpus vocabulary (no NC-encumbered data; see
 * scripts/lexicon/morpheus-crunch.mjs).
 *
 * Tiers (both confident — the map is analyzer output, not heuristics):
 *   1. exact   — normalized form equals an LSJ headword
 *   2. lemma   — form found in lexicon_lemma_map_grc
 * A miss is a structured miss, same contract as Latin.
 *
 * normGreekKey MUST match scripts/lexicon/import-lsj.mjs (same normalizer
 * on both sides): NFD → strip length marks → NFC → lowercase → grave→acute.
 */

const GRAVE_TO_ACUTE: Record<string, string> = { 'ὰ': 'ά', 'ὲ': 'έ', 'ὴ': 'ή', 'ὶ': 'ί', 'ὸ': 'ό', 'ὺ': 'ύ', 'ὼ': 'ώ', 'ἃ': 'ἅ', 'ἓ': 'ἕ', 'ἳ': 'ἵ', 'ὃ': 'ὅ', 'ὓ': 'ὕ', 'ὣ': 'ὥ', 'ἂ': 'ἄ', 'ἒ': 'ἔ', 'ἲ': 'ἴ', 'ὂ': 'ὄ', 'ὒ': 'ὔ', 'ὢ': 'ὤ', 'ᾲ': 'ᾴ', 'ῂ': 'ῄ', 'ῲ': 'ῴ' };

export function normGreekKey(raw: string): string {
  let s = raw.normalize('NFD').replace(/[̄̆]/g, '').normalize('NFC').toLowerCase();
  s = [...s].map((ch) => GRAVE_TO_ACUTE[ch] ?? ch).join('');
  return s.replace(/[^\p{L}\p{N}]/gu, '');
}

interface GrcEntryDoc {
  key: string;
  headword: string;
  key_normalized: string;
  grammar: string | null;
  etymology: string | null;
  homograph: string | null;
  short_def: string | null;
}

export interface GrcMatch {
  key: string;
  headword: string;
  matchType: 'exact' | 'lemma';
  confident: true;
  grammar: string | null;
  etymology: string | null;
  shortDef: string | null;
}

export interface GrcLookupResult {
  query: string;
  normalized: string;
  found: boolean;
  matches: GrcMatch[];
}

const MAX_MATCHES = 4;

/** Entries with a short def outrank bare headwords (homograph stubs). */
function rank(docs: GrcEntryDoc[]): GrcEntryDoc[] {
  return [...docs].sort((a, b) => Number(!!b.short_def) - Number(!!a.short_def) || a.key.localeCompare(b.key));
}

function toMatch(d: GrcEntryDoc, matchType: 'exact' | 'lemma'): GrcMatch {
  return {
    key: d.key,
    headword: d.headword,
    matchType,
    confident: true,
    grammar: d.grammar,
    etymology: d.etymology,
    shortDef: d.short_def,
  };
}

export async function lookupGreekWord(db: Db, rawWord: string): Promise<GrcLookupResult> {
  const query = rawWord.trim().slice(0, 80);
  const normalized = normGreekKey(query);
  const miss: GrcLookupResult = { query, normalized, found: false, matches: [] };
  if (normalized.length < 1) return miss;
  const entries = db.collection<GrcEntryDoc>('lexicon_entries_grc');

  const exact = await entries.find({ key_normalized: normalized }).limit(8).toArray();
  if (exact.length) {
    return { query, normalized, found: true, matches: rank(exact).slice(0, MAX_MATCHES).map((d) => toMatch(d, 'exact')) };
  }

  const mapped = await db
    .collection<{ form: string; keys: string[] }>('lexicon_lemma_map_grc')
    .findOne({ form: normalized });
  if (mapped?.keys?.length) {
    const docs = await entries.find({ key: { $in: mapped.keys.slice(0, 8) } }).toArray();
    if (docs.length) {
      return { query, normalized, found: true, matches: rank(docs).slice(0, MAX_MATCHES).map((d) => toMatch(d, 'lemma')) };
    }
  }

  return miss;
}
