/**
 * Every hand-run script that submits a Gemini batch and writes page text is a lane or a listed door (v2#8590 item 3,
 * v3#241). This is the scripts-side twin of page-text-doors.test.ts, which covers website routes.
 *
 * WHY. The router decides which engine reads or translates a page. lanes-registry.test.ts covers the scripts a
 * schedule runs, and page-text-doors.test.ts covers the website routes. What was left is scripts a person runs by
 * hand: a script that submits its own Gemini batch can put text into pages on an engine the router never chose.
 * The usual way it does this is indirect. The script writes no page itself. It inserts a `batch_jobs` row of type
 * `ocr` and batch-collector.mjs writes every page in it. Two archived scripts (scripts/_archived/2026-11-batch-doors)
 * worked this way.
 *
 * WHAT IT CHECKS. A tracked code file under scripts/ (not _archived/ or output/) is a DOOR when it submits a Gemini
 * batch (BATCH_SUBMIT) AND it either
 *   (a) writes or clears page text in its own source (the shared probe, ./page-text-probe.ts),
 *   (b) calls a library writer by name (SCRIPT_TEXT_WRITERS), or
 *   (c) hands its batch to the collector: a `batch_jobs` insert of type `ocr` or `translation` (HANDS_TO_COLLECTOR).
 * Every door must be a file of a lane in LANES or an entry in SCRIPT_PAGE_TEXT_DOORS with a kind, a reason and an
 * issue. An entry that is no longer a door fails too, so the list cannot rot.
 *
 * WHAT IT DOES NOT SEE. The probe's blind spots (page-text-probe.ts). It also misses a write made inside a local
 * helper module the script imports, unless that helper is one of the named writers. Following imports would flag
 * every eval that imports translate-core.mjs for its prompt builders. It misses a batch submitted through a helper
 * whose name is not in BATCH_SUBMIT, and a batch_jobs row whose type is computed at run time.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
// @ts-expect-error plain .mjs
import { LANES, SCRIPT_PAGE_TEXT_DOORS, PAGE_TEXT_DOOR_KINDS } from '../../scripts/lib/lanes.mjs';
import { REPO, writesOrClearsPageText } from './page-text-probe';

type Door = { file: string; kind: string; reason: string; issue?: string };

/** The four ways a script submits a Gemini batch: the list on v3#241. */
export const BATCH_SUBMIT = /batchGenerateContent|batches\.create|createBatch(WithRotation|JobInline)?\(/; // POSIX ERE too: git grep -E reads it

/**
 * Library functions under scripts/lib that write or clear page text, or build the update that does. A script that
 * calls one holds no update document, so the probe cannot see the write from the script.
 */
const SCRIPT_TEXT_WRITERS = ['writePageText', 'writePageTranslation', 'restoreRevision', 'repairTranslationText', 'ocrSetFields', 'withholdUpdate', 'restoreUpdate'];
const WRITER_CALL = new RegExp(`\\b(?:${SCRIPT_TEXT_WRITERS.join('|')})\\s*\\(`);

const COLLECTOR_TYPE = String.raw`\{[^]{0,800}?\btype:\s*['"](?:ocr|translation)['"]`;
/** A `batch_jobs` row batch-collector.mjs turns into page text: inline, or through a variable that holds the collection. */
export function handsToCollector(src: string): boolean {
  if (new RegExp(String.raw`collection\(\s*['"]batch_jobs['"]\s*\)\s*\.\s*insert(?:One|Many)\(\s*\[?\s*` + COLLECTOR_TYPE).test(src)) return true;
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*[^;\n]*?collection\(\s*['"]batch_jobs['"]\s*\)/g)) {
    if (new RegExp(String.raw`\b${m[1]}\s*\.\s*insert(?:One|Many)\(\s*\[?\s*` + COLLECTOR_TYPE).test(src)) return true;
  }
  return false;
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Why this source is a door, or null. */
export function scriptDoorReason(src: string): string[] | null {
  const code = stripComments(src);
  if (!BATCH_SUBMIT.test(code)) return null;
  const why = [
    writesOrClearsPageText(src) && 'writes page text',
    WRITER_CALL.test(code) && 'calls a page-text writer',
    handsToCollector(code) && 'hands an ocr/translation batch to batch-collector',
  ].filter(Boolean) as string[];
  return why.length ? why : null;
}

/** Tracked code files under scripts/ whose text matches BATCH_SUBMIT (comments are stripped before the real test). */
function scriptFiles(): string[] {
  let out = '';
  try { out = execFileSync('git', ['grep', '-lE', BATCH_SUBMIT.source, '--', 'scripts'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 }); } catch { return []; }
  return out.split('\n')
    .filter((f) => f && /\.(m?[jt]s|cjs)$/.test(f) && !/^scripts\/(_archived|output)\//.test(f) && !/\/_archived\//.test(f) && !/\.test\.[jt]s$/.test(f));
}

const laneFiles = new Set<string>((LANES as { files: string[] }[]).flatMap((l) => l.files));
const doors = SCRIPT_PAGE_TEXT_DOORS as Door[];

describe('hand-run script doors into page text (v2#8590 item 3)', () => {
  const found = new Map<string, string[]>();
  const submitters: string[] = [];
  for (const f of scriptFiles()) {
    const src = fs.readFileSync(path.join(REPO, f), 'utf8');
    if (BATCH_SUBMIT.test(stripComments(src))) submitters.push(f);
    const why = scriptDoorReason(src);
    if (why) found.set(f, why);
  }

  it('every script that submits a Gemini batch and writes page text is a lane or a listed door', () => {
    const listed = new Set(doors.map((d) => d.file));
    const unregistered = [...found].filter(([f]) => !laneFiles.has(f) && !listed.has(f)).map(([f, why]) => `${f} (${why.join('; ')})`);
    expect(unregistered, [
      'These scripts submit a Gemini batch and write page text (pages.ocr / pages.translation), and are not registered (v3#241).',
      'Text a model produces belongs to a lane the router feeds: queue the book for its lane instead.',
      'If the script must exist, add it to a lane in scripts/lib/lanes.mjs, or to SCRIPT_PAGE_TEXT_DOORS there with its kind, reason and issue.',
    ].join(' ')).toEqual([]);
  });

  it('every listed door is still a door, has a known kind, a reason and an issue, and has one home', () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const d of doors) {
      if (seen.has(d.file)) problems.push(`${d.file}: listed twice`);
      seen.add(d.file);
      if (!fs.existsSync(path.join(REPO, d.file))) { problems.push(`${d.file}: file is gone — remove the entry`); continue; }
      if (!found.has(d.file)) problems.push(`${d.file}: no longer submits a batch AND writes page text — remove the entry`);
      if (!PAGE_TEXT_DOOR_KINDS.includes(d.kind)) problems.push(`${d.file}: unknown kind ${d.kind}`);
      if (!d.reason?.trim()) problems.push(`${d.file}: no reason`);
      if (!/^v[23]#\d+$/.test(d.issue ?? '')) problems.push(`${d.file}: no issue that makes it a lane or retires it`);
      if (laneFiles.has(d.file)) problems.push(`${d.file}: is a lane's file too — a door has one home`);
    }
    expect(problems).toEqual([]);
    // The count is the work left on v2#8590 item 3. It may only fall: a new model door is a lane, not an entry.
    expect(doors.filter((d) => d.kind === 'model').length, 'a new model door was listed: make it a lane the router feeds').toBeLessThanOrEqual(1);
  });

  it('every named writer is a function a scripts/lib module exports', () => {
    const libs = execFileSync('git', ['ls-files', '--', 'scripts/lib'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').filter((f) => /\.mjs$/.test(f))
      .map((f) => fs.readFileSync(path.join(REPO, f), 'utf8')).join('\n');
    expect(SCRIPT_TEXT_WRITERS.filter((n) => !new RegExp(`export\\s+(?:async\\s+)?function\\s+${n}\\b`).test(libs))).toEqual(['restoreRevision']);
    // restoreRevision lives in src/lib/page-revisions.ts; a script that imports it is still a writer.
    expect(fs.readFileSync(path.join(REPO, 'src/lib/page-revisions.ts'), 'utf8')).toMatch(/export\s+async\s+function\s+restoreRevision\b/);
  });

  it('positive controls on the real tree: the sweep finds the submitters and the lane writers', () => {
    // A check that finds nothing proves nothing.
    expect(submitters.length, 'the batch-submit regex stopped matching').toBeGreaterThan(25);
    for (const [f, shape] of [
      ['scripts/batch/bulk-reocr-local.mjs', 'hands an ocr/translation batch to batch-collector'],
      ['scripts/batch/retranslate-stale.mjs', 'hands an ocr/translation batch to batch-collector'],
      ['scripts/maintenance/reread-loop-pages.mjs', 'writes page text'],
      ['scripts/maintenance/tengyur-heading-judge-5497.mjs', 'calls a page-text writer'],
    ]) expect(found.get(f), `${f} should be found as a door (${shape})`).toContain(shape);
    // An eval that registers its batch as external_eval and writes files is not a door.
    expect(found.has('scripts/eval/ocr-pareto-6293/run-arms.mjs')).toBe(false);
  });

  it('negative controls: a planted unregistered writer is caught in each code shape', () => {
    const submit = "const job = await ai.batches.create({ model, src: { fileName: file.name } });\n";
    // Shape 1: the script writes the page itself, inline update.
    expect(scriptDoorReason(submit + "await db.collection('pages').updateOne({ id }, { $set: { 'ocr.data': text, updated_at: now } });")).toEqual(['writes page text']);
    // Shape 2: the script hands the batch to the collector, inline and through a variable.
    expect(scriptDoorReason(submit + "await db.collection('batch_jobs').insertOne({\n  id: nanoid(),\n  job_name: job.name,\n  type: 'ocr',\n  status: 'pending',\n});")).toEqual(['hands an ocr/translation batch to batch-collector']);
    expect(scriptDoorReason(submit + "const jobs = db.collection('batch_jobs');\nawait jobs.insertOne({ job_name: job.name, type: 'translation', status: 'pending' });")).toEqual(['hands an ocr/translation batch to batch-collector']);
    // Shape 3: through a library writer, with no update document in the script.
    expect(scriptDoorReason("const job = await createBatchWithRotation(model, reqs);\nawait writePageTranslation(db, { page, book, text, model });")).toEqual(['calls a page-text writer']);
    // Not doors: no batch; an eval batch registry row; a reader; a comment.
    expect(scriptDoorReason("await db.collection('pages').updateOne({ id }, { $set: { 'ocr.data': text } });")).toBeNull();
    expect(scriptDoorReason(submit + "await db.collection('batch_jobs').insertOne({ job_name: job.name, type: 'external_eval', status: 'pending' });")).toBeNull();
    expect(scriptDoorReason(submit + "const pages = await db.collection('pages').find({ 'ocr.data': { $exists: true } }, { projection: { 'translation.data': 1 } }).toArray();")).toBeNull();
    expect(scriptDoorReason(submit + '// results are later written with writePageTranslation(…) by the lane, not here')).toBeNull();
  });
});
