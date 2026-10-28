#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-ocr.mjs read (the production call this varies) — it cannot deny read_file, which is
// the question here; scripts/lib/agy-cli.mjs installToolGate is reused and its root pointed elsewhere for the deny arm.
/**
 * #7558: does `@./page.jpg` attach the image in `agy -p`, or does the model see it only through its read_file turn?
 * One page, one arm per run; nothing is written to Mongo.
 *
 *   node --env-file=... scripts/eval/agy-read-file-7558/attach-probe.mjs <page_id> old|att|deny <scratch-dir>
 *
 *   old   the production sentence (sentinels-6523): "attached: @./page.jpg"
 *   att   the same, plus "already in front of you: do not call any tool and do not open any file"
 *   deny  `att` with the tool gate's root moved away, so read_file is denied: the model has only the @ mention
 *
 * Result 2026-10-27 (2 pages, agy 1.4.8): old = run_command:deny then read_file, the page read; att = read_file anyway,
 * the page read; deny = "The image @./page.jpg is not present in the message context" (both pages). And
 * `--input-format=stream-json` refuses an image block: 'stream input content block type "image" is not supported (only
 * "text")'. So the read_file turn IS the read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { agyCall, agyUsage, installToolGate, gateCalls, CLI_SAFE_ARGS } from '../../lib/agy-cli.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { liveOcrPrompt } from '../../lib/live-ocr-prompt.mjs';
import { OCR_SENTINEL_INSTRUCTION } from '../../lib/cli-chatter.mjs';

const [pageId, variant, out] = process.argv.slice(2);
const S = {
  old: `\n\nThe page image to transcribe is attached: @./page.jpg Transcribe it in the format above. ${OCR_SENTINEL_INSTRUCTION}\n`,
  att: `\n\nThe page image to transcribe is attached to this message (@./page.jpg) and is already in front of you: do not call any tool and do not open any file. Transcribe it in the format above. ${OCR_SENTINEL_INSTRUCTION}\n`,
};
S.deny = S.att;
if (!pageId || !S[variant] || !out) { console.error('usage: attach-probe.mjs <page_id> old|att|deny <scratch-dir>'); process.exit(2); }
const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const p = await db.collection('pages').findOne({ id: pageId });
const { base } = await liveOcrPrompt(db);
const buf = Buffer.from(await (await fetch(getPageSource(p))).arrayBuffer());
const ws = path.join(out, `ws-${variant}-${pageId}`);
fs.rmSync(ws, { recursive: true, force: true });
fs.mkdirSync(ws, { recursive: true });
fs.writeFileSync(path.join(ws, 'page.jpg'), buf);
const log = installToolGate(ws);
if (variant === 'deny') { const h = path.join(ws, '.agents', 'hooks.json'); fs.writeFileSync(h, fs.readFileSync(h, 'utf8').replace(`AGY_GATE_ROOT='${ws}'`, "AGY_GATE_ROOT='/nonexistent'")); }
const r = await agyCall(['-p', base + S[variant], '--model', 'gemini-3.8-flash-low', ...CLI_SAFE_ARGS], ws);
fs.writeFileSync(path.join(out, `${variant}-${pageId}.txt`), r.text || '');
console.log(JSON.stringify({ variant, cls: r.cls, usage: agyUsage(r.usage), tools: gateCalls(log), chars: r.text?.length, head: r.text?.slice(0, 200) }));
await c.close();
