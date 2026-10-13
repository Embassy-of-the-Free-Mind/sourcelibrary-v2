#!/usr/bin/env node
// PRIOR ART: scripts/eval/ocr-pareto-6293/rescore-extract.mjs (6523c) applies the same extractor to the OCR Pareto
// arms and re-scores them; this walks EVERY stored CLI arm (OCR, translation, QA), keeps the raw untouched and writes
// the rescued text beside it with its method and guard result, for the second pass and the rescore to read.
/**
 * Steps 1–2 of the #6523 rescue: inventory every stored CLI output and cut what a deterministic extractor can.
 *
 *   node scripts/eval/cli-rescue-6523/rescue.mjs [--out DIR]
 *
 * Per arm (arms.mjs) and row:
 *   raw_problem   ocrReadProblem (OCR), cliChatterReason (translation), or 'not JSON' (QA) on the raw reply
 *   deterministic extractTranscription() from scripts/lib/cli-chatter.mjs (6523c's; NOT a second extractor). A
 *                 translation reply's leading "Here is the translation:" line is dropped first, the one shape that
 *                 extractor's lead-in list (written for transcriptions) does not name. A QA reply keeps its first
 *                 complete JSON object.
 *   guard         verbatimCut(raw, rescued): the cut must be a contiguous substring of the raw reply.
 *   method        'unchanged' (raw had no problem and the extractor removed nothing), 'deterministic' (the cut passed
 *                 the guard and the problem is gone), 'needs-cli' (text left, problem not settled), 'unrescuable'
 *                 (empty raw, or nothing left after the cut).
 *   A row that passes the checks is never changed; if the extractor would have cut it, that is recorded
 *   (`extractor_would_change`) for the extractor's owner.
 * Writes DIR/<arm>.jsonl (one record per row: key, raw sha, problem, method, rescued text when it differs) and
 * DIR/inventory.json (counts per arm). DIR defaults to $JOB_SCRATCH/cli-rescue-6523.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { ARMS } from './arms.mjs';
import { extractTranscription, ocrReadProblem, cliChatterReason } from '../../lib/cli-chatter.mjs';
import { verbatimCut, VERBATIM_GUARD_VERSION } from '../../lib/verbatim-cut.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = arg('out', join(process.env.JOB_SCRATCH || '/tmp', 'cli-rescue-6523'));
mkdirSync(OUT, { recursive: true });

export const EXTRACTOR_VERSION = (() => {
  const blob = execSync('git hash-object scripts/lib/cli-chatter.mjs').toString().trim().slice(0, 12);
  return `cli-chatter.extractTranscription@${blob}`;
})();

export function readJsonl(path) {
  const buf = readFileSync(path);
  const s = path.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  return s.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}
const sha = (s) => createHash('sha256').update(String(s ?? '')).digest('hex').slice(0, 16);

/** The prompt of some OCR arms (the Pareto strata) asks for plain text, so a missing <page-type> is not a failure there. */
export function problemOf(kind, text, untagged) {
  if (kind === 'qa') {
    // assemble.py's rule: the reply, a ``` fence removed, parses as JSON (an object or, for a book call, an array).
    const t = String(text || '').trim();
    if (!t) return 'empty';
    try { JSON.parse(t.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1')); return null; } catch { return firstJson(t) === null ? 'not JSON' : 'JSON wrapped in chat'; }
  }
  if (kind === 'translation') return cliChatterReason(text);
  const p = ocrReadProblem(text);
  if (untagged && p === 'no <page-type> tag') {
    // Same checks without the tag requirement: plan note, refusal, or a duplicated reply.
    const q = ocrReadProblem(`<page-type>text</page-type>\n${String(text || '').trim()}`);
    return q === 'conversational opener' ? null : q;
  }
  return p;
}

/** The first complete, parseable JSON object in a reply, as its source span, or null. */
export function firstJson(text) {
  const t = String(text || '');
  for (let a = t.indexOf('{'); a >= 0; a = t.indexOf('{', a + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = a; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        const span = t.slice(a, i + 1);
        try { JSON.parse(span); return span; } catch { break; }
      }
    }
  }
  return null;
}

/** An OCR arm whose prompt asks for plain text (most rows carry no <page-type>). */
export const isUntagged = (arm, rows) => arm.kind === 'ocr' && rows.filter((r) => /<page-type>/.test(arm.text(r) || '')).length < rows.length * 0.5;

const TR_LEAD = /^\s*(?:[^\n]{0,240}\bhere(?:'s| is) (?:the |my |your )?(?:[\w-]+ ){0,3}translation\b[^\n]{0,160}:[ \t]*\n)+/i;

export function deterministic(kind, raw) {
  if (kind === 'qa') { const j = firstJson(raw); return { text: j ?? '', steps: j && j.trim() !== String(raw).trim() ? ['first JSON object'] : [] }; }
  let t = String(raw || '');
  const steps = [];
  if (kind === 'translation') {
    // The last announcing line wins: what precedes it can be a separate reply (Tengyur p261).
    const lines = [...t.matchAll(/^[^\n]{0,240}\bhere(?:'s| is) (?:the |my |your )?(?:[\w-]+ ){0,3}translation\b[^\n]{0,160}:[ \t]*$/gim)];
    if (lines.length) { const m = lines.at(-1); t = t.slice(m.index + m[0].length); steps.push('translation announcement'); }
    else if (TR_LEAD.test(t)) { t = t.replace(TR_LEAD, ''); steps.push('translation announcement'); }
  }
  const x = extractTranscription(t);
  return { text: x.text, steps: [...steps, ...x.steps] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const inventory = { extractor: EXTRACTOR_VERSION, guard: VERBATIM_GUARD_VERSION, at: new Date().toISOString(), arms: {} };
  for (const arm of ARMS) {
    if (!existsSync(arm.path)) { inventory.arms[arm.id] = { missing: arm.path }; continue; }
    const rows = readJsonl(arm.path);
    const untagged = isUntagged(arm, rows);
    const c = { rows: rows.length, failing_raw: 0, by_problem: {}, unchanged: 0, deterministic: 0, deterministic_cosmetic: 0 /* clean rows the extractor would have changed, left as they are */, needs_cli: 0, unrescuable: 0, guard_rejected: 0 };
    const out = [];
    for (const r of rows) {
      const raw = arm.text(r) ?? '';
      const problem = problemOf(arm.kind, raw, untagged);
      if (problem) { c.failing_raw++; c.by_problem[problem] = (c.by_problem[problem] || 0) + 1; }
      const rec = { arm: arm.id, key: arm.key(r), model: arm.model, raw_sha: sha(raw), raw_chars: raw.length, raw_problem: problem };
      if (!raw.trim()) { rec.method = 'unrescuable'; rec.why = 'empty raw'; c.unrescuable++; out.push(rec); continue; }
      const d = deterministic(arm.kind, raw);
      const changed = d.text.trim() !== raw.trim();
      const after = d.text.trim() ? problemOf(arm.kind, d.text, untagged) : 'empty';
      // A reply that passes the checks is left as it is: the extractor's restart split also fires on text that
      // really repeats (Psalm 136's refrain, Tengyur verse), so on a clean reply its cut is recorded, not taken.
      if (!problem) {
        rec.method = 'unchanged'; c.unchanged++;
        if (changed) { rec.extractor_would_change = d.steps; c.deterministic_cosmetic++; }
        out.push(rec); continue;
      }
      const guard = changed ? verbatimCut(raw, d.text, { minLetters: arm.kind === 'qa' ? 5 : 20 }) : null;
      Object.assign(rec, { extractor: EXTRACTOR_VERSION, steps: d.steps, after_problem: after });
      if (guard) rec.guard = { version: VERBATIM_GUARD_VERSION, ok: guard.ok, reason: guard.reason, kept_share: guard.kept_share };
      if (guard && !guard.ok && d.text.trim()) { c.guard_rejected++; }
      if (changed && guard?.ok && !after) {
        rec.method = 'deterministic'; rec.text = d.text; c.deterministic++;
      } else if (!d.text.trim() && !changed) {
        rec.method = 'unrescuable'; rec.why = 'nothing left'; c.unrescuable++;
      } else {
        rec.method = 'needs-cli'; c.needs_cli++;
      }
      out.push(rec);
    }
    writeFileSync(join(OUT, `${arm.id.replace(/[:/]/g, '__')}.jsonl`), out.map((o) => JSON.stringify(o)).join('\n') + '\n');
    inventory.arms[arm.id] = { issue: arm.issue, kind: arm.kind, model: arm.model, path: arm.path, untagged_prompt: untagged || undefined, ...c };
  }
  writeFileSync(join(OUT, 'inventory.json'), JSON.stringify(inventory, null, 1));
  const tot = {};
  for (const [id, a] of Object.entries(inventory.arms)) {
    if (a.missing) { console.log(`${id}: MISSING ${a.missing}`); continue; }
    console.log(`${id.padEnd(52)} rows ${String(a.rows).padStart(4)} fail ${String(a.failing_raw).padStart(4)} det ${String(a.deterministic).padStart(4)} (clean-but-would-cut ${a.deterministic_cosmetic}) cli? ${String(a.needs_cli).padStart(3)} unresc ${String(a.unrescuable).padStart(3)} ${JSON.stringify(a.by_problem)}`);
    for (const k of ['rows', 'failing_raw', 'deterministic', 'needs_cli', 'unrescuable']) tot[k] = (tot[k] || 0) + a[k];
  }
  console.log('TOTAL', tot);
}
