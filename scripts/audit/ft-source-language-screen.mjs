/**
 * ft-source-language-screen.mjs — is the SOURCE already English? (#3524, #3459)
 *
 * WHY THIS EXISTS AS A STANDING SWEEP
 * -----------------------------------
 * A first-translation candidate is any non-English book with no prior found. The
 * cheapest way for that default to be flatly wrong is for the book to be in
 * English already — and `books.language` cannot tell you, because it records the
 * language of the WORK, not of the pages we hold. Ganguli's *Mahābhārata* and
 * Avalon's *Serpent Power* are catalogued Sanskrit and are English editions;
 * Boehme's *Works* (1781) is catalogued Latin and is English. 55 such books were
 * badged "first English translation" of a book already in English (#3524).
 *
 * `ft-translation-queue.mjs` already screens for this, but only over the head of
 * the queue and it persists nothing — so every consumer re-derives it, or (more
 * often) doesn't. This sweep runs the same detector across the whole candidate
 * pool and WRITES THE VERDICT DOWN, so the screen is a fact about the book rather
 * than a step someone has to remember.
 *
 * WHAT IT WRITES
 *   books.source_language_screen = {
 *     verdict: 'english_source' | 'foreign_source' | 'undetermined',
 *     basis, english_share|mean, pages_judged, screened_at, code_version
 *   }
 *
 * It writes NOTHING ELSE. It does not touch `is_first_translation`, `language`,
 * or `visible` — a screen that also flips flags is how one writer ends up
 * clobbering another (CLAUDE.md, the FT single-writer rule). Consumers read the
 * field; the reconcile stays the only flag writer.
 *
 * COST: zero. Reads stored OCR text, no model calls.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/ft-source-language-screen.mjs                 # dry run, prints the report
 *   node scripts/audit/ft-source-language-screen.mjs --apply         # persist verdicts
 *   node scripts/audit/ft-source-language-screen.mjs --apply --all   # include hidden/unpaginated
 *   node scripts/audit/ft-source-language-screen.mjs --rescreen      # ignore existing verdicts
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { withMongo } from '../lib/mongo.mjs';
import { classifySourceLanguage, samplePagesForLanguage } from '../lib/english-source-detect.mjs';

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const RESCREEN = process.argv.includes('--rescreen');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0);

const ENGLISH_LANGS = ['English', 'english', 'en', 'eng'];
const OUT_DIR = path.join(process.cwd(), 'scripts/output');

/**
 * Pin the code that produced a verdict. A screening threshold is a judgement, and
 * a stored judgement whose code is unknown cannot be re-derived or disputed.
 *
 * `rev-parse HEAD` ALONE IS NOT ENOUGH, and getting this wrong cost a run: the
 * first sweep was launched, then the detector was fixed while it was in flight.
 * Node had already loaded the module, so 500 books were written by the old code —
 * stamped with the same HEAD the fixed run would stamp, because the fix was
 * uncommitted. Two different judgements, one version string, no way to tell them
 * apart afterwards.
 *
 * So: refuse to write when the working tree is dirty. `--allow-dirty` marks the
 * stamp `<sha>-dirty+<hash-of-detector>` instead, which at least distinguishes
 * two dirty states from each other.
 */
const ALLOW_DIRTY = process.argv.includes('--allow-dirty');
let CODE_VERSION = 'unknown';
let DIRTY = false;
try {
  CODE_VERSION = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  DIRTY = execSync('git status --porcelain -- scripts/lib/english-source-detect.mjs scripts/audit/ft-source-language-screen.mjs',
    { encoding: 'utf8' }).trim().length > 0;
  if (DIRTY) {
    const h = createHash('sha256')
      .update(fs.readFileSync(new URL('../lib/english-source-detect.mjs', import.meta.url)))
      .digest('hex').slice(0, 8);
    CODE_VERSION = `${CODE_VERSION}-dirty+${h}`;
  }
} catch { /* not a repo */ }

await withMongo(async (db) => {
  const books = db.collection('books');
  const pages = db.collection('pages');

  const q = { language: { $nin: ENGLISH_LANGS } };
  if (!ALL) { q.visible = true; q.pages_count = { $gt: 0 }; }
  if (!RESCREEN) q.source_language_screen = { $exists: false };

  const total = await books.countDocuments(q);
  console.log(`Source-language screen — ${total.toLocaleString()} book(s) to screen`);
  console.log(`  scope: ${ALL ? 'ALL books' : 'visible + paginated'}${RESCREEN ? ', re-screening existing verdicts' : ''}`);
  console.log(`  mode:  ${APPLY ? 'APPLY (writes books.source_language_screen)' : 'DRY RUN'}`);
  console.log(`  code:  ${CODE_VERSION}\n`);

  if (APPLY && DIRTY && !ALLOW_DIRTY) {
    console.error('REFUSING TO WRITE — the detector or this script has uncommitted changes.');
    console.error('A stored verdict must name the exact code that produced it. Commit first,');
    console.error('or pass --allow-dirty to stamp a content hash instead.');
    process.exitCode = 1;
    return;
  }

  const cursor = books.find(q, {
    projection: { id: 1, title: 1, language: 1, pages_count: 1, is_first_translation: 1 },
    // A long paced sweep outlives the default 10-minute cursor lifetime. This is
    // the failure that killed the demote packet after 31 of 33 works, having
    // written nothing.
    noCursorTimeout: true,
  });

  const tally = { english_source: 0, foreign_source: 0, undetermined: 0, no_ocr: 0 };
  const englishHits = [];
  let seen = 0;
  let writes = 0;
  const ops = [];

  for await (const b of cursor) {
    if (LIMIT && seen >= LIMIT) break;
    seen++;
    const { texts, available } = await samplePagesForLanguage(pages, b.id);
    // "We could not ask" is not "we asked and found nothing." A book with no OCR
    // is unscreenable, not undetermined — collapsing the two turns an unasked
    // question into a finding, which is the standing failure mode in this area.
    const v = available === 0
      ? { verdict: 'no_ocr', basis: 'no_ocr_pages', pages_judged: 0 }
      : { ...classifySourceLanguage(texts), pages_available: available };
    tally[v.verdict] = (tally[v.verdict] || 0) + 1;

    if (v.verdict === 'english_source') {
      englishHits.push({
        id: b.id, title: b.title, language: b.language,
        pages_count: b.pages_count, badged: !!b.is_first_translation,
        basis: v.basis, english_share: v.english_share ?? null, mean: v.mean ?? null,
        pages_judged: v.pages_judged,
      });
    }

    if (APPLY) {
      ops.push({
        updateOne: {
          filter: { id: b.id },
          update: { $set: { source_language_screen: { ...v, screened_at: new Date(), code_version: CODE_VERSION } } },
        },
      });
      if (ops.length >= 500) { const r = await books.bulkWrite(ops); writes += r.modifiedCount; ops.length = 0; }
    }
    if (seen % 500 === 0) console.log(`  …${seen.toLocaleString()}/${total.toLocaleString()}  english=${tally.english_source} foreign=${tally.foreign_source} undet=${tally.undetermined} no_ocr=${tally.no_ocr}`);
  }
  if (APPLY && ops.length) { const r = await books.bulkWrite(ops); writes += r.modifiedCount; }

  console.log(`\n─── Screened ${seen.toLocaleString()} book(s) ───`);
  console.log(`  english_source : ${tally.english_source.toLocaleString()}  ← catalogued foreign, pages are English`);
  console.log(`  foreign_source : ${tally.foreign_source.toLocaleString()}`);
  console.log(`  undetermined   : ${tally.undetermined.toLocaleString()}  ← OCR'd but not judgeable; NOT excluded`);
  console.log(`  no_ocr         : ${tally.no_ocr.toLocaleString()}  ← unscreenable, not a finding; NOT excluded`);
  if (APPLY) console.log(`  written        : ${writes.toLocaleString()} book(s) updated`);

  const badgedEnglish = englishHits.filter((h) => h.badged);
  console.log(`\n─── Already-English books currently BADGED as a first English translation: ${badgedEnglish.length} ───`);
  for (const h of badgedEnglish.slice(0, 40)) {
    console.log(`  ${String(h.language).padEnd(12)}${String(h.pages_count ?? 0).padStart(6)}pp  ${(h.title || '').slice(0, 56).padEnd(58)}${h.basis}`);
  }
  if (badgedEnglish.length > 40) console.log(`  …and ${badgedEnglish.length - 40} more`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `ft-source-language-screen-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify({
    screened_at: new Date().toISOString(),
    code_version: CODE_VERSION,
    scope: ALL ? 'all' : 'visible+paginated',
    applied: APPLY,
    counts: { ...tally, screened: seen },
    english_source: englishHits,
  }, null, 2));
  console.log(`\nReport: ${out}`);
  if (!APPLY) console.log('Dry run — nothing written. Re-run with --apply to persist.');
},
/**
 * `noTimeout` is REQUIRED, not a tuning choice.
 *
 * `withMongo` kills the process after 300s to stop zombie scripts. This sweep
 * makes two `pages` queries per book across ~17,000 books and runs the better
 * part of an hour, so the default watchdog fires mid-run. It has now done so
 * twice — at 2,000 books on a laptop, then at 5,500 on the Hetzner box — with
 * `[mongo] Script timeout after 300s — forcing exit`. Same failure that killed
 * the demote packet at 31 of 33 works (CLAUDE.md, "Long paced runs need
 * noTimeout").
 *
 * The run is resumable, since the driving query skips books that already carry a
 * verdict, so a watchdog kill loses wall-clock rather than work. That is not a
 * reason to tolerate it: a partial sweep reports partial counts and says nothing
 * about being partial, which is how a 12%-complete screen gets read as a result.
 */
{ noTimeout: true });
