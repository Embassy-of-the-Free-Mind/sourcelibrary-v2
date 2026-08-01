#!/usr/bin/env node
/**
 * Quarantine non-person entries in the canonical `authors` collection (#2179).
 *
 * The `authors` collection (built by build-authors-collection.mjs, #2202; then
 * VIAF/Wikidata-anchored by reconcile-authors-grounded.mjs, #2218) is meant to
 * hold ONE doc per real book-author. But the source `author` strings are dirty:
 * institutions ("British Museum", "Bayerische Staatsbibliothek"), printer/series
 * labels ("Elzevir Respublica Series"), legal corpora ("Corpus juris civilis"),
 * work-titles miscatalogued as authors ("Splendor Solis", "Philosophia
 * Reformata"), and placeholders ("[s.n.]", "(unknown)") all became author docs.
 * They inflate author counts and generate empty/garbage /author/ pages.
 *
 * #2218 only ANCHORS people — it correctly leaves these unanchored (its LLM
 * returns null for non-people), but it never flags them, so they linger as fake
 * authors. This pass flags them `is_person: false` so author surfaces exclude
 * them. Nothing is deleted; fully reversible.
 *
 * SAFETY INTERLOCK: only ever touches docs that are STILL UNANCHORED (no
 * wikidata_id and no viaf_id). If #2218 anchored a doc, it is a real person and
 * is never a quarantine candidate — so this pass can run after #2218 without
 * racing its judgements. Pattern hits are conservative; the curated title list
 * is hand-verified (every entry checked to be a work/edition, not a person).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/quarantine-non-person-authors.mjs           # dry-run
 *   node scripts/maintenance/quarantine-non-person-authors.mjs --apply   # write flags
 *   node scripts/maintenance/quarantine-non-person-authors.mjs --unapply # revert all flags
 */
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const UNAPPLY = process.argv.includes('--unapply');

// ── Structural patterns: unmistakably an institution / series / placeholder ──
// Conservative — a hit must not plausibly be a single human author. Personal
// names that merely contain a place ("of Samosata") are NOT matched here.
const NON_PERSON = [
  { tag: 'institution', re: /\b(monaster(y|ies)|gonpa|dgon|temple|abbey|convent|priory|cloister|museum|gallery)\b/i },
  { tag: 'institution', re: /\b(biblioth\w*|staats?bib\w*|nationalbib\w*|universit\w+|college|académie|academy|institut\w*|society|verein)\b/i },
  // Note: bare printer-family surnames (Plantin, Elzevir, Aldine) are NOT
  // matched — they are also real people ("Christophe Plantin"). Series labels
  // like "Elzevir Respublica Series" are caught by the respublica/series rule.
  { tag: 'press-series', re: /\b(verlag|imprimerie|officina|druckerei)\b/i },
  { tag: 'press-series', re: /\b(respublica|series|collection|sammlung|reeks)\b/i },
  { tag: 'corpus', re: /\b(corpus juris|corpus hermeticum|opera omnia|opera|acta|statuta|decretum|decretals)\b/i },
  { tag: 'group', re: /\b(school of|circle of|workshop of|atelier|studio of|dynasty|kingdom|empire|province|diocese|order of)\b/i },
  { tag: 'placeholder', re: /^\s*\[?\s*s\.?\s*[nl]\.?\s*\]?\s*$/i },          // [s.n.] / s.l.
  { tag: 'placeholder', re: /^\s*[?？]\s*(\(.*\))?\s*$/ },                     // "?" / "? (s.l.)"
  { tag: 'placeholder', re: /^\s*\(?\s*(unknown|anonymous|anon|various|none|n\/a|traditional|s\.n\.?)\s*\)?\s*$/i },
  { tag: 'reference', re: /\bgeneral reference\b|\bthe philosophers\b/i },
];

// ── Curated work-titles miscatalogued as authors (HAND-VERIFIED) ─────────────
// Each confirmed to be a book/edition/work, not a person. Matched case-insensitively
// against the WHOLE canonical_name (exact, trimmed) to avoid catching real names.
const TITLE_NOT_AUTHOR = new Set([
  'splendor solis', 'philosophia reformata', 'theatrum sympatheticum', 'theatrum chemicum',
  'porta magia naturalis', 'magia naturalis', 'aurora consurgens', 'turba philosophorum',
  'mutus liber', 'rosarium philosophorum', 'musaeum hermeticum', 'atalanta fugiens',
  // ── added by #3434 ─────────────────────────────────────────────────────────
  // Surfaced by scripts/audit/author-attribution.mjs. These are the *search
  // queries* of the 2026-03-14 BSB import run, stamped into `books.author`: note
  // the "<author surname> <work keyword>" shape, which is nobody's name. Each is
  // a work (or a work-plus-author query), verified individually — never a person.
  'museum hermeticum', 'tripus aureus', 'fama fraternitatis', 'confessio fraternitatis',
  'iamblichus de mysteriis', 'albertus secrets', 'fludd medicina', 'kabbala denudata',
  'chaldaean oracles', 'viridarium chymicum', 'john dee monas',
  'kircher oedipus', 'kircher ars magna', 'kircher musurgia', 'kircher mundus',
].map((s) => s.toLowerCase()));

function classify(doc) {
  const names = [doc.canonical_name, ...(doc.variants || [])].filter(Boolean);
  const whole = String(doc.canonical_name || '').trim().toLowerCase();
  if (TITLE_NOT_AUTHOR.has(whole)) return 'title-not-author';
  for (const { tag, re } of NON_PERSON) if (names.some((n) => re.test(n))) return tag;
  return null;
}

const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const authors = mc.db('bookstore').collection('authors');

if (UNAPPLY) {
  const r = await authors.updateMany({ is_person: false }, { $unset: { is_person: '', quarantine_reason: '', quarantined_at: '' } });
  console.log(`Reverted is_person flags on ${r.modifiedCount} docs.`);
  await mc.close(); process.exit(0);
}

// INTERLOCK: candidates must still be unanchored — never override #2218's people.
const unanchored = {
  $and: [
    { $or: [{ viaf_id: { $in: [null, ''] } }, { viaf_id: { $exists: false } }] },
    { $or: [{ wikidata_id: { $in: [null, ''] } }, { wikidata_id: { $exists: false } }] },
    { $or: [{ is_person: { $ne: false } }, { is_person: { $exists: false } }] },
  ],
};
const docs = await authors.find(unanchored).sort({ book_count: -1 }).toArray();
const flagged = [];
for (const d of docs) { const reason = classify(d); if (reason) flagged.push({ d, reason }); }

const byReason = {};
for (const f of flagged) (byReason[f.reason] ||= []).push(f);
console.log(`Unanchored author docs scanned: ${docs.length}`);
console.log(`Non-person docs to quarantine: ${flagged.length}\n`);
for (const [reason, items] of Object.entries(byReason).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`── ${reason} (${items.length}) ──`);
  for (const { d } of items.slice(0, 60)) console.log(`   ${String(d.book_count || 0).padStart(3)}  ${d.canonical_name}`);
  if (items.length > 60) console.log(`   … +${items.length - 60} more`);
  console.log('');
}

if (!APPLY) { console.log('DRY-RUN. Re-run with --apply to write is_person:false flags.'); await mc.close(); process.exit(0); }

let n = 0;
for (const { d, reason } of flagged) {
  await authors.updateOne({ _id: d._id }, { $set: { is_person: false, quarantine_reason: reason, quarantined_at: new Date() } });
  n++;
}
console.log(`APPLIED: quarantined ${n} non-person author docs (is_person:false).`);
await mc.close();
