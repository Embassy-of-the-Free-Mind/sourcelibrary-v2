#!/usr/bin/env node
/**
 * Richter Ground Truth Comparison
 *
 * Compares AI OCR of Leonardo's mirror-script manuscripts against
 * Richter's published transcriptions (The Literary Works of Leonardo da Vinci).
 *
 * Approach:
 *   1. Find optics/light passages in Richter Vol I (in our library, OCR'd)
 *   2. Get Richter's Italian transcription of specific folios
 *   3. Run fresh OCR on the corresponding manuscript page image
 *   4. Compare AI OCR against Richter's known-good transcription using embedding similarity
 *   5. Also compare multiple AI runs against each other (self-consistency)
 *
 * This gives us BOTH:
 *   - Self-consistency (how much runs agree with each other)
 *   - Accuracy (how much runs agree with the expert transcription)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/richter-ground-truth.mjs
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'leonardo-eval-results');
fs.mkdirSync(RESULTS_DIR, { recursive: true });

const EMBEDDING_MODEL = 'gemini-embedding-001';
const GEMINI_FLASH = 'gemini-3-flash-preview';
const N_RUNS = 5;
const RETRY_MAX = 3;
const RETRY_DELAY = 5000;

// Richter book IDs in our library
const RICHTER_VOL1_ID = '6991e94c35ed50020acc1952';  // Literary Works Vol. I
const RICHTER_VOL2_ID = '6991e95235ed50020acc1bdc';  // Literary Works Vol. II
const RICHTER_NOTEBOOKS_ID = '6991e93135ed50020acc1458';  // Notebooks of Leonardo

// Leonardo manuscript: Etudes sur la chevelure (optics)
const LEONARDO_BOOK_ID = '6991ead72f801130a473e94e';

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

async function fetchImageAsBase64(url) {
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer()).toString('base64');
    } catch (e) {
      if (attempt < RETRY_MAX - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAY * (attempt + 1)));
      } else throw e;
    }
  }
}

async function geminiOcr(imageBase64, prompt, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      const response = await ai.models.generateContent({
        model: GEMINI_FLASH,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
            { text: prompt },
          ],
        }],
        config: { abortSignal: controller.signal },
      });
      clearTimeout(timeout);
      return response.text || '';
    } catch (e) {
      if (attempt < RETRY_MAX - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAY * (attempt + 1) * 2));
      } else throw e;
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }
  if (!process.env.MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log('Richter Ground Truth Comparison\n');

  // Step 1: Find optics/light passages in Richter
  console.log('=== Step 1: Finding Richter passages about optics/light ===\n');

  const richterPages = await db.collection('pages').find(
    {
      book_id: { $in: [RICHTER_VOL1_ID, RICHTER_VOL2_ID, RICHTER_NOTEBOOKS_ID] },
      $or: [
        { 'ocr.data': { $regex: /ombra|lume|luminoso|ottica|raggi|specchio/i } },
        { 'translation.data': { $regex: /shadow|light|luminous|optic|mirror|ray/i } },
      ],
    },
    { projection: { book_id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, _id: 0 } }
  ).sort({ page_number: 1 }).limit(20).toArray();

  console.log(`Found ${richterPages.length} Richter pages with optics/light content`);

  for (const p of richterPages.slice(0, 5)) {
    const ocrPreview = stripTags(p.ocr?.data || '').substring(0, 150);
    console.log(`  p${p.page_number}: ${ocrPreview}...`);
  }

  if (richterPages.length === 0) {
    console.log('No Richter passages found. Trying broader search...');

    // Try just getting some pages from Richter Vol I
    const samplePages = await db.collection('pages').find(
      { book_id: RICHTER_VOL1_ID, 'ocr.data': { $exists: true, $ne: '' } },
      { projection: { page_number: 1, 'ocr.data': 1, _id: 0 } }
    ).sort({ page_number: 1 }).limit(5).toArray();

    console.log(`\nSample pages from Richter Vol I:`);
    for (const p of samplePages) {
      console.log(`  p${p.page_number}: ${stripTags(p.ocr?.data || '').substring(0, 100)}`);
    }
  }

  // Step 2: Get our existing OCR of the Leonardo manuscript
  console.log('\n=== Step 2: Get existing Leonardo OCR from our pipeline ===\n');

  const leonardoPages = await db.collection('pages').find(
    { book_id: LEONARDO_BOOK_ID, page_number: { $in: [49, 53] } },
    { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1, _id: 0 } }
  ).toArray();

  for (const p of leonardoPages) {
    const ocr = stripTags(p.ocr?.data || '');
    console.log(`Leonardo p${p.page_number}: ${ocr.length} chars OCR`);
    console.log(`  Preview: ${ocr.substring(0, 150)}...`);
  }

  // Step 3: Run fresh OCR and compare against Richter
  console.log('\n=== Step 3: Fresh OCR vs Richter comparison ===\n');

  const prompt = `Transcribe this historical manuscript page to plain text.
This is a page from a Leonardo da Vinci manuscript. The text is written in mirror-script (right to left). Transcribe it as normal left-to-right Italian.
Preserve original spelling. Mark illegible text with <unclear>...</unclear>.
Do NOT add interpretive notes or reconstruct text you cannot read.`;

  const results = [];

  for (const pageNum of [49, 53]) {
    const iaId = 'etudessurlacheve00leon';
    const pad = String(pageNum).padStart(4, '0');
    const url = `https://iiif.archive.org/image/iiif/3/${iaId}%2F${iaId}_jp2.zip%2F${iaId}_jp2%2F${iaId}_${pad}.jp2/full/max/0/default.jpg`;

    console.log(`Leonardo p${pageNum}:`);

    let imgB64;
    try {
      imgB64 = await fetchImageAsBase64(url);
      console.log(`  Image: ${(imgB64.length * 0.75 / 1024).toFixed(0)}KB`);
    } catch (e) {
      console.log(`  SKIP: ${e.message}`);
      continue;
    }

    // Run N fresh OCR passes
    const runs = [];
    for (let i = 0; i < N_RUNS; i++) {
      try {
        const text = await geminiOcr(imgB64, prompt, apiKey);
        runs.push(text);
        console.log(`  Run ${i + 1}: ${stripTags(text).length} chars`);
      } catch (e) {
        console.log(`  Run ${i + 1}: ERROR`);
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    if (runs.length < 2) continue;

    // Get embeddings for all runs + Richter passages
    const strippedRuns = runs.map(r => stripTags(r));

    // Find best matching Richter passage
    const richterTexts = richterPages
      .map(p => stripTags(p.ocr?.data || ''))
      .filter(t => t.length > 100);

    if (richterTexts.length > 0) {
      const allTexts = [...strippedRuns, ...richterTexts];
      const allEmbs = await getEmbeddings(allTexts, apiKey);

      // Self-consistency (runs vs runs)
      let selfSum = 0, selfCount = 0;
      for (let i = 0; i < runs.length; i++) {
        for (let j = i + 1; j < runs.length; j++) {
          if (allEmbs[i] && allEmbs[j]) {
            selfSum += cosineSimilarity(allEmbs[i], allEmbs[j]);
            selfCount++;
          }
        }
      }
      const selfConsistency = selfCount > 0 ? selfSum / selfCount : 0;

      // Accuracy (runs vs Richter)
      let accSum = 0, accCount = 0;
      let bestRichterScore = 0;
      let bestRichterIdx = -1;
      for (let ri = 0; ri < richterTexts.length; ri++) {
        const richterEmb = allEmbs[runs.length + ri];
        if (!richterEmb) continue;

        for (let i = 0; i < runs.length; i++) {
          if (!allEmbs[i]) continue;
          const sim = cosineSimilarity(allEmbs[i], richterEmb);
          accSum += sim;
          accCount++;
          if (sim > bestRichterScore) {
            bestRichterScore = sim;
            bestRichterIdx = ri;
          }
        }
      }
      const accuracy = accCount > 0 ? accSum / accCount : 0;

      const result = {
        page: pageNum,
        n_runs: runs.length,
        self_consistency: selfConsistency,
        vs_richter_mean: accuracy,
        vs_richter_best: bestRichterScore,
        best_richter_page: richterPages[bestRichterIdx]?.page_number,
      };

      results.push(result);

      console.log(`\n  Self-consistency: ${(selfConsistency * 100).toFixed(1)}%`);
      console.log(`  vs Richter (mean): ${(accuracy * 100).toFixed(1)}%`);
      console.log(`  vs Richter (best match): ${(bestRichterScore * 100).toFixed(1)}% (Richter p${richterPages[bestRichterIdx]?.page_number})`);
    } else {
      console.log('  No Richter passages to compare against');
    }
  }

  // Save
  const outPath = path.join(RESULTS_DIR, 'richter-ground-truth.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nSaved: ${outPath}`);

  await client.close();
}

main();
