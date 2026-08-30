#!/usr/bin/env node
/**
 * Imprint reconciliation: where a book's place and printer disagree with itself.
 *
 * THE PROBLEM (issue #3969 is about columns; this is about VALUES)
 *   `field-sprawl.mjs` finds one concept spread across N fields. Merging those
 *   columns is mechanical only while the columns AGREE. Measured 2026-08-18:
 *
 *     place_of_publication  5,449 books      written by the OCR + EFM passes
 *     place_published       4,161 books      written by older imports
 *     publication_place     1,032 books      written by the BPH/USTC catalogue pass
 *     place                     1 book       stray
 *     printer               1,019 books      catalogue name-forms ("Aa, Pieter (I) van der")
 *     publisher            15,042 books      TWO populations: name-forms AND raw imprint strings
 *
 *   2,533 books carry two or more place fields. Only 1,634 agree once case,
 *   diacritics and catalogue apparatus are normalised. Of 916 books holding
 *   both printer fields, 151 agree.
 *
 *   A consolidation that picks a field wins or loses those books silently, and
 *   a facet built over the un-merged fields would publish the disagreement to
 *   readers. So the merge needs an adjudication rule first, and the rule needs
 *   to be measured before it is written.
 *
 *   The residue is NOT all conflict. Of the 539 place pairs that share no
 *   tokens, ~10% are a no-place marker against a city (`s.l. (Germany)` vs
 *   `Danzig`) and ≥40% are the same city in two languages (`Roma`/`Rome`,
 *   `Nürnberg`/`Nuremberg`). Reporting the raw bucket as a review queue would
 *   send someone to adjudicate Rome against Roma, so classifyConflict() splits
 *   those out: for place the human queue is 472, not 740.
 *
 * WHAT THIS REPORTS
 *   1. Coverage and overlap for every field in the family.
 *   2. Agreement rate under a comparison normalisation (case, punctuation,
 *      diacritics, and the bracketed apparatus catalogues use for fictitious
 *      imprints: `"Amsterdam" [= Hannover]`).
 *   3. Conflicts bucketed by SHAPE, because the shape decides who can resolve
 *      it: containment ("Basel" vs "Basileae, apud Petrum Pernam") is
 *      mechanical; two different cities is not.
 *   4. Those shapes rolled into the three tiers of who can resolve them —
 *      mechanically, with an authority file, or only by a person.
 *
 * NORMALISATION IS FOR COMPARISON ONLY, NEVER FOR STORAGE. `"Amsterdam"
 * [= Hannover]` is not noise — it is a catalogue's statement that the imprint
 * lies. Flattening it into "Amsterdam" would destroy the more interesting fact.
 *
 * READ-ONLY. Writes nothing, ever.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/imprint-reconciliation.mjs
 *   node --env-file=.env.production.local scripts/audit/imprint-reconciliation.mjs --json out.json
 *   node --env-file=.env.production.local scripts/audit/imprint-reconciliation.mjs --examples 12
 */
import fs from 'fs';
import { MongoClient } from 'mongodb';

const argv = process.argv.slice(2);
const argVal = (flag) => {
  const i = argv.indexOf(flag);
  return i > -1 ? argv[i + 1] : null;
};
const JSON_OUT = argVal('--json');
const EXAMPLES = Number(argVal('--examples') || 6);

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'bookstore';

/**
 * The family, ordered by provenance strength — strongest first.
 *
 * This order was a hypothesis: a value a human catalogue asserted beats one a
 * model read off a title page, which beats one an importer copied from provider
 * metadata. **As a MERGE rule it is now falsified**, and in the destructive
 * direction: on 53 books the catalogue field holds `s.l. (Germany)` (a true
 * statement that the title page names no place) while the import field holds a
 * real city — Danzig, Prague, Frankfurt, Amsterdam, Eichstätt. Catalogue-wins
 * overwrites the city with "unknown". The same field elsewhere holds plainly
 * established values (`Roma`, `Strasbourg`), so the value's ROLE is not a
 * property of the column: read the value's own shape instead. The order below
 * is kept because it still ranks how much to TRUST a value, not which one wins.
 * `writer` names the script that populates each field, because the provenance
 * layer cannot answer it reliably yet: `books.field_provenance` is on 69,778
 * books, but written by 81 independent writers in 164 key shapes, only 23.7%
 * of which name the script that wrote them (#3471). Do NOT read the standalone
 * `field_provenance` COLLECTION for this — it holds 58 rows in a different
 * shape, and measuring it instead of the embedded field is how one session
 * concluded the layer was never populated. See
 * .claude/docs/invariants/field-sprawl.md.
 */
const PLACE_FIELDS = [
  { field: 'publication_place', writer: 'enrichment/enrich-from-catalogs.mjs (BPH + USTC)', tier: 'catalogue' },
  { field: 'place_of_publication', writer: 'enrichment/extract-publisher-from-ocr.mjs, enrich-efm-from-bph.mjs', tier: 'ocr/mixed' },
  { field: 'place_published', writer: 'older imports (no current writer in scripts/)', tier: 'import' },
  { field: 'place', writer: 'unknown — 1 document', tier: 'stray' },
];

const PRINTER_FIELDS = [
  { field: 'printer', writer: 'enrichment/enrich-from-catalogs.mjs (BPH + USTC)', tier: 'catalogue' },
  { field: 'publisher', writer: 'imports + extract-publisher-from-ocr.mjs', tier: 'import/ocr' },
];

/** Comparison-only normalisation. See the header: never write this back. */
function normalise(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')       // strip diacritics
    .replace(/\[[^\]]*\]/g, ' ')            // drop catalogue apparatus: [= Hannover], [Netherlands]
    .replace(/["'“”‘’]/g, ' ')              // quoted fictitious imprints
    .replace(/[.,;:()]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bibliographic markers for "the book itself states none" — `s.l.` (sine loco),
 * `n.p.`, `z.p.` (zonder plaats), `o.O.` (ohne Ort) for place; `s.n.` (sine
 * nomine) for printer. These are not values and must never be adjudicated
 * against one as though two sources disagreed. A catalogue writing
 * `s.l. (Germany)` asserts that the title page is silent, which is perfectly
 * compatible with an importer knowing the city from elsewhere.
 */
const NO_VALUE_STATED = /^(n\s*p|s\s*l|z\s*p|s\s*d|s\s*n|sine loco|sine nomine|zonder plaats|ohne ort|no place|unknown)\b/;

/** Levenshtein distance. Cheap at city-name lengths. */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Bucket a disagreement by the shape that decides who can resolve it.
 *
 * "Shares no tokens" is a verdict about STRINGS. Reported raw it overstates the
 * bibliographic conflict about twofold, because two of its populations are not
 * conflicts at all — a no-value-stated marker against a real value, and the same
 * value in two languages or spellings (Roma/Rome, Nürnberg/Nuremberg). Splitting
 * those out is what keeps the review queue honest: only `different-value` needs
 * a person, and even that is a CEILING — the edit-distance test misses wider
 * exonym pairs (Venezia/Venice), which land in `different-value` rather than
 * `variant-form`. Erring that way is deliberate: a variant wrongly queued costs
 * a reviewer a moment, a real conflict wrongly auto-merged costs a book its
 * imprint.
 */
function classifyConflict(a, b) {
  const na = normalise(a);
  const nb = normalise(b);
  if (!na || !nb) return 'one-side-empty-after-normalising';
  if (na === nb) return 'agree-after-normalising';
  if (na.includes(nb) || nb.includes(na)) return 'containment';       // "basel" vs "basileae apud petrum pernam"
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  const shared = [...ta].filter((t) => tb.has(t) && t.length > 2);
  if (shared.length) return 'partial-token-overlap';

  // Tested against the normalised form, where `s.l.` has become `s l`. A
  // BRACKETED marker (`[n.p.]`) never reaches here: normalise() strips `[...]`,
  // so it exits above as one-side-empty — which is the right destination, since
  // a bracketed hedge is conjectural and wants a person either way.
  if (NO_VALUE_STATED.test(na) || NO_VALUE_STATED.test(nb)) return 'no-value-stated-marker';
  if (editDistance(na, nb) <= Math.max(2, Math.floor(Math.max(na.length, nb.length) * 0.45))) {
    return 'variant-form';
  }
  return 'different-value';
}

async function main() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set. Run with --env-file=.env.production.local');
    process.exit(2);
  }
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const books = client.db(MONGODB_DB).collection('books');

  const report = { measured_at: new Date().toISOString(), place: {}, printer: {} };

  for (const [label, spec] of [['place', PLACE_FIELDS], ['printer', PRINTER_FIELDS]]) {
    const names = spec.map((s) => s.field);
    const present = (f) => ({ [f]: { $exists: true, $nin: [null, ''] } });

    const coverage = {};
    for (const s of spec) {
      coverage[s.field] = {
        total: await books.countDocuments(present(s.field)),
        visible: await books.countDocuments({ visible: true, ...present(s.field) }),
        writer: s.writer,
        tier: s.tier,
      };
    }

    const cursor = books.find(
      { $or: names.map(present) },
      { projection: { title: 1, ...Object.fromEntries(names.map((n) => [n, 1])) } }
    );

    const buckets = {};
    const examples = {};
    let multi = 0;
    let single = 0;
    let mechanical = 0;
    let needsAuthorityFile = 0;
    let needsJudgement = 0;

    // Increasing severity — the worst pair a book holds decides its bucket.
    const RANK = [
      'agree-after-normalising',
      'containment',
      'variant-form',
      'no-value-stated-marker',
      'partial-token-overlap',
      'different-value',
      'one-side-empty-after-normalising',
    ];

    for await (const doc of cursor) {
      const held = names.filter((n) => typeof doc[n] === 'string' && doc[n].trim() !== '');
      if (held.length < 2) { single++; continue; }
      multi++;

      // Compare every pair the book actually holds, keep the worst shape.
      let worst = 'agree-after-normalising';
      let worstPair = null;
      for (let i = 0; i < held.length; i++) {
        for (let j = i + 1; j < held.length; j++) {
          const shape = classifyConflict(doc[held[i]], doc[held[j]]);
          if (RANK.indexOf(shape) > RANK.indexOf(worst)) {
            worst = shape;
            worstPair = [held[i], held[j]];
          }
        }
      }
      buckets[worst] = (buckets[worst] || 0) + 1;

      // Who can resolve this, in three tiers.
      //
      // Note what is NOT here: a tier-precedence rule. Catalogue-beats-OCR-beats-
      // import is falsified in the destructive direction by no-place-marker-vs-
      // city, where the catalogue field holds `s.l. (Germany)` and the import
      // field holds `Danzig`. Precedence would overwrite the city with "unknown".
      // Resolution has to read the VALUE's shape, not the column it sits in.
      if (worst === 'agree-after-normalising' || worst === 'containment') mechanical++;
      else if (worst === 'variant-form' || worst === 'no-value-stated-marker') needsAuthorityFile++;
      else needsJudgement++;

      if (!examples[worst]) examples[worst] = [];
      if (examples[worst].length < EXAMPLES && worstPair) {
        examples[worst].push({
          book_id: String(doc._id),
          title: (doc.title || '').slice(0, 70),
          [worstPair[0]]: doc[worstPair[0]],
          [worstPair[1]]: doc[worstPair[1]],
        });
      }
    }

    report[label] = {
      coverage,
      books_with_one_field: single,
      books_with_multiple_fields: multi,
      conflict_shapes: buckets,
      resolvable_mechanically: mechanical,
      resolvable_with_an_authority_file: needsAuthorityFile,
      needs_human_judgement: needsJudgement,
      examples,
    };
  }

  // ---- print ----------------------------------------------------------
  for (const label of ['place', 'printer']) {
    const r = report[label];
    console.log(`\n=== ${label.toUpperCase()} ===`);
    for (const [f, c] of Object.entries(r.coverage)) {
      console.log(`  ${f.padEnd(24)} ${String(c.total).padStart(7)} total  ${String(c.visible).padStart(7)} visible   [${c.tier}] ${c.writer}`);
    }
    console.log(`  books carrying exactly one of these fields : ${r.books_with_one_field}`);
    console.log(`  books carrying two or more                 : ${r.books_with_multiple_fields}`);
    console.log('  disagreement shape (worst pair per book):');
    for (const [shape, n] of Object.entries(r.conflict_shapes).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${shape.padEnd(34)} ${n}`);
    }
    console.log(`  resolvable mechanically                    : ${r.resolvable_mechanically}`);
    console.log(`  resolvable with an authority file         : ${r.resolvable_with_an_authority_file}  (variant forms, no-value-stated markers)`);
    console.log(`  needs a human                              : ${r.needs_human_judgement}  (ceiling — still holds missed exonyms)`);
    for (const [shape, rows] of Object.entries(r.examples)) {
      if (shape === 'agree-after-normalising' || !rows.length) continue;
      console.log(`\n  -- ${shape} --`);
      for (const row of rows) {
        const { book_id, title, ...vals } = row;
        console.log(`     ${title}`);
        for (const [k, v] of Object.entries(vals)) console.log(`       ${k}: ${v}`);
      }
    }
  }

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
    console.log(`\nJSON written to ${JSON_OUT}`);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
