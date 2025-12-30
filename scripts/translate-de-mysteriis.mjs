#!/usr/bin/env node
/**
 * Translate OCR'd Latin De Mysteriis text
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function translateLatin(latinText) {
  console.log('Translating Latin text with AI...\n');

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const result = await model.generateContent(`You are an expert translator of Renaissance Latin, specializing in Neoplatonic and theurgic philosophical texts.

This is from Marsilio Ficino's Latin translation of Iamblichus's "De Mysteriis Aegyptiorum" (On the Mysteries of the Egyptians), a 3rd-4th century CE text on theurgy, divine beings, and ritual practice.

Translate the following Latin into clear, accurate English:
- Maintain philosophical precision (terms like substantia, dæmones, numina)
- Preserve the argumentative structure
- Render the Neoplatonic terminology consistently
- Note any unclear passages with [?]

LATIN TEXT:
${latinText}

OUTPUT: Provide the English translation, maintaining paragraph breaks where they appear.`);

  return result.response.text();
}

async function main() {
  // Load OCR'd Latin
  const latinText = await fs.readFile('/tmp/de_mysteriis_latin_ocr.txt', 'utf-8');
  console.log(`Loaded Latin text: ${latinText.length} chars\n`);

  // Translate
  const translation = await translateLatin(latinText);

  console.log('=== AI TRANSLATION ===\n');
  console.log(translation);

  // Save
  await fs.writeFile('/tmp/de_mysteriis_ai_translation.txt', translation);
  console.log('\nSaved to /tmp/de_mysteriis_ai_translation.txt');
}

main().catch(console.error);
