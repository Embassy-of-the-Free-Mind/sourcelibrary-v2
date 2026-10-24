// Shared harness, copied unchanged from ../whish147-best-attempt-2026-10-22/lib.mjs (branch job-whish147-best, #7119), except SCRATCH has no default.
// subscription, every prompt, reply and image hash kept.
// PRIOR ART: scripts/batch/claude-ocr.mjs — `claudeCall` (strips ANTHROPIC_* so the CLI uses the subscription login)
// is reused as is; its read loop is one-page-per-file OCR on the live prompt, which these collation/locate calls are not.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { claudeCall } from '../../../batch/claude-ocr.mjs';

export const SCRATCH = process.env.JOB_SCRATCH;
export const HERE = path.dirname(new URL(import.meta.url).pathname);
export const BOOK = '6ad845ec6037414ddef152af';
export const CROPS = path.join(SCRATCH, 'crops');
export const sha = (b) => createHash('sha256').update(b).digest('hex');
export const hash16 = (s) => sha(s).slice(0, 16);

export class UsageLimit extends Error {}

/**
 * Run (or reuse) one sealed call. `stage` and `id` name the result file under HERE/reads/<stage>/<id>.txt (+ .meta.json).
 * images: crop file paths; they are copied into a folder of their own as p01.jpg, p02.jpg … and nothing else.
 */
export async function sealedCall({ stage, id, model, prompt, images }) {
  const dir = path.join(HERE, 'reads', stage);
  fs.mkdirSync(dir, { recursive: true });
  const txt = path.join(dir, `${id}.txt`), metaF = path.join(dir, `${id}.meta.json`);
  if (fs.existsSync(metaF)) {
    const m = JSON.parse(fs.readFileSync(metaF, 'utf8'));
    if (m.ok && m.prompt_hash === hash16(prompt)) return { text: fs.readFileSync(txt, 'utf8'), meta: m, cached: true };
  }
  const seal = path.join(SCRATCH, 'sealed', `${stage}-${id}-${Date.now()}`);
  fs.mkdirSync(seal, { recursive: true });
  const imgs = images.map((f, i) => {
    const buf = fs.readFileSync(f);
    fs.writeFileSync(path.join(seal, `p${String(i + 1).padStart(2, '0')}.jpg`), buf);
    return { crop: path.basename(f), bytes: buf.length, sha256: sha(buf) };
  });
  const started = new Date().toISOString();
  let r;
  for (let attempt = 0; attempt < 2; attempt++) {
    r = await claudeCall(prompt, model, seal);
    if (!r.cls || r.cls === 'usage_limit') break;
  }
  fs.rmSync(seal, { recursive: true, force: true });
  fs.appendFileSync(path.join(HERE, 'reads', 'calls.jsonl'), JSON.stringify({ ts: new Date().toISOString(), stage, id, model: r.model, model_requested: model, secs: Math.round(r.secs), cls: r.cls, usage: r.usage }) + '\n');
  if (r.cls === 'usage_limit') throw new UsageLimit(r.err || r.text.slice(0, 300));
  const promptFile = path.join(HERE, 'reads', 'prompts', `${hash16(prompt)}.txt`);
  fs.mkdirSync(path.dirname(promptFile), { recursive: true });
  if (!fs.existsSync(promptFile)) fs.writeFileSync(promptFile, prompt);
  const meta = { stage, id, ok: !r.cls, error_class: r.cls, model: r.model || model, model_requested: model, cli: 'claude', started_at: started, finished_at: new Date().toISOString(), secs: Math.round(r.secs), prompt_hash: hash16(prompt), prompt_file: path.relative(HERE, promptFile), images: imgs, usage: r.usage, stderr_tail: r.cls ? r.err : undefined };
  fs.writeFileSync(txt, r.text || '');
  fs.writeFileSync(metaF, JSON.stringify(meta, null, 1));
  return { text: r.text || '', meta, cached: false };
}

/** Run tasks with a fixed concurrency; a UsageLimit pauses every worker, waits, and retries the task. */
export async function pool(tasks, n, fn, { waitMin = 20 } = {}) {
  const q = [...tasks];
  let pausedUntil = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (q.length) {
      const t = q.shift();
      for (;;) {
        while (Date.now() < pausedUntil) await new Promise((r) => setTimeout(r, 30000));
        try { await fn(t); break; } catch (e) {
          if (!(e instanceof UsageLimit)) { console.error(`task ${JSON.stringify(t).slice(0, 80)} failed: ${e.stack || e}`); break; }
          pausedUntil = Math.max(pausedUntil, Date.now() + waitMin * 60000);
          console.log(`${new Date().toISOString()} usage limit (${e.message.slice(0, 120)}); pausing ${waitMin} min`);
        }
      }
    }
  }));
}

export const crop = (page, leaf, half) => path.join(CROPS, `${page}-${leaf}${half}.jpg`);
export const boxes = () => JSON.parse(fs.readFileSync(path.join(HERE, 'boxes.json'), 'utf8'));
export const edition = (work) => fs.readFileSync(path.join(SCRATCH, 'editions', `${work}.txt`), 'utf8');
