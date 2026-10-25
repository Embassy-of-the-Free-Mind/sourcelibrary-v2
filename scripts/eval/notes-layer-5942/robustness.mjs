#!/usr/bin/env node
// PRIOR ART: measure-a.mts (Part A) re-resolves anchors across a page's real stored versions; this applies the same
// test (align.mjs truth, resolveAnchor) to the S arm's own anchors under rewrites we make on purpose, so the rewrite
// is known: a scripted edit set and an Opus correction pass.
/**
 * #5942 Part B (6): do S's anchors survive a rewrite of the English? $0.
 *   node scripts/eval/notes-layer-5942/robustness.mjs build   → $W/rewrite/req.jsonl (Opus correction requests, 20 pages)
 *   node scripts/eval/plain-6728/run-arm.mjs --requests $W/rewrite/req.jsonl --out $W/rewrite/out.jsonl --engine claude --model opus
 *   node scripts/eval/notes-layer-5942/robustness.mjs score   → scripts/eval/results/notes-layer-5942/part-b-robustness.json
 */
import fs from 'node:fs';
import { resolveAnchor } from '../../lib/annotation-layer.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { md5 } from '../plain-6728/prompts.mjs';
import { TRANSLATE_SUFFIX } from '../../lib/agy-cli.mjs';
import { W, readJsonl, layersOf } from './arms.mjs';
import { alignment, truthOf, classify } from './align.mjs';

const MODE = process.argv[2];
const R = new URL('../results/notes-layer-5942/', import.meta.url).pathname;
const pages = JSON.parse(fs.readFileSync(`${W}/pages.json`, 'utf8'));
const S = new Map(readJsonl(`${W}/out/S.jsonl`).filter((r) => r.text).map((r) => [r.uid, r]));
fs.mkdirSync(`${W}/rewrite`, { recursive: true });

/** The scripted edit set, seeded per page: a sentence in front, one sentence out, two words swapped, one word re-cased and re-punctuated. */
export function scriptedEdit(text, seed) {
  const rng = makeRng(seed);
  const pickIdx = (n) => Math.floor(rng() * n);
  let t = `A corrected reading of this page follows.\n\n${text}`;
  const sentences = [...t.matchAll(/[^.!?。！？\n]+[.!?。！？]+/g)].filter((m) => m.index > 45);
  const edits = ['insert-first-sentence'];
  if (sentences.length > 2) {
    const m = sentences[pickIdx(sentences.length)];
    t = t.slice(0, m.index) + t.slice(m.index + m[0].length);
    edits.push(`delete: ${m[0].trim().slice(0, 60)}`);
  }
  const words = [...t.matchAll(/[A-Za-z][A-Za-z'’-]{2,}/g)].filter((m) => m.index > 45);
  if (words.length > 4) {
    const i = pickIdx(words.length - 1);
    const a = words[i], b = words[i + 1];
    const between = t.slice(a.index + a[0].length, b.index);
    if (/^ +$/.test(between)) {
      t = t.slice(0, a.index) + b[0] + between + a[0] + t.slice(b.index + b[0].length);
      edits.push(`swap: ${a[0]} ${b[0]}`);
    }
  }
  const w2 = [...t.matchAll(/[A-Za-z][a-z]{3,}/g)].filter((m) => m.index > 45);
  if (w2.length) {
    const m = w2[pickIdx(w2.length)];
    const flipped = (m[0][0] === m[0][0].toUpperCase() ? m[0][0].toLowerCase() : m[0][0].toUpperCase()) + m[0].slice(1);
    t = t.slice(0, m.index) + flipped + ',' + t.slice(m.index + m[0].length);
    edits.push(`case+comma: ${m[0]}`);
  }
  return { text: t, edits };
}

if (MODE === 'build') {
  const rng = makeRng(5942 + 21);
  const rows = [];
  for (const lang of ['Latin', 'German', 'Greek', 'Chinese']) {
    const l = pages.filter((p) => p.lang === lang && S.has(p.uid));
    for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
    for (const p of l.slice(0, 5)) {
      const L = layersOf('S', S.get(p.uid).text);
      if (!L.ok) continue;
      const prompt = `You are revising an English translation of one page of a historical book against its source text.\n\n` +
        `Correct the English wherever it departs from the source: a wrong sense, a wrong name or number, an omission, an addition. ` +
        `Improve wording only where it is unclear. Leave everything that is right exactly as it is. Add no notes, brackets or commentary. ` +
        `Return the full revised English text of the page and nothing else.\n\nSOURCE:\n${p.ocr}\n\nENGLISH:\n${L.text}\n` + TRANSLATE_SUFFIX.replace('the translation', 'the revised English');
      rows.push({ uid: p.uid, lang, prompt, prompt_hash: md5(prompt) });
    }
  }
  fs.writeFileSync(`${W}/rewrite/req.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`${rows.length} correction requests`);
} else if (MODE === 'score') {
  const corrected = new Map(readJsonl(`${W}/rewrite/out.jsonl`).filter((r) => r.text).map((r) => [r.uid, r.text]));
  const res = { scripted: { pages: 0, anchors: 0, by: {}, by_kind: {} }, opus: { pages: 0, anchors: 0, by: {}, by_kind: {}, similarity: [] } };
  const cases = [];
  const tally = (o, k) => { o[k] = (o[k] || 0) + 1; };
  pages.forEach((p, n) => {
    if (!S.has(p.uid)) return;
    const L = layersOf('S', S.get(p.uid).text);
    if (!L.ok) return;
    const anchored = L.annotations.filter((a) => a.resolved && (a.kind === 'commentary' || a.kind === 'mark'));
    const runs = [['scripted', scriptedEdit(L.text, 5942 + n)]];
    if (corrected.has(p.uid)) runs.push(['opus', { text: corrected.get(p.uid), edits: ['opus correction pass'] }]);
    for (const [which, ed] of runs) {
      const { map, similarity } = alignment(L.text, ed.text);
      res[which].pages++;
      if (which === 'opus') res.opus.similarity.push(Math.round(similarity * 1000) / 1000);
      for (const a of anchored) {
        const anchor = { exact: a.anchor.exact, prefix: a.anchor.prefix, suffix: a.anchor.suffix, start: a.anchor.start, end: a.anchor.end };
        // The stored prefix/suffix are the model's; re-derive them from its own text so they match what a store would keep.
        anchor.prefix = L.text.slice(Math.max(0, anchor.start - 32), anchor.start);
        anchor.suffix = L.text.slice(anchor.end, anchor.end + 32);
        const r = resolveAnchor(ed.text, anchor);
        const cls = classify(r, truthOf(map, anchor));
        res[which].anchors++;
        tally(res[which].by, cls);
        tally((res[which].by_kind[a.kind] ||= {}), cls);
        if (!cls.startsWith('resolved:') && !cls.startsWith('orphan, words gone')) {
          cases.push({ which, uid: p.uid, cls, kind: a.kind, type: a.type, exact: a.anchor.exact, edits: ed.edits,
            new_ctx: r ? ed.text.slice(Math.max(0, r.start - 60), r.start) + '⟦' + ed.text.slice(r.start, r.end) + '⟧' + ed.text.slice(r.end, r.end + 60) : null });
        }
      }
    }
  });
  fs.writeFileSync(`${R}part-b-robustness.json`, JSON.stringify(res, null, 1) + '\n');
  fs.writeFileSync(`${W}/rewrite/cases.json`, JSON.stringify(cases, null, 1));
  console.log(JSON.stringify(res, null, 1));
  console.log(`${cases.length} cases to read by eye -> ${W}/rewrite/cases.json`);
}
