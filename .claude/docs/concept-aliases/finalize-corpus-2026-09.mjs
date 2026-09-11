// PRIOR ART: .claude/docs/concept-aliases/finalize-2026-09-11.mjs — the curated-seed
// finaliser (floor 0.7, malformed keys, stem retag, hand-demote list). This one adds the
// corpus-seed step: a seed_verdict gate, an Opus second-pass overlay, and APPENDS to the
// existing vocabulary instead of writing it from scratch (the 62 curated entries stay verbatim).
/**
 * Finalise corpus-derived concept verdicts (#4695 step 3, batch corpus-2026-09).
 *
 *   node finalize-corpus.mjs --sonnet <dir-of-jsonl> [--opus <dir-of-jsonl>] --in src/data/concept-aliases.json --out src/data/concept-aliases.json
 *
 * Rules, in order, per verdict row:
 *   1. seed rejected (Sonnet, or Opus overlay) → the concept is dropped entirely.
 *   2. malformed key (parenthetical, leading dash, colon/semicolon) → reject.
 *   3. Opus overlay wins where present: an Opus verdict for the same (concept, term_key)
 *      replaces Sonnet's tier + confidence + reason. Opus only re-judged ACCEPTED rows
 *      (variant/equivalent), so it can only demote or confirm — never promote a Sonnet reject.
 *   4. variant/equivalent below FLOOR (0.7) → related.
 *   5. variant whose Latin stem differs from the headword's → equivalent (a rendering, not a spelling).
 *   6. a concept that ends with no variant AND no equivalent is dropped (nothing to expand).
 * Output: the input vocabulary with new entries appended, each carrying
 *   { source: 'corpus-2026-09', books, judged: { sonnet: n, opus: n } }.
 */
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const getArg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const SONNET = getArg('--sonnet'); const OPUS = getArg('--opus'); const IN = getArg('--in'); const OUT = getArg('--out') || IN;
const FLOOR = 0.7; const SOURCE = 'corpus-2026-09';
const readDir = (d) => !d ? [] : fs.readdirSync(d).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(d, f), 'utf8').split('\n').filter(Boolean).map((l, i) => { try { return JSON.parse(l); } catch (e) { console.error(`bad json ${f}:${i + 1}: ${e.message}`); return null; } }).filter(Boolean));
const fold = (s) => s.normalize('NFC').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
const nonLatin = (s) => /[^\p{Script=Latin}\p{P}\p{N}\s]/u.test(s);
const MALFORMED = (k) => /[()（）]/.test(k) || /^[-–—]\s/.test(k) || /\s[—–]\s/.test(k) || /[:;]/.test(k);

const vocab = JSON.parse(fs.readFileSync(IN, 'utf8'));
const existing = new Set(vocab.concepts.map((c) => fold(c.concept)));
const sonnet = readDir(SONNET); const opus = readDir(OPUS);
const opusBy = new Map(); for (const c of opus) opusBy.set(c.term_key ?? c.concept, c);
const stats = { concepts: sonnet.length, seedRejected: 0, opusSeedRejected: 0, alreadyCurated: 0, empty: 0, added: 0, variant: 0, equivalent: 0, related: 0, reject: 0, malformed: 0, floorDemoted: 0, stemRetagged: 0, opusOverridden: 0, opusDemoted: 0 };
const added = [];
const seen = new Set();
// A corpus seed that an EARLIER (larger) concept already accepted as a variant or equivalent
// is the same concept seen from the other language (philosophy → philosophia, soul → anima):
// fold it into that entry instead of adding a duplicate headword.
const absorbed = new Map(); // folded key → headword that accepted it
for (const c of vocab.concepts) for (const r of [...c.variants, ...c.equivalents]) absorbed.set(fold(r.term), c.concept);
stats.mergedInto = 0;
for (const c of sonnet.slice().sort((a, b) => (b.books || 0) - (a.books || 0))) {
  const key = c.term_key ?? c.concept;
  if (seen.has(key)) continue; seen.add(key);
  if (!c.seed_verdict || c.seed_verdict.tier !== 'accept') { stats.seedRejected++; continue; }
  const o = opusBy.get(key);
  if (o?.seed_verdict && o.seed_verdict.tier !== 'accept') { stats.opusSeedRejected++; continue; }
  if (existing.has(fold(c.concept))) { stats.alreadyCurated++; continue; }
  if (absorbed.has(fold(key))) { stats.mergedInto++; continue; }
  const oBy = new Map((o?.verdicts || []).map((v) => [v.term_key, v]));
  const stem = fold(c.concept).replace(/[^a-z]/g, '').slice(0, 4);
  const entry = { concept: c.concept, source: SOURCE, books: c.books ?? null, variants: [], equivalents: [], related: [], rejected: 0, judged: { sonnet: (c.verdicts || []).length, opus: oBy.size } };
  for (const v0 of c.verdicts || []) {
    let v = v0; let note = null;
    const ov = oBy.get(v0.term_key);
    if (ov) { stats.opusOverridden++; if ((ov.tier === 'related' || ov.tier === 'reject') && (v0.tier === 'variant' || v0.tier === 'equivalent')) stats.opusDemoted++; v = { ...v0, tier: ov.tier, confidence: ov.confidence, reason: ov.reason }; note = 'opus second pass'; }
    let tier = v.tier;
    if (tier !== 'reject' && MALFORMED(v.term_key)) { tier = 'reject'; note = 'malformed key'; stats.malformed++; }
    else if ((tier === 'variant' || tier === 'equivalent') && v.confidence < FLOOR) { tier = 'related'; note = `below ${FLOOR} floor`; stats.floorDemoted++; }
    else if (tier === 'variant' && !nonLatin(v.term_key) && !nonLatin(c.concept) && stem.length >= 3 && !fold(v.term_key).replace(/[^a-z]/g, '').includes(stem)) { tier = 'equivalent'; note = 'retagged: different-language rendering, expand with label'; stats.stemRetagged++; }
    stats[tier] = (stats[tier] || 0) + 1;
    const row = { term: v.term_key, confidence: v.confidence, reason: v.reason, ...(note ? { note } : {}) };
    if (tier === 'variant') entry.variants.push(row); else if (tier === 'equivalent') entry.equivalents.push(row); else if (tier === 'related') entry.related.push(row); else entry.rejected++;
  }
  if (!entry.variants.length && !entry.equivalents.length) { stats.empty++; continue; }
  for (const r of [...entry.variants, ...entry.equivalents]) if (!absorbed.has(fold(r.term))) absorbed.set(fold(r.term), entry.concept);
  added.push(entry); stats.added++;
}
const curated = vocab.concepts.filter((c) => !c.source);
const priorCorpus = vocab.concepts.filter((c) => c.source && c.source !== SOURCE);
const out = { ...vocab, _meta: { ...vocab._meta, corpus_batches: { ...(vocab._meta.corpus_batches || {}), [SOURCE]: { added: added.length, judged: stats.concepts, method: 'Sonnet first pass over corpus seeds (top-2,000 by books, page-type labels excluded), Opus second pass over accepted rows, finalize-corpus.mjs rules' } } }, concepts: [...curated, ...priorCorpus, ...added] };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(stats));
console.log(`curated kept verbatim: ${curated.length} · added: ${added.length} · total: ${out.concepts.length} → ${OUT}`);
