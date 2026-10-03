#!/usr/bin/env node
// PRIOR ART: scripts/export-prompts-to-git.mjs — writes each `prompts` row to prompts/<type>/*.md,
// but counts no pages, keeps no dates beyond created_at and overwrites by name+version (two
// "Standard Translation" v12 rows collide); scripts/lib/provenance-history.json — infers generation
// SETTINGS (temperature, tokens) per writer and date, not which prompt a page ran under;
// scripts/maintenance/repair-prompt-defaults-3614.mjs — repairs is_default, reports nothing.
// None answers "how many pages did prompt v12 write, and when was it in production?" (#5672).
/**
 * prompt-history — the data behind .claude/docs/prompt-history.md (#5672). $0: Mongo reads and
 * `git log` only, no model.
 *
 *   node --env-file=.env.production.local scripts/audit/prompt-history.mjs [--step prompts|counts|git|all]
 *        [--days N]   (window width for the page walk; default 7)
 *        [--fresh]    (ignore the counts checkpoint and walk from the start)
 *
 * Writes to scripts/eval/results/prompt-history/:
 *   prompt-history.json   prompts metadata + hashes, page counts per (version, hash, id, name,
 *                         source), first/last updated_at per group, git log of prompt files
 *   prompts-content.json  every `prompts` row in full (content included)
 *   counts-checkpoint.json  resumable state of the page walk (delete or --fresh to restart)
 *
 * PAGE COUNTS. `pages` has no index on ocr/translation.prompt_*, so an exact count is a full read.
 * It walks the `_id` index in ObjectId-time windows, ONE `_id` BSON TYPE AT A TIME (pages carry
 * both ObjectId and 24-hex string ids; a range on one type never matches the other), $groups each
 * window, and checkpoints after every window. A finished walk is checked against
 * countDocuments per type: the totals must match exactly or the run says so.
 *
 * Windows: first/last `updated_at` per group is the date the page was LAST written under that
 * prompt, not when the prompt was default. A version re-run later stretches its window; a page
 * re-OCR'd under a newer prompt leaves the old count. Counts are pages AS THEY ARE TODAY.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(ROOT, 'scripts/eval/results/prompt-history');
const CKPT = path.join(OUT, 'counts-checkpoint.json');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const STEP = arg('--step', 'all');
const DAYS = Number(arg('--days', 7));
const FRESH = args.includes('--fresh');

const md5 = (s) => createHash('md5').update(s ?? '').digest('hex');
const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v) => { fs.writeFileSync(p + '.tmp', JSON.stringify(v, null, 2)); fs.renameSync(p + '.tmp', p); };

fs.mkdirSync(OUT, { recursive: true });
const HISTORY = path.join(OUT, 'prompt-history.json');
const history = readJson(HISTORY, { schema: 'prompt-history/1' });

async function stepPrompts(db) {
  const rows = await db.collection('prompts').find({}).sort({ type: 1, name: 1, created_at: 1 }).toArray();
  writeJson(path.join(OUT, 'prompts-content.json'), rows.map((r) => ({ ...r, _id: String(r._id) })));
  history.prompts = rows.map((r) => {
    const content = r.content ?? r.text ?? '';
    const { content: _c, text: _t, ...meta } = r;
    return {
      ...meta,
      _id: String(r._id),
      type: r.type ?? null,
      created_at: iso(r.created_at),
      updated_at: iso(r.updated_at),
      content_hash_stored: r.content_hash ?? null,
      content_md5: md5(content),
      hash_matches: r.content_hash ? r.content_hash === md5(content) : null,
      content_chars: content.length,
    };
  });
  console.log(`prompts: ${rows.length} rows`);
}

// ObjectId-time windows: [t, t+DAYS). For string ids the bound is the same 24-hex string.
function bound(type, secs) {
  const hex = Math.max(0, Math.floor(secs)).toString(16).padStart(8, '0') + '0000000000000000';
  return type === 'objectId' ? new ObjectId(hex) : hex;
}

function groupStage(f) {
  return [
    { $group: {
      _id: { v: `$${f}_v`, h: `$${f}_h`, id: `$${f}_id`, n: `$${f}_n`, src: `$${f}_src`, t: `$${f}_t`, data: `$${f}_d` },
      count: { $sum: 1 },
      first: { $min: `$${f}_u` },
      last: { $max: `$${f}_u` },
    } },
  ];
}

function merge(acc, rows) {
  for (const r of rows) {
    const k = JSON.stringify(r._id);
    const a = acc[k] ?? (acc[k] = { key: r._id, count: 0, first: null, last: null });
    a.count += r.count;
    const f = iso(r.first), l = iso(r.last);
    if (f && typeof f === 'string' && (!a.first || f < a.first)) a.first = f;
    if (l && typeof l === 'string' && (!a.last || l > a.last)) a.last = l;
  }
}

async function stepCounts(db) {
  const pages = db.collection('pages');
  const ck = FRESH ? null : readJson(CKPT, null);
  const state = ck ?? { started: new Date().toISOString(), days: DAYS, types: {} };
  for (const type of ['string', 'objectId']) {
    const s = state.types[type] ?? (state.types[type] = { done: false, cursor: null, end: null, walked: 0, ocr: {}, translation: {} });
    if (s.done) { console.log(`${type}: already walked (${s.walked})`); continue; }
    if (s.cursor == null) {
      const [lo] = await pages.find({ _id: { $type: type } }, { projection: { _id: 1 } }).sort({ _id: 1 }).limit(1).toArray();
      const [hi] = await pages.find({ _id: { $type: type } }, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).toArray();
      const ts = (id) => parseInt(String(id).slice(0, 8), 16);
      s.cursor = ts(lo._id) - (ts(lo._id) % 86400);
      s.end = ts(hi._id) + 1;
      // An id that is not 24-hex would sort outside the windows; the total check below catches it.
    }
    const step = DAYS * 86400;
    while (s.cursor < s.end) {
      const t0 = Date.now();
      const match = { _id: { $gte: bound(type, s.cursor), $lt: bound(type, s.cursor + step) } };
      const [res] = await pages.aggregate([
        { $match: match },
        { $project: Object.fromEntries(['ocr', 'translation'].flatMap((f) => [
          [`${f}_v`, { $toString: `$${f}.prompt_version` }], [`${f}_h`, `$${f}.prompt_hash`],
          [`${f}_id`, { $toString: `$${f}.prompt_id` }], [`${f}_n`, `$${f}.prompt_name`],
          [`${f}_src`, `$${f}.source`], [`${f}_u`, `$${f}.updated_at`],
          [`${f}_t`, { $type: `$${f}` }], [`${f}_d`, { $type: `$${f}.data` }],
        ])) },
        { $facet: { ocr: groupStage('ocr'), translation: groupStage('translation'), n: [{ $count: 'n' }] } },
      ], { allowDiskUse: true, maxTimeMS: 1_800_000 }).toArray();
      merge(s.ocr, res.ocr);
      merge(s.translation, res.translation);
      const n = res.n[0]?.n ?? 0;
      s.walked += n;
      s.cursor += step;
      writeJson(CKPT, state);
      if (n) console.log(`${type} ${new Date(s.cursor * 1000).toISOString().slice(0, 10)} +${n} = ${s.walked} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
    // The windows are half-open on [lo-day, hi+1); anything outside is an id that is not 24-hex.
    s.total = await pages.countDocuments({ _id: { $type: type } });
    s.done = true;
    s.finished = new Date().toISOString();
    writeJson(CKPT, state);
    console.log(`${type}: walked ${s.walked}, countDocuments ${s.total}${s.walked === s.total ? ' — MATCH' : ' — MISMATCH'}`);
  }

  // Fold the two id types into one table per field (keeping the per-type split).
  const fold = (field) => {
    const acc = {};
    for (const [type, s] of Object.entries(state.types)) {
      for (const g of Object.values(s[field])) {
        const k = JSON.stringify(g.key);
        const a = acc[k] ?? (acc[k] = { ...g.key, count: 0, by_id_type: {}, first_updated_at: null, last_updated_at: null });
        a.count += g.count;
        a.by_id_type[type] = (a.by_id_type[type] ?? 0) + g.count;
        if (g.first && (!a.first_updated_at || g.first < a.first_updated_at)) a.first_updated_at = g.first;
        if (g.last && (!a.last_updated_at || g.last > a.last_updated_at)) a.last_updated_at = g.last;
      }
    }
    return Object.values(acc).sort((x, y) => y.count - x.count);
  };
  history.page_counts = {
    note: 'Exact, full walk of pages by _id window per _id type. Keys: v=prompt_version, h=prompt_hash, id=prompt_id, n=prompt_name, src=<field>.source, t=$type of the field, data=$type of <field>.data. first/last_updated_at = min/max <field>.updated_at in the group (when pages were last written, not when the prompt was default).',
    started: state.started,
    finished: Object.values(state.types).map((s) => s.finished).sort().at(-1) ?? null,
    walk: Object.fromEntries(Object.entries(state.types).map(([t, s]) => [t, { walked: s.walked, countDocuments: s.total ?? null, match: s.walked === s.total }])),
    ocr: fold('ocr'),
    translation: fold('translation'),
  };
}

function stepGit() {
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const seeders = git('grep', '-lE', "collection\\(['\"]prompts['\"]\\)").split('\n').filter(Boolean)
    .filter((p) => !p.startsWith('.claude/') && !p.includes('_archived/'));
  const log = (paths, follow) => git('log', ...(follow ? ['--follow'] : []), '--date=iso-strict', '--format=%H%x09%ad%x09%s', '--', ...paths)
    .split('\n').filter(Boolean).map((l) => { const [sha, date, subject] = l.split('\t'); return { sha: sha.slice(0, 10), date, subject }; });
  history.git = {
    prompts_dir: log(['prompts/'], false),
    seeding_and_resolver_files: seeders.map((p) => ({ path: p, commits: log([p], true) })),
  };
  console.log(`git: ${history.git.prompts_dir.length} commits on prompts/, ${seeders.length} files touching the prompts collection`);
}

const needsDb = STEP === 'all' || STEP === 'prompts' || STEP === 'counts';
const client = needsDb ? new MongoClient(process.env.MONGODB_URI) : null;
try {
  if (client) await client.connect();
  const db = client?.db('bookstore');
  if (STEP === 'all' || STEP === 'prompts') await stepPrompts(db);
  if (STEP === 'all' || STEP === 'git') stepGit();
  history.generated_at = new Date().toISOString();
  writeJson(HISTORY, history);
  if (STEP === 'all' || STEP === 'counts') { await stepCounts(db); history.generated_at = new Date().toISOString(); writeJson(HISTORY, history); }
} finally {
  await client?.close();
}
