#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/backfill-ocr-warning-flags.mjs (stamps ocr.has_warning; changes no text),
 * scripts/maintenance/cli-chatter-cut-6523/repair-pages.mjs (cuts CLI wrapper chatter outside the transcription markers,
 * not a <warning> inside them) and src/lib/strip-editorial-wrappers.ts (strips <warning> from snippets, quotes and
 * exports only — the reader does NOT go through it). None removes a model's prompt-mismatch note from stored text.
 *
 * strip-prompt-mismatch-warnings — a page read with the wrong language prompt can carry the model's complaint about
 * the prompt as a <warning>: "The provided image is a Classical Chinese woodblock print, not a Latin manuscript."
 * That is chatter about OUR prompt, not a note on the object. The reader shows <warning> as an amber condition chip,
 * expanded on first sight (src/components/reader/NotesRenderer.tsx MetadataPanel), so readers of the page see it.
 * This removes exactly those <warning> elements — the ones that talk about the prompt or a language the page is not
 * in — from `ocr.data` and `translation.data`. A <warning> about the object (ink bleed, a tear, an odd typeface) is
 * kept. The page's transcription and English are not touched.
 *
 * Every write goes through writePageText (page_revisions row with the whole prior field, compare-and-set on the prior
 * text, human-edit guard, one run id: scripts/maintenance/revert-run.mjs --run-id <run> undoes it) and a sweep_log row
 * per book. A translation is not marked stale: the text it translates is unchanged.
 *
 *   node --env-file=.env.production.local scripts/maintenance/strip-prompt-mismatch-warnings.mjs --book <id> [--issue N]   dry run
 *   ... --apply
 */
import { MongoClient } from 'mongodb';
import { writePageText, newRunId, textHash, isHumanEditedField } from '../lib/page-text-writer.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const SCRIPT = 'scripts/maintenance/strip-prompt-mismatch-warnings.mjs';
const SWEEP = 'strip-prompt-mismatch-warnings';
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const APPLY = argv.includes('--apply');
const BOOK = arg('--book', null);
const ISSUE = Number(arg('--issue', 0)) || null;

/** A <warning> that complains about the prompt or names a language the page is not in, rather than the object. */
export const PROMPT_MISMATCH = /\bnot (?:a |in )?(?:Latin|German|French|English|Greek|Hebrew)\b|\b(?:the |a )?(?:user|prompt|instructions?)\b[^<]{0,80}\b(?:request|specif|describ|mention|suggest|said|ask|identif|label|call|indicat|stat)|\bas (?:described|mentioned|suggested|specified) in the prompt\b/i;

/** The text with prompt-mismatch <warning> elements removed, or null when none. Exported for the test. */
export function stripPromptMismatch(text) {
  const removed = [];
  const out = String(text || '').replace(/[ \t]*<warning>([\s\S]*?)<\/warning>[ \t]*\n?/gi, (m, inner) => {
    if (!PROMPT_MISMATCH.test(inner)) return m;
    removed.push(inner.trim());
    return '';
  });
  return removed.length ? { text: out.replace(/^\n+/, ''), removed } : null;
}

async function main() {
  if (!BOOK) { console.error('--book <id> is required'); process.exit(2); }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const runId = newRunId(SWEEP);
  const tally = { pages_seen: 0, hits: { ocr: 0, translation: 0 }, written: { ocr: 0, translation: 0 }, human_edited: 0, other: {} };
  const pages = await db.collection('pages').find({ book_id: BOOK, $or: [{ 'ocr.data': /<warning>/i }, { 'translation.data': /<warning>/i }] },
    { projection: { id: 1, page_number: 1, ocr: 1, translation: 1 } }).sort({ page_number: 1 }).toArray();
  const changed = new Set();
  for (const p of pages) {
    tally.pages_seen++;
    for (const field of ['ocr', 'translation']) {
      const cur = p[field];
      const r = cur?.data && stripPromptMismatch(cur.data);
      if (!r) continue;
      tally.hits[field]++;
      if (isHumanEditedField(cur)) { tally.human_edited++; continue; }
      console.log(`  p.${p.page_number} ${field}: ${r.removed.map((w) => JSON.stringify(w.slice(0, 90))).join(' | ')}`);
      if (!APPLY) continue;
      const { content_hash, updated_at, ...keep } = cur; // re-stamped by the writer from the new text
      const res = await writePageText(db, p.id, field, { ...keep, data: r.text }, {
        by: SCRIPT, reason: `remove the model's prompt-mismatch <warning> (chatter about the prompt, shown to readers as a condition note)${ISSUE ? ` (#${ISSUE})` : ''}`,
        run_id: runId, revision_source: SWEEP, expect_prior_hash: textHash(cur),
      });
      if (res.status === 'written') { tally.written[field]++; changed.add(p.id); } else tally.other[res.status] = (tally.other[res.status] || 0) + 1;
    }
  }
  if (APPLY && changed.size) await recordSweepAction(db, { sweep: SWEEP, book_id: BOOK, action: 'strip-prompt-mismatch-warning', detail: { issue: ISSUE, pages: changed.size, run_id: runId, script: SCRIPT } });
  console.log(JSON.stringify({ apply: APPLY, book: BOOK, run_id: APPLY ? runId : null, pages_changed: changed.size, ...tally }, null, 1));
  await client.close();
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname === (await import('path')).resolve(process.argv[1]);
if (isMain) await main();
