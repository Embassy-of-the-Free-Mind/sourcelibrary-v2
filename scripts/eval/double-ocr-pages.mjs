#!/usr/bin/env node
/**
 * WHICH PAGES HAVE ACTUALLY BEEN OCR'd TWICE? (#3473)
 *
 * The inventory, not the metric. `revision-agreement-corpus.mjs` answers "how much
 * do the two passes agree"; this answers the prior question that everything else
 * assumes — which pages genuinely carry two or more independent model reads OF THE
 * SAME LEAF, and are therefore eligible to be compared at all.
 *
 * `page_revisions` overstates it in three distinct ways, and each looks identical
 * to a real double read from inside the row:
 *
 *   1. TEXT THAT WAS MOVED, NOT READ. The #3357 e-rara off-by-one repair relocated
 *      existing `ocr` subdocuments between pages; the revision it snapshotted is
 *      the neighbouring leaf's text. 56,413 ocr rows across 323 books. Sampled,
 *      95%+ match the CURRENT text of the adjacent page byte-for-byte. One read,
 *      two page ids.
 *   2. AN IMAGE SWAP WITH NO LABEL (#3368 leaf offset, re-archiving). Caught only
 *      by the printed `<page-num>`, which the model transcribes off the leaf itself.
 *   3. A HUMAN EDIT. A real second look, but not a second OCR pass, and it must not
 *      sit in a corpus used to characterise what the models do.
 *
 * The filters are in `scripts/lib/revision-pairs.mjs` so no consumer can implement
 * half of one. A per-book shift verdict is applied on top: a uniform slide keeps
 * the printed sequence intact, so pairs on unnumbered leaves in a demonstrably
 * shifted book are excluded too — the per-pair check cannot reach them.
 *
 * Free: Mongo reads and local compute, no model calls. No agreement metric here on
 * purpose — one implementation of that lives in `revision-agreement-corpus.mjs`,
 * and duplicating it is how two numbers start disagreeing.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/double-ocr-pages.mjs [--limit=N] [--batch=500] [--write-collection]
 *
 * Long run (165K pages) — launch detached:
 *   nohup node scripts/eval/double-ocr-pages.mjs > /tmp/double-ocr.log 2>&1 &
 *
 * `--field=translation` runs the same inventory over translation revisions, writing
 * `double-translation-pages-*` / Mongo `double_translation_pages`.
 *
 * `--write-collection` additionally upserts each row into Mongo `double_ocr_pages`
 * keyed on page_id, so other jobs can query the dataset instead of parsing JSONL.
 * Upsert only — it never deletes, and a stale row is re-stamped with `run_date`.
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { classifyPair, sourceKind, printedLeaf, bookShiftVerdict } from '../lib/revision-pairs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const LIMIT = args.limit ? parseInt(args.limit) : 0;
const BATCH = parseInt(args.batch || '500');
const WRITE_COLLECTION = !!args['write-collection'];
// The translation side has the SAME defect and a worse share of it: the sweep is
// 55,272 of 134,544 translation revisions (41.1%) against 56,413 of 191,221 on the
// ocr side (29.5%). Nothing consumes translation pairs yet, which is exactly why
// this runs now — the filter should exist before the first study does.
const FIELD = args.field === 'translation' ? 'translation' : 'ocr';
const DATE = args.date || new Date().toISOString().slice(0, 10);
const OUT_DIR = args['out-dir'] || path.join(__dirname, 'results');
const STEM = FIELD === 'ocr' ? 'double-ocr-pages' : 'double-translation-pages';
const OUT_JSONL = path.join(OUT_DIR, `${STEM}-${DATE}.jsonl`);
const TMP_JSONL = `${OUT_JSONL}.pass1`;
const OUT_SUMMARY = path.join(OUT_DIR, `${STEM}-${DATE}.json`);
const OUT_REPORT = path.join(OUT_DIR, `${STEM}-${DATE}.md`);
const COLLECTION = FIELD === 'ocr' ? 'double_ocr_pages' : 'double_translation_pages';
const SITE = 'https://sourcelibrary.org';

const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const REVS = db.collection('page_revisions');
  const PAGES = db.collection('pages');
  const BOOKS = db.collection('books');

  const total = await REVS.countDocuments({ field: FIELD });
  console.log(`page_revisions field:'${FIELD}' → ${total.toLocaleString()} revisions`);

  const out = fs.createWriteStream(TMP_JSONL, { flags: 'w' });
  const bookCache = new Map();
  // Per-book leaf evidence, from NON-sweep pairs only: the question it answers is
  // "did this book's images move underneath its text for some reason other than the
  // labelled repair", so including the repair's own rows would answer itself.
  const bookPairs = new Map();
  const unknownSources = {};
  const reasons = {};
  let revsRead = 0, pagesSeen = 0, pagesEmitted = 0, missingPage = 0, singlePass = 0;
  const t0 = Date.now();

  let batch = [], cur = null;

  const flush = async () => {
    if (!batch.length) return;
    const ids = batch.map(b => b.page_id);
    const pageDocs = await PAGES.find(
      { id: { $in: ids } },
      { projection: { id: 1, book_id: 1, page_number: 1, [`${FIELD}.data`]: 1, [`${FIELD}.model`]: 1, [`${FIELD}.source`]: 1, [`${FIELD}.prompt_version`]: 1, [`${FIELD}.updated_at`]: 1 } },
    ).maxTimeMS(180000).toArray();
    const pageById = new Map(pageDocs.map(p => [p.id, p]));

    const needBooks = [...new Set(batch.map(b => b.revs[0].book_id).filter(id => id && !bookCache.has(id)))];
    if (needBooks.length) {
      const bookDocs = await BOOKS.find(
        { $or: [{ _id: { $in: needBooks } }, { id: { $in: needBooks } }] },
        { projection: { id: 1, slug: 1, language: 1, year: 1, pages_count: 1 } },
      ).maxTimeMS(120000).toArray();
      const found = new Set();
      for (const b of bookDocs) {
        for (const k of [String(b._id), b.id]) if (k && needBooks.includes(k)) { bookCache.set(k, b); found.add(k); }
      }
      for (const k of needBooks) if (!found.has(k)) bookCache.set(k, null);
    }

    for (const entry of batch) {
      pagesSeen++;
      const pg = pageById.get(entry.page_id) || null;
      if (!pg) missingPage++;
      const bookId = entry.revs[0].book_id;
      const bk = bookCache.get(bookId) || null;

      // oldest prior → … → newest prior → live pages.ocr
      const chain = [...entry.revs]
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
        .map(r => ({
          data: r.data, source: r.source ?? null, model: r.model || null,
          prompt: r.prompt_version == null ? null : String(r.prompt_version),
          at: r.created_at || null, original_date: r.original_date || null, live: false,
        }));
      const liveField = pg?.[FIELD];
      if (liveField?.data) {
        chain.push({
          data: liveField.data, source: liveField.source ?? 'live', model: liveField.model || null,
          prompt: liveField.prompt_version == null ? null : String(liveField.prompt_version),
          at: liveField.updated_at || null, original_date: null, live: true,
        });
      }
      for (const c of chain) if (sourceKind(c.source) === 'unknown') inc(unknownSources, String(c.source));
      if (chain.length < 2) { singlePass++; continue; }

      const pairs = [];
      for (let i = 0; i < chain.length - 1; i++) {
        const prior = chain[i], current = chain[i + 1];
        const v = classifyPair({ priorSource: prior.source, priorText: prior.data, currentText: current.data });
        inc(reasons, v.reason);
        pairs.push({
          step: i,
          is_live: current.live,
          prior_source: prior.source,
          source_kind: v.source_kind,
          prior_model: prior.model,
          current_model: current.model,
          prior_prompt: prior.prompt,
          current_prompt: current.prompt,
          printed_prior: v.printed.prior,
          printed_current: v.printed.current,
          leaf: v.leaf,
          usable: v.usable,
          reason: v.reason,
        });
        // Only the two printed numbers, never the texts: this map spans the whole
        // run (a book's pages are scattered through a page_id-ordered scan) and
        // holding page text per pair would be gigabytes.
        if (v.source_kind !== 'text-move' && v.printed.prior != null && v.printed.current != null) {
          if (!bookPairs.has(bookId)) bookPairs.set(bookId, []);
          bookPairs.get(bookId).push({ printedPrior: v.printed.prior, printedCurrent: v.printed.current });
        }
      }

      out.write(JSON.stringify({
        page_id: entry.page_id,
        book_id: bookId,
        book_slug: bk?.slug || null,
        page_number: pg?.page_number ?? null,
        language: bk?.language || null,
        year: typeof bk?.year === 'number' ? bk.year : null,
        page_missing: !pg,
        url: bk?.slug ? `${SITE}/book/${bk.slug}/page/${entry.page_id}` : null,
        stored_revisions: entry.revs.length,
        passes: chain.length,
        pass_chain: chain.map(c => ({
          source: c.source, source_kind: sourceKind(c.source), model: c.model, prompt: c.prompt,
          at: c.at, printed: printedLeaf(c.data), chars: (c.data || '').length, live: c.live,
        })),
        pairs,
      }) + '\n');
      pagesEmitted++;
    }
    batch = [];
  };

  const cursor = REVS.find(
    { field: FIELD, data: { $type: 'string', $ne: '' } },
    { projection: { page_id: 1, book_id: 1, data: 1, model: 1, prompt_version: 1, source: 1, created_at: 1, original_date: 1 } },
  ).sort({ page_id: 1, created_at: -1 }).batchSize(500);

  for await (const rv of cursor) {
    revsRead++;
    if (!cur || cur.page_id !== rv.page_id) {
      if (cur) batch.push(cur);
      cur = { page_id: rv.page_id, revs: [] };
      if (batch.length >= BATCH) await flush();
    }
    cur.revs.push(rv);
    if (revsRead % 20000 === 0) {
      const rate = revsRead / ((Date.now() - t0) / 1000);
      console.log(`  ${revsRead.toLocaleString()}/${total.toLocaleString()} revisions · ${pagesEmitted.toLocaleString()} pages · ${rate.toFixed(0)}/s`);
    }
    if (LIMIT && revsRead >= LIMIT) break;
  }
  if (cur) batch.push(cur);
  await flush();
  await new Promise(r => out.end(r));

  // ── pass 2: apply the per-book shift verdict ───────────────────────
  // Held to a second pass because the cursor is ordered by page_id: a book's pairs
  // are not contiguous, so its verdict is only complete once every page is read.
  const verdicts = new Map();
  for (const [bookId, prs] of bookPairs) verdicts.set(bookId, bookShiftVerdict(prs));
  bookPairs.clear();

  const finalOut = fs.createWriteStream(OUT_JSONL, { flags: 'w' });
  const rl = readline.createInterface({ input: fs.createReadStream(TMP_JSONL), crlfDelay: Infinity });
  const stats = {
    pages: 0, double_ocr_pages: 0, pages_only_sweep: 0, usable_pairs: 0,
    by_reads: {}, by_language: {}, by_leaf_evidence: {}, by_model_pair: {},
    books_shifted: 0, books_clean: 0, books_insufficient: 0,
    demoted_by_book_verdict: 0,
  };
  const mongoOps = [];
  const COL = db.collection(COLLECTION);
  for await (const line of rl) {
    if (!line) continue;
    const row = JSON.parse(line);
    const bv = verdicts.get(row.book_id) || { verdict: 'insufficient', verified: 0, shifted: 0, dominant_offset: null };
    row.book_shift = bv;
    for (const p of row.pairs) {
      // A uniform slide preserves the printed sequence, so an unverified pair in a
      // book whose verified pairs are mostly shifted is shifted too, on the balance
      // of evidence. Demote rather than drop — the reason stays on the row.
      if (p.usable && p.leaf === 'unverified' && bv.verdict === 'shifted') {
        p.usable = false; p.reason = 'book-shifted';
        stats.demoted_by_book_verdict++;
        inc(reasons, 'book-shifted'); reasons.ok--;
      }
    }
    const usable = row.pairs.filter(p => p.usable);
    row.usable_pairs = usable.length;
    // n independent reads of this leaf = usable transitions + 1, when the usable
    // transitions form the chain. Reported as a floor, never a claim of exactness.
    row.independent_reads = usable.length ? usable.length + 1 : (row.passes ? 1 : 0);
    row.double_ocr = usable.length >= 1;
    row.leaf_evidence = usable.some(p => p.leaf === 'same') ? 'verified-same-leaf'
      : usable.length ? 'unverified-leaf' : 'none';
    row.excluded_reasons = row.pairs.filter(p => !p.usable).map(p => p.reason);

    stats.pages++;
    if (row.double_ocr) {
      stats.double_ocr_pages++;
      stats.usable_pairs += usable.length;
      inc(stats.by_reads, String(row.independent_reads));
      inc(stats.by_language, row.language || '(unknown)');
      inc(stats.by_leaf_evidence, row.leaf_evidence);
      for (const p of usable) inc(stats.by_model_pair, `${p.prior_model || '?'}→${p.current_model || '?'}`);
    } else if (row.pairs.length && row.pairs.every(p => p.reason === 'text-move-source')) {
      stats.pages_only_sweep++;
    }
    finalOut.write(JSON.stringify(row) + '\n');

    if (WRITE_COLLECTION) {
      mongoOps.push({
        updateOne: {
          filter: { page_id: row.page_id },
          update: { $set: {
            page_id: row.page_id, book_id: row.book_id, book_slug: row.book_slug,
            page_number: row.page_number, language: row.language, year: row.year,
            double_ocr: row.double_ocr, independent_reads: row.independent_reads,
            usable_pairs: row.usable_pairs, leaf_evidence: row.leaf_evidence,
            excluded_reasons: row.excluded_reasons, book_shift_verdict: bv.verdict,
            passes: row.passes, run_date: DATE,
          } },
          upsert: true,
        },
      });
      if (mongoOps.length >= 1000) { await COL.bulkWrite(mongoOps, { ordered: false }); mongoOps.length = 0; }
    }
  }
  await new Promise(r => finalOut.end(r));
  if (WRITE_COLLECTION && mongoOps.length) await COL.bulkWrite(mongoOps, { ordered: false });
  if (WRITE_COLLECTION) {
    await COL.createIndex({ double_ocr: 1, leaf_evidence: 1 });
    await COL.createIndex({ book_id: 1 });
  }
  fs.unlinkSync(TMP_JSONL);
  for (const v of verdicts.values()) stats[`books_${v.verdict === 'insufficient' ? 'insufficient' : v.verdict === 'shifted' ? 'shifted' : 'clean'}`]++;
  await client.close();

  const summary = {
    date: new Date().toISOString(),
    scope: LIMIT ? `first ${LIMIT} revisions (sorted by page_id)` : 'full page_revisions OCR corpus',
    revisions_read: revsRead,
    pages_with_any_revision: pagesSeen,
    pages_missing_doc: missingPage,
    pages_single_pass: singlePass,
    ...stats,
    pair_reasons: reasons,
    unknown_source_labels: unknownSources,
    rows_jsonl: path.relative(process.cwd(), OUT_JSONL),
    elapsed_s: Math.round((Date.now() - t0) / 1000),
  };
  fs.writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 1));

  const tbl = (obj, head, limit = 20) => {
    const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, limit);
    if (!rows.length) return '';
    return [`| ${head} | pages |`, '|---|---:|', ...rows.map(([k, v]) => `| ${k} | ${v.toLocaleString()} |`), ''].join('\n');
  };
  const md = [
    `# Pages with a genuine second ${FIELD === 'ocr' ? 'OCR' : 'translation'} pass (${DATE})`, '',
    `Inventory of pages carrying **two or more independent model passes over the same leaf**.`,
    `Built from \`page_revisions\` (field \`${FIELD}\`) with the #3473 filters in`,
    `\`scripts/lib/revision-pairs.mjs\` — a revision alone does not mean the page was read twice.`, '',
    '## Headline', '',
    `- revisions read: **${revsRead.toLocaleString()}**`,
    `- pages carrying at least one stored OCR revision: **${pagesSeen.toLocaleString()}**`,
    `- **pages genuinely ${FIELD === 'ocr' ? "OCR'd" : 'translated'} 2+ times: ${stats.double_ocr_pages.toLocaleString()}** (${(100 * stats.double_ocr_pages / Math.max(1, pagesSeen)).toFixed(1)}% of them)`,
    `- usable pair transitions: **${stats.usable_pairs.toLocaleString()}**`,
    `- pages whose ONLY revision is the e-rara shift sweep (not a second read): **${stats.pages_only_sweep.toLocaleString()}**`,
    `- pairs demoted by the per-book shift verdict (unverified leaf in a demonstrably shifted book): **${stats.demoted_by_book_verdict.toLocaleString()}**`,
    `- live page doc missing (book purged): ${missingPage.toLocaleString()}`, '',
    '## Why pairs were excluded', '',
    '`ok` is the usable population. Every other row is a pair that *looks* like a second',
    'read from inside `page_revisions` and is not one.', '',
    tbl(reasons, 'reason'),
    '## Leaf evidence on the usable pages', '',
    '`verified-same-leaf` = both passes printed the same page number, so they demonstrably',
    'read one leaf. `unverified-leaf` = at least one side printed no page number; the pair',
    'survives on the book-level verdict, which is weaker evidence. Report the split — do not',
    'quote the total as if it were all verified.', '',
    tbl(stats.by_leaf_evidence, 'evidence'),
    '## Reads per page', '', tbl(stats.by_reads, 'independent reads'),
    '## By language', '', tbl(stats.by_language, 'language'),
    '## By model transition', '', tbl(stats.by_model_pair, 'prior → current'),
    '## Books', '',
    `- shifted (their images moved under their text): **${stats.books_shifted.toLocaleString()}**`,
    `- clean: **${stats.books_clean.toLocaleString()}**`,
    `- insufficient evidence (fewer than 3 pairs printing a page number): **${stats.books_insufficient.toLocaleString()}**`, '',
    Object.keys(unknownSources).length
      ? ['## ⚠ Unrecognised source labels', '',
         'A source this filter does not know is a possible new bulk sweep. Classify it in',
         '`scripts/lib/revision-pairs.mjs` before trusting any number above.', '',
         tbl(unknownSources, 'source')].join('\n')
      : '## Source labels\n\nAll source labels recognised.\n',
    `Rows: \`${path.basename(OUT_JSONL)}\` · summary: \`${path.basename(OUT_SUMMARY)}\``, '',
  ].filter(Boolean).join('\n');
  fs.writeFileSync(OUT_REPORT, md);

  console.log(`\n${md.split('## Why pairs')[0]}`);
  console.log(`Saved → ${OUT_JSONL}\n        ${OUT_SUMMARY}\n        ${OUT_REPORT}`);
  if (WRITE_COLLECTION) console.log(`        mongo: ${COLLECTION} (upserted ${stats.pages.toLocaleString()} rows)`);
}

main().catch(e => { console.error(e); process.exit(1); });
