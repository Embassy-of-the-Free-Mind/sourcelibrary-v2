#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/gallery.mjs shows 5 best / median / worst pages of ONE arm, whole
// pages, chosen by fidelity. #5698 asks for six pages chosen for what the NOTES let a reader see, the same passage
// under every arm side by side; the pages and the passage anchors below were picked by eye after unblinding.
/** #5698 gallery: six pages where typed notes change what a reader can see, source / reference / each arm on the same passage. */
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl } from '../translation-vs-reference/common.mjs';

const DIR = new URL('../results/translation-prompt-v17-2026-10/', import.meta.url).pathname;
const recs = readJsonl(path.join(DIR, 'records.jsonl'));
const res = JSON.parse(fs.readFileSync(path.join(DIR, 'results.json'), 'utf8'));
const ARMS = ['v13-a', 'v13-b', 'v17-study', 'v17-reading'];
// suffix of book_id_page · what to look at · anchors (regex) for source, reference, and the arms' English
const PAGES = [
  { id: '278c50_277', what: 'A number the source may have wrong. The page reads "seven kingdoms" where the vision has four chariots. Study keeps "seven" and offers "four" as an alternative; v13-a says the same in an untyped note; v13-b and reading resolve it without a typed flag.', src: /מלכיות|מלכיו/, ref: /What are these|seven|four chariots/i, en: /kingdoms which|allusion to the|hint(?:s|ed)? (?:at|to) the/i },
  { id: 'bb8d6f_286', what: 'An odd word kept literal. Palissy wants a potter to be "portatif". v13 silently writes a guess; study writes "portable" and gives "enduring" as the alternative.', src: /portatif/i, ref: /two things/i, en: /agile|vigilant|nimble/i },
  { id: 'bcc0813_50', what: 'A term with two live senses in a list of vices (Kalila wa-Dimna). Study flags the second sense; v13 picks one and moves on.', src: /الصيد/, ref: /women|passion|the chase|sport/i, en: /hunting/i },
  { id: 'dde8b5_1455', what: 'Liturgy (Kaddish). The page itself prints a variant (נ"א קץ, "another version: end"). All four arms flag it: v13 in an untyped note, v17 as `alternative:`. So v13 already does this when the page prints the variant, and strictly it is a note of the source, not ours. The study arm also shows the v17 defect: a term written as `<note>term>Kaddish</note>`.', src: /ויצמח|פורקני|יתגדל/, ref: /Magnified|salvation to spring|redemption/i, en: /spring forth|sprout|flourish|hasten the coming|bring near (?:the|His)|draw near (?:the|His)/i },
  { id: '90aa8a_185', what: 'Lotus Sūtra, a passage built on negations. Study scores 5 on transparency and fidelity; one of its alternatives is real ("laws/things" for dharma) and two are synonyms.', src: /क्षान्त/, ref: /patient/i, en: /patient/i },
  { id: '133f67_112', what: 'A double negation in the commentary (無所不為, "nothing left undone") that v13-a, v13-b and reading all turn into "nothing is done". Study gets it right in the text, but its alternative notes sit elsewhere on the page and are all synonyms: the notes did not find the hard spot. The published reference (Legge) covers the Laozi text only, not this commentary.', src: /無所不為/, ref: /giving himself no trouble/i, en: /(?:speak|talk) of learning/i },
];
const excerpt = (text, re, before = 230, after = 400) => {
  const t = String(text || '').replace(/\s*\n+\s*/g, ' ⏎ '); const i = t.search(re);
  if (i < 0) return '_(the excerpt rule did not find the passage in this text; see the page)_';
  const a = Math.max(0, i - before), b = Math.min(t.length, i + after);
  return `${a > 0 ? '… ' : ''}${t.slice(a, b).replace(/\|/g, '\\|')}${b < t.length ? ' …' : ''}`;
};
const L = ['# Gallery: six pages where typed notes change what a reader can see (#5698)', '',
  'Prompt v13 (the live default, run twice) against v17 in its two stances, on pages with a published English translation. Each block shows the same passage in the source, the published reference and the four arms. Notes are shown as the model wrote them: under v17 a note opens with its type. Pages and passages were picked by eye **after** unblinding, for what they show; they are examples, not a sample. Scores are one blind Opus judge (transparency) and two (fidelity).', ''];
PAGES.forEach((P, n) => {
  const r = recs.find((x) => `${x.book_id}_${x.page_number}`.endsWith(P.id));
  const pp = res.per_page.find((p) => p.id === `${r.book_id}_${String(r.page_number).padStart(5, '0')}`);
  L.push(`## ${n + 1}. ${r.lang}: ${r.reference_meta.title}, [p. ${r.page_number}](https://sourcelibrary.org/book/${r.book_id}?page=${r.page_number})${r.set === 'main' ? '' : ' (gallery pool, not in the 40)'}`, '', P.what, '',
    '| | passage | transparency | fidelity |', '|---|---|---|---|',
    `| **source** | ${excerpt(r.source_text, P.src, 150, 220)} | | |`,
    `| **reference** (${r.reference_meta.translator}${r.reference_meta.year ? `, ${r.reference_meta.year}` : ''}; ${String(r.reference_meta.licence).split('(')[0].trim()}) | ${excerpt(r.reference_text, P.ref, 150, 260)} | | |`);
  for (const arm of ARMS) L.push(`| **${arm}** | ${excerpt(r.candidates.find((c) => c.arm === arm).text, P.en)} | ${pp[arm].transparency} | ${pp[arm].fidelity} |`);
  const alts = ARMS.flatMap((arm) => pp[arm].alternatives.map((a) => `${arm}: "${a.quote}" → **${a.verdict}**`));
  if (alts.length) L.push('', `Second readings offered, as the judge audited them: ${alts.join('; ')}.`);
  L.push('');
});
fs.writeFileSync(path.join(DIR, 'gallery.md'), L.join('\n'));
console.log(L.join('\n'));
