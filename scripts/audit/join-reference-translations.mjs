#!/usr/bin/env node
/**
 * Join `reference_translations` (149,096 MARC-derived rows, 126,558 with an
 * LCCN) to our books — the largest citable bibliography we hold, currently
 * linked to NOTHING (`book_id` present on 0 rows).
 *
 * WHY (#4525)
 * -----------
 * We assert "a prior English translation exists" for ~10,000 books and can show
 * a translator + year + URL for 3,803. Meanwhile an authoritative catalogue of
 * English translations of non-English originals sits beside the corpus, unjoined.
 * Every match turns an unfalsifiable verdict into a citation; every confident
 * NON-match on a weak-verifier "found" is a candidate first we are suppressing.
 *
 * MATCHING — reuses the tuned logic from `scripts/eval/card-prior-candidates.mjs`
 * ------------------------------------------------------------------------------
 * A naive surname substring match was measured at ~100% FALSE POSITIVES on a
 * 56-card probe ("Ruel" matched *Bar*ruel; "Kircher" matched Unterkircher but
 * never Athanasius). So:
 *   1. Surname EQUALITY, not a substring. NOTE: `author_surname` carries an
 *      INDEX but is populated on ZERO rows — an index on a field that does not
 *      exist. Querying it returns a flat zero that looks like "no matches".
 *      So the surname is derived from `author` here, and the script asserts a
 *      non-zero candidate pool before trusting any result.
 *   2. `original_languages` must contain the book's source language — the
 *      catalogue records what the item was translated FROM, and a Latin book
 *      cannot be evidenced by a translation from Russian.
 *   3. Score on MARC `uniform_title` (the library world's own work identifier)
 *      or title, by token overlap weighted to cover OUR title.
 *   4. A year sanity check: a translation published before the source edition
 *      is not evidence about it.
 *
 * MARC writes inverted order ("Kircher, Athanasius"); our books write natural
 * order. Taking the FIRST token anchors on the given name and matches nothing —
 * that exact bug produced a flat zero across 115 cards before a positive control
 * found it. Hence surnameOf() takes the LAST token unless already inverted.
 *
 * NEVER WRITES. Emits a review file. Linking a citation to a public claim is a
 * separate, reviewed decision.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/join-reference-translations.mjs \
 *     [--limit N] [--min-score 0.5] [--out scripts/output/rt-join.jsonl] [--sample]
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const LIMIT = Number(arg('--limit', 0)) || 0;
const MIN_SCORE = Number(arg('--min-score', 0.5));
const OUT = arg('--out', 'scripts/output/rt-join.jsonl');
const SAMPLE = process.argv.includes('--sample');

/** books.language -> MARC ISO 639-2 codes seen in original_languages. */
const LANG = {
  Latin: ['lat'], German: ['ger'], French: ['fre'], Italian: ['ita'], Spanish: ['spa'],
  Dutch: ['dut'], Greek: ['grc', 'gre'], 'Ancient Greek': ['grc'], Russian: ['rus'],
  Hebrew: ['heb'], Arabic: ['ara'], Chinese: ['chi'], Japanese: ['jpn'], Korean: ['kor'],
  Sanskrit: ['san'], Portuguese: ['por'], Polish: ['pol'], Swedish: ['swe'], Danish: ['dan'],
  Czech: ['cze'], Hungarian: ['hun'], Persian: ['per'], Turkish: ['tur'], Syriac: ['syr'],
  Armenian: ['arm'], Tibetan: ['tib'], Norwegian: ['nor'], Catalan: ['cat'], Romanian: ['rum'],
};

function surnameOf(rawAuthor) {
  const a = String(rawAuthor || '').split('|')[0].replace(/[;.,\s]+$/, '').trim();
  if (!a) return '';
  if (a.includes(',')) return a.split(',')[0].trim();
  const parts = a.split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || '';
}
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
/**
 * Function words in EVERY language this corpus holds, not just English. A
 * 13-match spot-check produced exactly two false positives and both were German
 * function words carrying the whole score: Nietzsche's `Der Wille zur Macht`
 * matched `Zur Genealogie der Moral` on {der, zur}, and Schelling's
 * `Philosophie der Kunst` matched `Zur Geschichte der neueren Philosophie` the
 * same way. An English-only stoplist scoring non-English titles is a silent
 * precision leak.
 */
const STOP = new Set([
  // English
  'the', 'a', 'an', 'of', 'and', 'or', 'on', 'in', 'to', 'for', 'with', 'book', 'books',
  // German
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'zur', 'zum', 'von',
  'vom', 'und', 'uber', 'aus', 'bei', 'nach', 'auf',
  // French
  'de', 'du', 'la', 'le', 'les', 'des', 'sur', 'aux', 'une', 'dans', 'par', 'pour', 'et',
  // Italian / Spanish
  'el', 'il', 'lo', 'gli', 'della', 'delle', 'degli', 'nel', 'con', 'por', 'para',
  // Latin
  'ad', 'ex', 'cum', 'sive', 'seu', 'per', 'pro', 'liber', 'libri', 'libro', 'opera',
  'omnia', 'tomus', 'pars', 'vol', 'volumen',
]);
const tokens = (s) => norm(s).split(' ').filter((t) => t.length > 2 && !STOP.has(t));
/**
 * When MARC gives a `uniform_title` it IS the work identifier, so trust it and
 * do not let the translated English title rescue a mismatch — that is how a
 * Wille-zur-Macht book matched a Genealogie-der-Moral record. Fall back to the
 * row title only when no uniform_title exists (32.4% of rows).
 */
function titleScore(ourTitle, rowUniform, rowTitle) {
  const a = new Set(tokens(ourTitle));
  if (!a.size) return 0;
  // A SINGLE shared content word on a short title reads as 0.5 and is usually
  // noise: `Philosophie der Kunst` vs `Zur Geschichte der neueren Philosophie`
  // overlap only on {philosophie}. Require two matching tokens whenever our
  // title has two to give.
  const cover = (t) => {
    const b = new Set(tokens(t));
    if (!b.size) return 0;
    let hit = 0; for (const x of a) if (b.has(x)) hit++;
    if (hit < 2 && a.size >= 2) return 0;
    return hit / a.size;
  };
  const u = String(rowUniform || '').trim();
  return u ? cover(u) : cover(rowTitle);
}
const yearOf = (s) => { const m = String(s || '').match(/\b(1[0-9]{3}|20[0-2][0-9])\b/); return m ? Number(m[1]) : null; };

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const rt = db.collection('reference_translations');

// One full read, indexed in memory by surname. 16,151 anchored-regex queries
// over 149K unindexed rows is the slow, flaky shape that timed out; the whole
// collection is ~50MB and fits comfortably.
console.log('loading reference_translations…');
const bySurname = new Map();
let loaded = 0;
for await (const r of rt.find({}, { projection: { _id: 0, lccn: 1, author: 1, title: 1, uniform_title: 1, year: 1, publisher: 1, original_languages: 1, source: 1 } })) {
  loaded++;
  const sn = norm(surnameOf(r.author));
  if (sn.length < 4) continue;
  let arr = bySurname.get(sn);
  if (!arr) { arr = []; bySurname.set(sn, arr); }
  arr.push(r);
}
console.log(`loaded ${loaded} rows, ${bySurname.size} distinct surnames`);
if (!bySurname.size) { console.error('FATAL: empty surname index — refusing to report zero matches as a finding'); process.exit(2); }

const EN = ['English', 'english', 'en', 'eng'];
let pool = await db.collection('books').find(
  { visible: true, pages_count: { $gt: 0 }, language: { $nin: [...EN, null] }, pages_translated: { $gt: 0 } },
  { projection: { id: 1, title: 1, author: 1, language: 1, published: 1, is_first_translation: 1 } },
).toArray();
if (SAMPLE) { let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  pool = pool.map((b) => ({ b, k: rnd() })).sort((a, z) => a.k - z.k).map((x) => x.b); }
if (LIMIT) pool = pool.slice(0, LIMIT);
console.log(`books to probe: ${pool.length}\n`);

const out = [];
let probed = 0, withCand = 0, noSurname = 0, noLangMap = 0;
for (const b of pool) {
  const surname = surnameOf(b.author);
  if (surname.length < 4) { noSurname++; continue; }
  const codes = LANG[String(b.language || '').trim()];
  if (!codes) { noLangMap++; continue; }
  probed++;
  const cand = bySurname.get(norm(surname)) || [];
  const rows = cand.filter((r) => (r.original_languages || []).some((l) => codes.includes(l)));
  if (!rows.length) continue;
  const ourYear = yearOf(b.published);
  const scored = rows
    .map((r) => ({ r, score: titleScore(b.title, r.uniform_title, r.title) }))
    .filter((x) => x.score >= MIN_SCORE)
    // a translation printed before our source edition is not evidence about it
    .filter((x) => { const y = yearOf(x.r.year); return !(ourYear && y && y < ourYear - 5); })
    .sort((a, z) => z.score - a.score)
    .slice(0, 5);
  if (!scored.length) continue;
  withCand++;
  out.push({
    book_id: String(b.id), title: b.title, author: b.author, language: b.language,
    published: b.published, badged: b.is_first_translation === true,
    candidates: scored.map(({ r, score }) => ({
      score: Number(score.toFixed(2)), lccn: r.lccn, year: r.year,
      marc_author: r.author, title: r.title, uniform_title: r.uniform_title || null,
      publisher: r.publisher, source: r.source,
    })),
  });
}
console.log(`probed ${probed} books (skipped: ${noSurname} no usable surname, ${noLangMap} unmapped language)`);
console.log(`books with >=1 candidate at score >= ${MIN_SCORE}: ${withCand} (${((100 * withCand) / (probed || 1)).toFixed(1)}%)`);
const badgedHit = out.filter((o) => o.badged).length;
console.log(`  of those, currently BADGED a first translation: ${badgedHit}  <- each is a badge to re-examine`);
writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
console.log(`\nwrote ${OUT} (${out.length} rows) — REVIEW FILE, nothing written to the database`);
await c.close();
