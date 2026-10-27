#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-ocr.mjs read --correct-prompt (the lane's request: corr-prompt.txt with the draft in its
// {draft} slot, then the image) and prep.py (the 30-folio arms). Neither loads an error profile; this builds the same
// request three ways, the profile text coming from per-reader / per-corrector data files (profiles/*.json).
/**
 * Stage 1 requests for the corrector-profile experiment (#6560, #6740): one request per page and arm.
 *   A  corr-prompt.txt, unchanged
 *   B  A + the READER profile of the draft's OCR system (profiles/reader.<draft model>.<script>.json)
 *   C  B + the CORRECTOR profile of the model that corrects (profiles/corrector.<model>.<script>.json)
 * A profile goes in after the prompt's description of the image and before its output rules, so the draft stays last.
 *
 *   node arms.mjs --root=$JOB_SCRATCH
 * reads <root>/set/pages.jsonl (build-set.mjs) and <root>/prep/req/corr-anchor.jsonl (prep.py --reuse-plants: the 10
 * planted drafts), writes <root>/req/{A,B,C}.jsonl ({uid, image, prompt}) and <root>/req/drafts.jsonl ({uid, draft}).
 * Run each with scripts/eval/run-cli-arm.py --model gemini-3.8-flash-low --kind ocr.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const ROOT = arg('root') || process.env.JOB_SCRATCH;
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

export const TEMPLATE = fs.readFileSync(path.join(HERE, '..', 'corr-prompt.txt'), 'utf8');
export const loadProfile = (kind, model, script) => JSON.parse(fs.readFileSync(path.join(HERE, 'profiles', `${kind}.${model}.${script}.json`), 'utf8'));
const ANCHOR = '\n\nWrite the transcription between';

/** The arm's prompt for one draft. */
export function armPrompt(arm, draft, { reader = 'yigdzin-v1', corrector = 'gemini-3.8-flash-low', script = 'tibetan' } = {}) {
  if (!TEMPLATE.includes(ANCHOR) || !TEMPLATE.includes('{draft}')) throw new Error('corr-prompt.txt changed shape: no output-rules paragraph or {draft} slot');
  const blocks = [];
  if (arm === 'B' || arm === 'C') blocks.push(loadProfile('reader', reader, script).prompt_text);
  if (arm === 'C') blocks.push(loadProfile('corrector', corrector, script).prompt_text);
  const t = blocks.length ? TEMPLATE.replace(ANCHOR, `\n\n${blocks.join('\n\n')}${ANCHOR}`) : TEMPLATE;
  return t.split('{draft}').join(draft);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pages = readJsonl(path.join(ROOT, 'set', 'pages.jsonl'));
  const anchors = readJsonl(path.join(ROOT, 'prep', 'req', 'corr-anchor.jsonl'));
  const items = [
    ...pages.map((p) => ({ uid: p.uid, image: p.image, draft: p.draft })),
    // prep.py built the planted request as CORR.format(draft=...): the planted draft is everything after "Draft:\n"
    ...anchors.map((r) => ({ uid: `plant|${r.uid}`, image: r.image, draft: r.prompt.slice(r.prompt.lastIndexOf('Draft:\n') + 'Draft:\n'.length) })),
  ];
  fs.mkdirSync(path.join(ROOT, 'req'), { recursive: true });
  for (const arm of ['A', 'B', 'C']) fs.writeFileSync(path.join(ROOT, 'req', `${arm}.jsonl`), items.map((x) => JSON.stringify({ uid: x.uid, image: x.image, prompt: armPrompt(arm, x.draft) })).join('\n') + '\n');
  fs.writeFileSync(path.join(ROOT, 'req', 'drafts.jsonl'), items.map((x) => JSON.stringify({ uid: x.uid, draft: x.draft })).join('\n') + '\n');
  // the A request must be the lane's request exactly (cli-ocr.mjs: template with the draft in its slot)
  const a0 = readJsonl(path.join(ROOT, 'req', 'A.jsonl'))[0];
  if (a0.prompt !== TEMPLATE.split('{draft}').join(items[0].draft)) throw new Error('arm A is not the lane prompt');
  console.log(`arms: ${items.length} requests per arm (${pages.length} pages + ${anchors.length} planted drafts)`);
}
