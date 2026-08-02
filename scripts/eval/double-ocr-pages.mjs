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
const CHECKPOINT = `${OUT_JSONL}.checkpoint`;
const CHUNK = parseInt(args.chunk || '5000');   // revisions per range query
const SITE = 'https://sourcelibrary.org';

const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

/**
 * Atlas drops connections. A ~35-minute scan hit `MongoNetworkError: read
 * ECONNRESET` twice and lost the whole run both times. Transient network faults
 * are the expected case at this duration, not the exception — retry them, and let
 * a genuine error surface after the attempts are spent.
 */
async function retry(fn, label, attempts = 5) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      const transient = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|socket|pool|topology|MongoNetworkError|CursorNotFound/i
        .test(`${e?.name} ${e?.message} ${e?.constructor?.name}`);
      if (!transient || i >= attempts) throw e;
      const wait = Math.min(30000, 1000 * 2 ** (i - 1));
      console.log(`  ⚠ ${label} failed (${e?.message?.slice(0, 80)}) — retry ${i}/${attempts - 1} in ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

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

  // RESUME. The first full run died twice on `MongoNetworkError: read ECONNRESET`
  // ~35 minutes in and lost everything, which is the standard fate of a long sweep
  // here (see CLAUDE.md on the entity-attribution repair: CursorNotFound from a
  // cursor held open across a long batch, DNS failures on sleep/wake). So pass 1
  // scans in page_id RANGES with a checkpoint after each chunk, appends to the
  // pass-1 file, and never holds a cursor open across chunks. Deleting the
  // checkpoint file starts over.
  const resuming = fs.existsSync(CHECKPOINT) && fs.existsSync(TMP_JSONL);
  const ckpt = resuming ? JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8')) : { last_page_id: '', revs_read: 0 };
  if (resuming) console.log(`  resuming after page_id ${ckpt.last_page_id} (${ckpt.revs_read.toLocaleString()} revisions already read)`);
  const out = fs.createWriteStream(TMP_JSONL, { flags: resuming ? 'a' : 'w' });
  const bookCache = new Map();
  let revsRead = ckpt.revs_read, pagesEmitted = 0;
  let pagesSeen = ckpt.pages_seen || 0, missingPage = ckpt.missing_page || 0, singlePass = ckpt.single_pass || 0;
  let lastPageId = ckpt.last_page_id;
  const t0 = Date.now();

  let batch = [];

  const flush = async () => {
    if (!batch.length) return;
    const ids = batch.map(b => b.page_id);
    const pageDocs = await retry(() => PAGES.find(
      { id: { $in: ids } },
      { projection: { id: 1, book_id: 1, page_number: 1, [`${FIELD}.data`]: 1, [`${FIELD}.model`]: 1, [`${FIELD}.source`]: 1, [`${FIELD}.prompt_version`]: 1, [`${FIELD}.updated_at`]: 1 } },
    ).maxTimeMS(180000).toArray(), 'pages lookup');
    const pageById = new Map(pageDocs.map(p => [p.id, p]));

    const needBooks = [...new Set(batch.map(b => b.revs[0].book_id).filter(id => id && !bookCache.has(id)))];
    if (needBooks.length) {
      const bookDocs = await retry(() => BOOKS.find(
        { $or: [{ _id: { $in: needBooks } }, { id: { $in: needBooks } }] },
        { projection: { id: 1, slug: 1, language: 1, year: 1, pages_count: 1 } },
      ).maxTimeMS(120000).toArray(), 'books lookup');
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
      if (chain.length < 2) { singlePass++; continue; }

      const pairs = [];
      for (let i = 0; i < chain.length - 1; i++) {
        const prior = chain[i], current = chain[i + 1];
        const v = classifyPair({ priorSource: prior.source, priorText: prior.data, currentText: current.data });
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

  // Range scan, one bounded query per chunk. A page's revisions must be grouped
  // together, so the TRAILING page_id of every chunk is dropped and re-fetched by
  // the next query ($gt the last COMPLETE page_id) — otherwise a page straddling a
  // chunk boundary would be emitted twice, each time with half its chain.
  const startedAt = revsRead;
  while (true) {
    const rows = await retry(() => REVS.find(
      { field: FIELD, data: { $type: 'string', $ne: '' }, ...(lastPageId ? { page_id: { $gt: lastPageId } } : {}) },
      { projection: { page_id: 1, book_id: 1, data: 1, model: 1, prompt_version: 1, source: 1, created_at: 1, original_date: 1 } },
    ).sort({ page_id: 1 }).limit(CHUNK).maxTimeMS(300000).toArray(), 'revision chunk');
    if (!rows.length) break;

    const groups = new Map();
    for (const rv of rows) {
      if (!groups.has(rv.page_id)) groups.set(rv.page_id, []);
      groups.get(rv.page_id).push(rv);
    }
    const pageIds = [...groups.keys()];
    // A short chunk is the end of the collection: nothing follows, so the last
    // group is complete and must NOT be dropped.
    const complete = rows.length < CHUNK ? pageIds : pageIds.slice(0, -1);
    if (!complete.length) {
      // One page_id filled an entire chunk — advance past it rather than spin.
      console.log(`  ⚠ page ${pageIds[0]} has ≥${CHUNK} revisions; taking it whole`);
      complete.push(pageIds[0]);
    }

    for (const pid of complete) {
      batch.push({ page_id: pid, revs: groups.get(pid) });
      if (batch.length >= BATCH) await flush();
    }
    revsRead += complete.reduce((n, pid) => n + groups.get(pid).length, 0);
    lastPageId = complete[complete.length - 1];

    await flush();
    // Counters ride in the checkpoint so a resumed run reports the corpus, not the
    // stretch since the last crash.
    fs.writeFileSync(CHECKPOINT, JSON.stringify({
      last_page_id: lastPageId, revs_read: revsRead, field: FIELD,
      pages_seen: pagesSeen, missing_page: missingPage, single_pass: singlePass,
    }));

    const rate = (revsRead - startedAt) / Math.max(1, (Date.now() - t0) / 1000);
    console.log(`  ${revsRead.toLocaleString()}/${total.toLocaleString()} revisions · ${pagesEmitted.toLocaleString()} pages this run · ${rate.toFixed(0)}/s`);
    if (rows.length < CHUNK) break;
    if (LIMIT && revsRead >= LIMIT) break;
  }
  await flush();
  await new Promise(r => out.end(r));

  // ── pass 2a: derive the aggregates FROM THE FILE ───────────────────
  // Not from in-memory counters accumulated during pass 1: a resumed run would
  // carry only the counts from its own segment, and the totals would silently
  // describe the last crash-to-finish stretch rather than the corpus. The pass-1
  // file is the record; everything is recomputed from it.
  const bookPairs = new Map();
  const unknownSources = {};
  const reasons = {};
  for await (const line of readline.createInterface({ input: fs.createReadStream(TMP_JSONL), crlfDelay: Infinity })) {
    if (!line) continue;
    const row = JSON.parse(line);
    for (const c of row.pass_chain || []) if (c.source_kind === 'unknown') inc(unknownSources, String(c.source));
    for (const p of row.pairs || []) {
      inc(reasons, p.reason);
      // Per-book leaf evidence, from NON-sweep pairs only: the question is whether
      // this book's images moved under its text for some reason OTHER than the
      // labelled repair, so including the repair's own rows would answer itself.
      if (p.source_kind !== 'text-move' && p.printed_prior != null && p.printed_current != null) {
        if (!bookPairs.has(row.book_id)) bookPairs.set(row.book_id, []);
        bookPairs.get(row.book_id).push({ printedPrior: p.printed_prior, printedCurrent: p.printed_current });
      }
    }
  }
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
      if (mongoOps.length >= 1000) {
        const ops = mongoOps.slice(); mongoOps.length = 0;
        await retry(() => COL.bulkWrite(ops, { ordered: false }), 'bulkWrite');
      }
    }
  }
  await new Promise(r => finalOut.end(r));
  if (WRITE_COLLECTION && mongoOps.length) await retry(() => COL.bulkWrite(mongoOps, { ordered: false }), 'bulkWrite');
  if (WRITE_COLLECTION) {
    await COL.createIndex({ double_ocr: 1, leaf_evidence: 1 });
    await COL.createIndex({ book_id: 1 });
  }
  // Only now — while these exist, an interrupted run can resume instead of
  // re-reading the whole corpus.
  fs.unlinkSync(TMP_JSONL);
  if (fs.existsSync(CHECKPOINT)) fs.unlinkSync(CHECKPOINT);
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
