/**
 * ft-translator-as-author-screen.mjs — is this book ITSELF a published English
 * translation we re-hosted? (#3524, #3459)
 *
 * WHY THIS EXISTS ALONGSIDE THE SOURCE-LANGUAGE SCREEN
 * ---------------------------------------------------
 * `ft-source-language-screen.mjs` asks whether the pages we hold are English. It
 * catches Ganguli's *Mahābhārata* and Avalon's *Serpent Power*. It CANNOT catch a
 * BILINGUAL edition — Legge's *Chinese Classics*, the Loeb library, Sacred Books
 * of the East — because the Chinese or Greek is right there on the page and the
 * book screens, correctly, as a foreign source. Verified 2026-08-01: Legge's
 * *Works of Mencius* screens `foreign_source` and is nonetheless Legge's own
 * published English translation of 1893.
 *
 * That is the contamination mode unique to the PROMOTE direction, and it is why
 * the June 2026 promote census held 5 books rather than badging them (Duyvendak's
 * *Book of Lord Shang* is the canonical example). Left unscreened, a re-hosted
 * published translation becomes a "first English translation" of itself.
 *
 * THE SIGNAL: `books.author` is a person who appears as a TRANSLATOR in the
 * translation catalogue. Free, no model calls.
 *
 * WHY IT ONLY HOLDS, NEVER EXCLUDES
 * ---------------------------------
 * The signal is real and noisy, and the noise is structural rather than fixable:
 *   - A translator is often also an author. Joscelyn Godwin translates AND writes;
 *     Franz Hartmann wrote in German and translated.
 *   - A name match is not a person match. "Swedenborg, Emanuel" matched on a
 *     French edition of Swedenborg — he appears as a translator on some other row.
 *   - A book being a translation does not defeat the claim unless it is a
 *     translation INTO ENGLISH. A 1782 German rendering of Fludd does not.
 * So this writes a HOLD with its evidence attached and a human decides. Measured
 * on the live candidate pool the list is ~93 books, of which ~23 are badged —
 * reviewable in an afternoon, which is the point. §17: never derive a destructive
 * flag from an unverified match.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/ft-translator-as-author-screen.mjs             # dry run + review list
 *   node scripts/audit/ft-translator-as-author-screen.mjs --apply     # persist holds
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { withMongo } from '../lib/mongo.mjs';

const APPLY = process.argv.includes('--apply');
const ALLOW_DIRTY = process.argv.includes('--allow-dirty');
const ENGLISH_LANGS = ['English', 'english', 'en', 'eng'];
const OUT_DIR = path.join(process.cwd(), 'scripts/output');

/** Placeholder "translators" that are not people and must never seed the index. */
const NON_PERSON_TRANSLATOR = /^(various|anonymous|unknown|n\.?a\.?|editor|the editors|multiple|s\.?n\.?)$/i;

let CODE_VERSION = 'unknown';
let DIRTY = false;
try {
  CODE_VERSION = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  DIRTY = execSync('git status --porcelain -- scripts/audit/ft-translator-as-author-screen.mjs',
    { encoding: 'utf8' }).trim().length > 0;
  if (DIRTY) {
    const h = createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex').slice(0, 8);
    CODE_VERSION = `${CODE_VERSION}-dirty+${h}`;
  }
} catch { /* not a repo */ }

/** Lowercase, drop life dates, parentheticals and punctuation. */
export function normalizeName(s) {
  return String(s || '').toLowerCase()
    .replace(/\d{3,4}\s*-\s*\d{0,4}/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[.,;:'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Both orderings of a name, because catalogues store "Surname, First" and our
 * `books.author` is frequently "First Surname".
 *
 * Requires two tokens: a bare surname is a collision waiting to happen, and this
 * screen exists to reduce review load, not to generate it.
 */
export function nameVariants(s) {
  const n = normalizeName(s);
  if (!n || NON_PERSON_TRANSLATOR.test(n)) return [];
  const out = new Set([n]);
  const m = n.match(/^([^,]+),\s*(.+)$/);
  if (m) out.add(`${m[2]} ${m[1]}`.replace(/\s+/g, ' ').trim());
  return [...out].filter((x) => x.split(' ').length >= 2 && x.length > 5);
}

/**
 * An explicit TRANSLATOR self-declaration in the author field — "(trans.)".
 *
 * ⚠️ `(ed.)` MUST NOT BE HERE, and including it was the first version of this
 * screen. An editor of a critical edition edits the ORIGINAL: Dillmann's *Biblia
 * Veteris Testamenti Aethiopica* is the Ge'ez text, Heiberg's *Euclidis Opera
 * Omnia* is the Greek, Diels' *Fragmente der Vorsokratiker* is the Greek. Those
 * are the most ordinary books in this corpus and every one of them is a
 * legitimate first-translation candidate. Conflating the two roles produced 337
 * spurious holds out of 430 — a screen that flags the normal case is worse than
 * no screen, because someone has to clear it.
 *
 * Editor is a role in the ORIGINAL language; translator is a role in the TARGET
 * language. Only the second can defeat a first-translation claim.
 */
const EXPLICIT_ROLE_RE = /\(\s*(?:trans(?:l(?:ated|ator))?|tr)\.?\s*\)|\btranslated by\b|\btransl\.\s*by\b/i;

await withMongo(async (db) => {
  const books = db.collection('books');

  if (APPLY && DIRTY && !ALLOW_DIRTY) {
    console.error('REFUSING TO WRITE — uncommitted changes to this script. Commit first, or --allow-dirty.');
    process.exitCode = 1;
    return;
  }

  // ── Build the translator index ────────────────────────────────────────────
  const index = new Map(); // normalized variant -> sample catalogue row
  for (const r of await db.collection('translation_catalogs')
    .find({ translator: { $nin: [null, ''] } }, { projection: { translator: 1, english_title: 1, pub_year: 1, source: 1 } })
    .toArray()) {
    for (const v of nameVariants(r.translator)) if (!index.has(v)) index.set(v, r);
  }

  /**
   * Names that are ALSO original authors in the same catalogue.
   *
   * Robert Fludd wrote *Medicina catholica*; Emanuel Swedenborg wrote his own
   * works. Both also appear in some row's translator column, so a bare name match
   * flagged eight Fludd titles and two Swedenborgs as "may be a translation" —
   * pure collision. If the catalogue knows the name as an author of works in its
   * own right, a name match carries no information and the `catalogue_match`
   * basis is withheld. The explicit "(trans.)" declaration is unaffected: that is
   * a statement about THIS book, not about the name.
   */
  const authorNames = new Set();
  for (const r of await db.collection('translation_catalogs')
    .find({ canonical_author: { $nin: [null, ''] } }, { projection: { canonical_author: 1 } })
    .toArray()) {
    for (const v of nameVariants(r.canonical_author)) authorNames.add(v);
  }
  console.log(`Translator index: ${index.size.toLocaleString()} name variants from translation_catalogs`);
  console.log(`Author names withheld from name-matching: ${authorNames.size.toLocaleString()}\n`);

  // ── Screen the candidate pool ─────────────────────────────────────────────
  const pool = await books.find(
    { visible: true, pages_count: { $gt: 0 }, language: { $nin: ENGLISH_LANGS } },
    { projection: { id: 1, title: 1, author: 1, year: 1, language: 1, is_first_translation: 1 } },
  ).toArray();

  const holds = [];
  for (const b of pool) {
    if (!b.author) continue;
    const explicit = EXPLICIT_ROLE_RE.test(b.author);
    const vs = nameVariants(b.author);
    // Withhold a bare name match when the catalogue also knows the name as an
    // author in its own right — see `authorNames` above.
    const match = vs.some((v) => authorNames.has(v)) ? null : vs.find((v) => index.has(v));
    if (!match && !explicit) continue;
    holds.push({
      id: b.id,
      title: b.title,
      author: b.author,
      language: b.language,
      year: b.year ?? null,
      badged: !!b.is_first_translation,
      // Two independent reasons, reported separately: an explicit "(trans.)" in
      // the author field is a self-declaration and far stronger than a name match.
      basis: explicit && match ? 'explicit_role+catalogue_match' : explicit ? 'explicit_role' : 'catalogue_match',
      matched_translator: match ?? null,
      catalogue_example: match ? { title: index.get(match).english_title, year: index.get(match).pub_year, source: index.get(match).source } : null,
    });
  }

  const badged = holds.filter((h) => h.badged);
  console.log(`─── ${holds.length} book(s) HELD for review — may themselves be published translations ───`);
  console.log(`  of those, currently badged as a first English translation: ${badged.length}\n`);
  const byBasis = holds.reduce((a, h) => { a[h.basis] = (a[h.basis] || 0) + 1; return a; }, {});
  console.log('  by basis:', JSON.stringify(byBasis), '\n');

  for (const h of [...badged, ...holds.filter((x) => !x.badged)].slice(0, 45)) {
    console.log(`  ${h.badged ? '[BADGED] ' : '         '}${String(h.language).slice(0, 14).padEnd(16)}${String(h.year || '').padEnd(6)}`
      + `${(h.author || '').slice(0, 26).padEnd(28)}${(h.title || '').slice(0, 44).padEnd(46)}${h.basis}`);
  }
  if (holds.length > 45) console.log(`  …and ${holds.length - 45} more in the JSON`);

  if (APPLY) {
    const ops = holds.map((h) => ({
      updateOne: {
        filter: { id: h.id },
        update: {
          $set: {
            translator_author_screen: {
              verdict: 'hold',
              basis: h.basis,
              matched_translator: h.matched_translator,
              catalogue_example: h.catalogue_example,
              screened_at: new Date(),
              code_version: CODE_VERSION,
            },
          },
        },
      },
    }));
    if (ops.length) {
      const r = await books.bulkWrite(ops);
      console.log(`\nWritten: ${r.modifiedCount} hold(s). NOTE: a hold is a review request, not an exclusion —`);
      console.log('nothing downstream may treat it as a verdict, and no flag was touched.');
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `ft-translator-as-author-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify({
    screened_at: new Date().toISOString(),
    code_version: CODE_VERSION,
    applied: APPLY,
    pool_size: pool.length,
    index_size: index.size,
    counts: { held: holds.length, held_and_badged: badged.length, by_basis: byBasis },
    holds,
  }, null, 2));
  console.log(`\nReview list: ${out}`);
  if (!APPLY) console.log('Dry run — nothing written.');
});
