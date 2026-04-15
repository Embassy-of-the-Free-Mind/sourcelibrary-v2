#!/usr/bin/env node
/**
 * Generate sentence-level alignment between Latin source and English translation.
 *
 * Strategy: split both texts into sentences locally, then ask Gemini to:
 * 1. Match sentence indices (tiny output)
 * 2. For each matched pair, generate word-level detail (one pair at a time)
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/experiments/generate-sentence-alignment.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, 'alignment-demo-data.json');
const OUTPUT_PATH = path.join(__dirname, 'alignment-results.json');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: {
    temperature: 0.1,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json',
  },
});

function stripTags(text) {
  let cleaned = text
    .replace(/<lang>[^<]*<\/lang>\n?/g, '')
    .replace(/<page-type>[^<]*<\/page-type>\n?/g, '')
    .replace(/<page-num>[^<]*<\/page-num>\n?/g, '')
    .replace(/<sig>[^<]*<\/sig>\n?/g, '')
    .replace(/<meta>[\s\S]*?<\/meta>\n?\n?/g, '')
    .replace(/<note>[\s\S]*?<\/note>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  cleaned = cleaned.replace(/^([A-Z])\1(?=[A-Z])/, '$1');
  return cleaned;
}

function trimToBody(text) {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith('#'))) i++;
  return lines.slice(i).join('\n').trim();
}

// Split text into sentences. Latin uses periods, colons, and sometimes semicolons as sentence boundaries.
function splitSentences(text) {
  // Split on sentence-ending punctuation followed by space + uppercase, or double newline
  const sentences = [];
  // Use a regex that splits on period/question/exclamation followed by space+uppercase
  const parts = text.split(/(?<=[.?!])\s+(?=[A-Z\[\(])|(?:\n\n+)/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 10) { // Skip very short fragments
      sentences.push(trimmed);
    }
  }
  return sentences;
}

async function callGemini(prompt, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await model.generateContent(prompt);
      let text = result.response.text().trim();
      // Strip markdown fencing
      text = text.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim();
      return JSON.parse(text);
    } catch (e) {
      if (i === retries - 1) {
        console.error(`  Failed after ${retries} attempts:`, e.message);
        return null;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

async function matchSentences(srcSentences, transSentences) {
  // Ask Gemini to match indices. This produces tiny output.
  const srcList = srcSentences.map((s, i) => `[${i}] ${s.substring(0, 50)}`).join('\n');
  const transList = transSentences.map((s, i) => `[${i}] ${s.substring(0, 50)}`).join('\n');

  const prompt = `Match these Latin source sentences to their English translations by index.
Each source sentence should map to 1-2 English sentences, and vice versa.
Return: [{"s":[srcIdx], "e":[enIdx]}] — arrays because one source may map to multiple English or vice versa.

LATIN SENTENCES:
${srcList}

ENGLISH SENTENCES:
${transList}`;

  const matches = await callGemini(prompt);
  if (!matches) return [];

  // Expand to full text pairs
  return matches.map(m => ({
    srcIndices: Array.isArray(m.s) ? m.s : [m.s],
    enIndices: Array.isArray(m.e) ? m.e : [m.e],
    src: (Array.isArray(m.s) ? m.s : [m.s]).map(i => srcSentences[i]).filter(Boolean).join(' '),
    en: (Array.isArray(m.e) ? m.e : [m.e]).map(i => transSentences[i]).filter(Boolean).join(' '),
  })).filter(p => p.src && p.en);
}

async function getWordLinks(srcSentence, enSentence) {
  const prompt = `Given this Latin sentence and English translation, list the key word-level correspondences (3-8 per pair). Focus on content words.

Return: [{"s":"latin","e":"english","w":1.0}]
w: 1.0=direct, 0.7=contextual, 0.4=implied

LATIN: ${srcSentence}
ENGLISH: ${enSentence}`;

  const words = await callGemini(prompt);
  if (!words) return [];

  return words.map(w => ({
    src: w.s || w.src || '',
    en: w.e || w.en || '',
    weight: w.w ?? w.weight ?? 0.7,
  })).filter(w => w.src && w.en);
}

async function processPage(rawOcr, rawTrans, label) {
  const srcText = trimToBody(stripTags(rawOcr));
  const transText = trimToBody(stripTags(rawTrans));

  console.log(`\n--- ${label} ---`);
  console.log(`  Source: ${srcText.length} chars`);
  console.log(`  Translation: ${transText.length} chars`);

  const srcSentences = splitSentences(srcText);
  const transSentences = splitSentences(transText);

  console.log(`  Source sentences: ${srcSentences.length}`);
  console.log(`  Translation sentences: ${transSentences.length}`);

  // Step 1: Match sentences
  console.log('  Matching sentences...');
  const pairs = await matchSentences(srcSentences, transSentences);
  console.log(`  ${pairs.length} pairs found`);

  // Step 2: Get word links for each pair
  const sentences = [];
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const words = await getWordLinks(pair.src, pair.en);
    sentences.push({
      src: pair.src,
      en: pair.en,
      words,
    });
    if ((i + 1) % 3 === 0) console.log(`  ${i + 1}/${pairs.length} word links generated`);
  }

  const totalWords = sentences.reduce((n, s) => n + s.words.length, 0);
  console.log(`  Done: ${sentences.length} sentences, ${totalWords} word links`);

  return { srcText, transText, sentences };
}

async function main() {
  const rawData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  const results = { generated: new Date().toISOString(), pages: [] };

  // Ficino De Voluptate p6
  const ficino = rawData.ficino[0];
  const fResult = await processPage(ficino.ocr, ficino.translation, 'Ficino De Voluptate p6');
  results.pages.push({
    id: 'ficino-de-voluptate-p6',
    book: 'De Voluptate',
    author: 'Marsilio Ficino',
    page: 6,
    year: '1457',
    sourceLanguage: 'Latin',
    sourceText: fResult.srcText,
    translationText: fResult.transText,
    sentences: fResult.sentences,
  });

  // Pymander p8
  const pymander = rawData.pymander[2];
  const pResult = await processPage(pymander.ocr, pymander.translation, 'Pymander p8');
  results.pages.push({
    id: 'pymander-p8',
    book: 'Pymander',
    author: 'Hermes Trismegistus (trans. Ficino)',
    page: 8,
    year: '1505',
    sourceLanguage: 'Latin',
    sourceText: pResult.srcText,
    translationText: pResult.transText,
    sentences: pResult.sentences,
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\nWritten to ${OUTPUT_PATH}`);

  for (const page of results.pages) {
    console.log(`\n${page.id}: ${page.sentences.length} sentences`);
    if (page.sentences[0]) {
      const s = page.sentences[0];
      console.log(`  First: "${s.src.substring(0, 60)}..." → "${s.en.substring(0, 60)}..."`);
      console.log(`  Words: ${s.words.map(w => `${w.src}→${w.en}`).join(', ')}`);
    }
  }
}

main().catch(console.error);
