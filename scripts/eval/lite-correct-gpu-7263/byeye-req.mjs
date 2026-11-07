#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-correct-6561/opus.mjs (runs {uid, image, prompt} rows on a sealed `claude -p`, Read
// only) is the runner; this only builds its rows. No earlier by-eye prompt compares a draft with a correction of it
// (looked in paddle-correct-6561/readoff.mjs: span-level A/B, not a whole-page look).
// The PREREG's by-eye look at the worst lite-correct pages: Opus sees the image, the GPU draft and lite's correction.
// Usage: byeye-req.mjs <out.jsonl> zh:<zh scratch>:<uid,uid,..>[:arm] tib:<tib scratch>:<uid,uid,..>[:arm]
//   arm defaults to lite-correct (zh) / lite-corr (tib); e.g. tib:<dir>:<uid>:lite-p2-corr for the P2 rows
import fs from 'node:fs';

const [, , OUT, ...specs] = process.argv;
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const last = (f) => new Map(readJsonl(f).map((r) => [r.uid, r]));
const ask = (lang, draft, corr) => `You are checking an automatic correction of an OCR transcription against the page image.

The page image is the file ./page.jpg in the current directory. Open it with the Read tool (the only tool you may use) and look at it closely.

The page is ${lang}. Below are two transcriptions of it: DRAFT, made by an OCR engine, and CORRECTION, which another model produced from the image and the draft (it was told to change the draft only where the image differs).

===DRAFT===
${draft}
===END DRAFT===

===CORRECTION===
${corr || '(the corrector returned nothing)'}
===END CORRECTION===

Compare both with the image. Report, in plain English, under these headings:
1. What the correction changed (layout, order, characters/syllables added, dropped or replaced), with 2-4 concrete examples quoting the text.
2. For the changed text: does the image support the correction or the draft? Name any text the correction invented, dropped, duplicated or put out of reading order.
3. Verdict, one line: CORRECTION BETTER / SAME / WORSE than the draft for a reader of this page, and why in one sentence.`;

const rows = [];
for (const spec of specs) {
  const [kind, dir, ids, arm] = spec.split(':');
  for (const uid of ids.split(',')) {
    if (kind === 'zh') {
      const s = JSON.parse(fs.readFileSync(`${dir}/sets.json`, 'utf8')).find((x) => x.uid === uid);
      const r = last(`${dir}/out-${arm || 'lite-correct'}.jsonl`).get(uid);
      const m = String(r?.text || '').match(/===TRANSCRIPTION===[ \t]*\n?([\s\S]*?)(?:\n?===END===|$)/);
      rows.push({ uid: `zh-${uid}${arm ? `-${arm}` : ''}`, image: s.image, prompt: ask('a printed Classical Chinese page (Siku Quanshu), read in columns right to left', s.paddle, m ? m[1] : r?.text) });
    } else {
      const q = readJsonl(`${dir}/req/corr.jsonl`).find((x) => x.uid === uid);
      const draft = q.prompt.split('\nDraft:\n')[1];
      const t = String(last(`${dir}/out/${arm || 'lite-corr'}.jsonl`).get(uid)?.text || '');
      const m = t.match(/<<<BEGIN>>>([\s\S]*?)(?:<<<END>>>|$)/);
      rows.push({ uid: `tib-${uid}${arm ? `-${arm}` : ''}`, image: q.image, prompt: ask('one frame of a Tibetan Kangyur manuscript (Uchen script; it may show two leaves)', draft, m ? m[1].trim() : t) });
    }
  }
}
fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(rows.length, 'rows');
