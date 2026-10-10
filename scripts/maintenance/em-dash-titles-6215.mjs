#!/usr/bin/env node
// PRIOR ART: scripts/audit/em-dash-prose.mjs — counts em dashes in stored prose and never writes;
// it does not read titles. The prose rewrites of #6215 were done by hand into
// `prose_rewrite_backups` with no script kept; this uses the same backup rows for a rule that
// needs no hand: a title's em dash is our own separator, never the source's wording.
/**
 * Remove the em dash from our English book titles (#6215; Derek, 2026-10-10: `title` and
 * `display_title` of live books, with undo).
 *
 * The dash in these titles is a catalogue separator we wrote: "Author — Title (1735)",
 * "御定駢字類編·卷十 — Imperial Parallel Characters (vol 193)", "The Path — Vol-III No-7".
 * Rule, per " — ":
 *   a comma  when it sits inside parentheses, when the title already has a colon elsewhere, or
 *            when what follows is a volume word, a number or a lower-case word;
 *   a colon  otherwise (a subtitle or gloss).
 * A dash with no spaces becomes a comma and a space. Nothing else in the title changes.
 *
 * Writes: one `prose_rewrite_backups` row per field ({ coll, _id, field, old, new, at, issue }),
 * then `$set` pinned to the old value, `updated_at` bumped (the Supabase catalogue sync keys on it).
 *   node --env-file=.env.production.local scripts/maintenance/em-dash-titles-6215.mjs            dry run + sample
 *   … --apply
 *   … --undo [--apply]     restore every title this script wrote that is still unchanged
 */
import { MongoClient } from 'mongodb';

const ISSUE = 6215;
const TAG = 'em-dash-titles-6215';
const APPLY = process.argv.includes('--apply');
const VOLUME_WORD = /^(?:vols?\b|volume\b|part\b|parts\b|book\b|books\b|juan\b|kwon\b|no\b|nos\b|tome\b|band\b|fasc|chapter\b|ms\b|\d)/iu;

/** The title without its em dashes. Pure. */
export function undash(title) {
  let out = '';
  let rest = String(title);
  for (;;) {
    const m = /\s*—\s*/.exec(rest);
    if (!m) break;
    const before = out + rest.slice(0, m.index);
    const after = rest.slice(m.index + m[0].length);
    const open = (before.match(/[(（\[]/g) || []).length - (before.match(/[)）\]]/g) || []).length;
    const lower = /^\p{Ll}/u.test(after) && !/^(?:vols?|volume|part|juan|kwon|no|tome|band|chapter)\b/i.test(after);
    const comma = open > 0 || /[:：]/.test(before) || /[:：]/.test(after) || VOLUME_WORD.test(after) || lower || !/\s/.test(m[0]);
    if (!before.trim()) { out = ''; rest = after; continue; } // a leading dash
    if (!after.trim()) { out = before.trimEnd(); rest = ''; break; } // a trailing dash
    out = `${before.trimEnd()}${comma ? ', ' : ': '}`;
    rest = after;
  }
  return (out + rest).replace(/,\s*,/g, ',').replace(/:\s*:/g, ':');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const client = new MongoClient(process.env.MONGODB_URI, { socketTimeoutMS: 600_000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = db.collection('books');
  const backups = db.collection('prose_rewrite_backups');
  try {
    if (process.argv.includes('--undo')) {
      const rows = await backups.find({ issue: ISSUE, tag: TAG }).toArray();
      let restored = 0, changed = 0;
      for (const r of rows) {
        if (!APPLY) continue;
        const res = await books.updateOne({ _id: r._id_book, [r.field]: r.new }, { $set: { [r.field]: r.old, updated_at: new Date() } });
        if (res.modifiedCount) restored++; else changed++;
      }
      console.log(JSON.stringify({ backup_rows: rows.length, restored, changed_since: changed, dry_run: !APPLY }));
    } else {
      const rows = await books.find({ visible: true, pages_count: { $gt: 0 }, $or: [{ title: /—/ }, { display_title: /—/ }] }, { projection: { id: 1, title: 1, display_title: 1 } }).toArray();
      const plan = [];
      for (const b of rows) for (const field of ['title', 'display_title']) {
        const old = b[field];
        if (typeof old !== 'string' || !old.includes('—')) continue;
        const next = undash(old);
        if (next.includes('—') || !next.trim() || next === old) { console.log(`REFUSED ${b.id} ${field}: ${old}`); continue; }
        plan.push({ _id: b._id, id: b.id, field, old, new: next });
      }
      const count = (f) => plan.filter((p) => p.field === f).length;
      console.log(`live books with an em dash: ${rows.length}; title ${count('title')}, display_title ${count('display_title')}`);
      // One example per title shape, taken in id order: a sample to read, not a statistic.
      const seen = new Set();
      for (const p of [...plan].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))) {
        const shape = p.old.replace(/[\p{L}\p{N}]+/gu, 'w').slice(0, 40);
        if (seen.has(shape) || seen.size >= Number(process.env.SAMPLE || 40)) continue;
        seen.add(shape);
        console.log(`  ${p.field}: ${p.old}\n        → ${p.new}`);
      }
      if (APPLY) {
        const now = new Date();
        let written = 0, raced = 0;
        for (let i = 0; i < plan.length; i += 50) {
          const chunk = plan.slice(i, i + 50);
          await backups.insertMany(chunk.map((p) => ({ coll: 'books', _id_book: p._id, book_id: p.id, field: p.field, old: p.old, new: p.new, at: now, issue: ISSUE, tag: TAG })));
          for (const p of chunk) {
            const res = await books.updateOne({ _id: p._id, [p.field]: p.old }, { $set: { [p.field]: p.new, updated_at: now } });
            if (res.modifiedCount) written++; else raced++;
          }
        }
        console.log(JSON.stringify({ planned: plan.length, written, raced }));
      } else console.log('DRY RUN: nothing was written.');
    }
  } finally { await client.close(); }
}
