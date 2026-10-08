#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/common.mjs `plant()` plants a MEANING CHANGE (a negation, a
// number) inside an existing sentence for the fidelity judges; scripts/eval/translation-vs-reference/backtrans/ reuses
// it as a detector control. Neither inserts a new commentary sentence, which is what an additions detector must find.
/** #5982 controls: clean reference pages (negative) and the same pages with one planted commentary sentence (positive). */
/**
 *   node scripts/eval/untagged-additions/build-controls.mjs --round 1   (arm v13-a; round 2 = arm v13-b, other plants)
 * A page is CLEAN in an arm when neither blind judge of #5919 / #5942, reading against the human reference, named an
 * invention outside a house tag in that arm (q1.json). One of 40 commentary sentences (10 each: explanation, image
 * description, definition, bridging summary) is inserted after a seeded sentence in the middle 70% of the page.
 * Output: results/untagged-additions-2026-10/controls-r<round>.key.json (committed) and work/controls-r<round>.jsonl.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeRng } from '../lib/paired-stats.mjs';
import { itemId } from '../translation-vs-reference/common.mjs';
import { sentenceUnits } from './detector.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const ROUND = Number(opt('round', 1));
const ARM = ROUND === 1 ? 'v13-a' : 'v13-b';
const ROOT = new URL('../../../', import.meta.url).pathname;
const DIR = path.join(ROOT, 'scripts/eval/results/untagged-additions-2026-10');
const SETS = [
  { dir: 'scripts/eval/results/translation-notes-free-2026-10', ref: 'origin/main' },
  { dir: 'scripts/eval/results/notes-layer-2026-10/lite', ref: 'origin/job-notes-layer-5942' },
];
const read = (set, f) => { const p = path.join(ROOT, set.dir, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : execFileSync('git', ['show', `${set.ref}:${set.dir}/${f}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }); };

// {T} is a capitalised word taken from the page's own translation, so the plant is about this page.
const PLANTS = {
  1: {
    explanation: ['Here the author is alluding to {T}, a commonplace of the period.', 'This refers to {T}, which readers of the time would have recognised at once.', 'The point of the comparison is that {T} stands for the whole of the argument.', 'By this the writer means that the practice had already fallen out of use.', '{T} was a well-known authority in the schools of the time.', 'This is a reference to the doctrine discussed in the earlier chapters of the work.', 'The passage echoes a saying usually attributed to Aristotle.', 'In other words, the reader is being warned not to take the statement literally.', 'The allusion is to a story told by Pliny in his Natural History.', 'This reflects the common belief of the age that such things were governed by the stars.'],
    image_description: ['A woodcut at the head of the page shows two figures standing beside a furnace.', '[Illustration: an ornamental initial letter decorated with vines and a small bird.]', "The page is decorated with a printer's device depicting an anchor and a dolphin.", 'Below the text is an engraving of a seated scholar holding an open book.', 'A decorative border of flowers and scrollwork surrounds the text.', 'In the margin a small hand-drawn pointing finger marks this passage.', 'The diagram shows three concentric circles labelled with the names of the planets.', 'At the foot of the page there is a library stamp and a handwritten shelf mark.', '(The page has a large ornamental tailpiece showing a vase of fruit.)', 'The text is laid out in two columns separated by a vertical rule.'],
    definition: ['{T}: a term used for the first stage of the work.', "[{T}: literally, 'that which is hidden']", '{T} here means the inner or spiritual sense, as opposed to the letter.', '({T} is an old measure equal to about half a litre.)', "The word translated here as 'virtue' means power or efficacy rather than moral goodness.", '{T}, that is, the common name for quicksilver among the older writers.', "[i.e., the philosophers' stone]", 'By {T} is meant a kind of salt obtained by burning plants.', 'The term {T} denotes a vessel with a long neck used for distillation.', '({T}: an honorific title given to a learned teacher.)'],
    summary: ['This page continues the discussion begun in the previous chapter.', 'In summary, the author argues that experience must be preferred to authority.', 'The author now turns from theory to practical instruction.', 'The following section lists the remaining items in the same manner.', 'The rest of the page repeats the same argument with further examples.', 'Having set out the objections, the text proceeds to answer each in turn.', 'The passage concludes by restating the main point of the chapter.', 'What follows is a list of the authorities cited in support of this view.', 'To summarise: the three causes named above are treated as one.', 'The text breaks off here and resumes on the following page.'],
  },
  2: {
    explanation: ['{T} is mentioned here because of the long quarrel described by earlier historians.', 'The author appears to have in mind the Stoic teaching on fate.', 'This was a common argument among physicians trained at Padua.', 'The remark is ironic, since the opposite was generally held to be true.', 'Such a claim would have been understood as a criticism of the court.', 'The number is symbolic and should not be read as an exact count.', 'This is the same {T} who appears in the letters of Cicero.', 'The comparison draws on the imagery of the Song of Songs.', 'Modern scholars identify this place with a village near Aleppo.', 'The writer is following Galen closely at this point.'],
    image_description: ['An engraved plate shows a laboratory with three stills and a seated assistant.', '[Image: a circular diagram divided into twelve sections, each marked with a sign.]', 'A small woodcut of a hand holding a flask is set into the text.', 'The heading is printed in red and black within a ruled frame.', 'There is an ink stain across the lower half of the leaf, and the corner is torn.', 'A later reader has underlined several lines and written a note beside them.', 'The initial letter is a large decorated capital showing a saint at prayer.', '(An illustration of a tree with seven branches fills the lower part of the page.)', 'A table with four columns occupies the centre of the page.', 'The tailpiece is a woodcut of two cherubs holding a wreath.'],
    definition: ['{T} is the name given to the dry residue left after distillation.', '[{T}: a unit of weight, roughly thirty grams]', "The word rendered 'spirit' here has the sense of a volatile substance.", '({T}, meaning "the gate" in the original language.)', 'A {T} is a judge appointed to settle disputes of this kind.', "[that is, the feast kept on the first day of the year]", '{T}: the technical term for a syllogism with a suppressed premise.', 'Here {T} signifies the lowest of the three souls.', '(i.e. a dish made of barley and milk)', 'The expression means literally "to wash the hands" and so to give up a claim.'],
    summary: ['This section sets out the rules that the rest of the chapter applies.', 'The author goes on to give four examples, of which this is the first.', 'In short, the argument is that the cause must come before its effect.', 'The page opens in the middle of a sentence carried over from the one before.', 'Here the narrative returns to the events described at the start of the book.', 'The remainder of the passage is a list of names.', 'The author closes the section with a prayer.', 'Overall, the passage defends the older view against its recent critics.', 'This paragraph serves as a transition to the second part of the treatise.', 'The discussion that follows depends on the distinction just made.'],
  },
}[ROUND];
const KINDS = Object.keys(PLANTS);

const q1 = JSON.parse(fs.readFileSync(path.join(DIR, 'q1.json'), 'utf8'));
const dirty = new Set();
for (const s of Object.values(q1.sets)) for (const e of s.entries) if (e.arm === ARM && !e.where.startsWith('tagged')) dirty.add(e.id);
const pages = [];
for (const set of SETS) for (const l of read(set, 'records.jsonl').split('\n').filter((x) => x.trim())) {
  const r = JSON.parse(l); if (r.set !== 'main') continue;
  const cand = r.candidates.find((c) => c.arm === ARM); if (!cand) continue;
  pages.push({ id: itemId(r), lang: r.lang, source: r.source_text, prev: r.source_prev_tail || '', next: r.source_next_head || '', translation: cand.text, clean: !dirty.has(itemId(r)) });
}
const clean = pages.filter((p) => p.clean && sentenceUnits(p.translation).length >= 5).sort((a, b) => (a.id < b.id ? -1 : 1));
const rng = makeRng(5982 + ROUND);
const order = [...clean]; for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
const items = []; const key = { round: ROUND, arm: ARM, seed: 5982 + ROUND, pages_total: pages.length, pages_clean: clean.length, negatives: [], positives: [], judge_named: [] };
for (const p of clean) { items.push({ id: `neg:${p.id}`, source: p.source, prev: p.prev, next: p.next, translation: p.translation }); key.negatives.push({ id: `neg:${p.id}`, lang: p.lang }); }
let k = 0;
for (const p of order.slice(0, 40)) {
  const kind = KINDS[k % 4]; const tpl = PLANTS[kind][Math.floor(k / 4)]; k++;
  // insert after a whole line in the middle 70% of the page, so the plant is its own sentence unit
  const lines = p.translation.split('\n');
  const body = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.trim() && !/<\/?(summary|keywords|meta)\b/i.test(l) && /[.!?:]["'”’)]?\s*(<\/[a-z-]+>)?\s*$/.test(l.trim()));
  const mid = body.filter((_, j) => j >= body.length * 0.15 && j <= body.length * 0.85);
  const site = (mid.length ? mid : body)[Math.floor(rng() * (mid.length ? mid : body).length)];
  if (!site) continue;
  const caps = [...new Set((p.translation.replace(/<[a-z/][^<>]*>/gi, ' ').match(/(?<=[a-z,;] )[A-Z][a-z]{4,}/g) || []))];
  const plain = [...new Set(p.translation.replace(/<[a-z/][^<>]*>/gi, ' ').match(/(?<=[a-z,;] )[a-z]{7,}/g) || [])];
  const pool = caps.length ? caps : plain;
  const T = pool.length ? pool[Math.floor(rng() * pool.length)] : 'the matter';
  const sentence = tpl.replace('{T}', T);
  const planted = [...lines.slice(0, site.i + 1), '', sentence, ...lines.slice(site.i + 1)].join('\n');
  const n = sentenceUnits(planted).findIndex((u) => u.includes(sentence)) + 1;
  if (!n) throw new Error(`plant not found as a unit on ${p.id}`);
  items.push({ id: `pos:${p.id}`, source: p.source, prev: p.prev, next: p.next, translation: planted });
  key.positives.push({ id: `pos:${p.id}`, lang: p.lang, kind, sentence, n, form: /^[[(]/.test(sentence) ? 'bracketed' : 'bare' });
}
// pages a judge did name an untagged invention on: not controls, but the detector is read against them too
for (const p of pages.filter((x) => !x.clean)) {
  items.push({ id: `named:${p.id}`, source: p.source, prev: p.prev, next: p.next, translation: p.translation });
  const named = Object.values(q1.sets).flatMap((s) => s.entries).filter((e) => e.arm === ARM && e.id === p.id && !e.where.startsWith('tagged'));
  key.judge_named.push({ id: `named:${p.id}`, lang: p.lang, entries: named.map((e) => ({ judge: e.judge, kind: e.kind, where: e.where, quote: e.quote })) });
}
fs.mkdirSync(path.join(DIR, 'work'), { recursive: true });
fs.writeFileSync(path.join(DIR, 'work', `controls-r${ROUND}.jsonl`), items.map((x) => JSON.stringify(x)).join('\n') + '\n');
fs.writeFileSync(path.join(DIR, `controls-r${ROUND}.key.json`), JSON.stringify(key, null, 1));
console.log(`round ${ROUND} (${ARM}): ${pages.length} pages, ${clean.length} clean; ${key.negatives.length} negatives, ${key.positives.length} positives (${KINDS.map((x) => `${x} ${key.positives.filter((q) => q.kind === x).length}`).join(', ')}), ${key.judge_named.length} judge-named pages`);
