#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-corpus-audit/build-packets.mjs and tibetan-mt-ab/build-judge-packet.mjs —
// blinded packets with a seeded left/right key kept apart, but for TRANSLATIONS judged against a source text;
// here the two candidates are OCR outputs and the thing they are judged against is the page image.
/** #5795: blinded A/B packets (image path + both OCR outputs) for the ten most-disagreeing pages per family. No model call. */
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';
const WORK = '/data/scratch/sl/hidden-flash-5795-work'; const RES = 'scripts/eval/results/hidden-flash-5795'; const LIMIT = 7000;
const picks = JSON.parse(fs.readFileSync(path.join(WORK, 'adjudication-picks.json'), 'utf8'));
const out = (arm) => new Map(fs.readFileSync(`${RES}/outputs-${arm}.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((x) => [x.slug, x]));
const O = { lite: out('lite'), flash: out('flash') }; const rng = makeRng(57950); const key = {};
fs.mkdirSync(path.join(WORK, 'adj'), { recursive: true }); fs.mkdirSync(path.join(WORK, 'adj-key'), { recursive: true });
const show = (o) => { const t = o.text || ''; const head = `[engine status: ${/^(RECITATION|SAFETY|PROHIBITED_CONTENT)$/.test(o.finishReason) ? 'the engine declined this page, no text' : o.finishReason === 'MAX_TOKENS' ? 'output hit the length limit' : 'finished'}; ${t.length} characters in total]`; return `${head}\n${t.length > LIMIT ? `${t.slice(0, LIMIT)}\n[… ${t.length - LIMIT} more characters not shown …]\n${t.slice(-600)}` : t}`; };
for (const [fam, slugs] of Object.entries(picks)) for (const slug of slugs) {
  const flip = rng() < 0.5; key[slug] = flip ? { A: 'flash', B: 'lite' } : { A: 'lite', B: 'flash' };
  fs.writeFileSync(path.join(WORK, 'adj', `${slug}.md`), `# ${slug}\n\nImage: ${WORK}/images/${slug}.jpg\n\n## OUTPUT A\n\n${show(O[key[slug].A].get(slug))}\n\n## OUTPUT B\n\n${show(O[key[slug].B].get(slug))}\n`);
}
fs.writeFileSync(path.join(WORK, 'adj-key', 'key.json'), JSON.stringify(key, null, 1)); fs.copyFileSync(path.join(WORK, 'adj-key', 'key.json'), `${RES}/adjudication-key.json`);
console.log(Object.entries(picks).map(([f, s]) => `${f}: ${s.join(' ')}`).join('\n'));
