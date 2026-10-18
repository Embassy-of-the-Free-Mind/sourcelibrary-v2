#!/usr/bin/env node
/**
 * Read every visible collection's members against its theme with Opus, and untag the clear strays (#6899).
 *
 * PRIOR ART: scripts/maintenance/audit-collections.mjs checks structure (names, kinds, parents, counts), not
 * whether a member belongs; scripts/workers/enrich-worker.mjs Phase 7.6 ADDS tags by score and never subtracts;
 * scripts/identity-evidence/collection-copies-2026-10-03.method/ removed same-edition copies, not off-theme books.
 * The `claude -p` lanes are imported from scripts/maintenance/curate-collection-highlights.mjs.
 *
 * Why: /collections/maya opened on Herold's Heydenweldt and its grid held Codex Fejérváry-Mayer (Aztec, not Maya).
 * The tagger adds a book wherever its score clears a bar, so broad or keyword-adjacent books drift into shelves
 * whose readers expect something specific.
 *
 *   plan    members per collection (visible; id, title, author, year, language, first 300 chars of summary),
 *           in batches of --batch (60).
 *   judge   Opus via `claude -p` (subscription): for each batch, list only the members that are NOT on theme,
 *           as `stray` (clearly does not belong under any fair reading of the collection) or `borderline`,
 *           each with a one-line reason. Everything not listed is on theme. Verdicts are files under --out.
 *   apply   for every `stray`: $pull the slug from books.collections (other tags kept), $unset its
 *           collection_relevance.<slug>, bump updated_at (the Supabase grid syncs on it, #4399). Never hides or
 *           deletes. DRY unless --apply; writes untag-log.jsonl BEFORE the first write; one sweep_log row per
 *           untag. Borderline verdicts are listed in borderline.jsonl, never applied.
 *
 *   node --env-file=.env.production.local scripts/maintenance/audit-collection-membership.mjs plan  --out=DIR [--slug=a,b] [--books-only|--art-only]
 *   CLAUDE_BIN=~/.local/bin/claude node --env-file=… audit-collection-membership.mjs judge --out=DIR [--lanes=3]
 *   node --env-file=… audit-collection-membership.mjs apply --out=DIR [--apply] [--only=slug,…] [--skip=slug,…]
 *
 * After --apply: run scripts/workers/sync-books-catalog.mjs (incremental), then revalidate the touched
 * collections (--revalidate does it here), then rerun curate-collection-highlights.mjs plan/judge/apply so no
 * highlight points at an untagged book.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { recordSweepActions } from '../lib/sweep-log.mjs';
import { revalidateCollection } from '../lib/revalidate.mjs';
import { runLanes, summaryText } from './curate-collection-highlights.mjs';

const STEP = process.argv[2];
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const flag = (n) => process.argv.includes(`--${n}`);
const OUT = arg('out');
const list = (n) => (arg(n) ? new Set(arg(n).split(',')) : null);
const SWEEP = `collection-membership-audit-${new Date().toISOString().slice(0, 10)}`;
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const P = (f) => path.join(OUT, f);

async function connect() {
  const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await c.connect();
  return { client: c, db: c.db('bookstore') };
}

async function plan() {
  const SLUGS = list('slug');
  const BATCH = Number(arg('batch', 60));
  const { client, db } = await connect();
  const cols = (await db.collection('collections').find({ visible: true },
    { projection: { slug: 1, name: 1, subtitle: 1, description: 1, kind: 1, parent: 1, collection_type: 1 } }).toArray())
    .filter((c) => !SLUGS || SLUGS.has(c.slug));
  const batches = [];
  for (const col of cols) {
    const filter = { collections: col.slug, visible: true };
    if (flag('books-only')) filter.pages_count = { $gt: 0 };
    if (flag('art-only')) filter.resource_type = { $exists: true };
    const members = await db.collection('books').find(filter, { projection: {
      _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, resource_type: 1,
      summary: 1, 'reading_summary.overview': 1, 'enrichment.subject': 1,
    } }).sort({ id: 1 }).toArray();
    if (!members.length) continue;
    const rows = members.map((b) => ({
      id: b.id, title: (b.display_title || b.title || '').slice(0, 200), author: b.author || '', year: b.year || b.published || '',
      language: b.language || '', ...(b.resource_type ? { type: b.resource_type } : {}),
      summary: (summaryText(b) || (Array.isArray(b.enrichment?.subject) ? b.enrichment.subject.join(', ') : b.enrichment?.subject || ''))
        .replace(/\s+/g, ' ').slice(0, 300),
    }));
    const parent = col.parent ? await db.collection('collections').findOne({ slug: col.parent }, { projection: { name: 1 } }) : null;
    for (let i = 0; i < rows.length; i += BATCH) {
      batches.push({ key: `${col.slug}--${String(i / BATCH).padStart(4, '0')}`, slug: col.slug,
        collection: { slug: col.slug, name: col.name, subtitle: col.subtitle || '', kind: col.kind || '', parent: parent?.name || '',
          description: String(col.description || '').replace(/\s+/g, ' ').slice(0, 900) },
        members: rows.slice(i, i + BATCH) });
    }
  }
  await client.close();
  fs.writeFileSync(P('batches.json'), JSON.stringify(batches));
  console.log(`${new Set(batches.map((b) => b.slug)).size} collections, ${batches.reduce((n, b) => n + b.members.length, 0)} member slots, ${batches.length} batches`);
}

const PROMPT = (b) => `You are auditing the membership of one collection in a digital library of historical primary sources. Readers open this collection expecting books about its subject. Below are the collection's name, subtitle, kind and description, and a batch of its members.

Decide for each member whether it belongs. List ONLY the members that do NOT clearly belong:
- "stray": clearly off the collection's subject under any fair reading of its name, subtitle and description. A reader would be puzzled to find it here. Examples: a Mesoamerican codex of the Aztec/Borgia group in a Maya collection; a grammar book in an erotica collection; a book on an unrelated region, tradition or field that shares only a keyword.
- "borderline": arguably related (adjacent tradition, general reference, secondary scholarship, a miscellany with one relevant part, an unclear record) but not squarely on theme.

Be conservative with "stray": if a book could reasonably be there, call it borderline or leave it out. Broad collections (natural philosophy, literature, theology) accept a wide range. If kind is "provenance" or the description says the collection is defined by a printer, library, language or period rather than a subject, judge only against that criterion. A sub-collection (parent given) should be about its own narrower subject. Judge from the title, author, year and summary; a summary may be thin or wrong, so do not call a book a stray on the summary alone when its title and author fit.

Reply with ONLY a JSON array (empty [] if every member belongs), no prose, no markdown fence:
[{"id": "<member id>", "verdict": "stray"|"borderline", "reason": "<one short line>"}]

COLLECTION:
${JSON.stringify(b.collection, null, 1)}

MEMBERS:
${JSON.stringify(b.members, null, 1)}`;

async function judge() {
  const batches = readJson(P('batches.json'), null);
  if (!batches) throw new Error('run plan first');
  const only = list('only');
  const todo = only ? batches.filter((b) => only.has(b.slug)) : batches;
  // An id the batch does not hold (a mistyped hex id) is dropped at load, not a reason to rerun the batch;
  // a reply where most ids miss is.
  await runLanes(todo, Number(arg('lanes', 3)), P('verdicts'), PROMPT, (arr, b) => Array.isArray(arr)
    && arr.every((x) => ['stray', 'borderline'].includes(x.verdict) && typeof x.reason === 'string')
    && arr.filter((x) => b.members.some((m) => m.id === x.id)).length >= arr.length * 0.8);
}

function loadVerdicts() {
  const batches = readJson(P('batches.json'), []);
  const byKey = new Map(batches.map((b) => [b.key, b]));
  const out = [];
  for (const f of fs.existsSync(P('verdicts')) ? fs.readdirSync(P('verdicts')) : []) {
    const b = byKey.get(f.replace(/\.json$/, ''));
    if (!b) continue;
    for (const v of readJson(P(`verdicts/${f}`), [])) {
      const m = b.members.find((x) => x.id === v.id);
      if (!m) continue;
      out.push({ slug: b.slug, collection: b.collection.name, ...v, title: m?.title, author: m?.author, year: m?.year });
    }
  }
  return { batches, out };
}

async function apply() {
  const only = list('only'), skip = list('skip');
  const { batches, out } = loadVerdicts();
  const judged = new Set(fs.existsSync(P('verdicts')) ? fs.readdirSync(P('verdicts')).map((f) => f.replace(/\.json$/, '')) : []);
  const pick = (v) => (!only || only.has(v.slug)) && !(skip && skip.has(v.slug));
  const strays = out.filter((v) => v.verdict === 'stray' && pick(v));
  const borderline = out.filter((v) => v.verdict === 'borderline');
  fs.writeFileSync(P('borderline.jsonl'), borderline.map((v) => JSON.stringify(v)).join('\n') + '\n');
  // Per-collection counts for the report.
  const per = {};
  for (const b of batches) { const r = (per[b.slug] ||= { members: 0, judged: 0, stray: 0, borderline: 0 }); r.members += b.members.length; if (judged.has(b.key)) r.judged += b.members.length; }
  for (const v of out) per[v.slug][v.verdict]++;
  fs.writeFileSync(P('per-collection.json'), JSON.stringify(per, null, 1));
  console.log(`judged ${Object.values(per).reduce((n, r) => n + r.judged, 0)} member slots; stray ${out.filter((v) => v.verdict === 'stray').length}, borderline ${borderline.length}; to untag now ${strays.length}`);
  if (!flag('apply')) { fs.writeFileSync(P('untag-dry.jsonl'), strays.map((v) => JSON.stringify(v)).join('\n') + '\n'); return; }

  const { client, db } = await connect();
  const logFile = P('untag-log.jsonl');
  const already = new Set(fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.book_id}|${r.slug}`; }) : []);
  const todo = strays.filter((v) => !already.has(`${v.id}|${v.slug}`));
  const before = new Map((await db.collection('books').find({ id: { $in: todo.map((v) => v.id) } }, { projection: { _id: 0, id: 1, collections: 1 } }).toArray()).map((b) => [b.id, b.collections || []]));
  // Log BEFORE writing: an untag is a change readers see.
  fs.appendFileSync(logFile, todo.map((v) => JSON.stringify({ sweep: SWEEP, book_id: v.id, slug: v.slug, title: v.title, reason: v.reason, collections_before: before.get(v.id) || null, at: new Date().toISOString() })).join('\n') + (todo.length ? '\n' : ''));
  const touched = new Set(), rows = [];
  let changed = 0;
  for (const v of todo) {
    if (!(before.get(v.id) || []).includes(v.slug)) continue;
    const r = await db.collection('books').updateOne({ id: v.id, collections: v.slug },
      { $pull: { collections: v.slug }, $unset: { [`collection_relevance.${v.slug}`]: '' }, $currentDate: { updated_at: true } });
    if (r.modifiedCount) {
      changed++; touched.add(v.slug);
      rows.push({ sweep: SWEEP, book_id: v.id, action: 'untagged-from-collection', detail: { collection: v.slug, reason: v.reason, by: 'claude-opus (claude -p), judged against name+subtitle+description' } });
    }
  }
  if (rows.length) await recordSweepActions(db, rows);
  await client.close();
  console.log(`APPLIED: untagged ${changed} book-collection pairs in ${touched.size} collections`);
  // touched.json accumulates across runs, so `apply --apply` → sync → `apply --apply --revalidate` purges them all.
  const allTouched = new Set([...readJson(P('touched.json'), []), ...touched]);
  fs.writeFileSync(P('touched.json'), JSON.stringify([...allTouched]));
  if (flag('revalidate')) for (const slug of allTouched) {
    try { await revalidateCollection(slug, { quiet: true }); } catch (e) { console.log(`  revalidate ${slug}: ${e.message}`); }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!['plan', 'judge', 'apply'].includes(STEP) || !OUT) {
    console.error('usage: audit-collection-membership.mjs plan|judge|apply --out=DIR (see header)');
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  await ({ plan, judge, apply })[STEP]();
}
