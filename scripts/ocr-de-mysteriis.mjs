#!/usr/bin/env node
/**
 * OCR De Mysteriis Aegyptiorum (Ficino Latin) from Gallica
 * Find and OCR the opening of Book I for benchmark comparison
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Gallica IIIF base for De Mysteriis
const GALLICA_ARK = 'ark:/12148/bpt6k585129';
const getImageUrl = (folio) =>
  `https://gallica.bnf.fr/iiif/${GALLICA_ARK}/f${folio}/full/1500,/0/default.jpg`;

async function fetchImageAsBase64(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const buffer = await response.arrayBuffer();
  return { data: Buffer.from(buffer).toString('base64'), mimeType: 'image/jpeg' };
}

async function ocrPage(folio, purpose = 'content') {
  const imageUrl = getImageUrl(folio);
  console.log(`Fetching folio ${folio}...`);

  const image = await fetchImageAsBase64(imageUrl);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = purpose === 'scan'
    ? `Look at this page from a 16th century Latin book. Describe what's on the page:
- Is it a title page, preface, or main text?
- If main text, what chapter/book does it appear to be?
- Quote the first few words of the main text if present.
Keep response brief (2-3 sentences).`
    : `You are an expert OCR system for Renaissance Latin texts.

This is from Marsilio Ficino's Latin translation of Iamblichus's De Mysteriis Aegyptiorum (1497/1570).

Transcribe the Latin text accurately:
- Preserve original spelling and abbreviations
- Maintain paragraph structure
- Note any marginal annotations
- Include chapter/section headers if present

Output ONLY the Latin transcription.`;

  const result = await model.generateContent([
    prompt,
    { inlineData: image }
  ]);

  return result.response.text();
}

async function findBookOneStart() {
  console.log('=== Scanning for Book I start ===\n');

  // Check pages 5-25 to find where actual content begins
  for (const folio of [5, 10, 15, 20, 25]) {
    const desc = await ocrPage(folio, 'scan');
    console.log(`Folio ${folio}: ${desc}\n`);
  }
}

async function ocrBookOneOpening(startFolio) {
  console.log(`\n=== OCR Book I opening from folio ${startFolio} ===\n`);

  const pages = [];
  for (let f = startFolio; f < startFolio + 3; f++) {
    const text = await ocrPage(f, 'content');
    pages.push({ folio: f, text });
    console.log(`--- Folio ${f} ---`);
    console.log(text.substring(0, 600) + '...\n');
  }

  return pages;
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'scan') {
    await findBookOneStart();
  } else if (args[0] === 'ocr' && args[1]) {
    const startFolio = parseInt(args[1], 10);
    const pages = await ocrBookOneOpening(startFolio);

    const combined = pages.map(p => `[Folio ${p.folio}]\n${p.text}`).join('\n\n');
    await fs.writeFile('/tmp/de_mysteriis_latin_ocr.txt', combined);
    console.log('Saved to /tmp/de_mysteriis_latin_ocr.txt');
  } else {
    console.log('Usage:');
    console.log('  node ocr-de-mysteriis.mjs scan        # Find where Book I starts');
    console.log('  node ocr-de-mysteriis.mjs ocr <folio> # OCR from specified folio');
  }
}

main().catch(console.error);
