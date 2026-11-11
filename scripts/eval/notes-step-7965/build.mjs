#!/usr/bin/env node
// PRIOR ART: scripts/eval/bench-translation/build.mjs builds the #7499 requests from Mongo; this does not rebuild them.
// It reads that run's kept requests and PLAIN reads (gex45 /root/jobs/prompt-bench-7499/w, copied to $BENCH7499) and
// derives this run's: v21 = the v13 request with buildV21's block stacked; the notes step = lib.mjs notesRequest over
// the kept PLAIN read. Nothing is re-sent to Mongo; no text is committed.
/**
 * #7965 step 3, build. In: $BENCH7499/{req/cli-v13.jsonl, units.jsonl, arms/{flash38,lite}-plain.jsonl}.
 * Out ($W = $JOB_SCRATCH/w): req/cli-v21.jsonl (agy, the #6545 132), req/cli-notes.jsonl (agy, notes over flash38-plain),
 * units.jsonl (lite Batch: set v21 = 365, v21b = the 50 floor pages, notes = notes over lite-plain), inputs.json.
 *
 *   node scripts/eval/notes-step-7965/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitAnnotations } from '../../lib/annotation-layer.mjs';
import { v21Request, requestParts, previousNotes, notesRequest, md5, NOTES_STEP_V1_MD5 } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const B = process.env.BENCH7499 || `${process.env.JOB_SCRATCH}/bench7499`;
const W = process.env.NOTES_W || `${process.env.JOB_SCRATCH}/w`;
const jl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, '../bench-translation/manifest.json'), 'utf8'));
const P = new Map(manifest.pages.map((p) => [p.id, p]));
fs.mkdirSync(path.join(W, 'req'), { recursive: true });
fs.mkdirSync(path.join(W, 'arms'), { recursive: true });

const cli13 = new Map(jl(`${B}/req/cli-v13.jsonl`).map((r) => [r.uid, r]));
const units13 = new Map(jl(`${B}/units.jsonl`).filter((u) => u.set === 'v13').map((u) => [u.uid, u]));
const plain = { flash38: new Map(jl(`${B}/arms/flash38-plain.jsonl`).filter((r) => r.text).map((r) => [r.uid, r])), lite: new Map(jl(`${B}/arms/lite-plain.jsonl`).filter((r) => r.text).map((r) => [r.uid, r])) };

const out = (f, rows) => fs.writeFileSync(path.join(W, f), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const inputs = {};
const notesFor = (engine, uid) => {
  const parts = requestParts(cli13.get(uid).prompt);
  const read = plain[engine].get(uid);
  if (!read) return null;
  const translation = splitAnnotations(read.text).text;   // translation.text as the store would hold the PLAIN read
  const prev = previousNotes(parts.previous);
  inputs[`${engine}|${uid}`] = { translation_md5: md5(translation), ocr_md5: md5(parts.ocr), prev_notes: prev.length, plain_out_tokens: read.usage?.output_tokens ?? read.out ?? null };
  return { parts, translation, prev };
};

// agy: the #6545 panel.
const panel = manifest.pages.filter((p) => p.p6545).map((p) => p.id);
const cliV21 = [], cliNotes = [];
for (const uid of panel) {
  const r = cli13.get(uid);
  const prompt = v21Request(r.prompt);
  cliV21.push({ uid, lang: r.lang, group: r.group, prompt, prompt_hash: md5(prompt) });
  const n = notesFor('flash38', uid);
  if (!n) { console.log(`flash38 ${uid}: no PLAIN read`); continue; }
  const np = notesRequest({ ocr: n.parts.ocr, translation: n.translation, prevNotes: n.prev, sourceLanguage: n.parts.sourceLanguage, sourceWork: n.parts.sourceWork, cli: true });
  cliNotes.push({ uid, lang: r.lang, group: r.group, prompt: np, prompt_hash: md5(np) });
}
out('req/cli-v21.jsonl', cliV21);
out('req/cli-notes.jsonl', cliNotes);

// lite Batch units (pareto-6182/run-arms.mjs reads $W/units.jsonl: uid, set, prompt, max_out, prod_model).
const units = [];
for (const p of manifest.pages) {
  const u = units13.get(p.id);
  const prompt = v21Request(u.prompt);
  units.push({ uid: p.id, set: 'v21', lang: u.lang, prod_model: u.prod_model, prompt, prompt_hash: md5(prompt), max_out: u.max_out });
  if (p.floor) units.push({ uid: p.id, set: 'v21b', lang: u.lang, prod_model: u.prod_model, prompt, prompt_hash: md5(prompt), max_out: u.max_out });
  const n = notesFor('lite', p.id);
  if (!n) { console.log(`lite ${p.id}: no PLAIN read`); continue; }
  const np = notesRequest({ ocr: n.parts.ocr, translation: n.translation, prevNotes: n.prev, sourceLanguage: n.parts.sourceLanguage, sourceWork: n.parts.sourceWork });
  units.push({ uid: p.id, set: 'notes', lang: u.lang, prod_model: u.prod_model, prompt: np, prompt_hash: md5(np), max_out: 4096 });
}
out('units.jsonl', units);
fs.writeFileSync(path.join(W, 'inputs.json'), JSON.stringify({ notes_step_md5: NOTES_STEP_V1_MD5, built: new Date().toISOString(), pages: inputs }, null, 1));
const c = (s) => units.filter((u) => u.set === s).length;
console.log(`agy: v21 ${cliV21.length}, notes ${cliNotes.length}; lite units: v21 ${c('v21')}, v21b ${c('v21b')}, notes ${c('notes')}; notes-step/v1 md5 ${NOTES_STEP_V1_MD5}`);
const prevN = Object.values(inputs).map((x) => x.prev_notes);
console.log(`previous-page notes: ${prevN.filter((n) => n > 0).length} of ${prevN.length} inputs carry some (median ${prevN.sort((a, b) => a - b)[prevN.length >> 1]})`);
