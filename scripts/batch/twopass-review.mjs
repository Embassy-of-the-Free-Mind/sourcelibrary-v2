#!/usr/bin/env node
// PRIOR ART: scripts/batch/claude-translate.mjs (the sealed `claude -p` call, env strip, usage-limit test and strict tag
// split, imported from it) — it translates from OCR alone and cannot review a draft or see the image. The review pass of
// the job florentine-twopass test (#6865, 2026-10-18 03:15 report; its review.mjs was a jobs-volume one-off) is this
// script's recipe, unchanged: Opus, 5 leaves per call, page image + OCR + draft, the same instruction.
/**
 * Second pass of a two-pass translation (#6865): Opus reviews a draft read made by `cli-translate.mjs read` (Gemini
 * through agy) or `claude-translate.mjs read` (Opus, when the agy quota is out) against the page IMAGE and the OCR, and writes a read directory that `cli-translate.mjs apply` writes
 * like any other. Writes NOTHING to the database.
 *
 *   node --env-file=.env.production.local scripts/batch/twopass-review.mjs --page-ids-file=F --draft=DIR --out=DIR
 *        [--model=opus] [--per-call=5] [--wait] [--ocr-checked="..."]
 *
 * Before any call it runs scripts/lib/ocr-first-gate.mjs over the target pages, as claude-translate.mjs and
 * cli-translate.mjs do: a run resting mostly on a flash-lite transcription stops until --ocr-checked names the check.
 *
 * A call takes up to --per-call leaves in the file's order whose drafts are done; each leaf goes in with its image
 * (a file in the call's sealed folder, opened with the Read tool, the only tool allowed), its OCR and its draft
 * (<summary>/<keywords> stripped). The reply must be one `<translation page="N">` per leaf, in order, nothing else
 * (claude-translate's splitBlockReply); a refused call is retried once, then each leaf alone. The draft's
 * <summary>/<keywords> are put back after the reviewed text. The meta keeps the draft's prompt_ref, OCR hash and
 * context, the exact review prompt (prompts/<hash>.txt), and `passes`: the draft and the review, which apply copies into
 * the page's provenance. A draft that failed, was cut, or is chatter is not reviewed and gets no meta (apply never sees
 * it, so the page keeps its stored English). --wait: keep polling for drafts still being read until every page has one
 * or has failed. A usage limit stops the run (exit 3) with the reviews done so far saved, as claude-ocr.mjs and
 * claude-translate.mjs do; re-running skips them. It never retries on a timer: a call after a limit reply spends the
 * window the meter says is gone (Derek, 2026-10-22: wait for the meter's resets_at, then re-run).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { readPageIdsFile } from '../lib/ocr-targeting.mjs';
import { sanitizeTranslationTags, contentHash } from '../lib/translate-core.mjs';
import { cliChatterReason } from '../lib/cli-chatter.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { ocrFirstGate } from '../lib/ocr-first-gate.mjs';
import { splitBlockReply } from './claude-translate.mjs';

const READ_SITE = 'scripts/batch/twopass-review.mjs';
const PROMPT_VARIANT = 'twopass-review-6865';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = arg('out') && path.resolve(arg('out'));
const DRAFT = arg('draft') && path.resolve(arg('draft'));
const MODEL = arg('model') || 'opus';
const PER_CALL = Math.max(1, Math.min(10, Number(arg('per-call') || 5)));
const WAIT = process.argv.includes('--wait');
if (!OUT || !DRAFT || !arg('page-ids-file')) { console.error('usage: twopass-review.mjs --page-ids-file=F --draft=DIR --out=DIR (see the header)'); process.exit(2); }

export const INSTR = `You are reviewing a draft English translation of leaves of the Florentine Codex (Sahagún, 1570s, handwritten). Each leaf has two columns: Spanish on the LEFT and Nahuatl on the RIGHT; in the transcription (OCR) the columns are separated by <column-break/>. The two columns are not translations of each other.

For each leaf you have the page image (a file in this folder; open it with the Read tool), the OCR of both columns, and a draft translation. Check the Nahuatl column of the draft clause by clause against the OCR and the image. Correct mistranslations, restore omissions and remove additions that are not in the source. Keep everything that is correct unchanged, wording included; check the Spanish column the same way but change it only where it is wrong. Keep <column-break/> where it stands, and keep the draft's tags (<meta>, <header>, <note>, <term>, <unclear>, ...). Never summarise. Mark doubtful readings <unclear>…</unclear>. Output the FULL corrected translation of every leaf, not a list of changes.

A leaf whose OCR has no <column-break/> is a single column (a title page, a plate, a prologue): check it the same way.

Answer with the translation tags only, one per leaf in the order given: <translation page="1">…</translation> through <translation page="N">, and nothing before, between or after them: no commentary, no code fence.`;

const USAGE_LIMIT = /usage limit|limit reached|hit your (?:usage )?limit|out of extra usage|rate.?limit|\b429\b|resets? (?:at )?\d/i;
const STRIP = /<(summary|keywords)>[\s\S]*?<\/\1>/g;
const strip = (t) => t.replace(STRIP, '').trim();
const tail = (t) => (t.match(STRIP) || []).join('\n');
const claudeEnv = () => { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function claudeCall(prompt, cwd) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const ch = spawn('claude', ['-p', '--model', MODEL, '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, env: claudeEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    ch.stdout.on('data', (d) => (out += d)); ch.stderr.on('data', (d) => (err += d)); ch.stdin.end(prompt);
    const timer = setTimeout(() => ch.kill('SIGKILL'), 40 * 60 * 1000);
    ch.on('close', (code) => {
      clearTimeout(timer);
      let j = {}; try { j = JSON.parse(out); } catch { /* not JSON */ }
      const text = String(j.result ?? '').trim();
      const models = Object.keys(j.modelUsage || {});
      const failed = j.is_error || code !== 0;
      const cls = failed && USAGE_LIMIT.test(text + out + err) ? 'usage_limit' : code === null ? 'timeout' : failed ? `exit_${code}` : !text ? 'empty' : null;
      resolve({ text: failed ? '' : text, model: models.find((m) => m.includes('opus')) || models[0] || null, usage: j.usage ? { input: j.usage.input_tokens, output: j.usage.output_tokens, cache_read: j.usage.cache_read_input_tokens, turns: j.num_turns } : null, cls, err: (err || out).slice(-300), secs: (Date.now() - t0) / 1000 });
    });
  });
}

/** The leaf image, ≤ 2,400 px on the long side (the Codex scans are ~5,400 × 7,500): Getty IIIF at that size, else the archived master resized. */
async function fetchImage(p) {
  const tries = [];
  if (/\/iiif\/image\/.+\/full\/[^/]+\/0\/default\.jpg$/.test(p.photo || '')) tries.push(p.photo.replace(/\/full\/[^/]+\/0\//, '/full/!2400,2400/0/'));
  tries.push(getPageSource(p));
  for (const url of tries) {
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = await sharp(Buffer.from(await r.arrayBuffer())).resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
        return { buf, url };
      } catch (e) { console.log(`  image ${p.page_number} ${url}: ${e.message}`); await sleep(5000); }
    }
  }
  return null;
}

const version = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout?.trim();
if (!version) { console.error('claude is not installed'); process.exit(1); }
fs.mkdirSync(path.join(OUT, 'prompts'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });
const ids = readPageIdsFile(arg('page-ids-file'));
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await client.connect();
const db = client.db('bookstore');
const pages = new Map((await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1, photo: 1, archived_photo: 1, display_photo: 1 } }).toArray()).map((p) => [p.id, p]));
await client.close();
// Check the transcription before paying for a review on top of it (#6865).
const gate = ocrFirstGate([...pages.values()], arg('ocr-checked'));
console.log(gate.message);
if (!gate.ok) process.exit(2);

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const draftOf = (id) => {
  const m = readJson(path.join(DRAFT, `${id}.meta.json`));
  if (!m) return { state: 'pending' };
  let text = ''; try { text = fs.readFileSync(path.join(DRAFT, `${id}.txt`), 'utf8').trim(); } catch { /* none */ }
  if (m.error_class || m.wrapper || text.length < 5) return { state: 'failed', why: m.error_class || m.wrapper || 'empty' };
  const chatter = cliChatterReason(text);
  if (chatter) return { state: 'failed', why: `chatter: ${chatter}` };
  return { state: 'ready', meta: m, text };
};
const done = (id) => fs.existsSync(path.join(OUT, `${id}.meta.json`));
const failedLog = path.join(OUT, 'draft-failed.jsonl');
const noted = new Set();

async function review(group, attempt) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'tp2-'));
  const leaves = [];
  for (const [i, g] of group.entries()) {
    const img = await fetchImage(pages.get(g.id));
    if (!img) { fs.rmSync(dir, { recursive: true, force: true }); console.log(`  no image for p.${pages.get(g.id).page_number}`); return 'noimage'; }
    fs.writeFileSync(path.join(dir, `page${i + 1}.jpg`), img.buf);
    leaves.push({ ...g, image_url: img.url });
  }
  const body = leaves.map((g, i) => `=== LEAF ${i + 1} (image: page${i + 1}.jpg) ===\nOCR:\n${pages.get(g.id).ocr.data.trim()}\n\nDRAFT TRANSLATION:\n${strip(g.d.text)}`).join('\n\n');
  const sent = `${INSTR}\n\n${body}\n`;
  const t0 = new Date();
  const r = await claudeCall(sent, dir);
  fs.rmSync(dir, { recursive: true, force: true });
  const callId = `${group[0].id}-${group.length}-${attempt}-${Date.now().toString(36)}`;
  fs.writeFileSync(path.join(OUT, 'raw', `${callId}.txt`), r.text || r.err);
  const texts = r.text ? splitBlockReply(r.text, group.map((_, i) => i + 1)) : null;
  fs.appendFileSync(path.join(OUT, 'calls.jsonl'), JSON.stringify({ ts: new Date().toISOString(), call_id: callId, pages: group.map((g) => pages.get(g.id).page_number), model: r.model, secs: Math.round(r.secs), ok: !!texts, cls: r.cls || (texts ? null : 'page_tags_mismatch'), usage: r.usage, err: texts ? null : r.err.slice(-200) }) + '\n');
  console.log(`  ${group.map((g) => pages.get(g.id).page_number).join(',')}: ${texts ? 'ok' : `FAIL ${r.cls || 'tags'}`} ${Math.round(r.secs)}s`);
  if (r.cls === 'usage_limit') return 'limit';
  if (!texts) return 'fail';
  const sentHash = contentHash(sent);
  const promptFile = `prompts/${sentHash}.txt`;
  fs.writeFileSync(path.join(OUT, promptFile), sent);
  leaves.forEach((g, i) => {
    const reviewed = sanitizeTranslationTags(texts.get(i + 1));
    const text = [reviewed, tail(g.d.text)].filter(Boolean).join('\n\n');
    const dm = g.d.meta;
    fs.writeFileSync(path.join(OUT, `${g.id}.txt`), text);
    fs.writeFileSync(path.join(OUT, `${g.id}.meta.json`), JSON.stringify({
      page_id: g.id, book_id: dm.book_id, page_number: dm.page_number, cli: 'claude', cli_version: version, read_site: READ_SITE, prompt_variant: PROMPT_VARIANT,
      model: r.model || MODEL, model_requested: MODEL, call_id: callId, call_pages: group.length, attempts: attempt + 1, exit: 0, error_class: null, wrapper: null,
      started_at: t0.toISOString(), finished_at: new Date().toISOString(),
      // The OCR the draft was read from (apply refuses the page if it changed since), and the draft's production prompt.
      ocr_hash: dm.ocr_hash, ocr_updated_at: dm.ocr_updated_at ?? null, prompt_ref: dm.prompt_ref, is_english_book: dm.is_english_book, context: dm.context,
      prompt_sent_chars: sent.length, prompt_sent_hash: sentHash, prompt_sent_file: promptFile, call_usage: r.usage,
      chars: text.length, draft_chars: g.d.text.length, chatter: cliChatterReason(text),
      passes: [
        { pass: 'draft', cli: `${dm.cli} ${dm.cli_version}`, model: dm.model, read_site: dm.read_site || 'scripts/batch/cli-translate.mjs', ...(dm.call_id && { call_id: dm.call_id }), started_at: dm.started_at, finished_at: dm.finished_at, prompt_sent_hash: dm.prompt_sent_hash, prompt_sent_chars: dm.prompt_sent_chars, instruction: dm.instruction ?? null },
        { pass: 'review', cli: `claude ${version}`, model: r.model || MODEL, read_site: READ_SITE, prompt_variant: PROMPT_VARIANT, call_id: callId, call_pages: group.length, started_at: t0.toISOString(), finished_at: new Date().toISOString(), prompt_sent_hash: sentHash, image_url: g.image_url, kept_from_draft: ['summary', 'keywords'] },
      ],
    }, null, 1));
  });
  return 'ok';
}

async function run(group, attempt) {
  const res = await review(group, attempt);
  if (res === 'limit') { console.error(`STOPPED: usage limit at ${new Date().toISOString()}; ${ids.filter(done).length} of ${ids.length} reviewed. Re-run after the reset.`); process.exit(3); }
  return res;
}

console.log(`${ids.length} pages; review model ${MODEL}, ${PER_CALL} per call; claude ${version}`);
for (;;) {
  const todo = ids.filter((id) => pages.has(id) && !done(id));
  const states = todo.map((id) => ({ id, d: draftOf(id) }));
  for (const s of states) if (s.d.state === 'failed' && !noted.has(s.id)) { noted.add(s.id); fs.appendFileSync(failedLog, JSON.stringify({ page_id: s.id, page_number: pages.get(s.id).page_number, why: s.d.why }) + '\n'); }
  const ready = states.filter((s) => s.d.state === 'ready');
  const pending = states.filter((s) => s.d.state === 'pending').length;
  if (!ready.length && (!pending || !WAIT)) break;
  if (ready.length < PER_CALL && pending && WAIT) { await sleep(60000); continue; }
  const group = ready.slice(0, PER_CALL);
  if ((await run(group, 0)) === 'ok' || (await run(group, 1)) === 'ok') continue;
  for (const g of group) if (!done(g.id) && (await run([g], 2)) !== 'ok') { noted.add(g.id); fs.appendFileSync(path.join(OUT, 'review-failed.jsonl'), JSON.stringify({ page_id: g.id, page_number: pages.get(g.id).page_number }) + '\n'); }
  // a page whose review failed three times is left to its stored English; drop it from this run
  for (const g of group) if (!done(g.id)) pages.delete(g.id);
}
console.log(`done: ${ids.filter(done).length} of ${ids.length} reviewed`);
