/**
 * Fix unclosed/malformed <note> tags in stored translations, for a named list of pages (#5644).
 *
 * The corpus-wide scan this script used to run is retired: it wrote revisions without a
 * content_hash, overwrote human-edited pages and never re-synced the Supabase mirrors. Derive
 * the page list with an audit, then pass it here.
 *
 * Repair, in order:
 *   1. a malformed closer (`</note.` `</note,`) becomes `</note>`;
 *   2. an UNCLOSED note is closed at the tightest plausible point — right after a leading
 *      `<term>…</term>` (optionally labelled `original:`/`Sanskrit:`/`Tibetan:`), else before the
 *      first sentence break, newline or block tag. Closing at the next note or blank line (the
 *      writer-side rule) balances the tags but leaves the running text it swallowed inside the
 *      note, still hidden from a reader with notes off — the defect #5644 is about;
 *   3. a `</note>` left with no opener (the intended closer of a nested note) is dropped;
 *   4. repairAnnotationTags (the shared twin of src/lib/sanitize-translation-tags.ts) for
 *      anything left: wrong closers, nesting, other annotation tags.
 *
 * Guards (scripts/lib/translation-text-repair.mjs): human-edited pages are skipped; the write
 * is conditional on the text read; a page_revisions row (before/after content_hash, reason,
 * issue) is written first; both Supabase mirrors are re-synced after.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/fix-unclosed-note-tags.mjs --ids=<file.json|id,id,…>   # dry run
 *   … --apply [--out=<diff.json>]
 */

import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { repairAnnotationTags } from '../lib/annotation-tag-repair.mjs';
import { repairTranslationText, resyncMirrors, noteTagBalance } from '../lib/translation-text-repair.mjs';

const ARG = (n) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
const OUT = ARG('--out') || '/tmp/fix-unclosed-note-tags-diff.json';
const SOURCE = 'fix-unclosed-note-tags-5644';

const LEADING_TERMS = /^(?:(?:original|sanskrit|tibetan)\s*:\s*)?<term>[^<]*<\/term>(?:\s*[;,]\s*(?:original|sanskrit|tibetan)\s*:\s*<term>[^<]*<\/term>)*/i;
const STOP = /[.;!?](?=\s|$)|\n|<(?:note|summary|meta|keywords|leaf-break)\b/i;
const NOTE_TOKEN = /<note(?:\s[^>]*)?>|<\/note>/gi;

/** Close each unclosed <note> at the tightest plausible point (step 2 above). */
export function closeUnclosedNotes(text) {
  const toks = [...text.matchAll(NOTE_TOKEN)].map((m) => ({ i: m.index, end: m.index + m[0].length, close: m[0][1] === '/' }));
  const edits = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.close) continue;
    const next = toks[k + 1];
    if (next && next.close) { k++; continue; } // paired
    const segEnd = next ? next.i : text.length;
    const seg = text.slice(t.end, segEnd);
    const lead = seg.match(LEADING_TERMS);
    let at = lead ? lead[0].length : seg.search(STOP);
    if (at < 0) at = seg.length;
    if (at === 0 || !seg.slice(0, at).trim()) edits.push([t.i, t.end, '']); // empty: drop the stray opener
    else edits.push([t.end + at, t.end + at, '</note>']);
  }
  let out = text;
  for (const [a, b, s] of edits.sort((x, y) => y[0] - x[0])) out = out.slice(0, a) + s + out.slice(b);
  return out;
}

/** Drop a `</note>` with no open note before it — once step 2 has closed a nested opener, its
 *  intended closer is left over. Removing it changes no words and shows the text it ended. */
export function dropOrphanNoteCloses(text) {
  let depth = 0;
  return text.replace(NOTE_TOKEN, (tok) => {
    if (tok[1] !== '/') { depth++; return tok; }
    if (depth === 0) return '';
    depth--;
    return tok;
  });
}

export function repairNotes(text) {
  const malformedFixed = text.replace(/<\/note([^>a-z])/gi, '</note>$1');
  return repairAnnotationTags(dropOrphanNoteCloses(closeUnclosedNotes(malformedFixed)));
}

async function main() {
  const idsArg = ARG('--ids');
  if (!idsArg) { console.error('--ids=<file.json|id,id,…> required — the corpus-wide scan is retired (#5644)'); process.exit(1); }
  const ids = fs.existsSync(idsArg) ? JSON.parse(fs.readFileSync(idsArg, 'utf8')).map((x) => (typeof x === 'string' ? x : x.id)) : idsArg.split(',');

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const rows = [];
  const written = [];
  for (const id of ids) {
    const page = await db.collection('pages').findOne({ id });
    if (!page) { rows.push({ id, status: 'skipped', why: 'not_found' }); continue; }
    const before = page.translation?.data || '';
    const next = repairNotes(before);
    const row = { id, book_id: page.book_id, page: page.page_number, balance_before: noteTagBalance(before), balance_after: noteTagBalance(next) };
    const res = await repairTranslationText(db, page, next, {
      expectBefore: before, source: SOURCE, issue: '#5644', jobId: SOURCE, apply: APPLY,
      reason: 'unbalanced or malformed <note> tags closed so running text is not hidden inside a note; no words changed',
    });
    rows.push({ ...row, ...res, before, after: next });
    if (res.status === 'written') written.push(id);
  }
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
  const count = (s) => rows.filter((r) => r.status === s).length;
  const skips = rows.filter((r) => r.status === 'skipped').map((r) => `${r.id}:${r.why}`);
  console.log(`${APPLY ? 'written' : 'would write'}: ${count(APPLY ? 'written' : 'dry_run')} · skipped: ${skips.length}${skips.length ? ` (${skips.join(', ')})` : ''} · still unbalanced after repair: ${rows.filter((r) => r.balance_after && !r.balance_after.balanced).length} · diff → ${OUT}`);
  if (written.length) console.log('mirrors:', JSON.stringify(await resyncMirrors(db, written)));
  await client.close();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
