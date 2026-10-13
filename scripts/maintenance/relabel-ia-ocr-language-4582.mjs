#!/usr/bin/env node
/**
 * relabel-ia-ocr-language-4582.mjs — give a book back the cataloguer's language where IA's
 * `ocr_detected_lang` had overruled it and the #4582 gate now discounts that reading.
 *
 * PRIOR ART: scripts/maintenance/relabel-language-4884.mjs relabels from PAGE reads (a paid langid
 * pass) for books whose label disagrees with the page's script; its writer and undo are the shape
 * copied here. scripts/lib/ia-language.mjs (#6487) is the resolver this replays, unchanged: this
 * file holds only the candidate query, the page-tag cross-check and the writer.
 *
 * Population: books with `field_provenance.language.chosen_from: 'ia_ocr_detected'` and
 * `conflict: true`. Each is re-resolved against live archive.org metadata with the caller value
 * recorded in its own provenance claims. A book is PROPOSED when the resolver now picks a language
 * of another family than the stored one.
 *
 * A proposal is WRITTEN only when the pages do not contradict it: the `<language>` tags in the
 * book's stored transcriptions (language-fields.md: the strongest signal we hold) either agree with
 * the new label's family or do not exist. A book whose pages name the OLD label, or a third
 * language, is left alone and listed. A translation edition (`text_role` modern-/period-translation)
 * is written only when its own pages name the new label; with no transcribed page it is listed.
 *
 * Writes `language`, `languages[]`, `language_multi`, `field_provenance.language`, `updated_at` and
 * one `sweep_log` row per book (sweep `relabel-ia-ocr-4582`, old values in `detail.before`). Never
 * touches `original_language`, `text_role`, `is_translation`, `language_review`, `pipeline_auto`.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/relabel-ia-ocr-language-4582.mjs --out <dir>            dry run
 *   … --out <dir> --commit        write the proposals the pages do not contradict
 *   … --undo [--commit]           restore every book from its sweep_log row
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { resolveIaLanguage } from '../lib/ia-language.mjs';
import { languageCode, codeFamily, toLanguageCodes } from '../lib/language-normalize.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

export const SWEEP = 'relabel-ia-ocr-4582';
const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const arg = (f) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : null; };
const TRANSLATION_ROLES = new Set(['modern-translation', 'period-translation']);

/** Family of the first language a label names, or null. */
export const familyOf = (label) => { const c = toLanguageCodes(label).codes[0] || languageCode(label); return c ? codeFamily(c) : null; };

/** IA identifier of a book, from the fields importers have used. */
export function iaIdOf(b) {
  return b.ia_identifier || b.image_source?.identifier || b.image_source?.ia_identifier
    || (/archive\.org\/details\/([^/?#]+)/.exec(b.image_source?.source_url || b.source_url || '') || [])[1] || null;
}

/** Tally of `<language>` tags over a book's stored transcriptions, by family: [{family, label, pages}], largest first. */
async function pageTagTally(db, bookId) {
  const cur = db.collection('pages').find({ book_id: bookId, page_number: { $gt: 0 }, 'ocr.data': { $regex: '<language>' } }, { projection: { 'ocr.data': 1 } }).limit(400);
  const t = new Map();
  for await (const p of cur) {
    const m = /<language>([^<]{1,80})<\/language>/.exec(p.ocr.data); if (!m) continue;
    if (/^\s*(none|n\/a|unknown|und)\s*$/i.test(m[1])) continue; // a page with no text names no language
    const fam = familyOf(m[1]) || `?${m[1].trim()}`;
    const k = t.get(fam) || { family: fam, label: m[1].trim(), pages: 0 }; k.pages++; t.set(fam, k);
  }
  return [...t.values()].sort((a, b) => b.pages - a.pages);
}

async function fetchIaMeta(id) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(30000) });
      if (r.ok) return (await r.json()).metadata || null;
    } catch { /* retry */ }
    await new Promise((s) => setTimeout(s, 2000 * (i + 1)));
  }
  return undefined; // fetch failed: not the same as "no metadata"
}

async function main() {
  const commit = has('commit');
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 4 }); await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  try {
    if (has('undo')) {
      const rows = await db.collection('sweep_log').find({ sweep: SWEEP, action: 'relabel language' }).toArray();
      const undone = new Set((await db.collection('sweep_log').find({ sweep: SWEEP, action: 'undo relabel' }, { projection: { book_id: 1 } }).toArray()).map((r) => r.book_id));
      let n = 0, skipped = 0;
      for (const r of rows) {
        if (undone.has(r.book_id)) continue;
        const { before, after } = r.detail;
        const set = { language: before.language, updated_at: new Date() }, unset = {};
        for (const k of ['languages', 'language_multi']) { if (before[k] == null) unset[k] = ''; else set[k] = before[k]; }
        if (before.field_provenance_language == null) unset['field_provenance.language'] = ''; else set['field_provenance.language'] = before.field_provenance_language;
        if (!commit) { n++; continue; }
        // Only while the book still carries what this sweep wrote.
        const res = await books.updateOne({ id: r.book_id, language: after.language }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
        if (res.modifiedCount !== 1) { skipped++; continue; }
        await recordSweepAction(db, { sweep: SWEEP, book_id: r.book_id, action: 'undo relabel', detail: { restored: before } });
        n++;
      }
      console.log(`${commit ? 'RESTORED' : 'DRY RUN, would restore'}: ${n}; skipped (relabelled since): ${skipped}`);
      return;
    }

    const out = arg('out'); if (!out) { console.error('--out <dir> is required'); process.exit(2); }
    fs.mkdirSync(out, { recursive: true });
    const pop = await books.find({ 'field_provenance.language.chosen_from': 'ia_ocr_detected', 'field_provenance.language.conflict': true }, { projection: {
      id: 1, title: 1, language: 1, languages: 1, language_multi: 1, original_language: 1, text_role: 1, visible: 1, is_translation: 1, language_review: 1,
      ia_identifier: 1, image_source: 1, source_url: 1, 'field_provenance.language': 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, 'pipeline_auto.status': 1,
    } }).toArray();
    const rows = [];
    for (const b of pop) {
      const row = { book_id: b.id, title: String(b.title || '').slice(0, 90), visible: b.visible === true, stored: b.language, text_role: b.text_role ?? null,
        original_language: b.original_language ?? null, pages_ocr: b.pages_ocr || 0, pages_translated: b.pages_translated || 0 };
      const iaId = iaIdOf(b); row.ia_id = iaId;
      if (!iaId) { rows.push({ ...row, decision: 'unchanged', why: 'no IA identifier on the record' }); continue; }
      const meta = await fetchIaMeta(iaId);
      if (meta === undefined) { rows.push({ ...row, decision: 'unchanged', why: 'archive.org metadata fetch failed' }); continue; }
      if (!meta) { rows.push({ ...row, decision: 'unchanged', why: 'archive.org has no metadata for this id' }); continue; }
      const caller = (b.field_provenance?.language?.claims || []).find((c) => c.source === 'caller')?.value || null;
      const res = resolveIaLanguage(meta, caller);
      row.ia = { ocr_detected_lang: meta.ocr_detected_lang ?? null, ocr_detected_script: meta.ocr_detected_script ?? null, language: meta.language ?? null };
      row.caller = caller; row.resolved = res.language; row.chosen_from = res.chosen_from;
      row.discounted = res.provenance.claims.find((c) => c.discounted)?.discounted || null;
      if (!res.language || familyOf(res.language) === familyOf(b.language)) { rows.push({ ...row, decision: 'unchanged', why: 'the resolver still picks the stored language' }); continue; }
      row.page_tags = await pageTagTally(db, b.id);
      const top = row.page_tags[0] || null;
      const newFam = familyOf(res.language), oldFam = familyOf(b.language);
      // A translation edition's label is the EDITION's language (language-fields.md). Its pages can
      // show that; the catalogue of the work cannot. So with a translation role and no page tag: listed.
      if (!top && TRANSLATION_ROLES.has(b.text_role)) row.decision = 'listed', row.why = `translation edition (${b.text_role}) with no transcribed page to show the edition's language`;
      else if (top && top.family === oldFam) row.decision = 'listed', row.why = `the pages name the stored label (${top.label} on ${top.pages} pages)`;
      else if (top && top.family !== newFam) row.decision = 'listed', row.why = `the pages name a third language (${top.label} on ${top.pages} pages)`;
      else row.decision = 'write', row.why = top ? `pages agree (${top.label} on ${top.pages} pages)` : 'no transcribed page carries a language tag';
      if (row.decision === 'write' && commit) {
        const now = new Date();
        const after = { language: res.language, languages: [res.language], language_multi: false };
        const before = { language: b.language, languages: b.languages ?? null, language_multi: b.language_multi ?? null, field_provenance_language: b.field_provenance?.language ?? null };
        const provenance = { ...res.provenance, source: SWEEP, date: now, previous: { value: b.language, chosen_from: 'ia_ocr_detected' } };
        const w = await books.updateOne({ id: b.id, language: b.language }, { $set: { ...after, 'field_provenance.language': provenance, updated_at: now } });
        if (w.modifiedCount !== 1) { row.decision = 'listed'; row.why = 'not modified (changed underneath)'; }
        else {
          await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'relabel language', detail: { before, after, ia: row.ia, caller, discounted: row.discounted, page_tags: row.page_tags.slice(0, 4) } });
          row.written = true;
        }
      }
      rows.push(row);
    }
    const file = path.join(out, commit ? 'written.jsonl' : 'dry-run.jsonl');
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const t = {}; for (const r of rows) t[r.decision] = (t[r.decision] || 0) + 1;
    console.log(`${commit ? 'COMMIT' : 'DRY RUN'}: population ${pop.length}`, t, commit ? `modified ${rows.filter((r) => r.written).length}` : '');
    for (const r of rows.filter((x) => x.decision !== 'unchanged')) {
      console.log(`${r.decision.padEnd(6)} ${r.book_id} ${r.visible ? 'vis' : 'hid'} ${String(r.stored).padEnd(10)} → ${String(r.resolved).padEnd(10)} [${r.discounted}] role=${r.text_role} ocr=${r.pages_ocr} tags=${(r.page_tags || []).slice(0, 3).map((x) => `${x.label}:${x.pages}`).join(',') || '-'} | ${r.title.slice(0, 50)} | ${r.why}`);
    }
    const u = {}; for (const r of rows.filter((x) => x.decision === 'unchanged')) u[r.why] = (u[r.why] || 0) + 1; console.log('unchanged:', u);
    console.log(file);
  } finally { await client.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
