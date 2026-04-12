#!/usr/bin/env node
/**
 * Generate word alignment data for the interactive demo.
 *
 * Approach 1: LLM-generated alignment via Gemini
 * Approach 2: Embedding similarity (simulated with cosine similarity placeholder)
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/experiments/generate-alignment-data.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, 'alignment-demo-data.json');
const OUTPUT_PATH = path.join(__dirname, 'alignment-results.json');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function stripTags(text) {
  // Remove XML-style metadata tags but keep the actual content
  return text
    .replace(/<lang>[^<]*<\/lang>\n?/g, '')
    .replace(/<page-type>[^<]*<\/page-type>\n?/g, '')
    .replace(/<page-num>[^<]*<\/page-num>\n?/g, '')
    .replace(/<sig>[^<]*<\/sig>\n?/g, '')
    .replace(/<meta>[^<]*<\/meta>\n?\n?/g, '')
    .replace(/<margin>[^<]*<\/margin>/g, '')
    .replace(/<note>[^<]*<\/note>/g, '')
    .replace(/<unclear>[^<]*<\/unclear>/g, (m) => m.replace(/<\/?unclear>/g, ''))
    .trim();
}

const ALIGNMENT_PROMPT = `You are a Latin-English word alignment expert. Given a Latin source text and its English translation, produce a JSON array of alignment links.

Each link maps a span of English text to the Latin words that produced it. Use character offsets (0-indexed) in both texts.

Rules:
- Every English content word should appear in at least one link
- Latin function words (et, in, ad, etc.) should be linked when they contribute meaning
- weight: 1.0 for direct translations, 0.7 for partial/contextual, 0.4 for implied/restructured
- For one-to-many mappings (one Latin word → multiple English words), use one link with the full English span
- For many-to-one (multiple Latin words → one English word), include the full Latin span
- Skip headings/chapter markers — focus on body text
- Be precise with character offsets — they must exactly match the substrings

Return ONLY a JSON array, no markdown fencing, no explanation. Each element:
{
  "en": [startChar, endChar],
  "src": [startChar, endChar],
  "en_text": "the english words",
  "src_text": "the latin words",
  "weight": 0.4 | 0.7 | 1.0
}`;

async function generateLLMAlignment(sourceText, translationText) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `${ALIGNMENT_PROMPT}

LATIN SOURCE:
${sourceText}

ENGLISH TRANSLATION:
${translationText}`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 65536,
    },
  });

  const text = result.response.text().trim();
  // Strip markdown fencing if present
  const jsonStr = text.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim();

  try {
    const links = JSON.parse(jsonStr);
    // Validate and fix offsets
    return links.filter(link => {
      const enSlice = translationText.substring(link.en[0], link.en[1]);
      const srcSlice = sourceText.substring(link.src[0], link.src[1]);
      // Allow some tolerance — LLM offsets can be slightly off
      if (!enSlice || !srcSlice) return false;
      return true;
    }).map(link => ({
      en: link.en,
      src: link.src,
      en_text: link.en_text,
      src_text: link.src_text,
      weight: link.weight,
      method: 'llm',
    }));
  } catch (e) {
    console.error('Failed to parse LLM response:', e.message);
    console.error('Response was:', jsonStr.substring(0, 500));
    return [];
  }
}

// Simple word-level embedding similarity placeholder
// In production, you'd use multilingual-e5 from Hetzner
function generateEmbeddingAlignment(sourceText, translationText) {
  // Tokenize both texts
  const srcWords = tokenize(sourceText);
  const enWords = tokenize(translationText);

  // Simple cognate/similarity heuristic as placeholder for real embeddings
  const links = [];

  for (const enWord of enWords) {
    let bestMatch = null;
    let bestScore = 0;

    for (const srcWord of srcWords) {
      const score = cognateScore(srcWord.word, enWord.word);
      if (score > bestScore && score > 0.3) {
        bestScore = score;
        bestMatch = srcWord;
      }
    }

    if (bestMatch) {
      links.push({
        en: [enWord.start, enWord.end],
        src: [bestMatch.start, bestMatch.end],
        en_text: enWord.word,
        src_text: bestMatch.word,
        weight: Math.min(bestScore, 1.0),
        method: 'embedding',
      });
    }
  }

  return links;
}

function tokenize(text) {
  const words = [];
  const regex = /[a-zA-ZÀ-ÿāēīōūæœ]+/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    words.push({
      word: match[0].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return words;
}

// Rough Latin-English cognate similarity
function cognateScore(latin, english) {
  latin = latin.toLowerCase();
  english = english.toLowerCase();

  // Exact match
  if (latin === english) return 1.0;

  // Known Latin→English mappings (common philosophical terms)
  const knownPairs = {
    'animum': 'soul', 'animae': 'soul', 'anima': 'soul', 'animam': 'soul',
    'mente': 'mind', 'menti': 'mind', 'mens': 'mind',
    'sensum': 'sense', 'sensibus': 'senses', 'sensus': 'sense',
    'voluptatem': 'pleasure', 'voluptate': 'pleasure', 'voluptas': 'pleasure',
    'gaudium': 'joy', 'gaudio': 'joy', 'gaudii': 'joy',
    'laeticiam': 'gladness', 'laeticia': 'gladness', 'laetitiam': 'gladness',
    'bonum': 'good', 'bonis': 'good', 'bona': 'good',
    'malum': 'evil', 'malis': 'evil', 'mala': 'evil',
    'verum': 'true', 'vero': 'truly', 'veritas': 'truth',
    'plato': 'plato', 'platonis': 'plato',
    'partes': 'parts', 'partibus': 'parts', 'partim': 'partly',
    'primum': 'first', 'prima': 'first',
    'caput': 'chapter', 'capitis': 'chapter',
    'omne': 'every', 'omnes': 'all', 'omnia': 'all',
    'laudanda': 'praiseworthy', 'laude': 'praise', 'laudandum': 'praiseworthy',
    'vituperanda': 'blameworthy',
    'corpus': 'body', 'corporis': 'body', 'corpore': 'body',
    'deus': 'god', 'dei': 'god', 'deum': 'god',
    'natura': 'nature', 'naturae': 'nature', 'naturam': 'nature',
    'virtus': 'virtue', 'virtute': 'virtue', 'virtutem': 'virtue',
  };

  if (knownPairs[latin] === english) return 0.95;

  // Stem similarity (Latin stems often survive in English)
  const latinStem = latin.substring(0, Math.min(latin.length, 5));
  const englishStem = english.substring(0, Math.min(english.length, 5));

  if (latinStem === englishStem && latinStem.length >= 4) return 0.8;
  if (latin.substring(0, 4) === english.substring(0, 4) && latin.length >= 4) return 0.6;
  if (latin.substring(0, 3) === english.substring(0, 3) && latin.length >= 4) return 0.4;

  return 0;
}

async function main() {
  const rawData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));

  const results = {
    generated: new Date().toISOString(),
    pages: [],
  };

  // Process Ficino page 6 (best demo page)
  const ficino6 = rawData.ficino[0];
  const srcText = stripTags(ficino6.ocr);
  const transText = stripTags(ficino6.translation);

  console.log('Source text length:', srcText.length);
  console.log('Translation text length:', transText.length);
  console.log('\nSource preview:', srcText.substring(0, 200));
  console.log('\nTranslation preview:', transText.substring(0, 200));

  // Generate LLM alignment
  console.log('\n--- Generating LLM alignment for Ficino p6 ---');
  const llmLinks = await generateLLMAlignment(srcText, transText);
  console.log(`LLM: ${llmLinks.length} alignment links`);

  // Generate embedding-based alignment (cognate heuristic)
  console.log('\n--- Generating embedding alignment for Ficino p6 ---');
  const embLinks = generateEmbeddingAlignment(srcText, transText);
  console.log(`Embedding: ${embLinks.length} alignment links`);

  results.pages.push({
    id: 'ficino-de-voluptate-p6',
    book: 'De Voluptate (On Pleasure)',
    author: 'Marsilio Ficino',
    page: 6,
    sourceLanguage: 'Latin',
    sourceText: srcText,
    translationText: transText,
    alignments: {
      llm: llmLinks,
      embedding: embLinks,
    },
  });

  // Also process Pymander page 8 for variety
  const pymander8 = rawData.pymander[2];
  const pymSrc = stripTags(pymander8.ocr);
  const pymTrans = stripTags(pymander8.translation);

  console.log('\n--- Generating LLM alignment for Pymander p8 ---');
  const pymLlmLinks = await generateLLMAlignment(pymSrc, pymTrans);
  console.log(`LLM: ${pymLlmLinks.length} alignment links`);

  console.log('\n--- Generating embedding alignment for Pymander p8 ---');
  const pymEmbLinks = generateEmbeddingAlignment(pymSrc, pymTrans);
  console.log(`Embedding: ${pymEmbLinks.length} alignment links`);

  results.pages.push({
    id: 'pymander-p8',
    book: 'Pymander (Mercurii Trismegisti)',
    author: 'Hermes Trismegistus / Ficino',
    page: 8,
    sourceLanguage: 'Latin',
    sourceText: pymSrc,
    translationText: pymTrans,
    alignments: {
      llm: pymLlmLinks,
      embedding: pymEmbLinks,
    },
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\nResults written to ${OUTPUT_PATH}`);
  console.log(`Total pages: ${results.pages.length}`);
}

main().catch(console.error);
