#!/usr/bin/env node
/**
 * Clean every visible collection's `highlighted_books` (#6899).
 *
 * PRIOR ART: scripts/identity-evidence/collection-copies-2026-10-03.method/6-apply-membership.mjs
 * swapped highlights to a keeper but checked nothing else; scripts/maintenance/restore-collection-copy-membership.mjs
 * puts membership back and leaves highlights alone; scripts/cron/collection-health.mjs and
 * src/app/api/cron/collection-health/route.ts score a highlight COUNT, never membership. None drops a
 * non-member, repairs START HERE, or replaces the stock note.
 *
 * What a reader saw: /collections/maya opened ("Start here") on Herold's Heydenweldt, a book that was not in the
 * collection. 148 highlights in 50 collections pointed at non-members, and 1,039 carried the stock note
 * "A key work in the … collection." (which says nothing).
 *
 * Three steps, each reviewable before the next:
 *
 *   plan     mechanical: per collection, drop every entry whose book is not a visible member
 *            (books.collections ∋ slug, visible, pages_count > 0; for visual_art, an artwork member),
 *            normalise legacy shapes (a bare id string, `{id}` instead of `{book_id}`), drop repeats,
 *            and list what needs a judgement: START HERE gone, and stock notes.
 *   judge    Opus via `claude -p` (subscription, no API key): (a) is START HERE on the collection's theme,
 *            and if not or if gone, which member should open it; (b) one factual line per stock note,
 *            from the book's own summary, or empty. Verdicts land as JSON files under --out: data, read
 *            by eye before apply.
 *   apply    writes the new lists (DRY unless --apply), one sweep_log row per changed entry, and with
 *            --revalidate purges each touched /collections/<slug>.
 *
 *   node --env-file=.env.production.local scripts/maintenance/curate-collection-highlights.mjs plan  --out=DIR [--slug=a,b]
 *   node --env-file=.env.production.local scripts/maintenance/curate-collection-highlights.mjs judge --out=DIR [--lanes=3]
 *   node --env-file=.env.production.local scripts/maintenance/curate-collection-highlights.mjs apply --out=DIR [--apply] [--revalidate]
 *
 * Idempotent: rerun plan after a membership change and it drops the highlights of untagged books too.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { MongoClient, ObjectId } from 'mongodb';
import { recordSweepActions } from '../lib/sweep-log.mjs';
import { revalidateCollection } from '../lib/revalidate.mjs';

const STEP = process.argv[2];
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const flag = (n) => process.argv.includes(`--${n}`);
const OUT = arg('out');
const SLUGS = arg('slug') ? new Set(arg('slug').split(',')) : null;
const SWEEP = `collection-highlights-${new Date().toISOString().slice(0, 10)}`;
export const STOCK_NOTE = /^A key work in the .* collection\.?$/;
const CLI = process.env.CLAUDE_BIN || 'claude';
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1));
const P = (f) => path.join(OUT, f);

const BOOK_PROJ = {
  _id: 1, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, collections: 1,
  visible: 1, pages_count: 1, pages_translated: 1, resource_type: 1, thumbnail: 1, thumbnail_blob: 1,
  read_count: 1, work_id: 1, summary: 1, slug: 1, hidden_reason: 1, duplicate_of: 1, 'reading_summary.overview': 1,
};

export function summaryText(b) {
  if (typeof b.summary === 'string' && b.summary) return b.summary;
  return b.summary?.data || b.reading_summary?.overview || '';
}

/**
 * A highlight counts only when its book is a visible member that a reader can open: a book with pages, or an
 * artwork (resource_type), which art and mixed collections render as an image. Books sit in art collections too.
 */
export function isMember(book, slug) {
  if (!book || book.visible !== true || !(book.collections || []).includes(slug)) return false;
  return (book.pages_count || 0) > 0 || !!book.resource_type;
}

/** The keeper a hidden duplicate points at, as an id or a slug (both shapes exist in `hidden_reason`). */
export function duplicateKeeperRef(book) {
  if (!book || book.visible === true) return null;
  if (book.duplicate_of) return String(book.duplicate_of);
  const m = /^duplicate of (\S+)/.exec(book.hidden_reason || '');
  return m ? m[1] : null;
}

function brief(b) {
  return {
    id: b.id, title: b.display_title || b.title, author: b.author || '', year: b.year || b.published || '',
    language: b.language || '', pages: b.pages_count || 0,
    translated_pct: b.pages_count ? Math.round(100 * (b.pages_translated || 0) / b.pages_count) : 0,
    cover: !!(b.thumbnail_blob || b.thumbnail), summary: summaryText(b).replace(/\s+/g, ' ').slice(0, 300),
  };
}

async function connect() {
  const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await c.connect();
  return { client: c, db: c.db('bookstore') };
}

/** Resolve highlight refs by `id` OR `_id` (16K books carry a re-minted `_id`). */
async function resolveBooks(db, refs) {
  const ids = [...new Set(refs.filter(Boolean).map(String))];
  const oids = ids.filter((x) => /^[0-9a-f]{24}$/.test(x)).map((x) => new ObjectId(x));
  const docs = await db.collection('books').find({ $or: [{ id: { $in: ids } }, { _id: { $in: oids } }] }, { projection: BOOK_PROJ }).toArray();
  const m = new Map();
  for (const d of docs) { if (d.id) m.set(String(d.id), d); m.set(String(d._id), m.get(String(d._id)) || d); }
  return m;
}

// ── plan ────────────────────────────────────────────────────────────────────────────────────────────────
async function plan() {
  const { client, db } = await connect();
  const cols = (await db.collection('collections').find({ visible: true, 'highlighted_books.0': { $exists: true } },
    { projection: { slug: 1, name: 1, subtitle: 1, description: 1, collection_type: 1, highlighted_books: 1 } }).toArray())
    .filter((c) => !SLUGS || SLUGS.has(c.slug));
  const refOf = (h) => (typeof h === 'string' ? h : h?.book_id || h?.id);
  const books = await resolveBooks(db, cols.flatMap((c) => c.highlighted_books.map(refOf)));
  // A hidden duplicate's highlight goes to its keeper when the keeper is a member (one card per work).
  const keeperRefs = [...new Set([...books.values()].map(duplicateKeeperRef).filter(Boolean))];
  const keepers = await resolveBooks(db, keeperRefs);
  for (const d of await db.collection('books').find({ slug: { $in: keeperRefs } }, { projection: BOOK_PROJ }).toArray()) keepers.set(d.slug, d);
  // What a reader saw: the page looks highlights up by `id` with visible: true and opens on the first tier-1.
  const seenStart = (col) => col.highlighted_books.find((h) => h && typeof h === 'object' && h.tier === 1 && h.book_id
    && books.get(String(h.book_id))?.visible === true && books.get(String(h.book_id))?.id === h.book_id)?.book_id || null;
  const out = [];
  for (const col of cols) {
    const isArt = col.collection_type === 'visual_art';
    const before = col.highlighted_books;
    const after = [], dropped = [], seen = new Set();
    before.forEach((h, i) => {
      const ref = refOf(h);
      let book = books.get(String(ref));
      const entry = typeof h === 'string' ? { book_id: h } : { ...h };
      if (entry.id && !entry.book_id) { entry.book_id = entry.id; }
      delete entry.id; delete entry.slug;
      const keeper = keepers.get(duplicateKeeperRef(book) || '');
      if (!isMember(book, col.slug, isArt) && isMember(keeper, col.slug, isArt)) {
        dropped.push({ ref, title: book.display_title || book.title, why: 'hidden-duplicate', replaced_by: keeper.id });
        book = keeper; entry.book_id = keeper.id;
      }
      if (!isMember(book, col.slug, isArt)) {
        dropped.push({ ref, title: book ? (book.display_title || book.title) : entry.title || null,
          why: !book ? 'no-such-book' : book.visible !== true ? 'hidden' : !(book.collections || []).includes(col.slug) ? 'not-a-member' : 'no-pages' });
        return;
      }
      if (book.id && entry.book_id !== book.id) entry.book_id = book.id; // matched by _id: store the id the page reads
      if (seen.has(entry.book_id)) { dropped.push({ ref, title: book.display_title || book.title, why: 'repeat' }); return; }
      seen.add(entry.book_id);
      entry.title = book.display_title || book.title;
      if (entry.tier == null) entry.tier = i < 6 ? 1 : i < 15 ? 2 : 3;
      after.push(entry);
    });
    // The page opens on the first tier-1 entry in array order: keep the list in tier, rank order.
    after.sort((a, b) => (a.tier - b.tier) || ((a.rank ?? 999) - (b.rank ?? 999)));
    const startSeen = seenStart(col);
    const startAfter = after.find((e) => e.tier === 1) || null;
    out.push({
      slug: col.slug, name: col.name, subtitle: col.subtitle || '', description: String(col.description || '').slice(0, 600),
      is_art: isArt, before, after, dropped,
      start_before: startSeen,
      start_before_member: startSeen ? isMember(books.get(startSeen), col.slug, isArt) : null,
      start_after: startAfter?.book_id || null,
      start_dropped: (startSeen || null) !== (startAfter?.book_id || null),
      stock_notes: after.filter((e) => STOCK_NOTE.test(e.note || '')).map((e) => e.book_id),
    });
  }
  await client.close();
  writeJson(P('plan.json'), out);
  const s = (f) => out.reduce((n, c) => n + f(c), 0);
  console.log(`collections ${out.length}; entries ${s((c) => c.before.length)}; dropped ${s((c) => c.dropped.length)} in ${out.filter((c) => c.dropped.length).length} collections; START HERE changed ${out.filter((c) => c.start_dropped).length}; stock notes ${s((c) => c.stock_notes.length)}`);
  const why = {}; for (const c of out) for (const d of c.dropped) why[d.why] = (why[d.why] || 0) + 1;
  console.log('dropped by reason', why);
}

// ── judge ───────────────────────────────────────────────────────────────────────────────────────────────
const USAGE_LIMIT = /usage limit|limit reached|hit your (?:usage )?limit|out of extra usage|rate.?limit|\b429\b|resets? (?:at )?\d/i;
// `claude -p` prefers an API key over the subscription login, and node --env-file loads one: strip it (#6553).
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
export function claudeCall(prompt, model = 'opus') {
  return new Promise((resolve) => {
    const child = spawn(CLI, ['-p', '--model', model, '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'],
      { cwd: process.env.TMPDIR || '/tmp', stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    const timer = setTimeout(() => child.kill('SIGKILL'), 20 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {}; try { j = JSON.parse(out); } catch { /* not JSON */ }
      const text = String(j.result ?? '').trim();
      const failed = j.is_error || code !== 0;
      resolve({ text, failed, limit: failed && USAGE_LIMIT.test(text + out + err), err: (err || text).slice(-300) });
    });
  });
}
export function parseJsonReply(text) {
  const s = String(text).replace(/^\s*```[a-z]*\s*\n?/i, '').replace(/\n?\s*```\s*$/, '');
  const a = s.indexOf('['), b = s.lastIndexOf(']');
  return JSON.parse(s.slice(a, b + 1));
}
/** Run prompts through N lanes; on a usage limit, wait and retry the same item. Results cached per key. */
export async function runLanes(items, lanes, dir, makePrompt, validate) {
  fs.mkdirSync(dir, { recursive: true });
  const queue = items.filter((it) => !fs.existsSync(path.join(dir, `${it.key}.json`)));
  console.log(`  ${items.length - queue.length} cached, ${queue.length} to run in ${dir}`);
  await Promise.all(Array.from({ length: lanes }, async () => {
    while (queue.length) {
      const it = queue.shift();
      for (let attempt = 1; ; attempt++) {
        const r = await claudeCall(makePrompt(it));
        if (r.limit) { console.log(`  usage limit (${it.key}); waiting 15 min`); await new Promise((z) => setTimeout(z, 15 * 60 * 1000)); continue; }
        let parsed = null;
        try { parsed = parseJsonReply(r.text); if (!validate(parsed, it)) parsed = null; } catch { parsed = null; }
        if (parsed) { writeJson(path.join(dir, `${it.key}.json`), parsed); console.log(`  ok ${it.key}`); break; }
        if (attempt >= 3) { console.log(`  FAILED ${it.key}: ${r.err}`); break; }
      }
    }
  }));
}

const NOTE_RULES = `Rules for a note:
- One plain declarative sentence, at most 30 words, saying what this book IS or CONTAINS (subject, form, notable content). Facts only, taken from the summary; add nothing the summary does not say.
- No em dashes or en dashes. No praise or hype words (monumental, seminal, indispensable, cornerstone, landmark, invaluable, crucial, profound, timeless, foundational, testament, key work). No "this book" opener; start with the content.
- Do not mention Source Library, digitisation, translation status, or the collection.
- If the summary is empty, is about the author or a library rather than the book, is boilerplate ("A text by …"), or contradicts the title, return "" (empty). An empty note is better than a guessed one.`;

async function judge() {
  const planRows = readJson(P('plan.json'), null);
  if (!planRows) throw new Error('run plan first');
  const lanes = Number(arg('lanes', 3));
  const { client, db } = await connect();
  // (a) START HERE: is the current one on theme; if gone or off theme, pick from the highlights and top members.
  const startItems = [];
  for (const c of planRows) {
    const members = await db.collection('books').find({ collections: c.slug, visible: true,
      $or: [{ pages_count: { $gt: 0 } }, { resource_type: { $exists: true } }] }, { projection: BOOK_PROJ })
      .sort({ read_count: -1 }).limit(25).toArray();
    const hl = await resolveBooks(db, c.after.map((e) => e.book_id));
    const cands = new Map();
    for (const e of c.after.filter((x) => x.tier <= 2)) { const b = hl.get(e.book_id); if (b) cands.set(b.id, { ...brief(b), highlighted: true }); }
    for (const b of members) if (!cands.has(b.id)) cands.set(b.id, brief(b));
    const cur = c.start_after ? hl.get(c.start_after) : null;
    startItems.push({ slug: c.slug, name: c.name, subtitle: c.subtitle, description: c.description,
      current_start_here: cur ? { ...brief(cur), replaced_dropped_book: c.start_dropped } : null, candidates: [...cands.values()].slice(0, 35) });
  }
  const startBatches = [];
  for (let i = 0; i < startItems.length; i += 8) startBatches.push({ key: `start-${String(i / 8).padStart(3, '0')}`, rows: startItems.slice(i, i + 8) });
  await runLanes(startBatches, lanes, P('judge-start'), (b) => `You are the curator of a digital library of historical primary sources. Each collection page opens with one "Start here" book: the single best first book for a reader of that collection.

For EACH collection below decide:
1. on_theme: is current_start_here clearly about the collection's subject (name, subtitle, description)? true / false. If current_start_here is null, use null. "replaced_dropped_book: true" means the old Start here was removed because it was not a member; judge the current one fresh.
2. ONLY if on_theme is false or null, choose "pick": the book_id of the best Start here from candidates. Prefer: squarely on theme, a central original or best edition of a central work, a book with pages over a single image, readable (translated_pct high), has a cover. If on_theme is true, "pick" MUST be null: a person chose that book and an on-theme choice stands.
3. reason: one short line.

Reply with ONLY a JSON array, one object per collection, no prose, no markdown fence:
[{"slug": "...", "on_theme": true|false|null, "pick": "<book_id>"|null, "reason": "..."}]

COLLECTIONS:
${JSON.stringify(b.rows, null, 1)}`, (arr, b) => Array.isArray(arr) && arr.length === b.rows.length && arr.every((x, i) => x.slug === b.rows[i].slug
    && (x.pick == null || b.rows[i].candidates.some((cd) => cd.id === x.pick))
    && !(x.on_theme === true && x.pick)));

  // (b) notes: every stock note left after the START HERE picks, plus a picked book with no note.
  const picks = new Map();
  for (const f of fs.readdirSync(P('judge-start'))) for (const v of readJson(P(`judge-start/${f}`), [])) if (v.pick) picks.set(v.slug, v.pick);
  const needNote = new Set();
  for (const c of planRows) {
    for (const id of c.stock_notes) needNote.add(id);
    const p = picks.get(c.slug);
    const e = p && c.after.find((x) => x.book_id === p);
    if (p && (!e || !e.note || STOCK_NOTE.test(e.note))) needNote.add(p);
  }
  const nb = await resolveBooks(db, [...needNote]);
  await client.close();
  const done = new Set();
  if (fs.existsSync(P('judge-notes'))) for (const f of fs.readdirSync(P('judge-notes'))) for (const v of readJson(P(`judge-notes/${f}`), [])) done.add(v.id);
  const noteRows = [...needNote].filter((id) => !done.has(id)).map((id) => nb.get(id)).filter(Boolean)
    .map((b) => ({ id: b.id, title: b.display_title || b.title, author: b.author || '', year: b.year || b.published || '', summary: summaryText(b).replace(/\s+/g, ' ').slice(0, 900) }));
  const noteBatches = [];
  for (let i = 0; i < noteRows.length; i += 40) noteBatches.push({ key: `notes-${Date.now().toString(36)}-${String(i / 40).padStart(3, '0')}`, rows: noteRows.slice(i, i + 40) });
  await runLanes(noteBatches, lanes, P('judge-notes'), (b) => `Write a one-line note for each book below, shown under its card on a library collection page.

${NOTE_RULES}

Reply with ONLY a JSON array, one object per book in the same order, no prose, no markdown fence:
[{"id": "...", "note": "..."}]

BOOKS:
${JSON.stringify(b.rows, null, 1)}`, (arr, b) => Array.isArray(arr) && arr.length === b.rows.length && arr.every((x, i) => x.id === b.rows[i].id && typeof x.note === 'string'));
  console.log('judge done; read judge-start/*.json and judge-notes/*.json, then apply');
}

// ── apply ───────────────────────────────────────────────────────────────────────────────────────────────
export function cleanNote(n) {
  const s = String(n || '').trim();
  if (!s || /[—–]/.test(s) || STOCK_NOTE.test(s)) return '';
  return s;
}

async function apply() {
  const planRows = readJson(P('plan.json'), null);
  const starts = new Map();
  if (fs.existsSync(P('judge-start'))) for (const f of fs.readdirSync(P('judge-start'))) for (const v of readJson(P(`judge-start/${f}`), [])) starts.set(v.slug, v);
  const notes = new Map();
  if (fs.existsSync(P('judge-notes'))) for (const f of fs.readdirSync(P('judge-notes'))) for (const v of readJson(P(`judge-notes/${f}`), [])) notes.set(v.id, cleanNote(v.note));
  const { client, db } = await connect();
  const changes = [], logRows = [], touched = [];
  for (const c of planRows) {
    let list = c.after.map((e) => ({ ...e }));
    const v = starts.get(c.slug);
    let promoted = null;
    // An on-theme START HERE stands, whatever the judge would have preferred (a person chose it).
    if (v?.pick && v.on_theme !== true && v.pick !== c.start_after) {
      const existing = list.find((e) => e.book_id === v.pick);
      list = list.filter((e) => e.book_id !== v.pick);
      const [b] = (await db.collection('books').find({ id: v.pick }, { projection: BOOK_PROJ }).toArray());
      if (!b || !isMember(b, c.slug, c.is_art)) { console.log(`  skip pick ${c.slug} ${v.pick}: not a member now`); }
      else {
        promoted = { ...(existing || {}), book_id: b.id, title: b.display_title || b.title, author: existing?.author ?? b.author, year: existing?.year ?? b.year, tier: 1, rank: 0 };
        list.unshift(promoted);
      }
    }
    list.forEach((e, i) => { e.rank = i + 1; });
    for (const e of list) {
      if (STOCK_NOTE.test(e.note || '') || (e === promoted && !e.note)) {
        if (notes.has(e.book_id)) e.note = notes.get(e.book_id);
        else if (STOCK_NOTE.test(e.note || '')) e.note = '';
      }
      if (e.note === '') delete e.note;
    }
    const same = JSON.stringify(list) === JSON.stringify(c.before);
    if (same) continue;
    touched.push(c.slug);
    changes.push({ slug: c.slug, start_before: c.start_before, start_after: list.find((e) => e.tier === 1)?.book_id || null,
      start_verdict: v || null, dropped: c.dropped, before: c.before, after: list });
    for (const d of c.dropped) logRows.push({ sweep: SWEEP, book_id: String(d.ref ?? 'none'), action: 'collection-highlight-dropped', detail: { collection: c.slug, why: d.why, title: d.title } });
    if (promoted) logRows.push({ sweep: SWEEP, book_id: promoted.book_id, action: 'collection-start-here-promoted', detail: { collection: c.slug, replaced: c.start_after, reason: v.reason } });
    const noteChanged = list.filter((e) => { const b = c.before.find((x) => (typeof x === 'object') && (x.book_id || x.id) === e.book_id); return b && (b.note || '') !== (e.note || ''); });
    for (const e of noteChanged) logRows.push({ sweep: SWEEP, book_id: e.book_id, action: 'collection-highlight-note-replaced', detail: { collection: c.slug, before: c.before.find((x) => (x.book_id || x.id) === e.book_id)?.note || '', after: e.note || '' } });
    if (flag('apply')) {
      await db.collection('collections').updateOne({ slug: c.slug }, { $set: { highlighted_books: list, updated_at: new Date() } });
    }
  }
  writeJson(P(`changes${flag('apply') ? '' : '-dry'}.json`), changes);
  console.log(`${flag('apply') ? 'APPLIED' : 'DRY'}: ${touched.length} collections changed; ${logRows.length} sweep_log rows`);
  if (flag('apply')) {
    await recordSweepActions(db, logRows);
    if (flag('revalidate')) for (const slug of touched) {
      try { await revalidateCollection(slug, { quiet: true }); } catch (e) { console.log(`  revalidate ${slug}: ${e.message}`); }
    }
  }
  await client.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!['plan', 'judge', 'apply'].includes(STEP) || !OUT) {
    console.error('usage: curate-collection-highlights.mjs plan|judge|apply --out=DIR (see header)');
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  await ({ plan, judge, apply })[STEP]();
}
