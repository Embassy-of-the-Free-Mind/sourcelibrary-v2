#!/usr/bin/env node
/**
 * Standing audit: does `books.author` contradict `ai_metadata.author`? (#3894)
 *
 * THE CLASS. Two layers independently answer "who wrote this". `books.author`
 * comes from the importer — whatever the source catalogue said. `ai_metadata.author`
 * comes from enrichment, which read the pages. Nothing reconciles them, so when
 * the importer is wrong and enrichment is right, the right answer sits unused.
 *
 * The case that motivated this (reader report, feedback 6a7ac2d930665fc3449c1071):
 * *Demonomania de gli stregoni* (1592) was catalogued `author: "Manuzio, Aldo"` —
 * the Aldine press PRINTED it; Jean Bodin wrote it, and the title page says so.
 * `ai_metadata.author` had read "Jean Bodin" on 2026-05-30 and the description
 * opened "This is an Italian translation of Jean Bodin's…". Ten weeks later the
 * author-link backfill anchored the wrong string with `confidence: "high"`.
 * The cost was not cosmetic: we hold three other witnesses of that work, all
 * correctly attributed and clustered on Q10264553, and the Italian sat alone in a
 * singleton local work cluster — so a printer-as-author error silently costs a
 * work-graph edge as well as a byline.
 *
 * WHY THE EXISTING DETECTORS MISS IT. `author-attribution.mjs` (#3434) hunts
 * strings that are not names — search terms, work titles, `[object Object]`.
 * "Manuzio, Aldo" IS a name, of a real anchored person who genuinely authored
 * other books we hold, so it is invisible there for the same reason Khunrath was.
 * The signal here is not the shape of the string but its DISAGREEMENT with a
 * second, page-derived opinion.
 *
 * WHY THIS IS PARTITIONED AND NOT A DEFECT LIST. Most disagreement is benign, and
 * a flat list of it reads as 440 bugs when it is closer to 100. Four classes are
 * separated out before the residue is reported — see CLASSES below. Only
 * `person_vs_person` is a review queue; the rest are context.
 *
 * Read-only. Writes nothing. Exits 1 when the residue is non-empty so it can gate
 * CI, 0 when clean.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/author-vs-ai-metadata.mjs
 *   node scripts/audit/author-vs-ai-metadata.mjs --json
 *   node scripts/audit/author-vs-ai-metadata.mjs --all        # include hidden books
 *   node scripts/audit/author-vs-ai-metadata.mjs --class=person_vs_person
 */
import { MongoClient } from 'mongodb';

const JSON_OUT = process.argv.includes('--json');
const INCLUDE_HIDDEN = process.argv.includes('--all');
const ONLY_CLASS = (process.argv.find((a) => a.startsWith('--class=')) || '').split('=')[1] || null;

const log = (...a) => { if (!JSON_OUT) console.log(...a); };

// ───────────────────────────────────────────────────────────────────────────────
// Normalisation. Accent-folded, lowercased, punctuation to space. Tokens of 3+
// chars only: "de", "van", "di", "the" and initials match across unrelated names
// and would manufacture agreement where there is none.
// ───────────────────────────────────────────────────────────────────────────────
const norm = (s) => String(s ?? '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tokens = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));

/** Fraction of the smaller token set shared. 1 = one name contains the other. */
function overlap(a, b) {
  const A = tokens(a); const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let hits = 0;
  for (const t of A) if (B.has(t)) hits++;
  return hits / Math.min(A.size, B.size);
}

// ───────────────────────────────────────────────────────────────────────────────
// CLASSES. Order matters — each book takes the FIRST class it matches, so the
// cheap exclusions run before the expensive residue.
// ───────────────────────────────────────────────────────────────────────────────

/**
 * A catalogued value that names nobody. The AI is SUPPLYING an attribution.
 *
 * Test the RAW string for emptiness, never `norm()`'s output: `norm` strips every
 * non-Latin character, so 王圻 and Салтыков-Щедрин normalise to "" and an
 * `!norm(s)` test files the entire CJK and Cyrillic corpus as "placeholder".
 * That is exactly what the first run of this audit did — 39 non-Latin names
 * reported as anonymous books.
 */
const PLACEHOLDER = /^(unknown|anonymous|anon|various|n\s*a|none|untitled|s\s*n|sine nomine|no author|not stated|\[?unknown author\]?|unbekannt|onbekend)$/;
const isPlaceholder = (s) => {
  const raw = String(s ?? '').trim();
  if (!raw) return true;
  return PLACEHOLDER.test(norm(s));
};

/**
 * Whether the Latin-token metric can judge this pair AT ALL.
 *
 * `norm()` strips every non-Latin character, so a CJK or Cyrillic name yields an
 * EMPTY token set and `overlap()` returns 0 unconditionally — meaning every
 * non-Latin-authored book is a guaranteed "disagreement" regardless of what the
 * two strings say. The first cut of this only caught the case where the two
 * sides were in *different* scripts, which let 王圻, 王思義 and
 * Иван Сергеевич Тургенев into the review queue whenever enrichment answered in
 * the same script. So the test is "is either side non-Latin", not "do the sides
 * differ" — and the class means *undecidable here*, not *equivalent*. Judging
 * these needs transliteration, which this audit deliberately does not attempt.
 */
const latinShare = (s) => {
  const letters = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').match(/\p{L}/gu) || [];
  if (!letters.length) return 0;
  return letters.filter((c) => /[a-zA-Z]/.test(c)).length / letters.length;
};
const isUndecidableScript = (cat, ai) => latinShare(cat) < 0.5 || latinShare(ai) < 0.5;

/**
 * An institution, collection or corporate body. These overlap #3483's `is_person`
 * work — a museum really does author its own catalogue, so a contradiction here
 * is a different question ("which layer does this heading belong to") and does
 * not belong in a byline-correction queue.
 *
 * Two lists, because a trailing `\b` silently disables every truncated stem:
 * `/\bbibliot\b/` cannot match "Biblioteca" (no boundary before the "e"), which
 * is how "Biblioteca Aldina (ed.)" reached the person-vs-person queue.
 */
const INST_WORD = /\b(collection|library|museum|society|academy|accademia|company|association|commission|department|ministry|council|board|committee|survey|office|bureau|school|college|foundation|trust|press|verlag|church|google|order of|congregation)\b/i;
const INST_STEM = /(bibliot|institut|universit|archiv|akadem|gesellschaft|genootschap|maatschapp)/i;
const isInstitutional = (s) => INST_WORD.test(String(s ?? '')) || INST_STEM.test(String(s ?? ''));

/** Printer/publisher dynasties repeatedly catalogued as authors of what they printed. */
const PRINTER_HINT = /\b(manuzio|manutius|manucci|mannucci|aldina|torresan|estienne|stephanus|plantin|elzevir|elsevier|froben|giunt|gryphius|wechel|oporinus|blaeu|bodoni|didot)\b/i;

// ───────────────────────────────────────────────────────────────────────────────
const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');

const scope = INCLUDE_HIDDEN ? {} : { visible: true };
const query = {
  ...scope,
  'ai_metadata.author': { $type: 'string', $ne: '' },
  author: { $type: 'string', $ne: '' },
};

const withAi = await books.countDocuments({ ...scope, 'ai_metadata.author': { $type: 'string', $ne: '' } });
const scopeTotal = await books.countDocuments(scope);

log(`══ books.author vs ai_metadata.author ${INCLUDE_HIDDEN ? '(ALL books)' : '(visible only)'} ══\n`);
log(`  books in scope           : ${scopeTotal.toLocaleString()}`);
log(`  …carrying ai_metadata.author : ${withAi.toLocaleString()} (${(100 * withAi / scopeTotal).toFixed(1)}% — this audit is BLIND to the rest)`);

const classes = {
  placeholder_filled: [],
  undecidable_script: [],
  institutional: [],
  person_vs_person: [],
};

let compared = 0;
let agree = 0;
const cursor = books.find(query, {
  projection: {
    id: 1, title: 1, author: 1, author_id: 1, published: 1, year: 1, visible: 1,
    'ai_metadata.author': 1, 'ai_metadata.confidence': 1, 'ai_metadata.description': 1,
    author_link_provenance: 1, work_id: 1,
  },
});

for await (const b of cursor) {
  compared++;
  const cat = b.author;
  const ai = b.ai_metadata.author;
  if (overlap(cat, ai) > 0) { agree++; continue; }

  const row = {
    id: b.id || b._id.toString(),
    catalogued: cat,
    ai_says: ai,
    author_id: b.author_id ?? null,
    year: b.year ?? b.published ?? null,
    title: String(b.title ?? '').slice(0, 90),
    visible: b.visible === true,
    work_id: b.work_id ?? null,
  };

  if (isPlaceholder(cat)) { classes.placeholder_filled.push(row); continue; }
  if (isUndecidableScript(cat, ai)) { classes.undecidable_script.push(row); continue; }
  if (isInstitutional(cat)) { classes.institutional.push(row); continue; }

  // THE RESIDUE. A catalogued person contradicted by a different page-derived
  // person. Sub-tag the printer dynasties: they are the densest known cohort and
  // the one where a bulk rewrite is most tempting and most dangerous (Paulus
  // Manutius really did write his own Cicero commentaries).
  row.printer_as_author_suspect = PRINTER_HINT.test(cat);
  // A backfill that stamped high confidence on a string enrichment had already
  // contradicted is worth surfacing — it is how a wrong value gets entrenched.
  const anchored = (b.author_link_provenance || []).find((p) => p?.anchored);
  row.anchored_by = anchored ? `${anchored.run}/${anchored.confidence ?? '?'}` : null;
  classes.person_vs_person.push(row);
}

// ───────────────────────────────────────────────────────────────────────────────
// SECOND PASS — annotate the residue with whether the catalogued string is even
// a known person. Done per DISTINCT string (≈40 strings behind ≈250 rows).
//
// This used to be a fifth CLASS that routed suspected #3434 search-strings out of
// the queue, and it was a mistake twice over. A lexical "two capitalised words"
// test swallowed "Robert Fludd", "Alexander Pushkin", "Heinrich Khunrath" and
// "Ulisse Aldrovandi" — real anchored people whose disagreements then went
// unreviewed. Replacing it with author-attribution.mjs's actual signature
// (unanchored AND some book title begins with the string) routed exactly ONE row,
// because "Kircher Magneticum" heads no title — the real work is *Magnes sive de
// arte magnetica*. Both versions cost more than they returned, and silently
// handing a finding to a sibling audit that will not look at it is worse than
// listing it twice. So: annotate, never exclude.
// ───────────────────────────────────────────────────────────────────────────────
const authorsCol = db.collection('authors');
const anchorCache = new Map();
for (const s of new Set(classes.person_vs_person.map((r) => r.catalogued))) {
  const n = norm(s);
  const doc = await authorsCol.findOne({
    $and: [
      { $or: [{ canonical_name: s }, { variants: s }, { _id: n.replace(/ /g, '-') }] },
      { $or: [{ viaf_id: { $nin: [null, ''] } }, { wikidata_id: { $nin: [null, ''] } }] },
    ],
  }, { projection: { _id: 1 } });
  anchorCache.set(s, Boolean(doc));
}
for (const r of classes.person_vs_person) {
  // No authority record behind the catalogued name — it may not name a person at
  // all. Cross-reference #3434 / author-attribution.mjs when triaging these.
  r.unanchored_string = anchorCache.get(r.catalogued) === false;
}

for (const rows of Object.values(classes)) {
  rows.sort((x, y) => String(x.catalogued).localeCompare(String(y.catalogued)));
}

// ───────────────────────────────────────────────────────────────────────────────
const DESCRIPTIONS = {
  placeholder_filled: 'catalogued as a placeholder; the AI SUPPLIED a name — an opportunity, not a defect',
  undecidable_script: 'a non-Latin name on one or both sides — the Latin-token metric cannot judge these',
  institutional: 'corporate/collection heading — belongs with the is_person work (#3483), not a byline fix',
  person_vs_person: 'REVIEW QUEUE: a catalogued person contradicted by a different page-derived person',
};

const disagree = Object.values(classes).reduce((s, r) => s + r.length, 0);
const residue = classes.person_vs_person;

if (JSON_OUT) {
  console.log(JSON.stringify({
    scope: INCLUDE_HIDDEN ? 'all' : 'visible',
    scope_total: scopeTotal,
    with_ai_author: withAi,
    compared,
    agree,
    disagree,
    counts: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.length])),
    classes: ONLY_CLASS ? { [ONLY_CLASS]: classes[ONLY_CLASS] ?? [] } : classes,
  }, null, 2));
} else {
  log(`  compared                 : ${compared.toLocaleString()}`);
  log(`  agree (shared token)     : ${agree.toLocaleString()}`);
  log(`  disagree                 : ${disagree.toLocaleString()} (${(100 * disagree / compared).toFixed(1)}%)\n`);

  for (const [name, rows] of Object.entries(classes)) {
    if (ONLY_CLASS && name !== ONLY_CLASS) continue;
    log(`\n══ ${name} — ${rows.length} ══`);
    log(`   ${DESCRIPTIONS[name]}\n`);
    if (!rows.length) { log('   (none)'); continue; }

    const byCat = new Map();
    for (const r of rows) byCat.set(r.catalogued, (byCat.get(r.catalogued) || 0) + 1);
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    log('   top catalogued strings:');
    for (const [k, v] of top) log(`     ${String(v).padStart(4)}  ${k.slice(0, 70)}`);

    const show = name === 'person_vs_person' ? rows : rows.slice(0, 6);
    log(`\n   ${name === 'person_vs_person' ? 'full queue' : 'sample'}:`);
    for (const r of show) {
      const flags = [
        r.printer_as_author_suspect ? 'PRINTER?' : null,
        r.unanchored_string ? 'no-authority-record' : null,
        r.anchored_by ? `anchored:${r.anchored_by}` : null,
      ].filter(Boolean).join(' ');
      log(`     ${r.id}  ${String(r.year ?? '----').slice(0, 4)}  ${String(r.catalogued).slice(0, 34).padEnd(34)} → ${String(r.ai_says).slice(0, 30).padEnd(30)} ${flags}`);
      log(`        ${r.title}`);
    }
  }

  log('\n\n══ SUMMARY ══');
  for (const [name, rows] of Object.entries(classes)) log(`  ${name.padEnd(22)} : ${rows.length}`);
  log(`\n  ${residue.length === 0
    ? 'CLEAN — no unexplained person-vs-person disagreement'
    : `${residue.length} to review. Verify each against the TITLE PAGE before writing anything — `
      + 'a printer can author his own commentary, and enrichment is not an authority.'}`);
  log('\n  Never bulk-apply this queue. Key each fix on the book id you actually verified');
  log('  (.claude/docs/invariants/author-identity.md).');
}

await mc.close();
process.exit(residue.length === 0 ? 0 : 1);
