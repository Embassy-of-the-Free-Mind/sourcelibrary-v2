#!/usr/bin/env node
// PRIOR ART: scripts/lib/translation-text-repair.mjs (repairTranslationText + resyncMirrors) — the guarded
// door for every edit to stored translation text; used as-is for the English. scripts/maintenance/
// translation-cleanup-a2-5700.mjs — the corpus-wide $0 cleanup this follows (classes, dry run, revision row
// first); it has no class for a vendor stamp and never edits OCR. scripts/audit/scan-provenance-rights.mjs
// (#7308) — the detector that found the stamp's provenance. No existing door edits stored OCR text in place,
// so the OCR half below copies the translation door's guards (human-edit skip, revision first, conditional
// write) and, like it, leaves `ocr.updated_at` alone: staleness is decided from that clock
// (scripts/lib/stale-translation.mjs), and moving it would mark every stamped page's English stale and queue
// a paid retranslation of text that did not change.
/**
 * strip-proquest-stamp — remove the vendor stamp of the Early European Books scans from stored OCR and English
 * (#6056; Derek 2026-10-24: "remove proquest from the ocr/translation").
 *
 * The 1,142 public books in the Internet Archive collection `early-european-books` were digitised by ProQuest,
 * and the OCR transcribed its stamp from the scan margin: "Early European Books, Copyright © 2010 ProQuest LLC.
 * Images reproduced by courtesy of <library>. <shelfmark>" — mostly inside a `<meta>`, sometimes in the body,
 * and the translator carried it into the English (reworded, bolded, centred). This removes that sentence pair
 * from the copyright formula to the end of its line or tag, then drops a `<meta>` left empty and an empty
 * centring marker. A page where "ProQuest" survives the rule is NOT written; it is listed as residual.
 * The scan images are untouched (the stamp is burned into them).
 *
 * Writes per page: one `page_revisions` row per field (source `strip-proquest-6056`) BEFORE the field, then
 * `ocr.data` / `translation.data` (+ content_hash), conditional on the text not having changed. One
 * `sweep_log` row per book before its first write. Human-edited fields are skipped. Then the Supabase
 * mirrors are re-synced for books whose English changed.
 *
 *   node --env-file=.env.production.local scripts/maintenance/strip-proquest-stamp.mjs              # dry run
 *   node --env-file=.env.production.local scripts/maintenance/strip-proquest-stamp.mjs --apply [--books=a,b] [--out DIR]
 *
 * Undo: the `page_revisions` rows with source `strip-proquest-6056` hold every replaced text.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withMongo } from '../lib/mongo.mjs';
import { contentHash } from '../lib/write-provenance.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { repairTranslationText, resyncMirrors } from '../lib/translation-text-repair.mjs';

const SOURCE = 'strip-proquest-6056';
const ISSUE = 6056;
const REASON = 'remove the Early European Books / ProQuest scan stamp transcribed into the text (Derek 2026-10-24)';
const APPLY = process.argv.includes('--apply');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ONLY = arg('books')?.split(',').filter(Boolean) ?? null;
const OUT = arg('out') ?? `scripts/output/strip-proquest-${new Date().toISOString().slice(0, 10)}`;

// The formula and, when it follows, the courtesy sentence up to its own full stop (it may wrap a line, never
// crosses a tag). The library shelfmark that follows is catalogue information and stays.
const STAMP = /(?:->\s*)?\**\s*(?:Early European Books,?\s*)?Copyright\s*©?\s*(?:\d{4}\s*)?ProQuest(?:\s*LLC)?\.?\**\s*(?:<-)?\s*(?:(?:->\s*)?\**\s*Images reproduced by courtesy of[^<]*?\.\**\s*(?:<-)?(?=\s|<|$))?/gi;
const MENTION = /ProQuest|Early European Books/i;
const PROSE_TAGS = /<(meta|warning|note|image-desc|summary)(\s[^>]*)?>([\s\S]*?)<\/\1>/g;
const LIST_TAGS = /<(vocab|keywords)>([\s\S]*?)<\/\1>/g;

export function stripStamp(text) {
  if (typeof text !== 'string' || !MENTION.test(text)) return text;
  let t = text.replace(STAMP, '');
  // the model's own descriptions that name the vendor: drop those sentences, and a tag left empty
  t = t.replace(PROSE_TAGS, (m, tag, attrs = '', body) => {
    if (!MENTION.test(body)) return m;
    const kept = body.split(/(?<=[.!?])\s+/).filter((s) => !MENTION.test(s)).join(' ').trim();
    if (!kept || /^[^.]{0,40}:$/.test(kept)) return '';
    return `<${tag}${attrs}>${kept}</${tag}>`;
  });
  t = t.replace(LIST_TAGS, (m, tag, body) => {
    if (!MENTION.test(body)) return m;
    const items = body.split(/\s*,\s*/).filter((x) => x && !MENTION.test(x));
    return items.length ? `<${tag}>${items.join(', ')}</${tag}>` : '';
  });
  // last resort for free-form residue (24 pages of 7,496 on 2026-10-24): a glossed term, a list item, a
  // table row or a short line that names the vendor goes; in a long line, only the sentence that names it.
  t = t.replace(/\*?\s*<term>ProQuest<\/term>\s*:?\s*(?:<note>[^<]*<\/note>|[^\n<]*)/gi, '')
    .replace(/[;,]\s*(?:Digital provider:?\s*)?ProQuest(?:\s*LLC)?(?:\s*\(\d{4}\))?/gi, '')
    .split('\n').map((line) => {
      if (!MENTION.test(line)) return line;
      if (line.length < 300) return null;
      return line.split(/(?<=[.!?])\s+/).filter((s) => !MENTION.test(s)).join(' ');
    }).filter((l) => l !== null).join('\n');
  return t.replace(/<meta>\s*<\/meta>/g, '')
    .replace(/<meta>[ \t]+/g, '<meta>')
    .replace(/->\s*\**\s*<-/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const humanEditedOcr = (o) => !!(o && (o.source === 'manual' || o.edited_by || o.edited_at));

async function repairOcr(db, page, next) {
  const o = page.ocr || {};
  const before = o.data;
  if (humanEditedOcr(o)) return 'human_edited';
  if (next === before) return 'no_change';
  if (!APPLY) return 'dry_run';
  const beforeHash = contentHash(before), afterHash = contentHash(next);
  await db.collection('page_revisions').insertOne({
    id: randomBytes(6).toString('hex'), page_id: page.id, book_id: page.book_id, field: 'ocr', data: before,
    source: SOURCE, reason: REASON, issue: ISSUE, model: o.model, original_date: o.updated_at,
    created_at: new Date(), content_hash: beforeHash, after_content_hash: afterHash,
  });
  const set = { 'ocr.data': next, updated_at: new Date() };
  if (o.content_hash) set['ocr.content_hash'] = afterHash;
  const res = await db.collection('pages').updateOne({ id: page.id, 'ocr.data': before }, { $set: set });
  return res.modifiedCount === 1 ? 'written' : 'write_raced';
}

await withMongo(async (db) => {
  const books = await db.collection('books')
    .find({ ...(ONLY ? { id: { $in: ONLY } } : { 'catalog_metadata.collections': 'early-european-books' }) },
      { projection: { _id: 0, id: 1, title: 1 } }).toArray();
  const tally = { books: books.length, pages: 0, ocr: {}, tr: {}, residual: 0 };
  const residual = [], trChanged = [];
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const b of books) {
    const pages = await db.collection('pages').find(
      { book_id: b.id, $or: [{ 'ocr.data': { $regex: 'ProQuest', $options: 'i' } }, { 'translation.data': { $regex: 'ProQuest', $options: 'i' } }] },
      { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, ocr: 1, translation: 1 } }).toArray();
    if (!pages.length) continue;
    if (APPLY) await recordSweepAction(db, { sweep: SOURCE, book_id: b.id, action: 'strip-proquest-stamp', detail: { pages: pages.map((p) => p.page_number), issue: ISSUE } });
    for (const p of pages) {
      tally.pages++;
      const nextO = stripStamp(p.ocr?.data), nextT = stripStamp(p.translation?.data);
      if (/ProQuest/i.test(nextO || '') || /ProQuest/i.test(nextT || '')) { tally.residual++; residual.push({ book_id: b.id, page: p.page_number }); continue; }
      if (typeof p.ocr?.data === 'string' && /ProQuest/i.test(p.ocr.data)) bump(tally.ocr, await repairOcr(db, p, nextO));
      if (typeof p.translation?.data === 'string' && /ProQuest/i.test(p.translation.data)) {
        const r = await repairTranslationText(db, p, nextT, { expectBefore: p.translation.data, source: SOURCE, reason: REASON, issue: ISSUE, apply: APPLY });
        bump(tally.tr, r.status === 'skipped' ? `skipped:${r.why}` : r.status);
        if (r.status === 'written') trChanged.push(p.id);
      }
    }
  }
  if (APPLY && trChanged.length) tally.mirror = await resyncMirrors(db, trChanged);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ ...tally, apply: APPLY }, null, 1));
  writeFileSync(join(OUT, 'residual.json'), JSON.stringify(residual, null, 1));
  console.log(JSON.stringify({ ...tally, apply: APPLY }, null, 1));
});
