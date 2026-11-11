#!/usr/bin/env node
// PRIOR ART: scripts/eval/ocr-error-to-translation-7611/xlate.mjs (the live translate prompt on agy for a GIVEN
// transcription, no writes) — this is that call, plus an image arm. The image arm puts the page scan in the call's
// workspace and lets the model open it with its own read_file turn (#7558: `@./file` attaches nothing in agy -p), with
// one added sentence. Writes nothing to production (#8358).
//   node --env-file=.env.production.local translate.mjs <tasks.json [{key,page_id,ocr_text}]> <pages.json> <outdir> --arm=text|image [--conc=2]
import fs from 'node:fs'; import path from 'node:path';
import { MongoClient } from 'mongodb';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, loadTranslationPrompts } from '../../lib/translate-core.mjs';
import { TRANSLATE_SUFFIX, CLI_SAFE_ARGS, agyCall, agyUsage, installToolGate, installNarrowAgent, gateCalls, unwrapRead } from '../../lib/agy-cli.mjs';
import { TRANSLATION_SENTINEL_INSTRUCTION } from '../../lib/cli-chatter.mjs';
const [TASKS, PAGES, OUT] = process.argv.slice(2);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const ARM = arg('arm'); if (!['text', 'image'].includes(ARM)) { console.error('--arm=text|image'); process.exit(2); }
const MODEL = arg('model') || 'gemini-3.8-flash-low';
const CONC = Number(arg('conc') || 2);
const tasks = JSON.parse(fs.readFileSync(TASKS, 'utf8')); const pages = JSON.parse(fs.readFileSync(PAGES, 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const prompts = await loadTranslationPrompts(db);
const books = new Map();
for (const b of await db.collection('books').find({ id: { $in: [...new Set(Object.values(pages).map((p) => p.book_id))] } }).toArray()) books.set(b.id, b);
await c.close();
// The image arm's one added sentence (written once, not tuned on these pages).
export const IMAGE_SUFFIX = `\n\nThe scan of this page is the file ./page.jpg in this directory. Open it with read_file (or view_file): that is the only tool available here. The transcription above was made from this scan by an OCR engine and may contain misread words, letters, names or numbers. Translate the transcription, but where the scan clearly shows a different reading, translate what the scan shows. ${TRANSLATION_SENTINEL_INSTRUCTION}\n`;
let quota = false;
async function one(t) {
  const f = path.join(OUT, `${t.key}.json`);
  if (fs.existsSync(f) || quota) return;
  const p = pages[t.page_id];
  const built = buildTranslationPrompt({ prompts, book: books.get(p.book_id), ocrText: t.ocr_text, previousTranslation: p.prev_english, prevOcrText: p.prev_ocr || undefined, nextOcrText: p.next_ocr || undefined, pageBreak: PAGE_BREAK_SCOPED });
  const sent = built.prompt + (ARM === 'image' ? IMAGE_SUFFIX : TRANSLATE_SUFFIX);
  const usage = []; let r, calls = 0, tools = []; const t0 = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', `xl-${ARM}-`));
    const log = installToolGate(ws, { task: ARM === 'image' ? 'ocr' : 'translate' });
    let agent = [];
    if (ARM === 'image') { fs.copyFileSync(p.image_file, path.join(ws, 'page.jpg')); agent = installNarrowAgent(ws); }
    r = await agyCall(['-p', sent, '--model', MODEL, ...agent, ...CLI_SAFE_ARGS], ws); calls++; usage.push(agyUsage(r.usage));
    const tc = gateCalls(log); tools = tools.concat(tc); fs.rmSync(ws, { recursive: true, force: true });
    if (r.cls === 'quota') { quota = true; console.error('QUOTA', r.err); return; }
    const opened = tc.some((x) => x === 'read_file' || x === 'view_file');
    // An image-arm reply that never opened the scan is not an image-arm read: try again (counted in `calls`).
    if (!r.cls && !unwrapRead(r.text).problem && (ARM === 'text' || opened)) break;
  }
  const { text, problem } = unwrapRead(r.text);
  fs.writeFileSync(f, JSON.stringify({ ...t, arm: ARM, model: MODEL, prompt_ref: built.promptRef, english: text, problem, cls: r.cls, calls, tool_calls: tools, usage, prompt_chars: sent.length, secs: Math.round((Date.now() - t0) / 1000) }));
  console.log(t.key, r.cls || problem || 'ok', text.length, 'chars', tools.join(','));
}
const q = tasks.slice();
await Promise.all(Array.from({ length: CONC }, async () => { while (q.length && !quota) await one(q.shift()); }));
if (quota) process.exit(3);
