#!/usr/bin/env node
/**
 * PRIOR ART: src/app/api/pages/[id]/route.ts is the manual-edit writer (createRevision, source
 * 'manual', edited_by) — it takes a whole replacement from a signed-in editor and keeps the old
 * model's prompt keys on the field; a volunteer correction is span edits from an anonymous
 * proposal that a SECOND reader applies, and must not inherit the old engine attribution.
 * scripts/maintenance/restore-withheld-translation.mjs restores text from page_revisions; it does
 * not take new text. none other — looked in scripts/maintenance, scripts/lib for "correction".
 *
 * Apply (or reject) a volunteer's proposed correction (#6418, .claude/docs/volunteer-shifts-design.md).
 *
 * The SECOND READER runs this after opening the scan and agreeing with the edit. It:
 *   1. re-reads the page and refuses if its text no longer matches the proposal's base_hash;
 *   2. refuses a translation correction while the translation is stale (a patched span would
 *      bump its date and make English made from old OCR look fresh), unless the OCR was
 *      corrected in the same shift (or, for a book run with no shift, proposed with it by the same volunteer);
 *   3. saves a page_revisions row (keepMeta) and CONFIRMS it exists before writing;
 *   4. writes compare-and-set on the current text, replacing the field object so the corrected
 *      text does not inherit the old model's prompt/engine keys: source 'volunteer-correction',
 *      edited_by = the volunteer (which also turns on the pipeline's human-edit guard);
 *   5. records a correction_events row (before/after pair, #3241) and marks the proposal applied.
 *
 * A SUBSET of a proposal's edits (#6679): `--accept-edits=1,3,4` (1-based, as --show numbers them)
 * applies only those; the others are dropped with `--drop-reason` or, when the proposal carries an
 * `adjudication` (scripts/maintenance/adjudicate-corrections.mjs), that edit's decision. The proposal
 * becomes `partially_applied` with `accepted_edits` / `dropped_edits`, and the adjudicator's per-edit
 * verdicts travel into the page's `correction` block.
 *
 * What it SETS IN MOTION (say so when you run it): an OCR correction bumps ocr.updated_at, so a
 * machine translation of that page becomes stale; the stale lane (mark-stale-translations.mjs,
 * then realtime-translate.mjs --stale, under the spend dial) re-translates it from the corrected
 * text. A human-edited translation is never overwritten by that lane.
 *
 *   node --env-file=.env.production.local scripts/maintenance/apply-page-correction.mjs --list
 *   ... --show=<id>
 *   ... --apply=<id> --reader="<who checked it against the scan>"            (dry run)
 *   ... --apply=<id> --reader="<who>" --confirm                             (writes)
 *   ... --reject=<id> --reader="<who>" --reason="<why>" --confirm
 */
import { MongoClient } from 'mongodb';
import { contentHash } from '../lib/write-provenance.mjs';
import { saveRevisionBeforeOverwrite } from '../lib/page-revisions.mjs';
import { applySpanEdits } from '../lib/span-edits.mjs';
import { translationStaleness } from '../lib/stale-translation.mjs';

export const SOURCE = 'volunteer-correction';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

/** A unified-ish preview: each edit with a little context, so the reader can check it by eye. */
function preview(text, edits) {
  return edits
    .map((e, i) => {
      const at = text.indexOf(e.find);
      const before = at >= 0 ? text.slice(Math.max(0, at - 60), at) : '';
      const after = at >= 0 ? text.slice(at + e.find.length, at + e.find.length + 60) : '';
      return [
        `  [${i + 1}] …${before.replace(/\n/g, '⏎')}`,
        `      - ${e.find.replace(/\n/g, '⏎')}`,
        `      + ${e.replace.replace(/\n/g, '⏎')}`,
        `      …${after.replace(/\n/g, '⏎')}`,
        e.reason ? `      reason: ${e.reason}` : null,
      ].filter(Boolean).join('\n');
    })
    .join('\n');
}

/** `--accept-edits=1,3,4` → [1,3,4]; absent → every edit. 1-based, unique, in range, non-empty. */
function parseAccepted(raw, n) {
  const all = Array.from({ length: n }, (_, i) => i + 1);
  if (raw === undefined) return all;
  if (raw === true || !String(raw).trim()) throw new Error('--accept-edits needs a list, e.g. --accept-edits=1,3');
  const list = [...new Set(String(raw).split(',').map((x) => Number(x.trim())))].sort((a, b) => a - b);
  for (const k of list) if (!Number.isInteger(k) || k < 1 || k > n) throw new Error(`--accept-edits: ${k} is not an edit number (1–${n})`);
  return list;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const corrections = db.collection('page_corrections');
  try {
    if (args.list) {
      const rows = await corrections.find({ status: 'proposed' }).sort({ created_at: 1 }).limit(100).toArray();
      console.log(`${rows.length} proposed correction(s)`);
      for (const r of rows) {
        console.log(`${r.id}  ${r.field.padEnd(11)} page ${r.page_id} p.${r.page_number ?? '?'}  ${r.edits.length} edit(s)  by ${r.volunteer_label || r.volunteer_id.slice(0, 8)} (${r.drafted_by})  ${r.created_at.toISOString().slice(0, 16)}`);
      }
      return;
    }

    const id = args.show || args.apply || args.reject;
    if (!id || id === true) {
      console.error('Use --list, --show=<id>, --apply=<id> --reader=… [--accept-edits=1,3] [--confirm], or --reject=<id> --reader=… --reason=… --confirm');
      process.exitCode = 2;
      return;
    }
    const corr = await corrections.findOne({ id });
    if (!corr) throw new Error(`no correction ${id}`);
    const field = corr.field;
    const page = await db.collection('pages').findOne(
      { id: corr.page_id },
      { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1, translation: 1, translation_stale: 1 } },
    );
    if (!page?.[field]?.data) throw new Error(`page ${corr.page_id} has no ${field} text`);
    const current = page[field].data;

    console.log(`correction ${corr.id} [${corr.status}] — ${field}, page ${page.id} (book ${page.book_id}, p.${page.page_number})`);
    console.log(`volunteer: ${corr.volunteer_label || corr.volunteer_id} · drafted_by: ${corr.drafted_by}${corr.assistant_model ? ` · assistant: ${corr.assistant_model}` : ''}`);
    if (corr.note) console.log(`note: ${corr.note}`);
    console.log(`scan + reader: https://sourcelibrary.org/book/${page.book_id}/page/${page.id}`);
    console.log(preview(current, corr.edits));

    if (args.show) return;
    if (corr.status !== 'proposed') throw new Error(`correction is ${corr.status}, not proposed`);
    const reader = typeof args.reader === 'string' ? args.reader.trim() : '';
    if (!reader) throw new Error('--reader="<who checked it against the scan>" is required');

    // Which edits: all, or the --accept-edits subset (1-based). Each dropped edit keeps a reason.
    const accepted = parseAccepted(args['accept-edits'], corr.edits.length);
    const decisions = corr.adjudication?.decisions ?? null;
    const dropped = corr.edits.map((_, i) => i + 1).filter((n) => !accepted.includes(n)).map((n) => ({
      index: n,
      reason: (typeof args['drop-reason'] === 'string' && args['drop-reason'].trim())
        || ((d) => (d ? `${d.decision}: ${d.why}` : 'not accepted by the second reader'))(decisions?.find((x) => x.index === n)),
    }));
    if (dropped.length) {
      console.log(`\naccepting edit(s) ${accepted.join(',')}; dropping ${dropped.map((d) => `${d.index} (${d.reason})`).join('; ')}`);
    }

    if (args.reject) {
      const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
      if (!reason) throw new Error('--reason is required to reject');
      if (!args.confirm) { console.log('\nDRY RUN: would reject. Add --confirm.'); return; }
      await corrections.updateOne({ id, status: 'proposed' }, { $set: { status: 'rejected', reviewed_by: reader, reviewed_at: new Date(), reject_reason: reason } });
      console.log('rejected.');
      return;
    }

    // 1. Same text the volunteer corrected?
    const currentHash = contentHash(current);
    if (currentHash !== corr.base_hash) {
      if (args.confirm) await corrections.updateOne({ id, status: 'proposed' }, { $set: { status: 'stale', stale_at: new Date(), stale_current_hash: currentHash } });
      throw new Error(`stale: page ${field} is now ${currentHash}, proposal was made against ${corr.base_hash}${args.confirm ? ' (marked stale)' : ''}`);
    }

    // 2. Do not freshen a stale translation by patching it.
    if (field === 'translation') {
      const stale = page.translation_stale || translationStaleness(page).stale;
      let ocrFixedThisShift = page.ocr?.source === SOURCE && corr.shift_id && page.ocr?.correction?.shift_id === corr.shift_id;
      // A book run (#6418) stamps no shift_id: the same volunteer proposing the OCR and the translation of this
      // page together (minutes apart) is the same case — the English fix was written against the scan alongside
      // the OCR fix (#6679).
      if (!ocrFixedThisShift && page.ocr?.source === SOURCE && page.ocr?.correction?.volunteer_id === corr.volunteer_id) {
        const ocrCorr = await corrections.findOne({ id: page.ocr.correction.id }, { projection: { page_id: 1, created_at: 1 } });
        ocrFixedThisShift = ocrCorr?.page_id === page.id && Math.abs(+ocrCorr.created_at - +corr.created_at) < 10 * 60_000;
      }
      if (stale && !ocrFixedThisShift) {
        throw new Error('the translation is stale (made from an older transcription); fix the OCR or let it re-translate first');
      }
    }

    const result = applySpanEdits(current, accepted.map((n) => corr.edits[n - 1]));
    if ('error' in result) throw new Error(result.error);
    const next = result.text;
    console.log(`\n${current.length} → ${next.length} chars, ${currentHash} → ${contentHash(next)}`);
    if (field === 'ocr') console.log('NOTE: this bumps ocr.updated_at; a machine translation of this page becomes stale and the stale lane will re-translate it.');

    if (!args.confirm) { console.log('\nDRY RUN: nothing written. Add --confirm to apply.'); return; }

    // 3. Revision first, and prove it landed (the helper swallows its own failures).
    const before = new Date();
    await saveRevisionBeforeOverwrite(db, page.id, field, { reason: 'volunteer_correction', keepMeta: true });
    const revision = await db.collection('page_revisions').findOne(
      { page_id: page.id, field, created_at: { $gte: before } },
      { sort: { created_at: -1 }, projection: { id: 1, data: 1 } },
    );
    if (!revision || revision.data !== current) throw new Error('revision was not saved; nothing written');

    // 4. Compare-and-set write. The whole field object is replaced so the old model's
    //    prompt/engine keys do not describe the volunteer's text (they live on in the
    //    revision's meta). language travels; an `unreadable` flag travels too, because
    //    a span fix does not by itself make an unreadable page readable.
    const now = new Date();
    const volunteer = corr.volunteer_label || `volunteer:${corr.volunteer_id.slice(0, 8)}`;
    const old = page[field];
    const fieldDoc = {
      data: next,
      ...(old.language ? { language: old.language } : {}),
      ...(old.source_language ? { source_language: old.source_language } : {}),
      ...(old.unreadable ? { unreadable: old.unreadable } : {}),
      source: SOURCE,
      model: 'human',
      content_hash: contentHash(next),
      updated_at: now,
      edited_by: volunteer,
      edited_at: now,
      correction: {
        id: corr.id,
        volunteer_id: corr.volunteer_id,
        drafted_by: corr.drafted_by,
        assistant_model: corr.assistant_model ?? null,
        second_reader: reader,
        shift_id: corr.shift_id ?? null,
        base_hash: corr.base_hash,
        revision_id: revision.id,
        ...(dropped.length ? { accepted_edits: accepted, dropped_edits: dropped } : {}),
        ...(decisions ? { adjudication: { reader, decoy_caught: corr.adjudication.decoy_caught ?? null, verdicts: decisions } } : {}),
      },
    };
    const res = await db.collection('pages').updateOne(
      { id: page.id, [`${field}.data`]: current },
      { $set: { [field]: fieldDoc }, $inc: { edit_count: 1 } },
    );
    if (res.modifiedCount !== 1) throw new Error(`compare-and-set failed (matched ${res.matchedCount}); the page changed underneath — nothing written`);

    // 5. The before/after pair for the error corpus, and close the proposal.
    await db.collection('correction_events').insertOne({
      id: corr.id,
      page_id: page.id,
      book_id: page.book_id,
      field,
      before: current,
      after: next,
      before_model: old.model,
      before_source: old.source,
      before_prompt_version: old.prompt_version,
      revision_id: revision.id,
      editor_role: 'volunteer',
      edited_by: volunteer,
      drafted_by: corr.drafted_by,
      second_reader: reader,
      ...(dropped.length ? { accepted_edits: accepted, dropped_edits: dropped } : {}),
      created_at: now,
    });
    await corrections.updateOne(
      { id },
      { $set: {
        status: dropped.length ? 'partially_applied' : 'applied',
        reviewed_by: reader, reviewed_at: now, revision_id: revision.id, applied_hash: fieldDoc.content_hash,
        accepted_edits: accepted, dropped_edits: dropped,
      } },
    );
    console.log(`applied: modifiedCount=${res.modifiedCount}, revision ${revision.id}, correction_event ${corr.id}`);
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(`ERROR: ${e.message}`);
  process.exitCode = 1;
});
