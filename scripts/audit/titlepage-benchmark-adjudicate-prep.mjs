#!/usr/bin/env node
/**
 * Build BLIND adjudication packets for the discordant rows.
 *
 * Every discordant row runs the same way: reader X says nobody is named, reader Y
 * names someone. That asymmetry is partly BUILT IN by the sampling frame — the
 * pool is "books where flash-lite proposed an author", so flash-lite naming
 * someone is guaranteed on every row and it can never be the one that declines.
 * The benchmark therefore measures flash-lite's PRECISION WHEN IT FIRES, and is
 * structurally blind to its misses. Stated here so no one reads the 20-0 split
 * as a clean win.
 *
 * Blindness that IS achievable: the adjudicator never learns which reader
 * produced which answer, and A/B order is randomised per packet. Blindness that
 * is NOT achievable here: the adjudicator is the same model family as one of the
 * readers. That is a real limitation and no amount of prompt design removes it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const DIR = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/99d9b906-8887-4b60-ab4c-e4747d013447/scratchpad/bench50';
const { rows } = JSON.parse(readFileSync(`${DIR}/paired.json`, 'utf8'));
const disc = rows.filter((r) => !r.concordant);
mkdirSync(`${DIR}/adjudicate`, { recursive: true });
mkdirSync(`${DIR}/verdicts`, { recursive: true });

const key = [];
for (const r of disc) {
  // Randomise which reader is A and which is B, and record the mapping OUTSIDE
  // the packet so the adjudicator cannot recover it.
  const readerFirst = Math.random() < 0.5;
  const answerOf = (which) => which === 'reader'
    ? { claim: r.reader ? `The author is ${r.reader}` : 'No author is named on these pages', quote: r.reader_quote }
    : { claim: r.flash ? `The author is ${r.flash}` : 'No author is named on these pages', quote: r.flash_quote };
  const A = answerOf(readerFirst ? 'reader' : 'flash');
  const B = answerOf(readerFirst ? 'flash' : 'reader');
  key.push({ n: r.n, A: readerFirst ? 'reader' : 'flash', B: readerFirst ? 'flash' : 'reader', title: r.title });

  writeFileSync(`${DIR}/adjudicate/case-${r.n}.md`, `# Adjudication case ${r.n}

Two independent readers examined the same book's front matter and disagreed
about who the book says wrote it. Neither reader is identified, and you should
not try to guess which is which — judge only from the pages.

The book's front matter is at:
${DIR}/book-${r.n}.txt

## Answer A
${A.claim}
${A.quote ? `Evidence quoted: "${A.quote}"` : 'No evidence line given.'}

## Answer B
${B.claim}
${B.quote ? `Evidence quoted: "${B.quote}"` : 'No evidence line given.'}

## Your task

Read the front matter yourself and decide which answer the pages actually
support. Consider carefully:

- A **genitive** ("Auli Gellii ... libri"), "auctore", or a signature closing a
  dedication or preface indicates the AUTHOR.
- An **ablative after "interprete"**, "translated by", "emendatus a" indicates a
  TRANSLATOR or EDITOR — not the author.
- A name in an **ownership inscription**, often in a later hand with a later
  date, is the OWNER.
- A name inside a **quotation, epigraph, marginal citation, or an entry in a
  list or catalogue** belongs to that cited work, not to this book.
- A name the book is ABOUT, or whose views it prints or attacks, is the SUBJECT.
- Many early-modern books are genuinely anonymous. "No author is named" is
  frequently the correct answer, and is not a failure.
- Watch for a **Sammelband**: if the pages come from several bound-together
  works, say which work you are judging.

It is legitimate to conclude that NEITHER answer is right.

Write ONLY this JSON to ${DIR}/verdicts/verdict-${r.n}.json — no prose, no fence:

{"correct": "A" | "B" | "neither", "correct_author": "<the right answer, or null if nobody is named>", "quoted_line": "<the line that settles it, or null>", "confidence": "high|medium|low", "reasoning": "<two sentences at most>"}

Then reply with just: done
`);
}

writeFileSync(`${DIR}/adjudication-key.json`, JSON.stringify(key, null, 1));
console.log(`built ${disc.length} blind adjudication packets in ${DIR}/adjudicate/`);
console.log(`A/B mapping held OUT of the packets, in ${DIR}/adjudication-key.json`);
const rf = key.filter((k) => k.A === 'reader').length;
console.log(`order randomised: reader is "A" in ${rf} of ${key.length} packets`);
