#!/usr/bin/env node
/**
 * rewrite-ai-confirmed-language-notes-4766.mjs — turn the "AI confirmed as X" language notes that
 * CONTRADICT the stored value into plain provenance: what the model read, when, which model.
 *
 * PRIOR ART: scripts/maintenance/relabel-ia-ocr-language-4582.mjs — its sweep_log writer and undo
 * are the shape copied here; it relabels `language`, this never does. scripts/lib/ai-language-provenance.mjs
 * (PR #6705) is the write-time fix and its agree/disagree test (parseLanguageField + sameLanguageFamily)
 * is reused unchanged, so this sweep and new writes draw the same line.
 *
 * Why (#4766): before #6705 the enrichment writers stamped
 *   { source: 'import', note: 'AI confirmed as "Syriac" (high)', ai_confirmed_at }
 * whenever a catalogue value existed, including when the model DISAGREED with it. The note then
 * "confirms" a language the value beside it contradicts. This rewrites only those notes.
 *
 * Writes ONLY `field_provenance.language.note`, `.ai_reading` (new) and unsets `.ai_confirmed_at`.
 * Never touches `language`, `languages[]`, `original_language`, or the existing `value`/`claims`.
 * No `conflict: true` flag: the arbiter asked for provenance only, and `.conflict` is read by sweeps
 * (relabel-ia-ocr-language-4582.mjs), so adding it would be actuation, not recording.
 * The model comes from `ai_metadata.model` when `ai_metadata.enriched_at` matches the stamp (all
 * 4,614 stamps did on 2026-10-15); otherwise it is recorded as null rather than guessed.
 *
 * Excluded on purpose: the Syriac-read manuscripts catalogued Hebrew (`EXCLUDE`), held for a by-eye
 * check of their images before anything is written about them.
 *
 * One sweep_log row per book (sweep `ai-confirmed-notes-4766`, the old provenance object in `detail.before`).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/rewrite-ai-confirmed-language-notes-4766.mjs --out <dir>   dry run
 *   … --out <dir> --commit     write
 *   … --undo [--commit]        restore every book's provenance object from its sweep_log row
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { normalizeLanguageToken, parseLanguageField, sameLanguageFamily } from '../lib/language-normalize.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

export const SWEEP = 'ai-confirmed-notes-4766';
const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const arg = (f) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : null; };

/** The six Manchester manuscripts the model read as Syriac (#4766, 2026-09-16): by-eye first. */
export const EXCLUDE = new Set([
  '69c1bc0b8522835be84613b7', '69c1bc148522835be846161f', '69c1bf4b8522835be846c282',
  '69c1bbf98522835be8460ee1', '69c1bbb78522835be8460590', '69c1bc418522835be84621ca',
]);

const NOTE_RE = /^AI confirmed as "(.*)" \(([^)]*)\)$/;

/** The rewritten provenance entry, or null when the note agrees with the value (left alone). */
export function rewriteEntry(catalogued, fp, aiMeta) {
  const m = NOTE_RE.exec(fp?.note || '');
  if (!m) return null;
  const [, said, confidence] = m;
  const ai = normalizeLanguageToken(said);
  if (ai && parseLanguageField(catalogued).some((l) => sameLanguageFamily(ai, l))) return null;
  const at = fp.ai_confirmed_at ? new Date(fp.ai_confirmed_at) : null;
  const sameRun = at && aiMeta?.enriched_at && Math.abs(new Date(aiMeta.enriched_at) - at) < 120_000;
  const model = sameRun ? aiMeta.model ?? null : null;
  const day = at ? at.toISOString().slice(0, 10) : 'an unrecorded date';
  const what = ai ? `read the pages as "${said}"` : `named no language ("${said}")`;
  const { ai_confirmed_at: _drop, ...rest } = fp;
  return {
    ...rest,
    note: `AI enrichment (${model || 'model not recorded'}, ${day}) ${what} (${confidence}); the catalogued value "${catalogued}" was kept. Not a confirmation (#4766).`,
    ai_reading: { value: said, confidence, model, at },
  };
}

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const books = db.collection('books');
const commit = has('commit');
try {
  if (has('undo')) {
    const rows = await db.collection('sweep_log').find({ sweep: SWEEP, action: 'rewrite note' }).toArray();
    const undone = new Set((await db.collection('sweep_log').find({ sweep: SWEEP, action: 'undo rewrite' }, { projection: { book_id: 1 } }).toArray()).map((r) => r.book_id));
    let n = 0;
    for (const r of rows) {
      if (undone.has(r.book_id)) continue;
      n++;
      if (!commit) continue;
      await books.updateOne({ $or: [{ id: r.book_id }, { _id: r.detail._id }] }, { $set: { 'field_provenance.language': r.detail.before } });
      await recordSweepAction(db, { sweep: SWEEP, book_id: r.book_id, action: 'undo rewrite', detail: { restored: r.detail.before } });
    }
    console.log(`${commit ? 'restored' : 'would restore'} ${n} books`);
  } else {
    const out = arg('out');
    if (!out) throw new Error('--out <dir> is required');
    fs.mkdirSync(out, { recursive: true });
    const cur = books.find({ 'field_provenance.language.note': /^AI confirmed as / }, { projection: { id: 1, title: 1, language: 1, 'field_provenance.language': 1, 'ai_metadata.model': 1, 'ai_metadata.enriched_at': 1 } }).batchSize(1000);
    const rows = []; const pairs = {}; let seen = 0, excluded = 0;
    for await (const b of cur) {
      seen++;
      const before = b.field_provenance.language;
      const after = rewriteEntry(b.language, before, b.ai_metadata);
      if (!after) continue;
      if (EXCLUDE.has(String(b._id))) { excluded++; continue; }
      const key = `${b.language} <- ${after.ai_reading.value}`; pairs[key] = (pairs[key] || 0) + 1;
      rows.push({ _id: b._id, book_id: b.id || String(b._id), title: b.title, language: b.language, before, after });
    }
    fs.writeFileSync(path.join(out, 'ai-confirmed-notes-4766.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(`notes seen ${seen}; contradicting ${rows.length + excluded}; excluded for by-eye ${excluded}; to rewrite ${rows.length}`);
    console.log(Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 12));
    if (commit) {
      let n = 0;
      for (const r of rows) {
        const res = await books.updateOne(
          { _id: r._id, 'field_provenance.language.note': r.before.note },
          { $set: { 'field_provenance.language': r.after } },
        );
        if (!res.modifiedCount) continue;
        n++;
        await recordSweepAction(db, { sweep: SWEEP, book_id: r.book_id, action: 'rewrite note', detail: { _id: r._id, before: r.before, after: r.after } });
      }
      console.log(`rewrote ${n}`);
    }
  }
} finally {
  await client.close();
}
