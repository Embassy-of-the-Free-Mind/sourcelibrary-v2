#!/usr/bin/env node
/**
 * #4390 — 12,542 live books with non-Latin titles are dark to English search.
 * `english_title` is indexed (boost 8 in buildBookSearchStage) and ~5% populated.
 *
 * This fills ONLY the free residue: books whose own `title` already carries an
 * English gloss inline, in a shape strict enough to promote mechanically:
 *
 *     儒林外史(二十) — The Scholars, vol 20
 *     御定駢字類編·卷十二 — Imperial Parallel Characters (vol 11)
 *
 * It does NOT generate anything. Per #4390 a model-driven backfill is a
 * budgeted decision and is not authorised.
 *
 * WHY THE RULE IS SO NARROW — measured, not cautious by default. A looser
 * "Latin-script tail after a dash" rule matched 612 books and was wrong in both
 * directions:
 *   - it captured AUTHORS and editorial notes as titles. "Al-Munqidh min
 *     al-Dalal (المنقذ من الضلال) — Abu Hamid al-Ghazali (Arabic spiritual
 *     autobiography)" would have filed al-Ghazali's own NAME as the book's
 *     English title, and "Genji Monogatari, Vol. IV — Murasaki Shikibu; ed.
 *     Takekasa (Yuhodo, Tokyo 1928)" would have filed an imprint.
 *   - and it captured a CONTAINER: "皇極經世書·卷一上 (Book of Supreme
 *     World-Ordering Principles, juan 1.1) — Siku Quanshu" has its real English
 *     title in the PARENTHESES; the tail is the collectanea it sits in.
 * Trying to exclude those by keyword failed too — a stop-list containing
 * "treatise" refuses "Mathematical Treatise in Nine Sections", which is the
 * correct English title of 數書九章. So the rule tests for a POSITIVE shape
 * (title words + an explicit volume marker) instead of hunting for badness,
 * and everything it cannot prove is reported rather than written.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/fill-english-title-from-inline-gloss-4390.mjs
 *   node --env-file=.env.production.local scripts/maintenance/fill-english-title-from-inline-gloss-4390.mjs --apply
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'node:fs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'english-title-inline-gloss-4390';
const REPORT = 'scripts/output/english-title-4390-report.json';

const NONLATIN = /[Ͱ-ϿЀ-ӿ֐-׿؀-ۿऀ-ॿ一-鿿぀-ヿ가-힯]/;

/**
 * Promote a title's inline English gloss, or return null.
 * Accepted shape: "<original> — <Title Words> (vol N)" / ", vol N" / ", juan N",
 * or a bare "<Title Words>" of 2+ capitalised words with no descriptive noise.
 */
/**
 * Does the tail end in an explicit volume marker — "(vol 12)", ", vol 20"?
 * That is the CADAL ingest's signature, and it is what makes a tail provably a
 * TITLE rather than a fact about the book: nobody writes "Abu Hamid al-Ghazali
 * (vol 3)". Tails without it can still be correct ("Slavonic Philokalia") but
 * cannot be told apart mechanically from "BORI Critical Edition" or a bare
 * author name, so they go to review instead of being written.
 */
export function hasVolumeMarker(tail) {
  return /[(,]\s*(vol\.?|volume|juan|kwon|fasc\.?)\s*[\d.]+\s*\)?$/i.test(String(tail || '').trim());
}

export function inlineGloss(title) {
  const t = String(title || '');
  const m = t.match(/\s+[—–]\s+(.+)$/);          // em/en dash only: a hyphen is
  if (!m) return null;                            // ambiguous inside CJK titles
  const tail = m[1].trim();
  if (!tail || NONLATIN.test(tail)) return null;
  if (!/^[ -~À-ſ’'"]+$/.test(tail)) return null;
  if ((tail.match(/\(/g) || []).length !== (tail.match(/\)/g) || []).length) return null;
  if (/[;]/.test(tail)) return null;              // "author; ed. X" shape

  // Strip a trailing explicit volume marker and judge what is left.
  const body = tail
    .replace(/\s*[(,]\s*(vol\.?|volume|juan|kwon|fasc\.?)\s*[\d.]+\s*\)?$/i, '')
    .trim()
    .replace(/[,]$/, '');
  if (!body) return null;

  // Once the volume marker is stripped, a surviving comma means the tail is a
  // list of facts about the book, not its name: "Shao Yong Neo-Confucian cosmic
  // numerology, Siku Quanshu" is an author, a subject and a collectanea.
  if (body.includes(',')) return null;

  const words = body.match(/[A-Za-zÀ-ſ][A-Za-zÀ-ſ'’-]*/g) || [];
  if (words.length < 2) return null;              // one word is not a title gloss
  if (body.length > 90) return null;              // long tails are descriptions
  if (/\b\d{4}\b/.test(body)) return null;        // a year means edition note
  // A title gloss is Title Case or an ALL-CAPS-free phrase; a description
  // usually opens with a lowercase function word or a place/press name.
  if (!/^[A-Z]/.test(body)) return null;
  return tail;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  const dark = {
    visible: true, pages_count: { $gt: 0 },
    title: { $regex: '[Ͱ-ϿЀ-ӿ֐-׿؀-ۿऀ-ॿ一-鿿぀-ヿ가-힯]' },
    $or: [{ english_title: { $exists: false } }, { english_title: { $in: [null, ''] } }],
  };
  const rows = await books.find(dark).project({ id: 1, title: 1, language: 1, work_id: 1 }).toArray();
  console.log(`dark set (live, non-Latin title, no english_title): ${rows.length}`);

  const fill = [], review = [], skipped = [];
  for (const r of rows) {
    const en = inlineGloss(r.title);
    if (!en) { skipped.push(r); continue; }
    const row = { id: r.id, title: r.title, english_title: en, language: r.language };
    (hasVolumeMarker(en) ? fill : review).push(row);
  }
  console.log(`fillable (gloss + explicit volume marker → written): ${fill.length} (${(100 * fill.length / rows.length).toFixed(1)}%)`);
  console.log(`needs human review (title-shaped, unprovable): ${review.length} — NOT written`);
  console.log(`remaining dark after this sweep: ${skipped.length + review.length}`);

  const works = new Set(skipped.map(r => r.work_id).filter(Boolean));
  console.log(`  …spread over ${works.size} distinct work_ids — that, not the book count, is the unit any future fill should price.`);

  const byLang = new Map();
  for (const f of fill) byLang.set(f.language, (byLang.get(f.language) || 0) + 1);
  console.log('  fill by language:', [...byLang.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(', '));

  console.log('\nsample:');
  const step = Math.max(1, Math.floor(fill.length / 8));
  for (let i = 0; i < fill.length && i / step < 8; i += step) console.log(`  ${fill[i].title}\n     → ${fill[i].english_title}`);

  mkdirSync('scripts/output', { recursive: true });
  writeFileSync(REPORT, JSON.stringify({
    generated_at: new Date().toISOString(),
    dark_total: rows.length,
    fillable: fill.length,
    needs_review: review.length,
    residue: skipped.length,
    residue_distinct_works: works.size,
    fill,
    review,
  }, null, 1));
  console.log(`\nreport → ${REPORT}`);

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); await client.close(); return; }

  let n = 0;
  for (const f of fill) {
    const res = await books.updateOne(
      { id: f.id },
      { $set: { english_title: f.english_title, updated_at: new Date() } }
    );
    if (res.modifiedCount !== 1) { console.error(`  WARN ${f.id} modifiedCount=${res.modifiedCount}`); continue; }
    n++;
    await recordSweepAction(db, {
      sweep: SWEEP, book_id: f.id, action: 'english-title-from-inline-gloss',
      detail: { title: f.title, english_title: f.english_title },
    });
  }
  console.log(`applied: ${n}/${fill.length}`);
  console.log('\nNEXT: node scripts/workers/sync-books-catalog.mjs (books_catalog carries the search fields)');
  await client.close();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('FATAL', e); process.exit(1); });
}
