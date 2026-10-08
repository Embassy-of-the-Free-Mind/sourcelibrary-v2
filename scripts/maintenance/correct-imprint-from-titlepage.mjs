#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/apply-aldine-byline-correction-3894.mjs — the write shape copied here (dry run by
// default, a backup file, a provenance stamp with previous_value, a sweep_log row, the Supabase mirror), but it only
// writes `author`, and only from a verdict file of many books. recatalogue-magliabechiano-4164.mjs and
// correct-aristotle-titles.mjs are single-purpose scripts with their corrections written into the source. None of
// them corrects the IMPRINT (year / place / printer) of one book from a title page a person has read, which is the
// shape of every row in the #4043 human-review queue.
/**
 * Correct one book's imprint (year, place, printer) from its own title page, and record who read what, where.
 *
 * WHO RUNS IT: a person or a session that has opened the title-page scan and read the imprint off the image.
 * WHAT IT CHANGES: `published`, `year`, `year_source`, `place_published`, `publisher` on `books` (only the ones
 * passed), the matching `books.field_provenance.<field>` stamps, and the `books_catalog` row in Supabase.
 * WHAT IT DOES NOT CHANGE: `edition_key` (run scripts/maintenance/materialize-edition-keys.ts afterwards — a changed
 * year moves the key), the title, the author, the slug, visibility, or any page.
 *
 * `place_published` and `publisher` are the fields the citation surfaces read (#4053). They hold the STATED imprint:
 * what the title page says. A catalogue's different determination belongs in `publication_place` / `printer`, not here.
 *
 * Every stamp carries: this script's name, the previous value, the page number of the title page, the words read
 * there, how they were read (`--method`, e.g. "read from the page image"), by whom (`--reader`), and the issue.
 * The old values also go to scripts/maintenance/backups/correct-imprint-from-titlepage.json so `--revert` can
 * put them back.
 *
 *   node --env-file=.env.production.local scripts/maintenance/correct-imprint-from-titlepage.mjs \
 *     --book-id=<id> --year=1549 --place=Lyon --publisher="Jean de Tournes" \
 *     --page=3 --quote="LVGDVNI, Apud Ioan. Tornaesium. M. D. XLIX." \
 *     --method="read from the page image" --reader="<who>" --issue=4043            # dry run
 *   ... --apply
 *   node --env-file=.env.production.local scripts/maintenance/correct-imprint-from-titlepage.mjs --book-id=<id> --revert --apply
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = 'scripts/maintenance/correct-imprint-from-titlepage.mjs';
const BACKUP = join(HERE, 'backups', 'correct-imprint-from-titlepage.json');
const SWEEP = 'imprint-from-titlepage';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const BOOK = arg('book-id');
if (!BOOK) { console.error('--book-id is required'); process.exit(1); }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sbHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
// Mirror only the columns the catalogue row actually has; its shape is not this script's to define.
async function supabaseMirror(id, values) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: 'no supabase creds' };
  const cur = await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${encodeURIComponent(id)}&select=*`, { headers: sbHeaders });
  const rows = await cur.json().catch(() => null);
  if (!cur.ok || !Array.isArray(rows)) return { ok: false, status: cur.status };
  if (!rows.length) return { ok: true, rows: 0, note: 'no books_catalog row' };
  const body = Object.fromEntries(Object.entries(values).filter(([k]) => k in rows[0]));
  if (!Object.keys(body).length) return { ok: true, rows: 0, note: 'no matching columns' };
  if (!APPLY) return { ok: true, would: body };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=representation' },
    // updated_at is load-bearing: the grid reads it to decide what changed.
    body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }),
  });
  const out = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, rows: Array.isArray(out) ? out.length : 0, set: body };
}
const readBackup = () => (existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : { entries: [] });

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');
const FIELDS = ['published', 'year', 'year_source', 'place_published', 'publisher'];
const b = await books.findOne({ $or: [{ id: BOOK }, { _id: BOOK }] }, { projection: { id: 1, title: 1, field_provenance: 1, ...Object.fromEntries(FIELDS.map((f) => [f, 1])) } });
if (!b) { console.error(`book ${BOOK} not found (looked up by id and _id)`); await mc.close(); process.exit(1); }

if (REVERT) {
  const entry = readBackup().entries.filter((e) => e.book_id === b.id).pop();
  if (!entry) { console.error('no backup entry for this book'); await mc.close(); process.exit(1); }
  console.log(`${APPLY ? 'REVERT' : 'would revert'} ${b.id}:`, JSON.stringify(entry.before));
  if (APPLY) {
    const set = {}, unset = {};
    for (const f of Object.keys(entry.after)) {
      if (entry.before[f] === undefined) unset[f] = ''; else set[f] = entry.before[f];
      if (entry.before_provenance?.[f] === undefined) unset[`field_provenance.${f}`] = ''; else set[`field_provenance.${f}`] = entry.before_provenance[f];
    }
    const r = await books.updateOne({ id: b.id }, { ...(Object.keys(set).length ? { $set: { ...set, updated_at: new Date() } } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    console.log('  modifiedCount', r.modifiedCount, '| supabase', JSON.stringify(await supabaseMirror(b.id, entry.before)));
    await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'imprint-correction-reverted', detail: { restored: entry.before } });
  }
  await mc.close(); process.exit(0);
}

const year = arg('year') ? Number(arg('year')) : undefined;
if (arg('year') && !(Number.isInteger(year) && year > 0 && year < 2100)) { console.error('--year must be a year'); process.exit(1); }
const after = {
  ...(year ? { published: String(year), year, year_source: 'titlepage' } : {}),
  ...(arg('place') ? { place_published: arg('place') } : {}),
  ...(arg('publisher') ? { publisher: arg('publisher') } : {}),
};
const evidence = { page_number: arg('page') ? Number(arg('page')) : null, as_printed: arg('quote') ?? null, method: arg('method') ?? null, reader: arg('reader') ?? null, issue: arg('issue') ? `#${arg('issue')}` : null, note: arg('note') ?? null };
if (!Object.keys(after).length) { console.error('nothing to change: pass --year, --place and/or --publisher'); process.exit(1); }
for (const k of ['page_number', 'as_printed', 'method', 'reader']) {
  if (!evidence[k]) { console.error(`--${{ page_number: 'page', as_printed: 'quote' }[k] ?? k} is required: a correction without its evidence is not recorded`); process.exit(1); }
}

const changed = Object.fromEntries(Object.entries(after).filter(([f, v]) => b[f] !== v));
console.log(`${b.id}  ${String(b.title).slice(0, 70)}`);
for (const f of Object.keys(after)) console.log(`  ${f.padEnd(16)} ${JSON.stringify(b[f])} -> ${JSON.stringify(after[f])}${f in changed ? '' : '   (unchanged)'}`);
console.log('  evidence        ', JSON.stringify(evidence));
if (!Object.keys(changed).length) { console.log('nothing differs; no write'); await mc.close(); process.exit(0); }

const now = new Date().toISOString();
const before = Object.fromEntries(Object.keys(changed).map((f) => [f, b[f]]));
const beforeProv = Object.fromEntries(Object.keys(changed).map((f) => [f, b.field_provenance?.[f]]));
const stamps = Object.fromEntries(Object.keys(changed).map((f) => [`field_provenance.${f}`, {
  source: 'titlepage', script: SCRIPT, date: now, previous_value: b[f] ?? null, previous_provenance: b.field_provenance?.[f] ?? null, evidence,
}]));
if (!APPLY) {
  console.log('  supabase        ', JSON.stringify(await supabaseMirror(b.id, changed)));
  console.log('\ndry run — add --apply to write'); await mc.close(); process.exit(0);
}

const bk = readBackup();
bk.entries.push({ book_id: b.id, at: now, before, before_provenance: beforeProv, after: changed, evidence });
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify(bk, null, 1));
// Guard on the values read above: if another writer changed the record in between, write nothing.
const r = await books.updateOne({ id: b.id, ...Object.fromEntries(Object.keys(changed).map((f) => [f, b[f] === undefined ? { $exists: false } : b[f]])) }, { $set: { ...changed, ...stamps, updated_at: new Date() } });
console.log(`\nbooks.modifiedCount ${r.modifiedCount}`);
if (r.modifiedCount !== 1) { console.error('!! the record changed since it was read; nothing written'); await mc.close(); process.exit(1); }
console.log('supabase', JSON.stringify(await supabaseMirror(b.id, changed)));
await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'imprint-corrected-from-titlepage', detail: { from: before, to: changed, evidence } });
console.log('sweep_log row written. Next: npx tsx scripts/maintenance/materialize-edition-keys.ts (dry run) to restamp edition_key.');
await mc.close();
