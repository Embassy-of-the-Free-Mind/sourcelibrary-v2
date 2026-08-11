#!/usr/bin/env node
/**
 * Standing audit: is a book attributed to its PRINTER when its own title page
 * names an author? (#3894 item 5)
 *
 * WHY THIS EXISTS ALONGSIDE author-vs-ai-metadata.mjs. That audit compares
 * `books.author` against `ai_metadata.author`, and only 12% of visible books
 * carry one — so it is structurally blind to the other 88%. It corrected the
 * 1590 *Aminta* to Torquato Tasso while the 1581 and 1583 editions of the same
 * poem stayed under "Manuzio, Aldo", invisible purely because nobody had
 * enriched them. This audit reads the record's own title transcription, so it
 * covers the whole corpus and costs nothing.
 *
 * SCOPE: books whose catalogued author is a printer/publisher DYNASTY. That is
 * where the defect concentrates (the Aldine press alone is catalogued as the
 * author of hundreds of books it only printed) and it keeps precision high —
 * "the catalogued author is a printer AND the title names someone else" is two
 * positive conditions, not one loose one. `--all-authors` widens to every book,
 * which is much noisier; treat that as exploratory.
 *
 * THE VERDICTS, in the order they are decided:
 *   SELF_NAMED        the printer IS named on the title page. A printer can
 *                     author his own book — Aldus wrote grammars, Paulus
 *                     Manutius wrote the Cicero commentaries — so this is
 *                     evidence FOR the catalogue, not against it. Never flagged.
 *   AUTHOR_ON_PAGE    the title names someone in an AUTHOR grammatical position
 *                     and never names the printer. The review queue.
 *   EDITOR_ONLY       the title names someone, but only in an EDITOR position
 *                     ("a M. Antonio Mureto emendatus"). NOT actionable: the
 *                     author is simply not on the page, and promoting the
 *                     corrector swaps one wrong attribution for another.
 *   NO_NAME           no personal name detected. Silence, not innocence.
 *
 * Read-only. Writes nothing. Exits 1 when AUTHOR_ON_PAGE is non-empty.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/title-page-attribution.mjs
 *   node scripts/audit/title-page-attribution.mjs --json
 *   node scripts/audit/title-page-attribution.mjs --limit=40
 */
import { MongoClient } from 'mongodb';
import { namesOnTitlePage } from '../lib/title-page-attribution.mjs';
import { sameNameForm } from '../lib/name-equivalence.mjs';
import { nominativise } from '../lib/nominativise.mjs';

const JSON_OUT = process.argv.includes('--json');
const ALL_AUTHORS = process.argv.includes('--all-authors');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '--limit=0').split('=')[1]);
const log = (...a) => { if (!JSON_OUT) console.log(...a); };

/**
 * Printer and publisher dynasties. Every one of these is a real person or firm
 * that also, sometimes, genuinely authored a book — which is exactly why the
 * SELF_NAMED check exists rather than a blanket rewrite.
 */
const PRINTER_DYNASTY = /\b(manuzio|manutius|manucci|mannucci|aldina|aldine|torresan|estienne|stephanus|plantin|elzevir|elsevier|froben|giunt|gryphius|wechel|oporinus|blaeu|bodoni|didot|zetzner|birckmann|vascosan|morel|cramoisy|janssonius|hackius|luchtmans|zanetti|salicato|ruffinelli|marchetti|giolito|sessa|valgrisi|tramezzino)\b/i;

/**
 * Vernacular ↔ Latin printer names. These pairs share no letters, so no
 * orthographic rule can connect them — but a French printer signs his own Latin
 * title page "Henrici Stephani", and reading that as someone else turns a
 * correct catalogue entry into an accusation. Learned from the first run, where
 * "Estienne, Henri" was flagged against its own self-signed title page.
 */
const LATIN_ALIAS = [
  [/estienne/i, /steph[ae]n/i], [/manuzio|manucci|mannucci/i, /manuti|manuc/i],
  [/torresan/i, /torresan|asulan/i], [/giunt/i, /iunt|junt/i],
  [/froben/i, /froben/i], [/plantin/i, /plantin/i],
  [/wechel/i, /wechel/i], [/plantijn/i, /plantin/i],
  [/bade/i, /badi|ascensi/i], [/vascosan/i, /vascosan/i],
];

/** Is the catalogued author named anywhere in the title, in any known form? */
function namedInTitle(title, author) {
  const t = String(title ?? '');
  const a = String(author ?? '');
  if (!t || !a) return false;
  for (const [vern, lat] of LATIN_ALIAS) {
    if (vern.test(a) && lat.test(t)) return true;
  }
  // Bare surname substring, accent-folded. Crude on purpose: over-matching here
  // costs recall, under-matching costs a false accusation.
  const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const ft = fold(t);
  return fold(a).split(/[\s,;|()]+/)
    .filter((w) => w.length >= 5)
    .some((w) => ft.includes(w.slice(0, Math.max(5, w.length - 2))));
}

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');

const query = ALL_AUTHORS
  ? { author: { $type: 'string', $ne: '' }, title: { $type: 'string' } }
  : { author: PRINTER_DYNASTY, title: { $type: 'string' } };

const total = await books.countDocuments(query);
log(`══ title-page attribution ${ALL_AUTHORS ? '(ALL authors — noisy)' : '(printer dynasties)'} ══\n`);
log(`  books in scope: ${total.toLocaleString()}`);

const buckets = { AUTHOR_ON_PAGE: [], EDITOR_ONLY: [], SELF_NAMED: [], NO_NAME: [] };

const cursor = books.find(query, {
  projection: { id: 1, title: 1, author: 1, author_id: 1, published: 1, year: 1, visible: 1, 'ai_metadata.author': 1 },
});

for await (const b of cursor) {
  const names = namesOnTitlePage(b.title);
  const row = {
    id: b.id || b._id.toString(),
    catalogued: b.author,
    author_id: b.author_id ?? null,
    year: b.year ?? b.published ?? null,
    visible: b.visible === true,
    title: String(b.title ?? '').slice(0, 130),
    // Where enrichment also has an opinion, showing it makes review faster —
    // but this audit never depends on it, which is the whole point.
    ai_says: b.ai_metadata?.author ?? null,
  };

  // A printer who names himself on his own title page is not misattributed.
  //
  // This must be generous, because a false negative here is a false ACCUSATION.
  // Three ways the same person appears: the catalogued form, the Latin form
  // (Estienne/Stephanus — no shared letters, so no orthographic rule can reach
  // it), and a declined form anywhere in the title (Auli Gellii for Aulus
  // Gellius, where the stems are too short for the prefix rule).
  const selfNamed = names.some((n) => sameNameForm(n.name, b.author))
    || sameNameForm(String(b.title ?? '').slice(0, 240), b.author)
    || namedInTitle(b.title, b.author);
  if (selfNamed) { buckets.SELF_NAMED.push(row); continue; }

  if (!names.length) { buckets.NO_NAME.push(row); continue; }

  const authorRole = names.filter((n) => n.role === 'author');
  if (!authorRole.length) {
    row.editors = names.map((n) => n.name);
    buckets.EDITOR_ONLY.push(row);
    continue;
  }

  row.proposed = authorRole[0].name;
  row.proposed_via = authorRole[0].marker;
  // A genitive-head capture names the right person in the WRONG CASE. Flagged
  // so nobody writes "Nicolai Clenardi" into a byline that should read
  // "Nicolaus Clenardus" — the trap that nearly caught the item-2 pass.
  row.needs_nominative = authorRole[0].marker === 'genitive-head';
  row.other_names = names.slice(1).map((n) => `${n.name} (${n.role})`);
  row.ai_agrees = row.ai_says ? sameNameForm(row.ai_says, row.proposed) : null;
  buckets.AUTHOR_ON_PAGE.push(row);
}

const q = buckets.AUTHOR_ON_PAGE;

// ── Nominativise the genitive captures, by THESAURUS LOOKUP not by grammar ──
// A genitive names the right person in the wrong case ("Nicolai Clenardi").
// Latin nominatives are not recoverable by rule, but the `authors` thesaurus
// already stores curated nominative forms, and sameNameForm folds the endings —
// so the lookup does the declension. No match is a legitimate answer: it means
// the person is not in the thesaurus and the row still needs a human.
const authorsCol = db.collection('authors');
const candCache = new Map();
async function findCandidates(stem) {
  if (candCache.has(stem)) return candCache.get(stem);
  const rx = new RegExp(stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const docs = await authorsCol.find({ $or: [{ canonical_name: rx }, { variants: rx }, { _id: rx }] },
    { projection: { _id: 1, canonical_name: 1, variants: 1 }, limit: 25 }).toArray();
  candCache.set(stem, docs);
  return docs;
}
for (const r of q) {
  if (!r.needs_nominative) continue;
  const hit = await nominativise(r.proposed, findCandidates);
  if (!hit) continue;
  r.nominative = hit.nominative;
  r.nominative_slug = hit.slug;
  r.nominative_ambiguous = hit.ambiguous;
  if (hit.ambiguous) r.nominative_alternatives = hit.alternatives;
}

q.sort((a, b) => String(a.catalogued).localeCompare(String(b.catalogued)));

if (JSON_OUT) {
  console.log(JSON.stringify({
    scope: ALL_AUTHORS ? 'all-authors' : 'printer-dynasties',
    total,
    counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
    ai_corroboration: {
      queue_rows_with_ai_opinion: q.filter((r) => r.ai_says).length,
      ai_agrees: q.filter((r) => r.ai_agrees === true).length,
      ai_disagrees: q.filter((r) => r.ai_agrees === false).length,
    },
    needs_nominative: q.filter((r) => r.needs_nominative).length,
    nominative_resolved: q.filter((r) => r.nominative).length,
    nominative_ambiguous: q.filter((r) => r.nominative_ambiguous).length,
    author_on_page: q,
  }, null, 2));
} else {
  for (const [k, v] of Object.entries(buckets)) log(`  ${k.padEnd(16)} : ${v.length}`);

  // Independent corroboration: on the slice where BOTH signals exist, do they
  // agree? This is the closest thing to a precision estimate available without
  // hand-labelling, because the two derive from different evidence.
  const withAi = q.filter((r) => r.ai_says);
  if (withAi.length) {
    const agree = withAi.filter((r) => r.ai_agrees).length;
    log(`\n  Corroboration: of ${withAi.length} queue rows that ALSO have an ai_metadata.author,`);
    log(`  ${agree} agree with the title-page reading (${(100 * agree / withAi.length).toFixed(0)}%).`);
  }

  log(`\n\n══ AUTHOR_ON_PAGE — ${q.length} ══`);
  log('   the title names an author; the catalogued printer is not named there\n');
  for (const r of (LIMIT ? q.slice(0, LIMIT) : q)) {
    log(`  ${r.id}  ${String(r.year ?? '----').slice(0, 4)}  ${String(r.catalogued).slice(0, 26).padEnd(26)} → ${r.proposed}`);
    log(`     ${r.title}`);
    if (r.ai_says) log(`     enrichment says: ${r.ai_says}${r.ai_agrees ? '  ✓ agrees' : '  ✗ differs'}`);
    if (r.needs_nominative && r.nominative) {
      log(`     nominative: ${r.nominative} (${r.nominative_slug})`
        + (r.nominative_ambiguous ? `  ⚠ AMBIGUOUS, also: ${r.nominative_alternatives.join(', ')}` : ''));
    } else if (r.needs_nominative) {
      log('     ⚠ genitive form, not in the thesaurus — needs a human');
    }
    if (r.other_names?.length) log(`     also named: ${r.other_names.join(', ')}`);
  }

  log('\n\n══ EDITOR_ONLY — not actionable ══');
  log('   the page names a corrector/translator but no author. Promoting one');
  log('   swaps a wrong attribution for a different wrong attribution.\n');
  for (const r of buckets.EDITOR_ONLY.slice(0, 6)) {
    log(`  ${r.id}  ${String(r.catalogued).slice(0, 26).padEnd(26)} editors: ${r.editors.join(', ')}`);
    log(`     ${r.title}`);
  }

  log('\n\n══ SUMMARY ══');
  log(`  ${q.length} books attributed to a printer whose own title page names someone else.`);
  log('  Verify each against the title before writing. A printer can author his own');
  log('  book, and this audit only proves the page names another person — not that');
  log('  that person is the author of THIS volume (bound-withs, compilations).');
}

await mc.close();
process.exit(q.length === 0 ? 0 : 1);
