#!/usr/bin/env node
// PRIOR ART: scripts/eval/typed-refs-6012/lib.mjs (private-bucket R2 client, list/head) — eval-refs only, no page
// scoping; scripts/maintenance/build-preservation-manifest.mjs — images, not text; page_revisions (data-provenance.md
// §2) keeps only texts that were WRITTEN. Nothing kept the reads that never reached a page (#7075).
/**
 * Keep every UNWRITTEN read (#7075). OCR and translation texts that jobs produced but never wrote to a page (eval
 * arms, failed gates, pilot reads) live only in job folders. This copies them to the PRIVATE R2 bucket
 * `sl-corpus-snapshots` (not served by images.sourcelibrary.org: a failed-gate read must never be quotable) under
 *
 *   candidate-reads/<book_id>/<page_id>/<ocr|translation>/<content_hash>.json
 *
 * Writes nothing to Mongo except one `sweep_log` row per book on --apply. Never moves or deletes a job file.
 *
 *   node --env-file=.env.production.local scripts/maintenance/archive-candidate-reads.mjs [scan]
 *        [--roots=/mnt/HC_Volume_105839809/jobs,/root/jobs] [--apply] [--checkpoint=FILE] [--manifests=DIR]
 *   node --env-file=.env.production.local scripts/maintenance/archive-candidate-reads.mjs list --page=<page_id> [--text]
 *
 * What qualifies: a `<key>.meta.json` beside a `<key>.txt`, in the read-dir shape written by claude-ocr.mjs,
 * claude-ocr-two-read.mjs, cli-ocr.mjs read, cli-translate.mjs read, claude-translate.mjs read, twopass-review.mjs and
 * ocr-convergence/correct.mjs, plus a direct-API read meta carrying a translation/OCR prompt_ref. The page id comes
 * from the meta (or a 24-hex file name); the book id comes FROM MONGO (pages.id, else _id), never from the path.
 * Every other meta shape is counted by read dir as unknown and not archived.
 *
 * Skipped (counted): empty text; chatter or refusal (ocrReadProblem / cliChatterReason); text equal to the page's
 * current field or to ANY page_revisions row for that page and field (already kept); a key that already exists.
 * Dry run (default) prints counts by job × field × model and the skip reasons. --apply writes, resumable through
 * --checkpoint (default $JOB_SCRATCH/archive-candidate-reads.checkpoint.jsonl). Per-job manifests (page_id, book_id,
 * field, model, hash) go to --manifests (a folder, not R2: r2-key.mjs has no exception for a book-independent key).
 */
import fs from 'node:fs';
import path from 'node:path';
import { assertBookScopedKey } from '../lib/r2-key.mjs';
import { contentHash } from '../lib/write-provenance.mjs';
import { ocrReadProblem, cliChatterReason } from '../lib/cli-chatter.mjs';

export const BUCKET = 'sl-corpus-snapshots';
export const PREFIX = 'candidate-reads';
export const SWEEP = 'archive-candidate-reads-7075';
const SKIP_DIRS = new Set(['node_modules', '.git', 'prompts', 'raw', 'stored']);
const HEX24 = /^[0-9a-f]{24}$/;

const OCR_SITES = /claude-ocr\.mjs|claude-ocr-two-read\.mjs|ocr-convergence\/correct\.mjs|cli-ocr\.mjs|bulk-reocr-local\.mjs|realtime-ocr\.mjs/;
const TR_SITES = /claude-translate\.mjs|twopass-review\.mjs|cli-translate\.mjs|realtime-translate\.mjs/;

/** The page id a meta file belongs to, or null. */
export function pageIdOf(meta, base) {
  const id = typeof meta?.page_id === 'string' ? meta.page_id : null;
  if (id) return id;
  return HEX24.test(base) ? base : null;
}

/**
 * Which field a read is, from its meta: 'ocr' | 'translation', or { unknown: why }. The read site is the strongest
 * signal; an agy (cli-*.mjs) meta is a translation when it carries the stored OCR's hash or a prompt_ref (only
 * cli-translate writes those); a direct-API meta is classified by its prompt's name.
 */
export function classifyRead(meta) {
  const site = String(meta?.read_site || meta?.call_site || '');
  if (OCR_SITES.test(site)) return 'ocr';
  if (TR_SITES.test(site)) return 'translation';
  if (meta?.mode === 'correct') return 'ocr';
  if (meta?.cli === 'agy') return ('ocr_hash' in meta || meta.prompt_ref) ? 'translation' : 'ocr';
  const name = String(meta?.prompt_ref?.name || '');
  if (/translat/i.test(name)) return 'translation';
  if (/\bocr\b|transcri/i.test(name)) return 'ocr';
  if (meta?.two_read) return 'ocr';
  return { unknown: site || meta?.cli || meta?.api ? `unclassified ${site || meta.cli || meta.api}` : 'no read site, cli or prompt_ref' };
}

/** Why a text is not a read worth keeping, or null. */
export function textProblem(text, field) {
  const t = String(text || '').trim();
  if (!t) return 'empty';
  if (field === 'translation') return cliChatterReason(t);
  // header: false — a correct-mode reply (cli-ocr --correct, correct.mjs) is plain text by design (#6560), and a
  // missing <page-type> tag is a format slip, not chatter; plan notes, refusals, restarts and openers still fail.
  return ocrReadProblem(t, { header: false });
}

/** Hashes a text is "already kept" under: exact (trimmed) and whitespace-collapsed. */
export function keptHashes(text) {
  const t = String(text || '').trim();
  return [contentHash(t), contentHash(t.replace(/\s+/g, ' '))];
}

/** True when the read equals the current field or any revision of it. `kept` is a Set of keptHashes() values. */
export function alreadyKept(text, kept) {
  return keptHashes(text).some((h) => kept.has(h));
}

/** The object key for one read. Throws unless book-scoped (#3362). */
export function candidateKey(bookId, pageId, field, hash) {
  if (field !== 'ocr' && field !== 'translation') throw new Error(`bad field ${JSON.stringify(field)}`);
  if (!/^[0-9a-f]{16}$/.test(String(hash))) throw new Error(`bad content hash ${JSON.stringify(hash)}`);
  if (!pageId || /[/\s]/.test(pageId)) throw new Error(`bad page id ${JSON.stringify(pageId)}`);
  const key = `${PREFIX}/${bookId}/${pageId}/${field}/${hash}.json`;
  assertBookScopedKey(key, bookId, 'archive-candidate-reads');
  return key;
}

export function pagePrefix(bookId, pageId) {
  const p = `${PREFIX}/${bookId}/${pageId}`;
  assertBookScopedKey(p, bookId, 'archive-candidate-reads list');   // checked without the trailing '/' (an empty segment)
  return `${p}/`;
}

const modelOf = (m) => m.model || m.models?.[0] || m.adjudication?.model || m.model_requested || null;
const engineOf = (m) => m.cli || m.api || (m.read_site ? path.basename(m.read_site) : null);
const promptOf = (m) => ({ ref: m.prompt_ref ?? null, sent_hash: m.prompt_sent_hash ?? m.prompt_hash ?? null, sent_file: m.prompt_sent_file ?? m.prompt_file ?? null, variant: m.prompt_variant ?? null });

/** The object body. */
export function buildBody({ text, page, field, meta, job, sourcePath, readAt, sources, dirInfo }) {
  return {
    text,
    page_id: page.id, book_id: page.book_id, page_number: page.page_number ?? null, field,
    content_hash: contentHash(text),
    model: modelOf(meta), engine: engineOf(meta), prompt: promptOf(meta),
    job, source_path: sourcePath, also_at: sources.filter((s) => s !== sourcePath),
    read_at: readAt,
    meta,
    outcome: meta.outcome ?? null,
    gate: dirInfo?.apply_summaries?.length ? dirInfo.apply_summaries : null,
    dir_prompt_ref: dirInfo?.prompt_ref ?? null,
    archived_at: new Date().toISOString(),
    archived_by: 'scripts/maintenance/archive-candidate-reads.mjs',
    issue: 7075,
  };
}

/**
 * Which reads become objects. `pages`: page id -> { id, book_id, page_number }; `kept`: `${pageId}|${field}` -> Set of
 * keptHashes() of the current field and every page_revisions row. Identical texts of one page and field become ONE
 * object (the other paths go in `sources`). Pure; counts go into `tally`. Returns Map key -> { read, page, sources }.
 */
export function planObjects(reads, pages, kept, tally = { skip: {}, unknown: {}, byJobFieldModel: {}, candidates: 0, bytes: 0 }) {
  const objects = new Map();
  for (const r of reads) {
    const page = pages.get(r.pageId);
    if (!page || typeof page.book_id !== 'string' || !page.book_id) { bump(tally.unknown, `${r.readDir} :: page not in Mongo`); continue; }
    const k = `${page.id}|${r.field}`;
    if (kept.has(k) && r.kept.some((h) => kept.get(k).has(h))) { bump(tally.skip, 'already kept (current field or page_revisions)'); continue; }
    const key = candidateKey(page.book_id, page.id, r.field, r.hash);
    if (objects.has(key)) { objects.get(key).sources.push(r.txtPath); bump(tally.skip, 'same text in another job file (one object, also_at)'); continue; }
    objects.set(key, { read: r, page, sources: [r.txtPath] });
    tally.candidates++; tally.bytes += r.bytes;
    bump(tally.byJobFieldModel, `${r.job} | ${r.field} | ${r.model}`);
  }
  return objects;
}

/** The planned objects a resumed --apply still has to send: not in the checkpoint's keys. */
export function pendingObjects(objects, doneKeys) {
  return [...objects].filter(([key]) => !doneKeys.has(key));
}

// ── scan ────────────────────────────────────────────────────────────────────

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

function dirInfoOf(dir, cache) {
  if (cache.has(dir)) return cache.get(dir);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* gone */ }
  const apply_summaries = names.filter((n) => /^apply-summary-.*\.json$/.test(n)).map((n) => {
    const s = readJson(path.join(dir, n)) || {};
    return { file: n, at: s.at ?? null, apply: s.apply ?? null, run: s.run ?? null, gate_refused: s.gate_refused ?? null, written: s.written ?? null };
  });
  const info = { apply_summaries, prompt_ref: readJson(path.join(dir, 'prompt-ref.json')) };
  cache.set(dir, info);
  return info;
}

/**
 * The job a read dir belongs to: the folder under the first `jobs/` in its path (/mnt/…/jobs/<job>/…,
 * /root/jobs/<job>/…, /data/scratch/sl/jobs/<job>/…), so a root that IS one job dir names that job, not its subdir.
 * `readDir` is the path from the job's parent, for the unknown-shape report.
 */
export function jobOf(dir, root) {
  const m = dir.match(/(?:^|\/)jobs\/([^/]+)(\/.*)?$/);
  if (m) return { job: m[1], readDir: `${m[1]}${m[2] || ''}` };
  const rel = path.relative(root, dir);
  return { job: rel.split(path.sep)[0] || path.basename(root), readDir: rel || path.basename(root) };
}

/** Walk the roots; yield { metaPath, txtPath, dir, base, meta, job } for every *.meta.json. */
export function* walkReads(roots) {
  for (const root of roots) {
    const stack = [root];
    while (stack.length) {
      const d = stack.pop();
      let ents;
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        // Symlinks are not followed: every one seen (tr-apply-*, ocrbatch/*) points at a read already walked in its own dir.
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('ws-')) stack.push(p); continue; }
        if (!e.isFile() || !e.name.endsWith('.meta.json')) continue;
        const base = e.name.slice(0, -'.meta.json'.length);
        yield { metaPath: p, txtPath: path.join(d, `${base}.txt`), dir: d, base, ...jobOf(d, root) };
      }
    }
  }
}

function bump(o, k, n = 1) { o[k] = (o[k] || 0) + n; }

async function scan({ roots, apply, checkpoint, manifestsDir }) {
  const { MongoClient, ObjectId } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');

  const tally = { metas: 0, skip: {}, unknown: {}, byJobFieldModel: {}, bytes: 0, candidates: 0 };
  const dirCache = new Map();
  // 1. classify and hash (no text held in memory)
  const reads = [];
  for (const r of walkReads(roots)) {
    tally.metas++;
    const meta = readJson(r.metaPath);
    if (!meta) { bump(tally.unknown, `${r.readDir} :: unreadable meta`); continue; }
    const pageId = pageIdOf(meta, r.base);
    if (!pageId) { bump(tally.unknown, `${r.readDir} :: no page_id`); continue; }
    const field = classifyRead(meta);
    if (typeof field !== 'string') { bump(tally.unknown, `${r.readDir} :: ${field.unknown}`); continue; }
    if (!fs.existsSync(r.txtPath)) { bump(tally.unknown, `${r.readDir} :: no .txt beside meta`); continue; }
    const text = fs.readFileSync(r.txtPath, 'utf8').trim();
    const problem = textProblem(text, field);
    if (problem) { bump(tally.skip, problem === 'empty' ? 'empty' : `chatter: ${problem}`); continue; }
    reads.push({ ...r, pageId, field, hash: contentHash(text), kept: keptHashes(text), bytes: Buffer.byteLength(text), model: modelOf(meta) || '?' });
  }

  // 2. resolve pages and what is already kept, in batches
  const pageIds = [...new Set(reads.map((r) => r.pageId))];
  const pages = new Map();
  const kept = new Map();   // `${pageId}|${field}` -> Set of hashes
  const addKept = (pid, field, data) => {
    if (typeof data !== 'string' || !data.trim()) return;
    const k = `${pid}|${field}`; if (!kept.has(k)) kept.set(k, new Set());
    for (const h of keptHashes(data)) kept.get(k).add(h);
  };
  for (let i = 0; i < pageIds.length; i += 500) {
    const ids = pageIds.slice(i, i + 500);
    const proj = { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 };
    const found = await db.collection('pages').find({ id: { $in: ids } }, { projection: proj }).toArray();
    const missing = ids.filter((id) => !found.some((p) => p.id === id));
    const oids = missing.filter((id) => HEX24.test(id)).map((id) => new ObjectId(id));
    if (oids.length) found.push(...await db.collection('pages').find({ _id: { $in: oids } }, { projection: proj }).toArray());
    for (const p of found) {
      const pid = p.id || String(p._id);
      const page = { id: pid, book_id: p.book_id, page_number: p.page_number };
      pages.set(pid, page); pages.set(String(p._id), page);
      addKept(pid, 'ocr', p.ocr?.data); addKept(pid, 'translation', p.translation?.data);
    }
    // A revision may name the page by id or by _id; both map to the page's canonical id.
    const either = [...new Set(found.flatMap((p) => [p.id, String(p._id)].filter(Boolean)))];
    const revs = db.collection('page_revisions').find({ page_id: { $in: either }, field: { $in: ['ocr', 'translation'] } }, { projection: { page_id: 1, field: 1, data: 1 } });
    for await (const rv of revs) addKept(pages.get(rv.page_id)?.id ?? rv.page_id, rv.field, rv.data);
    process.stderr.write(`\r  pages ${Math.min(i + 500, pageIds.length)}/${pageIds.length}`);
  }
  process.stderr.write('\n');

  // 3. decide; group identical texts
  const objects = planObjects(reads, pages, kept, tally);

  // 4. manifests, per job
  if (manifestsDir) {
    fs.mkdirSync(manifestsDir, { recursive: true });
    const byJob = new Map();
    for (const { read, page } of objects.values()) {
      if (!byJob.has(read.job)) byJob.set(read.job, []);
      byJob.get(read.job).push(JSON.stringify({ page_id: page.id, book_id: page.book_id, field: read.field, model: read.model, hash: read.hash }));
    }
    for (const [job, rows] of byJob) fs.writeFileSync(path.join(manifestsDir, `${job}.jsonl`), rows.sort().join('\n') + '\n');
  }

  report(tally);
  if (!apply) { await client.close(); return tally; }

  // 5. apply: sweep_log rows first, then the objects, skipping what the checkpoint or R2 already has
  const done = new Set(fs.existsSync(checkpoint) ? fs.readFileSync(checkpoint, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).key) : []);
  const todo = pendingObjects(objects, done);
  const perBook = new Map();
  for (const [, o] of todo) perBook.set(o.page.book_id, (perBook.get(o.page.book_id) || 0) + 1);
  const runId = `${SWEEP}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  if (perBook.size) {
    const { recordSweepActions } = await import('../lib/sweep-log.mjs');
    await recordSweepActions(db, [...perBook].map(([book_id, n]) => ({ sweep: SWEEP, book_id, action: 'archive-candidate-reads', detail: { run: runId, objects: n, bucket: BUCKET, prefix: `${PREFIX}/${book_id}/` } })));
  }
  await client.close();
  const { S3Client, PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = r2Client(S3Client);
  const out = fs.openSync(checkpoint, 'a');
  const res = { written: 0, existed: 0, failed: 0 };
  const queue = [...todo];
  await Promise.all(Array.from({ length: 16 }, async () => {
    while (queue.length) {
      const [key, { read, page, sources }] = queue.shift();
      try {
        try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); res.existed++; fs.writeSync(out, JSON.stringify({ key, existed: true }) + '\n'); continue; }
        catch (e) { if (e?.$metadata?.httpStatus !== 404 && e?.name !== 'NotFound') throw e; }
        const text = fs.readFileSync(read.txtPath, 'utf8').trim();
        if (contentHash(text) !== read.hash) throw new Error(`text changed since the scan: ${read.txtPath}`);
        const meta = readJson(read.metaPath) || {};
        const readAt = meta.finished_at || meta.started_at || fs.statSync(read.txtPath).mtime.toISOString();
        const body = buildBody({ text, page, field: read.field, meta, job: read.job, sourcePath: read.txtPath, readAt, sources, dirInfo: dirInfoOf(read.dir, dirCache) });
        candidateKey(page.book_id, page.id, read.field, read.hash);   // re-assert at the write boundary
        await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: JSON.stringify(body), ContentType: 'application/json', IfNoneMatch: '*' }));
        res.written++; fs.writeSync(out, JSON.stringify({ key }) + '\n');
      } catch (e) {
        if (e?.$metadata?.httpStatus === 412) { res.existed++; fs.writeSync(out, JSON.stringify({ key, existed: true }) + '\n'); continue; }
        res.failed++; console.error(`  FAILED ${key}: ${e.message}`);
      }
      const n = res.written + res.existed + res.failed;
      if (n % 500 === 0) process.stderr.write(`\r  ${n}/${todo.length}`);
    }
  }));
  fs.closeSync(out);
  console.log(`\napply ${runId}: ${res.written} written, ${res.existed} already there, ${res.failed} failed (of ${todo.length}; ${objects.size - todo.length} in the checkpoint)`);
  return { ...tally, ...res };
}

function report(t) {
  console.log(`\n${t.metas} meta files; ${t.candidates} objects to keep, ${(t.bytes / 1e6).toFixed(1)} MB of text`);
  console.log('\nby job | field | model:');
  for (const [k, n] of Object.entries(t.byJobFieldModel).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${k}`);
  console.log('\nskipped:');
  for (const [k, n] of Object.entries(t.skip).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${k}`);
  console.log('\nunknown shapes (not archived), by read dir:');
  for (const [k, n] of Object.entries(t.unknown).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${k}`);
}

function r2Client(S3Client) {
  for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) if (!process.env[k]) throw new Error(`${k} is not set`);
  return new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
}

// ── list ────────────────────────────────────────────────────────────────────

async function list(pageArg, withText) {
  const { MongoClient, ObjectId } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const pages = client.db('bookstore').collection('pages');
  const p = await pages.findOne({ id: pageArg }, { projection: { id: 1, book_id: 1, page_number: 1 } })
    || (HEX24.test(pageArg) ? await pages.findOne({ _id: new ObjectId(pageArg) }, { projection: { id: 1, book_id: 1, page_number: 1 } }) : null);
  await client.close();
  if (!p) { console.error(`page ${pageArg} not found`); process.exit(1); }
  const pid = p.id || String(p._id);
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = r2Client(S3Client);
  const prefix = pagePrefix(p.book_id, pid);
  const keys = []; let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
    keys.push(...(r.Contents || []).map((o) => o.Key)); token = r.NextContinuationToken;
  } while (token);
  console.log(`book ${p.book_id} p.${p.page_number} (page ${pid}): ${keys.length} unwritten read(s) under ${BUCKET}/${prefix}`);
  for (const key of keys) {
    const b = JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))).Body.transformToString());
    console.log(`  ${b.field.padEnd(11)} ${b.content_hash}  ${String(b.model).padEnd(24)} ${String(b.engine).padEnd(22)} ${b.read_at?.slice(0, 10) ?? '?'}  ${String(b.text.length).padStart(6)} chars  ${b.job}${b.outcome ? `  outcome=${b.outcome}` : ''}`);
    if (withText) console.log(`\n${b.text}\n`);
  }
}

async function main() {
  const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
  const has = (n) => process.argv.includes(`--${n}`);
  const mode = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'scan';
  if (mode === 'list') {
    if (!arg('page')) { console.error('list needs --page=<page_id>'); process.exit(2); }
    return list(arg('page'), has('text'));
  }
  if (mode !== 'scan') { console.error('usage: archive-candidate-reads.mjs [scan] [--apply] | list --page=<id> (see the header)'); process.exit(2); }
  const roots = (arg('roots') || '/mnt/HC_Volume_105839809/jobs,/root/jobs').split(',').filter((r) => fs.existsSync(r));
  const scratch = process.env.JOB_SCRATCH || process.env.TMPDIR || '/tmp';
  console.log(`roots: ${roots.join(', ')}${has('apply') ? '  (APPLY)' : '  (dry run)'}`);
  await scan({ roots, apply: has('apply'), checkpoint: arg('checkpoint', path.join(scratch, 'archive-candidate-reads.checkpoint.jsonl')), manifestsDir: arg('manifests') || null });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
