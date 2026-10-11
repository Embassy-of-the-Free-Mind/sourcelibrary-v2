#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/withhold-leaked-reasoning-6117.mjs — withholds leaked pages; these two can be CUT
// clean instead, so readers keep the translation. scripts/maintenance/tengyur-cli-6361/apply.mjs wrote them.
/**
 * Cut the CLI's chat off the two Tengyur pages that carry it in readers' text (#6523, sweep tengyur-cli-6361):
 *   6abed76c896ea18127c8ee40 p154 opens "…rather than creating a software project plan, here is the translation…:"
 *   6abeb35b896ea18127c83af5 p261 has "Here is the translation:" partway through, after a separate paraphrase reply.
 * The rule is the same for both, read by eye on the whole page: keep what follows the LAST "here is the translation…:"
 * line. The cut must pass the verbatim guard (scripts/lib/verbatim-cut.mjs). The write goes through
 * writePageTranslation, which snapshots the old text to page_revisions first; the engine block is the one that
 * produced the text, plus a `repair` record naming this job. Dry run by default; --apply writes.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/cli-chatter-cut-6523/repair-pages.mjs [--apply]
 */
import { MongoClient } from 'mongodb';
import { writePageTranslation } from '../../lib/translate-core.mjs';
import { refusableReasoningLeak } from '../../lib/page-integrity.mjs';
import { verbatimCut, VERBATIM_GUARD_VERSION } from '../../lib/verbatim-cut.mjs';

const JOB = 'cli-past-data-6523';
const PAGES = [
  { book_id: '6abed76c896ea18127c8ee40', page_number: 154 },
  { book_id: '6abeb35b896ea18127c83af5', page_number: 261 },
];
const MARKER = /^.*\bhere is the translation\b[^\n]*:[ \t]*$/gim;
const apply = process.argv.includes('--apply');

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
try {
  for (const { book_id, page_number } of PAGES) {
    const page = await db.collection('pages').findOne({ book_id, page_number });
    const book = await db.collection('books').findOne({ $or: [{ id: book_id }, { _id: book_id }] });
    const raw = page?.translation?.data || '';
    const marks = [...raw.matchAll(MARKER)];
    const label = `${book_id} p${page_number}`;
    if (!marks.length) { console.log(`${label}: no marker — already repaired? skip`); continue; }
    const last = marks.at(-1);
    const cut = raw.slice(last.index + last[0].length).trim();
    const guard = verbatimCut(raw, cut);
    const leak = refusableReasoningLeak(cut);
    console.log(`${label}: raw ${raw.length} chars, cut ${cut.length} chars (kept ${guard.kept_share} of letters); guard ${guard.ok ? 'PASS' : 'FAIL ' + guard.reason}; leak ${leak ? leak.phrase : 'none'}`);
    console.log(`  removed head: ${JSON.stringify(raw.slice(0, last.index + last[0].length).slice(0, 400))}`);
    if (!guard.ok || leak || MARKER.test(cut)) { MARKER.lastIndex = 0; console.log('  NOT CUT — contain instead'); continue; }
    if (!apply) continue;
    const t = page.translation;
    const engine = {
      ...t.engine,
      repair: {
        job_id: JOB, issue: 6523, method: 'cut', at: new Date().toISOString(),
        rule: 'kept the text after the last "here is the translation…:" line',
        guard: VERBATIM_GUARD_VERSION, guard_result: 'pass', kept_share: guard.kept_share,
        prior_content_hash: t.content_hash ?? null,
      },
    };
    const res = await writePageTranslation(db, {
      page, book, text: cut,
      promptRef: { id: t.prompt_id, name: t.prompt_name, version: t.prompt_version, content_hash: t.prompt_hash },
      model: t.model, jobId: JOB, note: 'cli-chatter-cut-6523', engine,
    });
    console.log(`  write: ${JSON.stringify({ written: res.written, protected: res.protected, reason: res.reason })}`);
  }
} finally {
  await client.close();
}
