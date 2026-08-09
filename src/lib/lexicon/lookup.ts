import { Collection, Db } from 'mongodb';
import { normalizeLatin, looseKey, cleanOcrToken } from './normalize';
import { irregularLemmas, suffixSwapCandidates, longSVariants } from './latin-morph';

/**
 * Lookup chain for the parsing reader (issue #3823, Phase 1).
 *
 * Tiers, strongest first — the first tier that matches wins:
 *  1. exact     — normalized form equals a headword
 *  2. variant   — equals a recorded alternative orthography
 *  3. irregular — hand-tabled irregular form (est → sum, tulit → fero)
 *  4. inflected — form generated from the entry's own paradigm at import
 *                 time (lexicon_lemma_map)
 *  5. loose     — ae/oe/e + y/i collapsed match (coelum → caelum), a
 *                 deterministic orthographic equivalence, so it outranks…
 *  6. suffix    — heuristic suffix-swap candidate (labelled uncertain)
 *  7. ocr       — long-s misread repair: f→s variants (fpiffandi →
 *                 spissandi), re-run through tiers 1/4/5
 *
 * A miss is a structured miss. We never return a fuzzy "best guess" beyond
 * tier 5/6, and those tiers carry `confident: false` so the UI can hedge.
 */

export type MatchType = 'exact' | 'variant' | 'irregular' | 'inflected' | 'loose' | 'suffix' | 'ocr';

export interface LexiconMatch {
  key: string;
  headword: string;
  matchType: MatchType;
  confident: boolean;
  entryType: string;
  partOfSpeech: string | null;
  orthography: string | null;
  genitive: string | null;
  gender: string | null;
  declension: number | null;
  mainNotes: string | null;
  senses: unknown[];
  sensesTruncated: boolean;
}

export interface LexiconLookupResult {
  query: string;
  normalized: string;
  found: boolean;
  matches: LexiconMatch[];
}

const MAX_MATCHES = 4;
const MAX_SENSE_CHARS = 4000;

interface EntryDoc {
  key: string;
  headword: string;
  key_normalized: string;
  key_loose: string;
  alt_normalized?: string[];
  entry_type: string;
  part_of_speech?: string;
  gender?: string;
  declension?: number;
  title_genitive?: string;
  title_orthography?: string;
  main_notes?: string;
  senses?: unknown[];
}

function flattenSenseChars(senses: unknown[]): number {
  let n = 0;
  for (const s of senses) n += typeof s === 'string' ? s.length : flattenSenseChars(s as unknown[]);
  return n;
}

function truncateSenses(senses: unknown[]): { senses: unknown[]; truncated: boolean } {
  const out: unknown[] = [];
  let used = 0;
  for (const s of senses) {
    const cost = typeof s === 'string' ? s.length : flattenSenseChars(s as unknown[]);
    if (used + cost > MAX_SENSE_CHARS && out.length > 0) return { senses: out, truncated: true };
    out.push(s);
    used += cost;
  }
  return { senses: out, truncated: false };
}

function toMatch(doc: EntryDoc, matchType: MatchType): LexiconMatch {
  const { senses, truncated } = truncateSenses(doc.senses ?? []);
  return {
    key: doc.key,
    headword: doc.headword,
    matchType,
    confident: matchType !== 'suffix' && matchType !== 'ocr',
    entryType: doc.entry_type,
    partOfSpeech: doc.part_of_speech ?? null,
    orthography: doc.title_orthography ?? null,
    genitive: doc.title_genitive ?? null,
    gender: doc.gender ?? null,
    declension: doc.declension ?? null,
    mainNotes: doc.main_notes ? doc.main_notes.slice(0, 600) : null,
    senses,
    sensesTruncated: truncated,
  };
}

/** Prefer main entries and lower homonym numbers when several keys match. */
function rankEntries(docs: EntryDoc[]): EntryDoc[] {
  const typeRank: Record<string, number> = { main: 0, greek: 1, hapax: 2, gloss: 3, foreign: 4, spur: 5 };
  return [...docs].sort(
    (a, b) => (typeRank[a.entry_type] ?? 9) - (typeRank[b.entry_type] ?? 9) || a.key.localeCompare(b.key)
  );
}

/**
 * Pre-normalization variants tried through the whole chain, in order:
 * the word itself; enclitic stripped (-que/-ne/-ue: veniamque → veniam);
 * h toggled (early modern h-variance: humidum → umidum, arena → harena).
 * These rewrite the QUERY only, so they stay consistent with the stored
 * normalized keys (both sides of the guard keep the same normalizer).
 */
function queryVariants(normalized: string): string[] {
  const out = [normalized];
  const enclitic = normalized.match(/^(.{3,})(que|ne|ue|ce)$/);
  if (enclitic) out.push(enclitic[1]);
  if (normalized.startsWith('h')) out.push(normalized.slice(1));
  else if (/^[aeiou]/.test(normalized)) out.push('h' + normalized);
  if (enclitic && enclitic[1].startsWith('h')) out.push(enclitic[1].slice(1));
  return out;
}

export async function lookupLatinWord(db: Db, rawWord: string): Promise<LexiconLookupResult> {
  const query = cleanOcrToken(rawWord).slice(0, 60);
  const normalized = normalizeLatin(query);
  const entries = db.collection<EntryDoc>('lexicon_entries');
  const lemmaMap = db.collection<{ form: string; form_loose?: string; keys: string[] }>('lexicon_lemma_map');
  const miss: LexiconLookupResult = { query, normalized, found: false, matches: [] };
  if (normalized.length < 1) return miss;

  for (const variant of queryVariants(normalized)) {
    const res = await runTiers(entries, lemmaMap, query, variant);
    if (res) return { ...res, normalized };
  }
  return miss;
}

async function runTiers(
  entries: Collection<EntryDoc>,
  lemmaMap: Collection<{ form: string; form_loose?: string; keys: string[] }>,
  query: string,
  normalized: string
): Promise<LexiconLookupResult | null> {
  const finish = (docs: EntryDoc[], type: MatchType): LexiconLookupResult => ({
    query,
    normalized,
    found: true,
    matches: rankEntries(docs).slice(0, MAX_MATCHES).map((d) => toMatch(d, type)),
  });

  // 1. exact headword
  const exact = await entries.find({ key_normalized: normalized }).limit(8).toArray();
  if (exact.length) return finish(exact, 'exact');

  // 2. recorded orthographic variant
  const variant = await entries.find({ alt_normalized: normalized }).limit(8).toArray();
  if (variant.length) return finish(variant, 'variant');

  // 3. irregular forms — keep the table's order (est → sum before edo)
  const irrLemmas = irregularLemmas(normalized);
  if (irrLemmas.length) {
    const docs = await entries
      .find({ $or: [{ key_normalized: { $in: irrLemmas } }, { key: { $in: irrLemmas } }] })
      .limit(8)
      .toArray();
    if (docs.length) {
      const order = new Map(irrLemmas.map((l, i) => [l, i]));
      const pos = (d: EntryDoc) => order.get(d.key) ?? order.get(d.key_normalized) ?? 99;
      docs.sort((a, b) => pos(a) - pos(b));
      return { query, normalized, found: true, matches: docs.slice(0, MAX_MATCHES).map((d) => toMatch(d, 'irregular')) };
    }
  }

  // 4. generated paradigm map
  const mapped = await lemmaMap.findOne({ form: normalized });
  if (mapped?.keys?.length) {
    const docs = await entries.find({ key: { $in: mapped.keys.slice(0, 8) } }).toArray();
    if (docs.length) return finish(docs, 'inflected');
  }

  // 5. loose orthography (ae/oe/e, y/i collapse) — deterministic, so it
  // outranks the suffix heuristic ("forme" is formae, not a guess at formus).
  const loose = looseKey(normalized);
  if (loose !== normalized) {
    const docs = await entries.find({ key_loose: loose }).limit(8).toArray();
    if (docs.length) return finish(docs, 'loose');
    const mappedLoose = await lemmaMap.findOne({ form_loose: loose });
    if (mappedLoose?.keys?.length) {
      const docs2 = await entries.find({ key: { $in: mappedLoose.keys.slice(0, 8) } }).toArray();
      if (docs2.length) return finish(docs2, 'loose');
    }
  }

  // 6. suffix-swap heuristic (uncertain)
  const candidates = suffixSwapCandidates(normalized).slice(0, 24);
  if (candidates.length) {
    const docs = await entries.find({ key_normalized: { $in: candidates } }).limit(8).toArray();
    if (docs.length) {
      // keep candidate order, not mongo order
      const order = new Map(candidates.map((c, i) => [c, i]));
      docs.sort((a, b) => (order.get(a.key_normalized) ?? 99) - (order.get(b.key_normalized) ?? 99));
      return { query, normalized, found: true, matches: docs.slice(0, MAX_MATCHES).map((d) => toMatch(d, 'suffix')) };
    }
  }

  // 7. long-s OCR repair: f→s variants through headword, paradigm map, loose.
  const fsVariants = longSVariants(normalized);
  if (fsVariants.length) {
    const docs = await entries.find({ key_normalized: { $in: fsVariants } }).limit(8).toArray();
    if (docs.length) return finish(docs, 'ocr');
    const mappedFs = await lemmaMap.findOne({ form: { $in: fsVariants } });
    if (mappedFs?.keys?.length) {
      const docs2 = await entries.find({ key: { $in: mappedFs.keys.slice(0, 8) } }).toArray();
      if (docs2.length) return finish(docs2, 'ocr');
    }
    const looseFs = [...new Set(fsVariants.map(looseKey))];
    const docs3 = await entries.find({ key_loose: { $in: looseFs } }).limit(8).toArray();
    if (docs3.length) return finish(docs3, 'ocr');
  }

  return null;
}
