#!/usr/bin/env node
/**
 * Reasoning + Image Preprocessing OCR Evaluation
 *
 * Tests whether reasoning (Gemini 3 Pro with thinking) and image preprocessing
 * can improve Leonardo mirror-script OCR consistency.
 *
 * Image preprocessing techniques:
 *   - Original (baseline)
 *   - Horizontal flip (mirror → normal)
 *   - Grayscale + contrast enhancement
 *   - Binarization (Otsu-style threshold)
 *   - Flip + contrast combined
 *   - Inverted (white-on-black → black-on-white)
 *   - Cropped (remove margins, focus on text region)
 *
 * Models:
 *   - Gemini 3 Flash (baseline, no reasoning)
 *   - Gemini 3 Pro (reasoning/thinking mode)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/reasoning-and-preprocess-eval.mjs --test reasoning
 *   node scripts/eval/reasoning-and-preprocess-eval.mjs --test preprocess
 *   node scripts/eval/reasoning-and-preprocess-eval.mjs --test combined
 */

import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'leonardo-eval-results');
fs.mkdirSync(RESULTS_DIR, { recursive: true });

// ── Config ──────────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = 'gemini-embedding-001';
const N_RUNS = 3;  // 3 runs per condition (enough for signal, manageable cost)
const RETRY_MAX = 3;
const RETRY_DELAY = 5000;

const GEMINI_FLASH = 'gemini-3-flash-preview';
const GEMINI_PRO = 'gemini-3-pro-preview';

// Leonardo pages to test
const LEONARDO_PAGES = [49, 53];
const LEONARDO_IIIF = (p) => {
  const id = 'etudessurlacheve00leon';
  const pad = String(p).padStart(4, '0');
  return `https://iiif.archive.org/image/iiif/3/${id}%2F${id}_jp2.zip%2F${id}_jp2%2F${id}_${pad}.jp2/full/max/0/default.jpg`;
};

// Vitruvius as control
const VITRUVIUS_PAGES = [33];
const VITRUVIUS_IIIF = (p) => {
  const id = 'mvitrvviidearchi00vitr';
  const pad = String(p).padStart(4, '0');
  return `https://iiif.archive.org/image/iiif/3/${id}%2F${id}_jp2.zip%2F${id}_jp2%2F${id}_${pad}.jp2/full/max/0/default.jpg`;
};

// ── Prompts ─────────────────────────────────────────────────────────────────

const PROMPT_STANDARD = `Transcribe this historical manuscript page to plain text.

This is a page from a Leonardo da Vinci manuscript. The text may be written in mirror-script (right to left). Transcribe it as normal left-to-right Italian.

Rules:
1. Preserve original spelling, capitalization, punctuation
2. Mark illegible text with <unclear>...</unclear>
3. Describe diagrams briefly in [brackets]
4. If the page is blank or has no text, say "BLANK PAGE"
5. Do NOT add interpretive notes, translations, or scholarly commentary
6. Do NOT reconstruct text you cannot actually read — only transcribe what is visible`;

const PROMPT_REASONING = `You are a paleographer transcribing a Leonardo da Vinci manuscript page. Leonardo wrote in mirror-script — right to left with reversed letterforms, likely due to his left-handedness.

APPROACH THIS STEP BY STEP:
1. First, identify regions of text vs. diagrams on the page
2. For each text region, recognize that the script is mirrored — each letter is horizontally reversed
3. Mentally reverse each letterform to determine the intended character
4. Leonardo wrote in 15th-century Italian with some Latin terms. Use your knowledge of his vocabulary and topics to help decode ambiguous characters, but do NOT fabricate text you cannot actually see
5. Pay special attention to Leonardo's characteristic abbreviations: tildes over vowels for missing 'n' or 'm', superscript letters, and the nota-like abbreviation marks

Output only the transcribed text in normal left-to-right Italian. Mark illegible text with <unclear>...</unclear>. Describe diagrams briefly in [brackets].

CRITICAL: Only transcribe what you can actually decode from the image. If a word is too unclear to read, mark it as <unclear> rather than guessing.`;

const PROMPT_PRINTED = `Transcribe this historical printed page to plain text.
Preserve original spelling, capitalization, punctuation.
Mark illegible text with <unclear>...</unclear>.
Do NOT add interpretive notes or commentary.`;

// ── Image Processing ────────────────────────────────────────────────────────

async function fetchImageBuffer(url) {
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    } catch (e) {
      if (attempt < RETRY_MAX - 1) {
        console.log(`    Retry ${attempt + 1}: ${e.message}`);
        await new Promise(r => setTimeout(r, RETRY_DELAY * (attempt + 1)));
      } else throw e;
    }
  }
}

async function preprocessImage(buffer, method) {
  let img = sharp(buffer);

  switch (method) {
    case 'original':
      return buffer;

    case 'flip':
      // Horizontal flip — mirror-script → normal orientation
      return img.flop().jpeg({ quality: 90 }).toBuffer();

    case 'grayscale':
      // Convert to grayscale
      return img.grayscale().jpeg({ quality: 90 }).toBuffer();

    case 'contrast':
      // Grayscale + contrast enhancement
      return img
        .grayscale()
        .normalize()  // stretch histogram to full range
        .sharpen({ sigma: 1.5 })
        .jpeg({ quality: 90 })
        .toBuffer();

    case 'binarize':
      // Binarization — threshold to black/white
      return img
        .grayscale()
        .threshold(128)
        .jpeg({ quality: 90 })
        .toBuffer();

    case 'binarize_adaptive':
      // More aggressive binarization with normalization first
      return img
        .grayscale()
        .normalize()
        .threshold(140)
        .jpeg({ quality: 90 })
        .toBuffer();

    case 'flip_contrast':
      // Flip + contrast — combined best-of-both
      return img
        .flop()
        .grayscale()
        .normalize()
        .sharpen({ sigma: 1.5 })
        .jpeg({ quality: 90 })
        .toBuffer();

    case 'flip_binarize':
      // Flip + binarization
      return img
        .flop()
        .grayscale()
        .normalize()
        .threshold(140)
        .jpeg({ quality: 90 })
        .toBuffer();

    case 'invert':
      // Invert colors — sometimes helps with dark backgrounds
      return img
        .negate()
        .jpeg({ quality: 90 })
        .toBuffer();

    case 'denoise':
      // Median filter for noise reduction
      return img
        .grayscale()
        .median(3)
        .normalize()
        .jpeg({ quality: 90 })
        .toBuffer();

    case 'crop_center':
      // Crop to center 70% — remove margins
      const meta = await img.metadata();
      const cropW = Math.round(meta.width * 0.15);
      const cropH = Math.round(meta.height * 0.10);
      return img
        .extract({
          left: cropW,
          top: cropH,
          width: meta.width - cropW * 2,
          height: meta.height - cropH * 2,
        })
        .jpeg({ quality: 90 })
        .toBuffer();

    default:
      throw new Error(`Unknown preprocessing method: ${method}`);
  }
}

// ── Utilities ───────────────────────────────────────────────────────────────

function stripTags(text) {
  return text
    .replace(/<[^>]+>[^<]*<\/[^>]+>/g, '')
    .replace(/<[^>]+\/>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function jaccardSimilarity(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const intersection = [...wordsA].filter(x => wordsB.has(x));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getEmbeddings(texts, apiKey) {
  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({ model: EMBEDDING_MODEL });
  const results = [];

  for (let i = 0; i < texts.length; i += 5) {
    const batch = texts.slice(i, i + 5);
    const requests = batch.map(text => ({
      content: { role: 'user', parts: [{ text: text.slice(0, 8000) }] },
    }));

    try {
      const response = await model.batchEmbedContents({ requests });
      for (const emb of response.embeddings) results.push(emb.values);
    } catch {
      for (const req of requests) {
        try {
          const single = await model.embedContent(req);
          results.push(single.embedding.values);
        } catch { results.push(null); }
      }
    }
    if (i + 5 < texts.length) await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

async function pairwiseSimilarity(texts, apiKey) {
  const stripped = texts.map(t => stripTags(t));
  const embeddings = await getEmbeddings(stripped, apiKey);

  const pairs = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const cosine = (embeddings[i] && embeddings[j])
        ? cosineSimilarity(embeddings[i], embeddings[j])
        : null;
      const jaccard = jaccardSimilarity(stripped[i], stripped[j]);
      pairs.push({ i, j, cosine, jaccard });
    }
  }

  const cosines = pairs.map(p => p.cosine).filter(c => c !== null);
  const jaccards = pairs.map(p => p.jaccard);

  return {
    embedding: {
      mean: cosines.length ? cosines.reduce((a, b) => a + b, 0) / cosines.length : null,
      min: cosines.length ? Math.min(...cosines) : null,
      max: cosines.length ? Math.max(...cosines) : null,
    },
    jaccard: {
      mean: jaccards.reduce((a, b) => a + b, 0) / jaccards.length,
      min: Math.min(...jaccards),
      max: Math.max(...jaccards),
    },
    pairs,
  };
}

// ── OCR ─────────────────────────────────────────────────────────────────────

async function geminiOcr(imageBase64, model, prompt, apiKey, thinkingBudget = 0) {
  const ai = new GoogleGenAI({ apiKey });
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);

      const config = {
        abortSignal: controller.signal,
      };

      // Enable thinking for Pro model
      if (thinkingBudget > 0) {
        config.thinkingConfig = {
          thinkingBudget,
        };
      }

      const response = await ai.models.generateContent({
        model,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
            { text: prompt },
          ],
        }],
        config,
      });
      clearTimeout(timeout);
      return response.text || '';
    } catch (e) {
      if (attempt < RETRY_MAX - 1) {
        console.log(`      OCR retry ${attempt + 1}: ${e.message}`);
        await new Promise(r => setTimeout(r, RETRY_DELAY * (attempt + 1) * 2));
      } else throw e;
    }
  }
}

function saveResult(name, data) {
  const file = path.join(RESULTS_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`Saved: ${file}`);
}

// ── Test: Reasoning ─────────────────────────────────────────────────────────

async function testReasoning() {
  console.log(`\n=== Reasoning Test: Flash vs Pro (thinking) ===\n`);

  const apiKey = process.env.GEMINI_API_KEY;
  const results = [];

  const conditions = [
    { label: 'Flash (standard prompt)', model: GEMINI_FLASH, prompt: PROMPT_STANDARD, thinking: 0 },
    { label: 'Pro (standard prompt)', model: GEMINI_PRO, prompt: PROMPT_STANDARD, thinking: 0 },
    { label: 'Pro (reasoning prompt)', model: GEMINI_PRO, prompt: PROMPT_REASONING, thinking: 0 },
    { label: 'Pro (thinking=4096)', model: GEMINI_PRO, prompt: PROMPT_REASONING, thinking: 4096 },
    { label: 'Pro (thinking=8192)', model: GEMINI_PRO, prompt: PROMPT_REASONING, thinking: 8192 },
  ];

  for (const pageNum of LEONARDO_PAGES) {
    console.log(`\n--- Leonardo p${pageNum} ---`);
    const url = LEONARDO_IIIF(pageNum);
    const imgBuf = await fetchImageBuffer(url);
    const imgB64 = imgBuf.toString('base64');
    console.log(`  Image: ${(imgB64.length * 0.75 / 1024).toFixed(0)}KB`);

    for (const cond of conditions) {
      console.log(`\n  ${cond.label}:`);
      const transcriptions = [];

      for (let run = 0; run < N_RUNS; run++) {
        try {
          const t0 = Date.now();
          const text = await geminiOcr(imgB64, cond.model, cond.prompt, apiKey, cond.thinking);
          const elapsed = Date.now() - t0;
          transcriptions.push(text);
          const stripped = stripTags(text);
          console.log(`    Run ${run + 1}: ${stripped.length} chars, ${stripped.split(/\s+/).length} words, ${elapsed}ms`);
        } catch (e) {
          console.log(`    Run ${run + 1}: ERROR — ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 3000));
      }

      if (transcriptions.length < 2) {
        results.push({ page: pageNum, condition: cond.label, error: 'not enough runs' });
        continue;
      }

      const similarity = await pairwiseSimilarity(transcriptions, apiKey);
      const result = {
        page: pageNum,
        condition: cond.label,
        model: cond.model,
        thinking: cond.thinking,
        n_runs: transcriptions.length,
        similarity,
        run_lengths: transcriptions.map(t => stripTags(t).length),
      };

      results.push(result);
      console.log(`    Jaccard: ${(similarity.jaccard.mean * 100).toFixed(1)}%`);
      console.log(`    Embedding: ${similarity.embedding.mean ? (similarity.embedding.mean * 100).toFixed(1) + '%' : 'N/A'}`);
    }
  }

  saveResult('reasoning', results);
  printTable(results, 'Reasoning');
  return results;
}

// ── Test: Image Preprocessing ───────────────────────────────────────────────

async function testPreprocess() {
  console.log(`\n=== Image Preprocessing Test ===\n`);

  const apiKey = process.env.GEMINI_API_KEY;
  const results = [];

  const methods = [
    'original',
    'flip',
    'contrast',
    'binarize',
    'binarize_adaptive',
    'flip_contrast',
    'flip_binarize',
    'denoise',
    'invert',
    'crop_center',
  ];

  for (const pageNum of LEONARDO_PAGES.slice(0, 1)) {  // Just first page for preprocessing
    console.log(`\n--- Leonardo p${pageNum} ---`);
    const url = LEONARDO_IIIF(pageNum);
    const imgBuf = await fetchImageBuffer(url);
    console.log(`  Original: ${(imgBuf.length / 1024).toFixed(0)}KB`);

    for (const method of methods) {
      console.log(`\n  Preprocessing: ${method}`);

      let processedBuf;
      try {
        processedBuf = await preprocessImage(imgBuf, method);
        console.log(`    Processed: ${(processedBuf.length / 1024).toFixed(0)}KB`);
      } catch (e) {
        console.log(`    ERROR preprocessing: ${e.message}`);
        continue;
      }

      const imgB64 = processedBuf.toString('base64');
      const transcriptions = [];

      for (let run = 0; run < N_RUNS; run++) {
        try {
          const text = await geminiOcr(imgB64, GEMINI_FLASH, PROMPT_STANDARD, apiKey);
          transcriptions.push(text);
          const stripped = stripTags(text);
          console.log(`    Run ${run + 1}: ${stripped.length} chars, ${stripped.split(/\s+/).length} words`);
        } catch (e) {
          console.log(`    Run ${run + 1}: ERROR — ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 2000));
      }

      if (transcriptions.length < 2) {
        results.push({ page: pageNum, method, error: 'not enough runs' });
        continue;
      }

      const similarity = await pairwiseSimilarity(transcriptions, apiKey);
      results.push({
        page: pageNum,
        method,
        n_runs: transcriptions.length,
        similarity,
        run_lengths: transcriptions.map(t => stripTags(t).length),
        image_kb: Math.round(processedBuf.length / 1024),
      });

      console.log(`    Jaccard: ${(similarity.jaccard.mean * 100).toFixed(1)}%`);
      console.log(`    Embedding: ${similarity.embedding.mean ? (similarity.embedding.mean * 100).toFixed(1) + '%' : 'N/A'}`);
    }
  }

  saveResult('preprocess', results);
  printTable(results.map(r => ({ ...r, condition: r.method })), 'Image Preprocessing');
  return results;
}

// ── Test: Combined best ─────────────────────────────────────────────────────

async function testCombined() {
  console.log(`\n=== Combined: Best Preprocessing + Reasoning ===\n`);
  console.log('Run --test preprocess and --test reasoning first to identify best conditions.');
  console.log('Then manually combine the best preprocessing with the best model/prompt.');
  // TODO: After running individual tests, combine best preprocessing with Pro reasoning
}

// ── Output ──────────────────────────────────────────────────────────────────

function printTable(results, title) {
  console.log(`\n=== ${title} Results ===\n`);
  console.log('┌───────┬──────────────────────────────┬──────────┬──────────┬─────────────────┐');
  console.log('│ Page  │ Condition                    │ Jaccard  │ Embedding│ Length Var       │');
  console.log('├───────┼──────────────────────────────┼──────────┼──────────┼─────────────────┤');

  for (const r of results) {
    if (r.error) {
      const label = (r.condition || r.method || '?').substring(0, 28).padEnd(28);
      console.log(`│ p${String(r.page).padEnd(4)}│ ${label} │   ERROR  │   ERROR  │                 │`);
      continue;
    }
    const page = `p${r.page}`.padEnd(5);
    const label = (r.condition || r.method || '?').substring(0, 28).padEnd(28);
    const jac = (r.similarity.jaccard.mean * 100).toFixed(1).padStart(6) + '%';
    const emb = r.similarity.embedding.mean
      ? (r.similarity.embedding.mean * 100).toFixed(1).padStart(6) + '%'
      : '   N/A ';
    const lengths = r.run_lengths || [];
    const lenVar = lengths.length > 1
      ? `${Math.min(...lengths)}–${Math.max(...lengths)} chars`
      : '';
    console.log(`│ ${page} │ ${label} │ ${jac} │ ${emb} │ ${lenVar.padEnd(15)} │`);
  }

  console.log('└───────┴──────────────────────────────┴──────────┴──────────┴─────────────────┘');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const testArg = args.find(a => a.startsWith('--test='))?.split('=')[1]
    || args[args.indexOf('--test') + 1]
    || 'reasoning';

  if (!process.env.GEMINI_API_KEY) {
    console.error('Missing GEMINI_API_KEY');
    process.exit(1);
  }

  console.log(`Reasoning + Preprocessing Evaluation`);
  console.log(`Test: ${testArg}`);

  switch (testArg) {
    case 'reasoning':
      await testReasoning();
      break;
    case 'preprocess':
      await testPreprocess();
      break;
    case 'combined':
      await testCombined();
      break;
    default:
      console.error(`Unknown test: ${testArg}`);
      console.error('Available: reasoning, preprocess, combined');
      process.exit(1);
  }
}

main();
