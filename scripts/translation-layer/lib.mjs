/**
 * Shared helpers for the work-level external-translation-prior layer.
 *
 * The job this layer fixes: the legacy `ustc_editions.has_english_translation`
 * flag (built by scripts/catalog-coverage/build.mjs) is AUTHOR-LEVEL — it marks
 * every edition by an author who has ANY translated work as "translated"
 * (Filelfo 130/130, etc.). This library matches at the WORK level instead:
 * author-anchor + title containment + specificity, the same "fit" rule used by
 * the work-identity resolvers (see .claude/docs/work-identity-coverage.md).
 *
 * INVARIANT (issue #2626): a work counts as an EXTERNAL PRIOR only if a
 * translation existed independent of Source Library. SL-origin evidence
 * (sl_ft_llm_claim, sl_ft_catalog_verified, in_source_library,
 * sl_translation_percent) is NEVER a prior — it is tracked on a separate channel.
 */

import { createClient } from '@supabase/supabase-js';

export function supa() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// --- Source classification: which translation_catalogs sources are EXTERNAL priors ---
// SL-origin: our own pipeline output. Must be quarantined, never counted as a prior.
export const SL_ORIGIN_SOURCES = new Set([
  'sl_ft_llm_claim',        // unverified LLM claims — the 2,565-row quarantine bulk
  'sl_ft_catalog_verified', // SL verified, but still SL-origin evidence
]);
// `validated_additions` is ambiguous (issue flags it TBD). Treat as SL-origin
// (conservative: keep it OUT of the external baseline) unless reclassified.
export const SL_AMBIGUOUS_SOURCES = new Set(['validated_additions']);

export function isExternalSource(source) {
  if (!source) return false;
  if (SL_ORIGIN_SOURCES.has(source)) return false;
  if (SL_AMBIGUOUS_SOURCES.has(source)) return false;
  return true;
}

// --- Normalization ---

const ACCENTS = /[̀-ͯ]/g;
export function deaccent(s) {
  return (s || '').normalize('NFD').replace(ACCENTS, '');
}

export function normTitle(t) {
  return deaccent(t || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Surname out of "Ficino, Marsilio" / "Marsilio Ficino" / "Ficinus, Marsilius".
export function extractSurname(author) {
  if (!author) return '';
  let a = deaccent(author).toLowerCase().trim();
  // strip life-date / role parentheticals
  a = a.replace(/\([^)]*\)/g, '').replace(/\d{3,4}\s*-?\s*\d{0,4}/g, '').trim();
  if (a.includes(',')) return a.split(',')[0].replace(/[^a-z\s]/g, '').trim();
  const words = a.replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  return words.length ? words[words.length - 1] : '';
}

// Latin/vernacular surname stem so "ficino"/"ficinus"/"ficini" collapse to "ficin".
export function surnameStem(surname) {
  let s = deaccent(surname || '').toLowerCase().replace(/[^a-z]/g, '');
  s = s.replace(/(ius|us|is|i|um|o|ae|a|e)$/, '');
  return s;
}

// Nobiliary / patronymic particles that are NOT the identifying surname token.
const NAME_PARTICLES = new Set([
  'della', 'delle', 'del', 'di', 'da', 'de', 'des', 'du', 'la', 'le', 'los',
  'las', 'von', 'van', 'der', 'den', 'ten', 'ter', 'zur', 'zum', 'y', 'e',
  'of', 'the', 'do', 'dos', 'das', 'ibn', 'bin', 'al', 'el', 'ben', 'a',
]);

/**
 * Candidate surname STEMS for an author string, robust to multi-word names.
 * "Pico della Mirandola, Giovanni" → {pic, mirandol}; USTC "Pico della
 * Mirandola, Giovanni" → {pic, mirandol} (they meet). "Agrippa von Nettesheim"
 * → {agripp, nettesheim}. A match needs only ONE shared stem (then titleFit
 * gates), which rescues the Pico-style name-form mismatches the issue flagged.
 *
 * Comma form "Surname(s), Given": all significant pre-comma words.
 * No-comma form: the last 2 significant words (drops given names like Giovanni).
 */
export function surnameStems(author) {
  let a = deaccent(author || '').toLowerCase();
  a = a.replace(/\([^)]*\)/g, '').replace(/\d{3,4}\s*-?\s*\d{0,4}/g, '');
  const hasComma = a.includes(',');
  if (hasComma) a = a.split(',')[0];
  let words = a.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !NAME_PARTICLES.has(w));
  if (!hasComma && words.length > 2) words = words.slice(-2);
  const stems = new Set();
  for (const w of words) { const s = surnameStem(w); if (s.length >= 3) stems.add(s); }
  return [...stems];
}

// Common biblio / Latin function words that do NOT disambiguate a work.
export const STOP = new Set([
  'de', 'in', 'ad', 'et', 'ex', 'cum', 'per', 'pro', 'sive', 'seu', 'super',
  'contra', 'sub', 'a', 'ab', 'the', 'of', 'on', 'and', 'or', 'an', 'to', 'for',
  'von', 'della', 'del', 'di', 'das', 'der', 'die', 'und', 'le', 'la', 'les',
  'liber', 'libri', 'librorum', 'libellus', 'opera', 'omnia', 'opus', 'opuscula',
  'tractatus', 'tractatulus', 'epistola', 'epistolae', 'epistolarum', 'epistola',
  'oratio', 'orationes', 'orationis', 'dialogus', 'dialogi', 'dialogorum',
  'commentarius', 'commentaria', 'commentarii', 'commentariorum', 'commentary',
  'sermo', 'sermones', 'sermonum', 'vita', 'vitae', 'liber', 'item', 'eiusdem',
  'quibus', 'quae', 'qui', 'nunc', 'primum', 'denuo', 'editio', 'edition',
  'volume', 'vol', 'part', 'parts', 'selected', 'works', 'letters', 'poems',
  'treatise', 'treatises', 'book', 'books', 'first', 'second', 'new', 'complete',
  // admin / scholastic / devotional boilerplate (high enough DF to leak past a
  // pure IDF gate, but never work-identifying): papal/legal formulae, disputation
  // and commentary furniture, common devotional tags.
  'disputatio', 'disputatione', 'expositio', 'expositione', 'declaratio',
  'sententia', 'sententiae', 'sententiarum', 'sententiis', 'promulgata',
  'perpetuam', 'memoriam', 'tabula', 'capituli', 'capitulum', 'decretum',
  'constitutio', 'constitutiones', 'edictum', 'mandatum', 'bulla', 'rei',
  'theologica', 'theologicae', 'philosophica', 'philosophicae', 'positiones',
  'quaestio', 'quaestiones', 'quaestionum', 'conclusiones', 'theses', 'thesibus',
  'praeside', 'praesidente', 'respondente', 'auctore', 'autore', 'auctoris',
  'christi', 'jesu', 'iesu', 'domini', 'sancti', 'sancta', 'sanctae', 'beatae',
  'beati', 'divi', 'maria', 'mariae', 'virginis', 'dei', 'deo', 'evangelii',
]);

// Distinctive (work-identifying) tokens of a title.
export function distinctiveTokens(title) {
  return normTitle(title)
    .split(' ')
    .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));
}

// Document frequency of each distinctive token across a set of titles, for IDF.
export function buildDf(titles) {
  const df = new Map();
  for (const t of titles) {
    for (const tok of new Set(distinctiveTokens(t))) df.set(tok, (df.get(tok) || 0) + 1);
  }
  return df;
}

// IDF gate thresholds (calibrated on the USTC Latin cluster corpus, N≈366k):
//   STRONG ≥6.0  → token in ≲900 clusters (officiis 6.25, familiares 6.87, …)
//   MID    ≥5.0  → token in ≲2.5k clusters
// generic words (theologica 3.69, disputatio 2.24, christi 3.50) fall below MID.
const STRONG_IDF = 6.0;
const MID_IDF = 5.0;

/**
 * Work-level title fit, rarity-aware. The author is anchored upstream (surname
 * stem); here we additionally STRIP author-name tokens from both titles (a title
 * match must rest on WORK tokens, not the shared author name) and require the
 * shared tokens to be RARE enough to identify a work (the fit rule's specificity
 * + distinctive-title clauses).
 *
 * @param df  Map token→clusterDF (from buildDf over the USTC cluster titles)
 * @param N   number of clusters
 * @param authorStems  surname stems to strip from titles (author-name leak guard)
 * Returns { match, score(=idf sum), shared, n_strong }.
 */
export function titleFit(externalTitle, ustcTitle, df = null, N = 0, authorStems = []) {
  const stripAuthor = (toks) => authorStems.length
    ? toks.filter((t) => !authorStems.some((s) => s.length >= 3 && t.startsWith(s)))
    : toks;
  const ext = new Set(stripAuthor(distinctiveTokens(externalTitle)));
  const ust = new Set(stripAuthor(distinctiveTokens(ustcTitle)));
  if (ext.size === 0 || ust.size === 0) return { match: false, score: 0, shared: [], n_strong: 0 };
  const shared = [...ext].filter((t) => ust.has(t));
  if (shared.length === 0) return { match: false, score: 0, shared: [], n_strong: 0 };

  if (!df) {
    // fallback (no corpus): length-based proxy for rarity
    const strong = shared.filter((t) => t.length >= 8);
    const match = strong.length >= 1 || shared.length >= 2;
    return { match, score: Number((shared.length).toFixed(3)), shared, n_strong: strong.length };
  }
  const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1));
  let sum = 0, nStrong = 0, nMid = 0;
  for (const t of shared) {
    const v = idf(t);
    sum += v;
    if (v >= STRONG_IDF) nStrong++;
    if (v >= MID_IDF) nMid++;
  }
  // a single STRONG (rare) shared token identifies a work; otherwise need two MID.
  const match = nStrong >= 1 || nMid >= 2;
  return { match, score: Number(sum.toFixed(2)), shared, n_strong: nStrong };
}

// Paginated full pull of a Supabase table/column set with an optional filter builder.
export async function pullAll(sb, table, columns, applyFilter) {
  const rows = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    let q = sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (applyFilter) q = applyFilter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}
