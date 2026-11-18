#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/apply-gloss-corrections.mjs — span edits to a TRANSLATION only, refuses a stale
 * translation and a page with none, so it cannot write the OCR a reader reported or the first English of a page whose
 * translation was skipped or withheld. scripts/maintenance/apply-page-correction.mjs — applies a volunteer's proposal
 * from page_corrections and stamps `model: 'human'`; a session reading the image is not a volunteer. scripts/batch/cli-ocr.mjs
 * apply --by-eye — writes a CLI model's read, not text a session wrote with the image open. All three write through
 * the same doors this script uses (writePageText, writePageTranslation).
 *
 * Write page text that a Claude Code session corrected by eye, page by page, with the image open (#410: reader reports).
 *
 * Input: --items=FILE, a JSON list, one entry per page:
 *   { page_id, claim, evidence, feedback_ids?: [feedback row _id, ...],
 *     ocr?:         { text } | { edits: [{ find, replace, all? }] } | { clear: true },
 *     translation?: { text } | { edits: [...] } }
 * `text` replaces the field whole; `edits` are exact spans on the stored text (each must be found; without `all`, once);
 * `feedback_ids` name the reader reports the change came from; they go into the reason and the engine block (the reader
 * is credited by row id only: never put a name or handle in `claim`).
 * `clear` snapshots and removes a degenerate OCR (a repetition loop) so the page shows its image only.
 *
 * Per page, in order: the OCR (writePageText: the whole prior field to page_revisions under the run id, compare-and-set,
 * the human-edit guard) and then the translation (writePageTranslation, read AFTER the OCR write so its provenance names
 * the corrected transcription and the stale marker clears). A page whose OCR is written and whose translation is not
 * named is reported: its English is now older than its transcription and the stale lane will pick it up.
 * Both fields carry an `anthropic` engine block (api cli): the session's model, no generation call, the edit list or
 * the text as the prompt, the image url as the input, the claim and issue in `run`.
 *
 *   node --env-file=.env.production.local scripts/maintenance/apply-by-eye-page-text.mjs --items=F --issue=410 --job=NAME   (dry run)
 *   ... --confirm --cli-version="$(claude --version)"                                                                     (writes)
 * Undo: scripts/maintenance/revert-run.mjs --run-id <the run id printed> (OCR writes; translations restore from page_revisions).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { writePageText, newRunId } from '../lib/page-text-writer.mjs';
import { writePageTranslation } from '../lib/translate-core.mjs';
import { geminiEngine, imageInput, translationInput, notRecorded, codeVersion, host, contentHash } from '../lib/write-provenance.mjs';
import { applySpanEdits } from '../lib/span-edits.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const CALL_SITE = 'scripts/maintenance/apply-by-eye-page-text.mjs';
const MODEL = typeof args.model === 'string' ? args.model : 'claude-opus-5-5';
const ISSUE = args.issue ? Number(args.issue) : null;
const JOB = typeof args.job === 'string' ? args.job : null;
const NOTE = typeof args.note === 'string' ? args.note : `by-eye-correction${ISSUE ? `-${ISSUE}` : ''}`;
const PROMPT_NAME = typeof args['prompt-name'] === 'string' ? args['prompt-name'] : 'Correction written by eye against the page image in a Claude Code session';

/** Apply span edits in order; `all` replaces every occurrence, any other edit must match exactly once. */
export function applyEdits(text, edits) {
  let out = text;
  for (const e of edits) {
    if (e.all) {
      if (!out.includes(e.find)) return { error: `not found: ${JSON.stringify(e.find.slice(0, 80))}` };
      out = out.split(e.find).join(e.replace);
      continue;
    }
    const r = applySpanEdits(out, [e]);
    if ('error' in r) return r;
    out = r.text;
  }
  return { text: out };
}

/** The new text for a field spec against the stored text, or { error }. */
export function nextText(spec, current) {
  if (typeof spec.text === 'string') return spec.text.trim() ? { text: spec.text } : { error: 'empty text' };
  if (Array.isArray(spec.edits)) return current ? applyEdits(current, spec.edits) : { error: 'edits on a field with no text' };
  return { error: 'spec needs text or edits' };
}

/** The claim as recorded: prefixed with the feedback rows it came from. */
export const claimOf = (item) => (item.feedback_ids?.length ? `from reader feedback ${item.feedback_ids.join(', ')}: ` : '') + item.claim;

function engineFor(page, item, field, spec, { cliVersion, codeVer, runId }) {
  return geminiEngine({
    name: 'anthropic', api: 'cli', call_site: CALL_SITE, cli: { name: 'claude', version: cliVersion }, model: MODEL,
    prompt: { id: NOTE, name: PROMPT_NAME, version: '1', text: JSON.stringify(spec.edits ?? { text_chars: spec.text?.length ?? 0, field }) },
    generationConfig: notRecorded('text written by eye in a Claude Code session against the page image; no generation call'),
    run: { code_version: codeVer, host: host(), job_id: JOB, run_id: runId, ...(ISSUE ? { issue: ISSUE } : {}), claim: claimOf(item), evidence: item.evidence, ...(item.feedback_ids?.length ? { feedback_ids: item.feedback_ids } : {}) },
    input: field === 'ocr'
      ? imageInput({ url: getPageSource(page) })
      : translationInput({ ocrText: page.ocr?.data ?? '', ocrUpdatedAt: page.ocr?.updated_at }),
  });
}

async function main() {
  if (!args.items) throw new Error('--items=FILE is required');
  const items = JSON.parse(fs.readFileSync(args.items, 'utf8'));
  const confirm = !!args.confirm;
  if (confirm && typeof args['cli-version'] !== 'string') throw new Error('--cli-version="$(claude --version)" is required with --confirm');
  const ctx = { cliVersion: args['cli-version'] || 'dry-run', codeVer: await codeVersion(), runId: newRunId('apply-by-eye-page-text') };
  console.log(`${confirm ? 'WRITE' : 'DRY RUN'} run ${ctx.runId}: ${items.length} page(s)`);
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const pages = db.collection('pages');
  const proj = { id: 1, book_id: 1, page_number: 1, page_type: 1, photo: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, photo_original: 1, ocr: 1, translation: 1, translation_stale: 1 };
  const out = [];
  try {
    for (const item of items) {
      const page = await pages.findOne({ id: item.page_id }, { projection: proj });
      const tag = `${item.page_id} (book ${page?.book_id} p.${page?.page_number}) — ${claimOf(item)}`;
      if (!page) { console.log(`SKIP ${tag}: no page`); out.push({ page_id: item.page_id, status: 'no page' }); continue; }
      const book = await db.collection('books').findOne({ id: page.book_id }, { projection: { id: 1, language: 1 } });
      const row = { page_id: page.id, book_id: page.book_id, page_number: page.page_number };

      // ---- OCR ----
      if (item.ocr) {
        const prior = page.ocr || {};
        let next;
        if (item.ocr.clear) next = null;
        else {
          const r = nextText(item.ocr, prior.data);
          if (r.error) { console.log(`SKIP ${tag}: ocr ${r.error}`); row.ocr = `error: ${r.error}`; out.push(row); continue; }
          if (r.text === prior.data) { console.log(`  ocr unchanged`); row.ocr = 'unchanged'; }
          else next = {
            data: r.text, ...(prior.language ? { language: prior.language } : {}), model: MODEL, source: 'ai',
            prompt_name: PROMPT_NAME, prompt_version: '1', content_hash: contentHash(r.text), pipeline: NOTE,
            engine: engineFor(page, item, 'ocr', item.ocr, ctx),
          };
        }
        if (next !== undefined && row.ocr !== 'unchanged') {
          console.log(`\n${confirm ? 'WRITE' : 'DRY'} ocr ${tag}\n  ${next === null ? '(clear degenerate OCR)' : `${(prior.data || '').length} → ${next.data.length} chars`}`);
          if (confirm) {
            const w = await writePageText(db, page.id, 'ocr', next, { by: `${CALL_SITE} (${MODEL}, job ${JOB})`, reason: `${NOTE}: ${claimOf(item)}`, run_id: ctx.runId });
            row.ocr = w.status; row.ocr_revision = w.revision_id;
            console.log(`  ocr ${w.status}${w.revision_id ? ` (revision ${w.revision_id})` : ''}`);
            if (w.status !== 'written') { out.push(row); continue; }
          } else row.ocr = 'would write';
        }
      }

      // ---- translation (read after the OCR write) ----
      if (item.translation) {
        const fresh = confirm ? await pages.findOne({ id: page.id }, { projection: proj }) : page;
        const r = nextText(item.translation, fresh.translation?.data);
        if (r.error) { console.log(`SKIP translation ${tag}: ${r.error}`); row.translation = `error: ${r.error}`; out.push(row); continue; }
        console.log(`${confirm ? 'WRITE' : 'DRY'} translation ${tag}: ${(fresh.translation?.data || '').length} → ${r.text.length} chars`);
        if (confirm) {
          const w = await writePageTranslation(db, {
            page: fresh, book, text: r.text, model: MODEL, jobId: JOB, note: `${NOTE}: ${claimOf(item)}`, overwriteHuman: false,
            promptRef: { id: NOTE, name: PROMPT_NAME, version: '1' },
            engine: engineFor(fresh, item, 'translation', item.translation, ctx),
          });
          row.translation = w.written ? 'written' : `refused: ${w.protected ? 'human-edited' : w.reason}`;
          console.log(`  translation ${row.translation}`);
        } else row.translation = 'would write';
      } else if (row.ocr === 'written' && page.translation?.data) {
        console.log('  NOTE: OCR written, translation not named: the English is now older than its transcription');
        row.translation = 'not named (now stale)';
      }
      out.push(row);
    }
  } finally {
    await client.close();
  }
  console.log(JSON.stringify({ run_id: ctx.runId, results: out }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exitCode = 1; });
