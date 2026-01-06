#!/usr/bin/env node
/**
 * OCR Greek Poimandres pages from Scott's Hermetica
 * Uses Gemini to extract Greek text from page images
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Scott Hermetica Vol 1 - Greek Poimandres pages
const IA_ID = 'ScottHermeticaVolOne';
const GREEK_PAGES = [
  { leaf: 117, bookPage: 114, desc: 'Poimandres I Greek start' },
  { leaf: 119, bookPage: 116, desc: 'Poimandres I Greek continued' },
];

async function fetchImageAsBase64(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);

  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  return { data: base64, mimeType: 'image/jpeg' };
}

async function ocrGreekPage(leaf, bookPage) {
  const imageUrl = `https://archive.org/download/${IA_ID}/page/n${leaf}/full/pct:100/0/default.jpg`;
  console.log(`\nFetching page ${bookPage} (leaf n${leaf})...`);
  console.log(`URL: ${imageUrl}`);

  const image = await fetchImageAsBase64(imageUrl);

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `You are an expert OCR system specializing in Ancient Greek manuscripts and scholarly editions.

This is a page from Walter Scott's Hermetica (1924), containing the Greek text of the Poimandres.

Transcribe the Greek text accurately:
- Preserve original spelling and diacritical marks (accents, breathings)
- Maintain paragraph structure
- Include section numbers if present (e.g., §1, §2)
- Note any editorial marks or apparatus
- Transcribe in reading order

Output ONLY the Greek text transcription, nothing else.`;

  console.log('Calling Gemini for OCR...');
  const result = await model.generateContent([
    prompt,
    { inlineData: { mimeType: image.mimeType, data: image.data } }
  ]);

  const text = result.response.text();
  const usage = result.response.usageMetadata;

  console.log(`Tokens: ${usage?.promptTokenCount || 0} in, ${usage?.candidatesTokenCount || 0} out`);

  return text;
}

async function main() {
  console.log('=== OCR Greek Poimandres from Scott\'s Hermetica ===\n');

  const results = [];

  for (const page of GREEK_PAGES) {
    try {
      const text = await ocrGreekPage(page.leaf, page.bookPage);
      results.push({
        ...page,
        text,
        success: true
      });
      console.log(`\n--- Page ${page.bookPage} ---`);
      console.log(text.substring(0, 500) + '...\n');
    } catch (error) {
      console.error(`Error on page ${page.bookPage}:`, error.message);
      results.push({
        ...page,
        error: error.message,
        success: false
      });
    }
  }

  // Output combined Greek text
  console.log('\n=== COMBINED GREEK TEXT ===\n');
  const combinedGreek = results
    .filter(r => r.success)
    .map(r => r.text)
    .join('\n\n---\n\n');

  console.log(combinedGreek);

  // Save to file
  const outputPath = '/tmp/poimandres_greek_ocr.txt';
  const fs = await import('fs/promises');
  await fs.writeFile(outputPath, combinedGreek);
  console.log(`\nSaved to ${outputPath}`);
}

main().catch(console.error);
