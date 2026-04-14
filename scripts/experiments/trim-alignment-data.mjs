#!/usr/bin/env node
/**
 * Post-process alignment data:
 * 1. Extract just the body text (skip headings/labels)
 * 2. Fix doubled letters from margin tags
 * 3. Recompute alignment offsets for trimmed text
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.join(__dirname, 'alignment-results.json');
const OUTPUT = path.join(__dirname, 'alignment-results.json');

const data = JSON.parse(fs.readFileSync(INPUT, 'utf-8'));

// Manual trim ranges — specify where the good body text starts/ends
// These are character offsets in the already-tag-stripped text
const TRIM_CONFIG = {
  'ficino-de-voluptate-p6': {
    // Skip "## ¶ Caput..." headings, start at "PLATO igitur"
    srcMatch: 'PLATO igitur',
    transMatch: 'Plato, therefore',
    // Fix doubled P from <margin>P</margin>PLATO
    srcReplace: [['PPLATO', 'PLATO']],
    transReplace: [['PPlato', 'Plato']],
  },
  'pymander-p8': {
    // Skip "ARGVMENTVM." header, start at body
    srcMatch: 'bo sancto clamasse',
    transMatch: '[I heard the]',
    srcReplace: [],
    transReplace: [],
  },
};

for (const page of data.pages) {
  const config = TRIM_CONFIG[page.id];
  if (!config) continue;

  // Apply text fixes first (before computing offsets)
  let srcText = page.sourceText;
  let transText = page.translationText;

  for (const [from, to] of config.srcReplace || []) {
    srcText = srcText.replace(from, to);
  }
  for (const [from, to] of config.transReplace || []) {
    transText = transText.replace(from, to);
  }

  // Find trim start points
  const srcStart = srcText.indexOf(config.srcMatch);
  const transStart = transText.indexOf(config.transMatch);

  if (srcStart === -1 || transStart === -1) {
    console.error(`Could not find trim markers for ${page.id}`);
    console.error(`  srcMatch "${config.srcMatch}" at ${srcStart}`);
    console.error(`  transMatch "${config.transMatch}" at ${transStart}`);
    continue;
  }

  const newSrcText = srcText.substring(srcStart).trim();
  const newTransText = transText.substring(transStart).trim();

  // Compute offset deltas (accounting for text fixes changing positions)
  // We need the offset in the ORIGINAL text that corresponds to srcStart in the fixed text
  const origSrcStart = page.sourceText.indexOf(config.srcMatch.substring(0, 10));
  const origTransStart = page.translationText.indexOf(config.transMatch.substring(0, 10));

  // Rebase alignment links
  for (const method of ['llm', 'embedding']) {
    if (!page.alignments[method]) continue;
    page.alignments[method] = page.alignments[method]
      .map(link => ({
        ...link,
        src: [link.src[0] - origSrcStart, link.src[1] - origSrcStart],
        en: [link.en[0] - origTransStart, link.en[1] - origTransStart],
      }))
      .filter(link => {
        return link.src[0] >= -2 && link.src[1] <= newSrcText.length + 5 &&
               link.en[0] >= -2 && link.en[1] <= newTransText.length + 5;
      })
      .map(link => ({
        ...link,
        src: [Math.max(0, link.src[0]), Math.min(link.src[1], newSrcText.length)],
        en: [Math.max(0, link.en[0]), Math.min(link.en[1], newTransText.length)],
      }));
  }

  page.sourceText = newSrcText;
  page.translationText = newTransText;
}

fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2));

for (const page of data.pages) {
  console.log(`\n${page.id}:`);
  console.log(`  Source: ${page.sourceText.length} chars`);
  console.log(`  Trans: ${page.translationText.length} chars`);
  console.log(`  LLM links: ${page.alignments.llm.length}`);
  console.log(`  Embedding links: ${page.alignments.embedding.length}`);
  console.log(`  Source preview: "${page.sourceText.substring(0, 100)}..."`);
  console.log(`  Trans preview: "${page.translationText.substring(0, 100)}..."`);

  // Verify a few links
  const link = page.alignments.llm[0];
  if (link) {
    console.log(`  Sample LLM link: src[${link.src}]="${page.sourceText.substring(link.src[0], link.src[1])}" → en[${link.en}]="${page.translationText.substring(link.en[0], link.en[1])}"`);
  }
}
