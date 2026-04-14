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

Return a JSON array. Use this COMPACT format — single-letter keys to minimize output size:
[{"e":[0,5],"s":[0,5],"et":"english","st":"latin","w":1.0}]

Keys: e=english offsets, s=source offsets, et=english text, st=source text, w=weight.
Keep strings short — just the aligned words, no extra context.`;

// Split text into ~500 char chunks at sentence boundaries
function splitIntoChunks(srcText, transText, maxLen = 500) {
  const chunks = [];
  let srcStart = 0;
  let transStart = 0;

  // Simple sentence splitter: find period/newline near maxLen
  function findBreak(text, from, maxLen) {
    const end = Math.min(from + maxLen, text.length);
    if (end >= text.length) return text.length;
    // Look for sentence boundary
    for (let i = end; i > from + maxLen * 0.5; i--) {
      if (text[i] === '.' || text[i] === '\n') return i + 1;
    }
    // Fall back to space
    for (let i = end; i > from + maxLen * 0.5; i--) {
      if (text[i] === ' ') return i + 1;
    }
    return end;
  }

  while (srcStart < srcText.length && transStart < transText.length) {
    const srcEnd = findBreak(srcText, srcStart, maxLen);
    const transEnd = findBreak(transText, transStart, maxLen);
    chunks.push({
      src: srcText.substring(srcStart, srcEnd),
      srcOffset: srcStart,
      trans: transText.substring(transStart, transEnd),
      transOffset: transStart,
    });
    srcStart = srcEnd;
    transStart = transEnd;
  }
  return chunks;
}

async function generateLLMAlignment(sourceText, translationText) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-3-flash-preview',
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
    },
  });

  const chunks = splitIntoChunks(sourceText, translationText, 300);
  const allLinks = [];

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const prompt = `${ALIGNMENT_PROMPT}

IMPORTANT: Return character offsets relative to these exact text excerpts (starting at 0).

LATIN SOURCE:
${chunk.src}

ENGLISH TRANSLATION:
${chunk.trans}`;

    let text;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        text = result.response.text().trim();
        JSON.parse(text); // validate
        break;
      } catch (e) {
        if (attempt === 2) {
          console.error(`  Chunk ${ci + 1}/${chunks.length} failed after 3 attempts:`, e.message);
          text = null;
          break;
        }
        // wait briefly before retry
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    try {
      if (!text) continue;
      const links = JSON.parse(text);

      for (const link of links) {
        // Support both compact (e/s/et/st/w) and full format
        const enRange = link.e || link.en;
        const srcRange = link.s || link.src;
        const enText = link.et || link.en_text;
        const srcText = link.st || link.src_text;
        const weight = link.w ?? link.weight ?? 0.7;

        if (!enRange || !srcRange) continue;
        const enSlice = chunk.trans.substring(enRange[0], enRange[1]);
        const srcSlice = chunk.src.substring(srcRange[0], srcRange[1]);
        if (!enSlice || !srcSlice) continue;

        allLinks.push({
          en: [enRange[0] + chunk.transOffset, enRange[1] + chunk.transOffset],
          src: [srcRange[0] + chunk.srcOffset, srcRange[1] + chunk.srcOffset],
          en_text: enText || enSlice,
          src_text: srcText || srcSlice,
          weight,
          method: 'llm',
        });
      }
      console.log(`  Chunk ${ci + 1}/${chunks.length}: ${links.length} links`);
    } catch (e) {
      console.error(`  Chunk ${ci + 1}/${chunks.length} failed:`, e.message);
    }
  }

  return allLinks;
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
