#!/usr/bin/env node
// PRIOR ART: scripts/batch/twopass-review.mjs (a second pass over a draft English against the image and the OCR: Opus,
// 5 leaves a call; its instruction is the model for arm D's) and scripts/eval/error-zoo/guided-correct/build.py (the
// decoy method: the audit's findings framed as reports that may be wrong, one planted false report in random position).
// Neither fits as is: twopass-review is Opus-only and writes a read dir for apply; guided-correct corrects
// TRANSCRIPTIONS with Opus. This runs the two English arms on the live English route's model (agy 3.8 Flash low)
// through agy-cli.mjs gatedImageRead, the shared gated call. Writes NOTHING to the database.
/**
 * English repair test (#342), arms C and D over set.jsonl (draw.mjs):
 *   C guided: page image + transcription + stored English + the audit's findings as reports that may be wrong, with
 *             one planted false report (decoy) in a seeded random position.
 *   D blind:  page image + transcription + stored English, "check against the page and correct", no findings.
 *
 *   node scripts/eval/english-repair-342/repair.mjs --set=$JOB_SCRATCH/set --arm=C|D [--concurrency=2] [--limit=N]
 * Output: <set>/arm<C|D>/<page_id>.json { page_id, arm, text, problem, calls, cls, usage, secs, decoy? }.
 * Re-running skips pages with a clean output; a page whose call failed is retried (at most 3 tries in total).
 * Stops (exit 3) on a quota reply or when agyBlocked() says the model is closed: never calls to find out.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gatedImageRead, agyUsage } from '../../lib/agy-cli.mjs';
import { TRANSLATION_SENTINEL_INSTRUCTION } from '../../lib/cli-chatter.mjs';
import { agyBlocked } from '../../lib/model-limits.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const SET = arg('set'), ARM = arg('arm');
const MODEL = 'gemini-3.8-flash-low';
if (!SET || !['C', 'D'].includes(ARM)) { console.error('usage: repair.mjs --set=DIR --arm=C|D'); process.exit(1); }
const OUT = path.join(SET, `arm${ARM}`); fs.mkdirSync(OUT, { recursive: true });
const h = (s) => createHash('sha256').update(`english-repair-342:${s}`).digest('hex');

/** The English the reader is served, without the page's <summary>/<keywords> (an index field, not the page's text). */
export const body = (t) => String(t || '').replace(/<summary>[\s\S]*?<\/summary>/g, '').replace(/<keywords>[\s\S]*?<\/keywords>/g, '').trim();

/** The findings a guided pass is told: every English finding, transcription findings above minor, other serious. */
export function reportsOf(r) {
  return (r.errors || []).filter((e) => e.stage === 'translation' || (e.stage === 'ocr' && e.severity !== 'minor') || (e.stage === 'other' && e.severity === 'serious'))
    .map((e) => {
      const what = e.stage === 'ocr' ? 'In the transcription (the English may follow the misreading)' : e.stage === 'translation' ? 'In the English' : 'On this page';
      const q = [e.bad ? `quoted: "${String(e.bad).slice(0, 300)}"` : null, e.good ? `the page: "${String(e.good).slice(0, 300)}"` : null].filter(Boolean).join('; ');
      return `${what}: ${e.problem || '(no description)'}${q ? ` (${q})` : ''}`;
    });
}

const NEG_VERB = /\b(is|was|are|were|can|will|has|had|should|must|may)\b/;
/** One false report, built from text the stored English and every finding leave alone. Seeded by page id. */
export function decoyFor(r) {
  const en = body(r.translation);
  const busy = (r.errors || []).map((e) => String(e.bad || '')).filter(Boolean);
  // page furniture (running heads, folio numbers, signatures, meta) is not where a decoy should sit
  const furn = [...en.matchAll(/<(header|page-num|sig|meta|catchword)>[\s\S]*?<\/\1>|^#+ .*$|^Volume .*$/gm)].map((m) => [m.index, m.index + m[0].length]);
  const free = (i, len) => !busy.some((b) => { const j = en.indexOf(b); return j >= 0 && i < j + b.length && j < i + len; })
    && !furn.some(([a, z]) => i < z && a < i + len);
  const seed = parseInt(h(`decoy:${r.page_id}`).slice(0, 8), 16);
  // 1. a number: report it as another number (an O7 the decoy would plant)
  const nums = [...en.matchAll(/(?<![\w.,])(\d{1,4})(?![\w.,]?\d)/g)].filter((m) => free(m.index, m[0].length) && !/^0/.test(m[1]) && !/<page-num>[^<]*$/.test(en.slice(Math.max(0, m.index - 30), m.index)));
  if (nums.length) {
    const m = nums[seed % nums.length]; const n = Number(m[1]);
    const planted = String(n + 1 + (seed % 3));
    const ctx = en.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, ' ').trim();
    return { kind: 'number', orig: m[1], planted, context: ctx,
      report: `In the English: the number is wrong; the page gives ${planted}, not ${m[1]} (quoted: "${ctx}")` };
  }
  // 2. a statement: report it as negated on the page (a T8 the decoy would plant)
  const sents = en.split(/(?<=[.;!?])\s+/).map((s, k) => ({ s, k })).filter(({ s }) => NEG_VERB.test(s) && !/\bnot\b|n't\b|\bnever\b|\bno\b|\bnor\b|\bneither\b|\?/i.test(s) && !/^\W*(what|who|whom|how|why|where|when|which|whether)\b/i.test(s) && s.length > 30 && s.length < 300 && free(en.indexOf(s), s.length));
  if (sents.length) {
    const { s } = sents[seed % sents.length]; const v = s.match(NEG_VERB)[1];
    const negated = s.replace(NEG_VERB, `${v} not`);
    return { kind: 'negation', orig: s, planted: negated, context: s,
      report: `In the English: the sense is inverted; the page negates this statement, which should read "${negated.slice(0, 300)}" (quoted: "${s.slice(0, 300)}")` };
  }
  // 3. a capitalised name: report it as another spelling
  const names = [...en.matchAll(/(?<=[a-z,;] )([A-Z][a-z]{4,})/g)].filter((m) => free(m.index, m[0].length));
  if (names.length) {
    const m = names[seed % names.length]; const w = m[1];
    const i = 1 + (seed % (w.length - 2)); const planted = w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);
    return { kind: 'name', orig: w, planted, context: en.slice(Math.max(0, m.index - 40), m.index + w.length + 40).replace(/\s+/g, ' ').trim(),
      report: `In the English: the name is misspelt; the page reads "${planted}", not "${w}"` };
  }
  return null;
}

const HEAD = (r) => `You are reviewing the English translation of one page of a historical ${r.language || 'non-English'} book, for a library that publishes it beside the page image. The page image is attached. The transcription below was made from the image and may contain recognition errors; the image is the authority for what the page says.

TRANSCRIPTION:
"""
${body(r.ocr)}
"""

CURRENT ENGLISH TRANSLATION:
"""
${body(r.translation)}
"""
`;
const TASK = `Check the English against the page, sentence by sentence. Correct what is wrong: a sense inverted or a qualifier dropped; a word, name or number mistranslated; a passage of the page left out; text added that the page does not say (invented notes or glosses included); text that belongs to another page. Where the transcription misreads the page, translate what the image shows. Leave everything that is right exactly as it is, including the markup tags (<header>, <note>, <term>, <gloss>, <page-num>, <column-break/> and the like) and the paragraphing: do not restyle, polish or modernise. If nothing needs correcting, return the English unchanged.

Return the complete corrected English translation of the page and nothing else. ${TRANSLATION_SENTINEL_INSTRUCTION}`;

export function promptFor(r, arm) {
  if (arm === 'D') return `${HEAD(r)}\n${TASK}`;
  const reps = reportsOf(r); const d = decoyFor(r);
  if (d) { const pos = parseInt(h(`pos:${r.page_id}`).slice(0, 8), 16) % (reps.length + 1); reps.splice(pos, 0, d.report); }
  const list = reps.length ? reps.map((x, i) => `${i + 1}. ${x}`).join('\n') : '(none)';
  return `${HEAD(r)}
REVIEWER REPORTS. A reviewer flagged the points below. Reports may be wrong: check each one against the page image before acting on it, change the English only where the page bears the report out, and leave the English as it is where it does not. You may also correct other errors you find.
${list}

${TASK}`;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const set = fs.readFileSync(path.join(SET, 'set.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const outFile = (r) => path.join(OUT, `${r.page_id}.json`);
  const prev = (r) => { try { return JSON.parse(fs.readFileSync(outFile(r), 'utf8')); } catch { return null; } };
  const todo = set.filter((r) => { const p = prev(r); return !p || (p.cls && (p.tries ?? 1) < 3); }).slice(0, Number(arg('limit', 1e9)));
  console.log(`arm ${ARM}: ${todo.length} of ${set.length} pages to run`);
  let stop = null, i = 0;
  const one = async (r) => {
    const b = agyBlocked(MODEL); if (b) { stop = b; return; }
    const prompt = promptFor(r, ARM); const t0 = Date.now();
    const res = await gatedImageRead(prompt, fs.readFileSync(r.image), { model: MODEL, task: 'ocr', attempts: 2, tmp: process.env.TMPDIR });
    if (res.cls === 'quota') { stop = { reason: 'quota reply', text: String(res.text).slice(0, 200) }; return; }
    const p = prev(r);
    const row = { page_id: r.page_id, arm: ARM, group: r.group, text: res.answer, problem: res.problem, calls: res.calls, cls: res.cls ?? null, tries: (p?.tries ?? 0) + 1,
      tool_calls: res.tool_calls, usage: agyUsage(res.usage), secs: Math.round((Date.now() - t0) / 1000), prompt_hash: createHash('sha256').update(prompt).digest('hex').slice(0, 16),
      ...(ARM === 'C' ? { decoy: decoyFor(r), reports: reportsOf(r).length } : {}), at: new Date().toISOString() };
    fs.writeFileSync(outFile(r), JSON.stringify(row));
    console.log(`  ${r.page_id} ${r.group}: ${row.cls || row.problem || 'ok'} ${String(row.text || '').length} chars ${row.secs}s calls ${row.calls}`);
  };
  await Promise.all(Array.from({ length: Number(arg('concurrency', 2)) }, async () => { while (!stop && i < todo.length) await one(todo[i++]); }));
  if (stop) { console.log(`STOPPED: ${JSON.stringify(stop)}`); process.exit(3); }
}
