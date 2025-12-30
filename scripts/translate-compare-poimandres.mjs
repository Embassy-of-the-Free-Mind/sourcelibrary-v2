#!/usr/bin/env node
/**
 * Translate Greek Poimandres and compare to Scott's translation
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const IA_ID = 'ScottHermeticaVolOne';

// Scott's English translation is on facing pages (odd leaves = Greek, even = English)
const ENGLISH_PAGES = [
  { leaf: 118, bookPage: 115, desc: 'Scott English translation 1' },
  { leaf: 120, bookPage: 117, desc: 'Scott English translation 2' },
];

async function fetchImageAsBase64(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const buffer = await response.arrayBuffer();
  return { data: Buffer.from(buffer).toString('base64'), mimeType: 'image/jpeg' };
}

async function ocrEnglishPage(leaf) {
  const imageUrl = `https://archive.org/download/${IA_ID}/page/n${leaf}/full/pct:100/0/default.jpg`;
  console.log(`Fetching Scott's English page (leaf n${leaf})...`);

  const image = await fetchImageAsBase64(imageUrl);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const result = await model.generateContent([
    `OCR this page from Scott's Hermetica (1924). This is the English translation of the Poimandres.
Transcribe the English text accurately. Include section numbers.
Output ONLY the transcription.`,
    { inlineData: image }
  ]);

  return result.response.text();
}

async function translateGreek(greekText) {
  console.log('Translating Greek text with AI...');

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const result = await model.generateContent(`You are an expert translator of Ancient Greek, specializing in Hermetic and Neoplatonic philosophical texts.

Translate the following Greek text from the Poimandres into English. This is a critical edition with editorial marks:
- Text in ‹‹ ›› or ‹ › are editorial additions
- Text in [[ ]] are suspected interpolations
- <...> indicates lacunae or conjectures

Produce a clear, accurate English translation that:
1. Maintains section numbering (§1, §2, etc.)
2. Captures the mystical/philosophical tone
3. Uses natural English while preserving meaning

GREEK TEXT:
${greekText}

OUTPUT: Provide only the English translation, preserving section numbers.`);

  return result.response.text();
}

async function main() {
  console.log('=== Poimandres Translation Comparison ===\n');

  // Load OCR'd Greek text
  const greekText = await fs.readFile('/tmp/poimandres_greek_ocr.txt', 'utf-8');
  console.log(`Loaded Greek text: ${greekText.length} chars\n`);

  // Get AI translation of Greek
  const aiTranslation = await translateGreek(greekText);
  console.log('=== AI TRANSLATION FROM GREEK ===\n');
  console.log(aiTranslation);

  // OCR Scott's English translation
  console.log('\n=== SCOTT\'S PUBLISHED TRANSLATION (1924) ===\n');
  const scottPages = [];
  for (const page of ENGLISH_PAGES) {
    const text = await ocrEnglishPage(page.leaf);
    scottPages.push(text);
    console.log(`--- Page ${page.bookPage} ---`);
    console.log(text.substring(0, 800) + '...\n');
  }
  const scottTranslation = scottPages.join('\n\n');

  // Save results
  const comparison = `# Poimandres Translation Comparison
Generated: ${new Date().toISOString()}

## AI Translation (from OCR'd Greek)
${aiTranslation}

---

## Scott's Translation (1924)
${scottTranslation}

---

## Methodology
1. Greek text OCR'd from Scott's Hermetica Vol. I pages 114, 116 (leaves n117, n119)
2. AI translation performed using Gemini 2.5 Flash
3. Scott's English translation OCR'd from facing pages 115, 117 (leaves n118, n120)
4. Comparison allows evaluation of AI translation quality against scholarly benchmark
`;

  await fs.writeFile('/tmp/poimandres_comparison.md', comparison);
  console.log('\nSaved comparison to /tmp/poimandres_comparison.md');
}

main().catch(console.error);
