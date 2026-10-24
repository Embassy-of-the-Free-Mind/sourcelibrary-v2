// PRIOR ART: scripts/maintenance/archive-candidate-reads.mjs — the sweep that copies job-folder reads to the same
// prefix after the fact (its key, body and skip rules are moved here so the sweep and the readers share one copy);
// scripts/eval/typed-refs-6012/lib.mjs — the private-bucket R2 client. Neither keeps a read when it is made or
// hands one back to a reader, which is what stops a re-run from paying for the same read twice (#7075).
/**
 * Every read a reader makes is KEPT the moment it is paid for, and a reader that is about to make the same read again
 * gets the kept one back instead of calling the model (#7075; Derek, 2026-10-24: "we must not re-spend tokens").
 *
 *   keepRead({ page_id, book_id, page_number, field, text, model, prompt_hash, job, meta, prompt_text })
 *   findRead({ page_id, book_id, field, model, prompt_hash, derive })   -> { key, text, meta, body } | null
 *   reuseInto(outDir, fileKey, hit)                                     -> true when the read dir now holds the read
 *
 * Objects live in the PRIVATE bucket `sl-corpus-snapshots` (images.sourcelibrary.org does not serve it: a read that
 * failed its gate must never be quotable), at candidate-reads/<book_id>/<page_id>/<ocr|translation>/<content_hash>.json,
 * every key checked by assertBookScopedKey (#3362). The exact prompt a call sent goes to
 * candidate-reads/<book_id>/_prompts/<hash>.txt, so a reused read can be applied like a fresh one (the appliers check
 * the meta's prompt_sent_hash against the file it names).
 *
 * THE REUSE KEY. `prompt_hash` is the READER's hash of everything that decides the text except the model: the prompt
 * template or the exact page prompt, the reader's variant, and the page's input (its image sha256 for OCR, the OCR's
 * hash for a translation; see reuseHash()). The model is matched on its own (`reuse.model`, the model the reader
 * asked for). A read kept by the sweep, before readers kept their own, has no `reuse` block; a reader can pass
 * `derive(meta)` to compute the same hash from the stored meta.
 *
 * BEST EFFORT, ALWAYS. No credentials, an R2 error or a timeout logs one line and returns: keeping or finding a read
 * never fails the read. CANDIDATE_READS=off turns both off.
 */
import { assertBookScopedKey } from './r2-key.mjs';
import { contentHash } from './write-provenance.mjs';
import { ocrReadProblem, cliChatterReason } from './cli-chatter.mjs';
import fs from 'node:fs';
import path from 'node:path';

export const BUCKET = 'sl-corpus-snapshots';
export const PREFIX = 'candidate-reads';

/** The object key for one read. Throws unless book-scoped (#3362). */
export function candidateKey(bookId, pageId, field, hash) {
  if (field !== 'ocr' && field !== 'translation') throw new Error(`bad field ${JSON.stringify(field)}`);
  if (!/^[0-9a-f]{16}$/.test(String(hash))) throw new Error(`bad content hash ${JSON.stringify(hash)}`);
  if (!pageId || /[/\s]/.test(pageId)) throw new Error(`bad page id ${JSON.stringify(pageId)}`);
  const key = `${PREFIX}/${bookId}/${pageId}/${field}/${hash}.json`;
  assertBookScopedKey(key, bookId, 'candidate-reads');
  return key;
}

/** The prefix holding one page's reads (with a trailing '/'). */
export function pagePrefix(bookId, pageId, field) {
  const p = `${PREFIX}/${bookId}/${pageId}${field ? `/${field}` : ''}`;
  if (!pageId || /[/\s]/.test(pageId)) throw new Error(`bad page id ${JSON.stringify(pageId)}`);
  assertBookScopedKey(p, bookId, 'candidate-reads list');   // checked without the trailing '/' (an empty segment)
  return `${p}/`;
}

/** Where the exact prompt a call sent is kept, per book. */
export function promptKey(bookId, hash) {
  if (!/^[0-9a-f]{16}$/.test(String(hash))) throw new Error(`bad prompt hash ${JSON.stringify(hash)}`);
  const key = `${PREFIX}/${bookId}/_prompts/${hash}.txt`;
  assertBookScopedKey(key, bookId, 'candidate-reads prompt');
  return key;
}

/** Why a text is not a read worth keeping (or handing back), or null. */
export function textProblem(text, field) {
  const t = String(text || '').trim();
  if (!t) return 'empty';
  if (field === 'translation') return cliChatterReason(t);
  // header: false — a correct-mode reply (cli-ocr --correct, correct.mjs) is plain text by design (#6560), and a
  // missing <page-type> tag is a format slip, not chatter; plan notes, refusals, restarts and openers still fail.
  return ocrReadProblem(t, { header: false });
}

/** The reuse key: a hash of what decides the text apart from the model. Pure; readers and `derive` share it. */
export function reuseHash({ field, prompt, input, variant = null }) {
  if (!field || !prompt || !input) return null;
  return contentHash(JSON.stringify({ field, prompt, input, variant }));
}

/**
 * The reuse key of a TRANSLATION read, per page, from its meta: the prompt template (prompt_ref), the reader's variant,
 * the OCR translated (ocr_hash) and the page's own instruction line. cli-translate.mjs and claude-translate.mjs both
 * record these, so the key can be rebuilt for a read kept before readers stamped their own. The neighbouring context
 * (the page before's English) is deliberately not part of it.
 */
export function translationReuseKey(m) {
  const ref = m?.prompt_ref;
  const prompt = ref?.content_hash ?? ref?.hash ?? (ref ? JSON.stringify([ref.id ?? null, ref.version ?? null]) : null);
  return reuseHash({ field: 'translation', prompt, input: m?.ocr_hash, variant: JSON.stringify([m?.prompt_variant ?? null, m?.instruction ?? null]) });
}

/**
 * True when a kept body answers this request: same reuse key and model, and still a usable text. `derive(meta)` gives
 * the key for a body the sweep kept (no `reuse` block). Pure.
 */
export function matchesRead(body, { field, model, prompt_hash, derive }) {
  if (!body || body.field !== field || !prompt_hash) return false;
  if (textProblem(body.text, field)) return false;
  // A read its own reader marked failed (a quota cut, a reply outside the markers) is not handed back as done.
  const m = body.meta || {};
  if ((m.exit !== undefined && m.exit !== 0) || m.error_class || m.wrapper) return false;
  if (body.reuse?.hash) return body.reuse.hash === prompt_hash && body.reuse.model === model;
  if (typeof derive !== 'function' || (m.model_requested ?? m.model ?? body.model) !== model) return false;
  try { return derive(m) === prompt_hash; } catch { return false; }
}

// ── R2 ──────────────────────────────────────────────────────────────────────

let s3 = null, sdk = null, warned = new Set();
const off = () => process.env.CANDIDATE_READS === 'off';
function warn(kind, msg) { if (warned.has(kind)) return; warned.add(kind); console.error(`  candidate-reads: ${msg} (further ${kind} messages suppressed; the read itself is unaffected)`); }

async function client() {
  if (s3) return s3;
  for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) if (!process.env[k]) { warn('creds', `${k} is not set: reads are not kept or reused`); return null; }
  sdk = await import('@aws-sdk/client-s3');
  s3 = new sdk.S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  return s3;
}
const send = (c, cmd) => c.send(cmd, { abortSignal: AbortSignal.timeout(20_000) });

/** PUT unless the key exists. Resolves 'written' | 'existed'. Throws on other errors. */
async function putNew(c, key, body, contentType) {
  try {
    await send(c, new sdk.PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType, IfNoneMatch: '*' }));
    return 'written';
  } catch (e) {
    if (e?.$metadata?.httpStatus === 412) return 'existed';
    throw e;
  }
}

/**
 * Keep one read. Resolves { kept: 'written'|'existed'|false, key?, why? }; never throws.
 * `model` is the model the reader ASKED for (the reuse match); `meta.model` may name the one that answered.
 */
export async function keepRead({ page_id, book_id, page_number = null, field, text, model, prompt_hash = null, job = null, meta = {}, prompt_text = null, source_path = null }) {
  if (off()) return { kept: false, why: 'CANDIDATE_READS=off' };
  try {
    const t = String(text || '').trim();
    const problem = textProblem(t, field);
    if (problem) return { kept: false, why: problem };
    const c = await client();
    if (!c) return { kept: false, why: 'no R2 credentials' };
    const hash = contentHash(t);
    const key = candidateKey(book_id, page_id, field, hash);
    const sentHash = meta.prompt_sent_hash ?? (prompt_text ? contentHash(prompt_text) : null);
    const body = {
      text: t, page_id, book_id, page_number, field, content_hash: hash,
      model: meta.model || model || null, engine: meta.cli || meta.api || (meta.read_site ? path.basename(meta.read_site) : null),
      prompt: { ref: meta.prompt_ref ?? null, sent_hash: sentHash, sent_file: meta.prompt_sent_file ?? null, variant: meta.prompt_variant ?? null },
      reuse: prompt_hash ? { hash: prompt_hash, model: model || meta.model || null } : null,
      job, source_path, also_at: [], read_at: meta.finished_at || meta.started_at || new Date().toISOString(),
      meta, outcome: meta.outcome ?? null, gate: null,
      archived_at: new Date().toISOString(), archived_by: meta.read_site || 'scripts/lib/candidate-reads.mjs', issue: 7075,
    };
    const kept = await putNew(c, key, JSON.stringify(body), 'application/json');
    if (prompt_text && sentHash && contentHash(prompt_text) === sentHash) await putNew(c, promptKey(book_id, sentHash), prompt_text, 'text/plain; charset=utf-8');
    return { kept, key };
  } catch (e) {
    warn('keep', `keep failed for page ${page_id} (${field}): ${e?.message || e}`);
    return { kept: false, why: `error: ${e?.message || e}` };
  }
}

/** The kept read for this page, field, model and reuse key, or null. Never throws. */
export async function findRead({ page_id, book_id, field, model, prompt_hash, derive = null }) {
  if (off() || !prompt_hash || !book_id || !page_id) return null;
  try {
    const c = await client();
    if (!c) return null;
    const prefix = pagePrefix(book_id, page_id, field);
    const keys = []; let token;
    do {
      const r = await send(c, new sdk.ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
      keys.push(...(r.Contents || []).map((o) => o.Key)); token = r.NextContinuationToken;
    } while (token);
    // Several kept reads can match (repeat reads of one page on one prompt): the newest is handed back.
    let best = null;
    for (const key of keys) {
      const body = JSON.parse(await (await send(c, new sdk.GetObjectCommand({ Bucket: BUCKET, Key: key }))).Body.transformToString());
      if (body.book_id !== book_id || body.page_id !== page_id || !matchesRead(body, { field, model, prompt_hash, derive })) continue;
      if (!best || String(body.read_at || '') > String(best.body.read_at || '')) best = { key, text: body.text, meta: body.meta || {}, body };
    }
    return best;
  } catch (e) {
    warn('find', `lookup failed for page ${page_id} (${field}): ${e?.message || e}; the model will be called`);
    return null;
  }
}

/** True when anything is kept for this book (one LIST of one key): lets a reader skip per-page lookups. Never throws. */
export async function hasKeptReads(bookId) {
  if (off() || !bookId) return false;
  try {
    const c = await client();
    if (!c) return false;
    const prefix = `${PREFIX}/${bookId}`;
    assertBookScopedKey(prefix, bookId, 'candidate-reads book');
    const r = await send(c, new sdk.ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}/`, MaxKeys: 1 }));
    return (r.KeyCount || 0) > 0;
  } catch { return false; }
}

/** The exact prompt kept for this book and hash, or null. Never throws. */
export async function fetchPromptText(bookId, hash) {
  if (off() || !hash) return null;
  try {
    const c = await client();
    if (!c) return null;
    const r = await send(c, new sdk.GetObjectCommand({ Bucket: BUCKET, Key: promptKey(bookId, hash) }));
    return await r.Body.transformToString();
  } catch { return null; }
}

/**
 * Write a found read into a reader's dir as `<fileKey>.txt` + `.meta.json`, the meta the original read wrote plus
 * `reused_from`, and — when that meta names its prompt file (claude-ocr, claude-translate, correct mode) — the exact
 * prompt it sent, so the applier's hash check passes or fails on the same evidence as a fresh read. Returns false
 * (the caller calls the model) when that prompt is not kept.
 */
export async function reuseInto(outDir, fileKey, hit, extraMeta = {}) {
  const meta = { ...hit.meta, reused_from: { key: hit.key, job: hit.body?.job ?? null, read_at: hit.body?.read_at ?? null, at: new Date().toISOString() }, ...extraMeta };
  const pf = meta.prompt_sent_file;
  if (pf) {
    if (path.isAbsolute(pf) || pf.split(/[\\/]/).includes('..')) return false;
    const dest = path.join(outDir, pf);
    if (!fs.existsSync(dest)) {
      const sent = await fetchPromptText(hit.body.book_id, meta.prompt_sent_hash);
      if (!sent || contentHash(sent) !== meta.prompt_sent_hash) return false;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, sent);
    }
  }
  fs.writeFileSync(path.join(outDir, `${fileKey}.txt`), hit.text);
  fs.writeFileSync(path.join(outDir, `${fileKey}.meta.json`), JSON.stringify(meta, null, 1));
  return true;
}

/** True when the reader was asked to call the model even if a kept read exists (repeat-noise evals). */
export const wantsFresh = (argv = process.argv) => argv.includes('--fresh');
