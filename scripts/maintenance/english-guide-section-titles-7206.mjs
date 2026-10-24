#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/lib/summary-prompt.mjs + scripts/batch/batch-generate-indexes.mjs write
 *   `book_indexes.sectionSummaries` and since PR #7208 ask for an English `title` (printed heading in
 *   `titleOriginal`), but only for guides generated from now on. scripts/maintenance/resynthesize-summaries.mjs
 *   regenerates whole summaries (a full paid re-read of the book); scripts/maintenance/cleanup-artwork-titles.mjs
 *   is artwork titles. Nothing translates only the section titles of guides that already exist.
 *
 * english-guide-section-titles-7206 — English section titles for existing reading guides (#7206).
 *
 * WHY. On non-English books the reading guide's Sections list shows the printed headings ("Vorwort &
 * Stellung der Aufgabe") over English summaries; a foreign-word heuristic counted ~2,400 of 17,721 visible
 * non-English books. Readers of `title`: the book page Sections list (ExpandableGuide), book-embedding-text.
 *
 * TWO STAGES, so what is applied is exactly what was looked at:
 *   propose  flash-lite translates each candidate book's titles; writes <out>.jsonl. NO database writes.
 *     node --env-file=.env.production.local scripts/maintenance/english-guide-section-titles-7206.mjs propose --out=F [--limit=N] [--concurrency=8]
 *   apply    reads <in>.jsonl; per book, logs to sweep_log FIRST, then sets title = English and
 *            titleOriginal = the old title on each changed section, conditional on the old title still
 *            being there (a regenerated guide is skipped, not clobbered). Dry run unless --apply.
 *     node --env-file=.env.production.local scripts/maintenance/english-guide-section-titles-7206.mjs apply --in=F [--apply]
 *
 * Candidates: visible books with pages, language not English, whose guide has ≥ half its section titles
 * matching FOREIGN (stopwords / accented letters) and no section already carrying `titleOriginal`.
 * Undo: sweep_log rows (sweep 'guide-section-titles-en-7206') hold every old title; set title back from
 * titleOriginal and unset it.
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { callGemini } from '../lib/gemini-script-client.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const SWEEP = 'guide-section-titles-en-7206';
const MODEL = 'gemini-3.1-flash-lite';
const FOREIGN = /\b(der|die|das|und|von|des|den|dem|zur|zum|über|de|et|la|le|les|du|del|della|il|lo|cum|ad|libri|liber|caput|capitulum|vom|ein|eine|y|los|las|pars|het|een|van|en)\b|[äöüßñçàèéìòùâêîôûæœ]/i;

const args = Object.fromEntries(process.argv.slice(3).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const stage = process.argv[2];
if (!['propose', 'apply'].includes(stage)) { console.error('usage: propose --out=F | apply --in=F [--apply]'); process.exit(1); }

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

function prompt(book, titles) {
  return `You are translating the section headings of a reading guide for an English-speaking reader.
Book: "${book.title}" (${book.language}).
Below is a JSON array of ${titles.length} section titles. Return ONLY a JSON array of the same length, in the same order, where each item is the title in plain English.
- Translate titles that are in another language (Latin, German, French, etc.). Keep proper names as names.
- If a title is already English, return it unchanged.
- Keep any "&" or ":" structure. No quotation marks around items, no notes.
${JSON.stringify(titles)}`;
}

function parseArray(text, n) {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const a = JSON.parse(m[0]);
    return Array.isArray(a) && a.length === n && a.every((x) => typeof x === 'string' && x.trim()) ? a.map((x) => x.trim()) : null;
  } catch { return null; }
}

if (stage === 'propose') {
  const out = args.out; if (!out) throw new Error('--out required');
  const done = new Set(existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).book_id) : []);
  const books = await db.collection('books').find(
    { visible: true, pages_count: { $gt: 0 }, language: { $nin: ['English', null, ''] } },
    { projection: { _id: 0, id: 1, title: 1, language: 1 } },
  ).toArray();
  const byId = new Map(books.map((b) => [b.id, b]));
  const cands = [];
  for await (const d of db.collection('book_indexes').find({ 'sectionSummaries.0': { $exists: true } }, { projection: { _id: 0, book_id: 1, 'sectionSummaries.title': 1, 'sectionSummaries.titleOriginal': 1 } })) {
    const b = byId.get(d.book_id);
    if (!b || done.has(d.book_id)) continue;
    const s = d.sectionSummaries;
    if (s.some((x) => x.titleOriginal)) continue;
    const titles = s.map((x) => x.title || '');
    if (titles.filter((t) => FOREIGN.test(t)).length / titles.length < 0.5) continue;
    cands.push({ book: b, titles });
  }
  const limit = args.limit ? Number(args.limit) : cands.length;
  const todo = cands.slice(0, limit);
  console.log(`candidates ${cands.length} (already proposed ${done.size}); proposing ${todo.length}`);
  let i = 0, ok = 0, bad = 0, inTok = 0, outTok = 0;
  const conc = Number(args.concurrency || 8);
  await Promise.all(Array.from({ length: conc }, async () => {
    while (i < todo.length) {
      const { book, titles } = todo[i++];
      try {
        const r = await callGemini({ model: MODEL, prompt: prompt(book, titles), endpoint: 'scripts/maintenance/english-guide-section-titles-7206', type: 'enrichment', bookId: book.id, maxOutputTokens: 2000 });
        inTok += r.inputTokens; outTok += r.outputTokens;
        const en = parseArray(r.text, titles.length);
        if (!en) { bad++; continue; }
        appendFileSync(out, JSON.stringify({ book_id: book.id, language: book.language, book_title: book.title, old: titles, en }) + '\n');
        ok++;
      } catch (e) { bad++; console.warn(book.id, e.message); }
      if ((ok + bad) % 100 === 0) console.log(`${ok + bad}/${todo.length} ok=${ok} bad=${bad}`);
    }
  }));
  console.log(`done ok=${ok} unparsed/failed=${bad} tokens in=${inTok} out=${outTok}`);
}

if (stage === 'apply') {
  const rows = readFileSync(args.in, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const APPLY = args.apply === true;
  let books = 0, sections = 0, skipped = 0;
  for (const r of rows) {
    const changes = r.old.map((t, i) => ({ i, from: t, to: r.en[i] })).filter((c) => c.to !== c.from);
    if (!changes.length) continue;
    const filter = { book_id: r.book_id };
    for (const c of changes) filter[`sectionSummaries.${c.i}.title`] = c.from;
    if (!APPLY) { books++; sections += changes.length; continue; }
    const current = await db.collection('book_indexes').countDocuments(filter);
    if (!current) { skipped++; continue; }
    await recordSweepAction(db, { sweep: SWEEP, book_id: r.book_id, action: 'section-titles-to-english', detail: { model: MODEL, changes, issue: 7206 } });
    const set = {};
    for (const c of changes) { set[`sectionSummaries.${c.i}.title`] = c.to; set[`sectionSummaries.${c.i}.titleOriginal`] = c.from; }
    const res = await db.collection('book_indexes').updateOne(filter, { $set: set });
    if (res.modifiedCount === 1) { books++; sections += changes.length; } else skipped++;
  }
  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'}: books ${books}, sections ${sections}, skipped (guide changed since propose) ${skipped}`);
}

await client.close();
