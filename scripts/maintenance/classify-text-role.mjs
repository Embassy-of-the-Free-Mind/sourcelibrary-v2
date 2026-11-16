#!/usr/bin/env node
/**
 * Classify every visible book's `text_role` — the foundational field for
 * distinguishing original-language SOURCES from (often modern) TRANSLATIONS,
 * so render/search gates can prefer the original + our own translation rather
 * than surfacing e.g. Jowett's 1875 Plato or Evans-Wentz's Tibetan Book of the
 * Dead as the primary text. See issue #2395.
 *
 * text_role values:
 *   original            — original-language source (any non-English scan, or a
 *                         genuine English-native work like Bacon/Cudworth/More)
 *   period-translation  — historical translation, pre-~1700 (kept as artifact)
 *   modern-translation  — ~18th c.+ translation standing in for an original.
 *                         Loeb/SBE facing-page editions count here too (per
 *                         Derek, 2026-06-03): even though the original is in the
 *                         same scan, we present it as a translation.
 *
 * Heuristic, English-language books only (the actionable set). Marked
 * `text_role_source: 'heuristic-v1'` so it's clearly auto-derived and must be
 * human-QA'd before any gate goes live (issue #2395 acceptance criteria).
 * Also records `original_in_scan: true` for Loeb/facing-page so the gate knows
 * the original text is already present.
 *
 * KEEP THE classify() HEURISTIC IN SYNC with src/lib/text-role.ts
 * `classifyTextRole()`, which runs the same logic at import time so new books
 * are classified on insert. This script is the catch-all sweep for import paths
 * that bypass that hook (the direct-insert scripts) and for re-classifying after
 * metadata enrichment (e.g. once `year` lands). Run `--only-missing` from a cron
 * to keep the tail classified.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/classify-text-role.mjs --dry-run
 *   node scripts/maintenance/classify-text-role.mjs                    # live write, all visible books
 *   node scripts/maintenance/classify-text-role.mjs --only-missing     # only books with no text_role (cron-friendly)
 *   node scripts/maintenance/classify-text-role.mjs --limit=50 --dry-run
 *   node scripts/maintenance/classify-text-role.mjs --dry-run --diff=$JOB_SCRATCH/diff.jsonl  # review every CHANGE
 *   node scripts/maintenance/classify-text-role.mjs --non-english --dry-run --diff=…   # the #3957 set only
 *   --allow-demote   also write translation -> original flips (held by default)
 *   --ids=<file>     only these book ids (one per line, # comments) — apply a
 *                    reviewed subset of a dry-run diff (#3957: 638 proposed, a
 *                    reviewed subset written, the rest held)
 *   --sweep=<name>   sweep_log name for this run (kebab-case); default
 *                    classify-text-role-<date>. Name the run you may revert.
 *   --revert=<name>  restore every book that run changed, from its sweep_log
 *                    rows, where the book still holds what the run wrote.
 *                    Honours --dry-run.
 *
 * Only rows whose current role came from a heuristic (or that have none) are
 * touched; human / curated / explicit roles are skipped and counted. Only rows
 * whose role actually CHANGES are written, with `updated_at` bumped (so the
 * Supabase books_catalog mirror picks them up) and one sweep_log row each that
 * records the previous value — that row is the backup. #3957.
 */

import { MongoClient } from 'mongodb';
import { createWriteStream } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { recordSweepActions } from '../lib/sweep-log.mjs';

// Sources this sweep may overwrite: its own output and the import-time twin.
// Anything else (manual-qa, human-qa-*, curated-*, manual-*, a driver's explicit
// role) is a judgement the heuristic cannot see — never clobber it. #3957.
const HEURISTIC_SOURCES = new Set(['heuristic-v1', 'import-heuristic-v1']);
export function isOverwritable(b) {
  if (!b.text_role) return true;
  return HEURISTIC_SOURCES.has(b.text_role_source);
}

const enLike = v => !v || /^(english|en)$/i.test(String(v).trim());

// Strong translation signals on an English-language scan.
const TRANS_TITLE = /transl|englished|rendered into english|done into english|made english|from the (greek|latin|hebrew|arabic|sanskrit|german|french|italian|chinese|tibetan|persian|coptic|aramaic|syriac)|\bloeb\b|sacred books of the east/i;
const TRANS_AUTHOR = /\btr(ans)?\.?\b|translated by|;\s*tr\b/i;
// Classical / non-English-original authors: an English edition attributed to
// them is by definition a translation.
const CLASSICAL = /\b(plato|aristotle|plotinus|proclus|iamblichus|porphyry|plutarch|pythagoras|ptolemy|galen|hippocrates|homer|hesiod|sophocles|euripides|aeschylus|epictetus|marcus aurelius|sextus empiricus|philo|origen|cicero|seneca|virgil|ovid|lucretius|apuleius|boethius|aquinas|avicenna|averroes|al-biruni|al-kindi|maimonides|hermes trismegistus|laozi|lao tzu|confucius|zhuangzi|mencius|xunzi|patanjali|shankara|kabir|rumi|hafiz|sa'di|nagarjuna|padmasambhava)\b/i;
const LOEB = /\b(loeb|sacred books of the east)\b/i;
// Translator signals in a NON-English record (#3957) — copied verbatim from
// src/lib/text-role.ts; see the comment there for why TRANS_TITLE/CLASSICAL and
// original_language are not used on non-English scans. `\b` is ASCII-only in
// JS, hence the letter-aware lookarounds.
const wordRe = body => new RegExp(`(?<!\\p{L})(?:${body})(?!\\p{L})`, 'iu');
const TRANS_AUTHOR_INTL = wordRe(String.raw`tr(ans)?\.?|translated by|traduct(eur|rice|or|ora)|übers\.|übersetz\p{L}*|translator|vertaler|interprete`);
const TRANS_TITLE_INTL = wordRe(String.raw`tradui(t|te|ts|tes)|traduction|translat[ée]e?s?|mise?s? en fran[cç]o?[iy]s|übersetzt|übersetzung|verdeutscht|verteutscht|verdolmetscht|ins deutsche|in das deutsche|tradott[oaie]|traduzione|volgarizzat[oaie]|traducid[oa]s?|traducci[oó]n|traduzid[oa]s?|tradu[cç][aã]o|vertaald|vertaling|interprete|latin[eo] (redditu[sm]|reddit[ai]|versu[sm]|vers[ai]|conversu[sm]|convers[ai]|donatu[sm]|donat[ai])|in latinum (sermonem )?(conversu[sm]|convers[ai]|translatu[sm]|translat[ai]|versu[sm]|vers[ai])|(e|ex) (graec|arabic|hebrai?c)[oa] (in latinum|latine|convers|translat|vers)`);

// First 4-digit year found across the candidate fields, or NaN. Mirrors
// coerceYear() in src/lib/text-role.ts — keep in sync.
function coerceYear(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    if (typeof v === 'number' && v > 0) return v;
    const m = String(v).match(/\d{4}/);
    if (m) return Number(m[0]);
  }
  return NaN;
}

export function classify(book) {
  // Explicit translation hint wins over the language proxy below (which assumes
  // every non-English scan is an original). Mirrors classifyTextRole() in
  // src/lib/text-role.ts — keep in sync. #2395.
  if (book.is_translation === true) {
    const yr = coerceYear(book.year, book.published, book.original_work_year);
    const role = yr && yr > 0 && yr < 1700 ? 'period-translation' : 'modern-translation';
    return { role, loeb: false };
  }

  // Non-English scan → an original-language source, UNLESS the record names a
  // translator (#3957). Mirrors classifyTextRole() — keep in sync.
  if (!enLike(book.language)) {
    const t = book.title || '';
    const a = book.author || '';
    const sig = TRANS_AUTHOR_INTL.test(a) || TRANS_TITLE_INTL.test(t);
    // Loeb/SBE is a modern translation whatever `language` says — as above.
    if (LOEB.test(t) || LOEB.test(a)) return { role: 'modern-translation', loeb: true };
    if (!sig) return { role: 'original', loeb: false };
    const yr = coerceYear(book.year, book.published, book.original_work_year);
    return { role: yr && yr > 0 && yr < 1700 ? 'period-translation' : 'modern-translation', loeb: false };
  }

  const t = book.title || '';
  const a = book.author || '';
  const sigOrig = book.original_language && !enLike(book.original_language);
  const sigTitle = TRANS_TITLE.test(t);
  const sigAuth = TRANS_AUTHOR.test(a);
  const sigClassical = CLASSICAL.test(a) || CLASSICAL.test(t);
  const loeb = LOEB.test(t) || LOEB.test(a);

  if (!(sigOrig || sigTitle || sigAuth || sigClassical)) {
    // English book with no translation signal → treat as English-native original.
    return { role: 'original', loeb: false };
  }
  // It's a translation. Loeb always counts as modern (original co-present but
  // presented as translation). Otherwise split by era.
  if (loeb) return { role: 'modern-translation', loeb: true };
  const yr = coerceYear(book.year, book.published, book.original_work_year);
  if (yr && yr > 0 && yr < 1700) return { role: 'period-translation', loeb: false };
  return { role: 'modern-translation', loeb: false };
}

// Parse an --ids file: one book id per line; blank lines and # comments ignored.
export function parseIdList(text) {
  return [...new Set(String(text).split('\n').map(l => l.replace(/#.*/, '').trim()).filter(Boolean))];
}

// The $set that restores a book from one of this script's sweep_log rows, or
// null when the book no longer holds what the run wrote (a person or a later
// run has touched it since — never clobber that).
export function revertUpdate(book, detail) {
  if (!book || !detail) return null;
  const toSource = detail.to_source ?? 'heuristic-v1';
  if (book.text_role !== detail.to || book.text_role_source !== toSource) return null;
  const $set = { updated_at: new Date() };
  const $unset = {};
  if (detail.from == null) $unset.text_role = ''; else $set.text_role = detail.from;
  if (detail.from_source == null) $unset.text_role_source = ''; else $set.text_role_source = detail.from_source;
  return Object.keys($unset).length ? { $set, $unset } : { $set };
}

async function revert(db, sweep, dryRun) {
  const rows = await db.collection('sweep_log').find({ sweep, action: 'text-role-reclassified' }).toArray();
  const books = db.collection('books');
  let restored = 0, skipped = 0;
  const logRows = [];
  for (const r of rows) {
    const b = await books.findOne({ id: r.book_id }, { projection: { _id: 0, id: 1, text_role: 1, text_role_source: 1 } });
    const update = revertUpdate(b, r.detail);
    if (!update) { skipped++; console.log(`  skip ${r.book_id}: now ${b?.text_role} (${b?.text_role_source})`); continue; }
    if (dryRun) { restored++; continue; }
    // Log first, then write: a crash between the two leaves a log row and no
    // change, never a change with no record.
    await db.collection('sweep_log').insertOne({ timestamp: new Date(), sweep: `${sweep}-revert`, book_id: r.book_id, action: 'text-role-revert', detail: { from: b.text_role, from_source: b.text_role_source, to: r.detail.from ?? null, to_source: r.detail.from_source ?? null }, script: 'classify-text-role.mjs' });
    const res = await books.updateOne({ id: r.book_id, text_role: b.text_role, text_role_source: b.text_role_source }, update);
    restored += res.modifiedCount;
  }
  console.log(`${dryRun ? '[DRY RUN] ' : ''}revert ${sweep}: ${rows.length} logged changes, ${restored} restored, ${skipped} skipped (changed since)`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlyMissing = args.includes('--only-missing');
  // --non-english: only non-English scans — the #3957 re-classification, kept
  // apart from any drift on English rows so its diff can be reviewed alone.
  const nonEnglish = args.includes('--non-english');
  // A translation role is never demoted to 'original' unless asked: hand fixes
  // have been stamped with a heuristic source (69b1cae4…, #8570), so the source
  // alone cannot protect them, and this sweep exists to ADD missed translation
  // labels (#3957). Demotions are counted and printed so a person can look.
  const allowDemote = args.includes('--allow-demote');
  const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);
  const arg = name => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const idsPath = arg('ids');
  const ids = idsPath ? parseIdList((await import('node:fs')).readFileSync(idsPath, 'utf8')) : null;
  if (ids && !ids.length) { console.error(`--ids=${idsPath}: no ids`); process.exit(1); }

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set. Run with: set -a; source .env.production.local; set +a');
    process.exit(1);
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const col = db.collection('books');

  const revertSweep = arg('revert');
  if (revertSweep) { await revert(db, revertSweep, dryRun); await client.close(); return; }

  // --only-missing: classify just the books that have no text_role yet (the
  // import tail). Default: re-classify all visible books.
  const query = onlyMissing
    ? { visible: true, text_role: { $exists: false } }
    : { visible: true };
  if (nonEnglish) query.language = { $nin: [null, '', 'English', 'english', 'en', 'EN'] };
  if (ids) query.id = { $in: ids };
  const cursor = col.find(
    query,
    { projection: { _id: 0, id: 1, title: 1, author: 1, year: 1, published: 1, original_work_year: 1, language: 1, original_language: 1, is_translation: 1, text_role: 1, text_role_source: 1, original_in_scan: 1, read_count: 1 } },
  ).batchSize(1000);

  const diffPath = args.find(a => a.startsWith('--diff='))?.split('=').slice(1).join('=');
  const diffOut = diffPath ? createWriteStream(diffPath) : null;
  const dist = { original: 0, 'period-translation': 0, 'modern-translation': 0 };
  const transitions = {};
  let loebCount = 0, processed = 0, written = 0, unchanged = 0;
  const samples = { 'period-translation': [], 'modern-translation': [] };
  const ops = [];
  const logRows = [];
  const sweep = arg('sweep') || `classify-text-role-${new Date().toISOString().slice(0, 10)}`;
  const seen = new Set();

  let skippedProtected = 0, skippedDemote = 0;
  const demoteSamples = [];
  const flush = async () => {
    if (dryRun || !ops.length) return;
    // The sweep_log row is the backup: write it BEFORE the change it records.
    await recordSweepActions(db, logRows);
    const r = await col.bulkWrite(ops); written += r.modifiedCount;
    ops.length = 0; logRows.length = 0;
  };
  for await (const b of cursor) {
    if (limit && processed >= limit) break;
    processed++;
    seen.add(b.id);
    // Never clobber a human-QA'd / curated / explicit label — the heuristic
    // can't see what a person verified.
    if (!isOverwritable(b)) { skippedProtected++; continue; }
    const { role, loeb } = classify(b);
    dist[role]++;
    if (loeb) loebCount++;
    if (role !== 'original' && samples[role].length < 8) {
      samples[role].push(`${b.read_count || 0}rd ${b.year || '?'} — ${(b.title || '').slice(0, 44)} (${(b.author || '').slice(0, 22)})${loeb ? ' [Loeb]' : ''}`);
    }
    const sameRole = b.text_role === role && (!loeb || b.original_in_scan === true);
    if (sameRole) { unchanged++; continue; }
    if (!allowDemote && role === 'original' && b.text_role && b.text_role !== 'original') {
      skippedDemote++;
      if (demoteSamples.length < 20) demoteSamples.push(`${b.id} ${b.text_role} (${b.text_role_source}) — ${b.language} ${b.year || '?'} — ${(b.title || '').slice(0, 60)}`);
      continue;
    }
    const key = `${b.text_role || '(none)'} -> ${role}`;
    transitions[key] = (transitions[key] || 0) + 1;
    diffOut?.write(JSON.stringify({ id: b.id, language: b.language, year: b.year ?? b.published ?? null, title: b.title, author: b.author, from: b.text_role ?? null, from_source: b.text_role_source ?? null, to: role, loeb }) + '\n');
    const set = { text_role: role, text_role_source: 'heuristic-v1', updated_at: new Date() };
    if (loeb) set.original_in_scan = true;
    ops.push({ updateOne: { filter: { id: b.id }, update: { $set: set } } });
    logRows.push({ sweep, book_id: b.id, action: 'text-role-reclassified', detail: { from: b.text_role ?? null, from_source: b.text_role_source ?? null, to: role, to_source: 'heuristic-v1', loeb } });
    if (ops.length >= 1000) await flush();
  }
  await flush();
  if (diffOut) await new Promise(r => diffOut.end(r));

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Processed ${processed} visible books`);
  console.log(`  original:            ${dist.original}`);
  console.log(`  period-translation:  ${dist['period-translation']}`);
  console.log(`  modern-translation:  ${dist['modern-translation']} (incl. ${loebCount} Loeb/SBE)`);
  console.log(`  skipped (protected): ${skippedProtected}  (role not from a heuristic)`);
  console.log(`  unchanged:           ${unchanged}`);
  console.log(`  demotions held:      ${skippedDemote}${allowDemote ? '' : '  (translation -> original; --allow-demote to write)'}`);
  demoteSamples.forEach(s => console.log('     ', s));
  console.log(`  changes:             ${JSON.stringify(transitions)}`);
  if (diffPath) console.log(`  diff:                ${diffPath}`);
  if (!dryRun) console.log(`  modifiedCount:       ${written}`);
  if (ids) {
    const missing = ids.filter(id => !seen.has(id));
    console.log(`  --ids:               ${ids.length} listed, ${seen.size} found${missing.length ? `, NOT FOUND (or not visible / not matching): ${missing.join(' ')}` : ''}`);
  }
  if (!dryRun) console.log(`  sweep_log:           ${sweep}  (revert: --revert=${sweep})`);
  console.log('\nperiod-translation samples:'); samples['period-translation'].forEach(s => console.log('  ', s));
  console.log('\nmodern-translation samples:'); samples['modern-translation'].forEach(s => console.log('  ', s));

  await client.close();
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1); });
}
