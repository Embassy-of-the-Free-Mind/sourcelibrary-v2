#!/usr/bin/env node
// PRIOR ART: scripts/batch/claude-translate.mjs `read` — the sealed Opus call (claudeCall), the strict tag splitter
// (splitBlockReply), CALL_SUFFIX and the production block prompt (translate-core buildBlockTranslationPrompt) are
// imported unchanged. It reads PAGES from Mongo; a leaf crop is not a page record (this job writes none), so this feeds
// the same prompt a leaf's transcription from a file, one leaf per call.
/**
 * leaf-translate.mjs — Opus (subscription), no writes to the database. Job split-leaves-5771 (#5771) step 5.
 *
 *   node --env-file=.env.production.local scripts/eval/split-leaf-5771/leaf-translate.mjs \
 *        --frames=frames.jsonl --txt=DIR(leaf reads) --out=DIR [--job=split-leaves-5771]
 *
 * Per frame, per leaf in frame order: one call, page number = the frame's page number, the production prompt
 * (book header, scoped page-break devices), NO previous-page seed: on these photos the leaves are consecutive rectos
 * (#5260), so the leaf before a leaf in reading order is on another frame, and the order is not established for these
 * books; a wrong seed would invite the translator to bridge text that is not continuous. A leaf whose read has fewer
 * than 5 syllables is a blank leaf: no call. Writes OUT/<uid>-L<i>.txt + .meta.json, and OUT/frames/<uid>.txt (the
 * frame's English, leaves joined by <leaf-break/>, as the served English is). Stops (exit 3) at the job's usage caps
 * (CLAUDE_SESSION_MAX_PCT / CLAUDE_WEEKLY_MAX_PCT, read by claudeCall); re-running skips leaves done.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MongoClient } from 'mongodb';
import { claudeCall, splitBlockReply, CALL_SUFFIX } from '../../batch/claude-translate.mjs';
import { buildBlockTranslationPrompt, loadTranslationPrompts, PAGE_BREAK_SCOPED, sanitizeTranslationTags, contentHash } from '../../lib/translate-core.mjs';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const TXT = arg('txt'), OUT = arg('out'), JOB = arg('job', 'split-leaves-5771');
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
const frames = fs.readFileSync(arg('frames'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const syl = (t) => t.replace(/\n/g, '་').split('་').filter((s) => s.trim()).length;

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const prompts = await loadTranslationPrompts(db);
const books = new Map((await db.collection('books').find({ id: { $in: [...new Set(frames.map((f) => f.book_id))] } }).toArray()).map((b) => [b.id, b]));
await c.close();

let calls = 0, stop = null;
for (const f of frames) {
  const leaves = fs.readdirSync(TXT).filter((x) => x.startsWith(`${f.uid}-L`) && x.endsWith('.txt')).sort((a, b) => Number(a.match(/-L(\d+)/)[1]) - Number(b.match(/-L(\d+)/)[1]));
  const english = [];
  for (const lf of leaves) {
    const id = lf.replace(/\.txt$/, ''), dst = path.join(OUT, `${id}.txt`), metaF = path.join(OUT, `${id}.meta.json`);
    const ocr = fs.readFileSync(path.join(TXT, lf), 'utf8').trim();
    if (fs.existsSync(metaF) && JSON.parse(fs.readFileSync(metaF, 'utf8')).exit === 0) { english.push(fs.readFileSync(dst, 'utf8').trim()); continue; }
    if (syl(ocr) < 5) {
      fs.writeFileSync(dst, ''); fs.writeFileSync(metaF, JSON.stringify({ id, exit: 0, blank: true, ocr_syllables: syl(ocr) }));
      english.push(''); continue;
    }
    if (stop) break;
    const page = { id, book_id: f.book_id, page_number: f.page_number, ocr: { data: ocr } };
    const built = buildBlockTranslationPrompt({ prompts, book: books.get(f.book_id), pages: [page], previousTranslation: null, pageBreak: PAGE_BREAK_SCOPED });
    const sent = built.prompt + CALL_SUFFIX;
    let text = null, r = null;
    for (let attempt = 0; attempt < 2 && text == null && !stop; attempt++) {
      const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'leaf-tr-'));
      r = await claudeCall(sent, 'opus', dir);
      fs.rmSync(dir, { recursive: true, force: true });
      calls++;
      if (r.cls === 'usage_limit') { stop = r.err || 'usage limit'; break; }
      const t = r.cls ? null : splitBlockReply(r.text, [f.page_number]);
      if (t) text = sanitizeTranslationTags(t.get(Number(f.page_number)));
      fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });
      fs.writeFileSync(path.join(OUT, 'raw', `${id}-${attempt}.txt`), r.text || '');
    }
    if (stop) break;
    fs.writeFileSync(dst, text || '');
    fs.writeFileSync(metaF, JSON.stringify({ id, uid: f.uid, book_id: f.book_id, page_number: f.page_number, exit: text ? 0 : 1, error_class: text ? null : (r?.cls || 'page_tags_mismatch'), model: r?.model, usage: r?.usage, secs: r?.secs, prompt_ref: built.promptRef, prompt_sent_hash: contentHash(sent), ocr_hash: contentHash(ocr), chatter: text ? cliChatterReason(text) : null, job: JOB, at: new Date().toISOString() }, null, 1));
    console.log(`  ${id}: ${text ? `${text.length} chars` : `FAILED ${r?.cls || 'tags'}`} (${Math.round(r?.secs || 0)}s)`);
    english.push(text || '');
  }
  if (stop) break;
  if (english.length === leaves.length) fs.writeFileSync(path.join(OUT, 'frames', `${f.uid}.txt`), english.join('\n<leaf-break/>\n').trim() + '\n');
}
console.log(`${calls} calls`);
if (stop) { console.error(`STOPPED: ${stop}`); process.exit(3); }
