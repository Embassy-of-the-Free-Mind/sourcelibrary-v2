#!/usr/bin/env node
/**
 * Sanskrit Pivot Translation Evaluation
 *
 * Tests whether translating Sanskrit → Hindi → English produces better
 * results than Sanskrit → English directly, using LLMs.
 *
 * Three pipelines compared:
 *   A) Direct:    Sanskrit → English (single prompt)
 *   B) Pivot:     Sanskrit → Hindi (prompt 1) → English (prompt 2)
 *   C) CoT:       Sanskrit → "Think in Hindi first, then translate to English" (single prompt)
 *
 * Evaluation metrics (all reference-free):
 *   1. Self-consistency: N=3 runs per pipeline, embedding cosine similarity
 *   2. Cross-pipeline: embedding similarity between pipeline outputs
 *   3. GEMBA-style: ask an LLM to rate each translation (1-5 scale)
 *   4. Back-translation fidelity: English → Sanskrit, compare to original OCR
 *   5. Content preservation: key term extraction + check
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/sanskrit-pivot-eval.mjs [--book-id BOOK_ID] [--pages 5,10,15]
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'sanskrit-eval-results');
fs.mkdirSync(RESULTS_DIR, { recursive: true });

const EMBEDDING_MODEL = 'gemini-embedding-001';
const TRANSLATE_MODEL = 'gemini-3-flash-preview';
const JUDGE_MODEL = 'gemini-3-flash-preview';
const N_RUNS = 3;
const RETRY_MAX = 3;
const RETRY_DELAY = 3000;

// ── Prompts ─────────────────────────────────────────────────────────────────

const PROMPTS = {
  // Pipeline A: Direct Sanskrit → English
  direct: `Translate this Sanskrit text into English.
Preserve the meaning faithfully. Keep proper nouns transliterated.
If any passage is unclear, translate your best interpretation and note uncertainty in [brackets].
Output only the English translation.`,

  // Pipeline B, step 1: Sanskrit → Hindi
  pivot_to_hindi: `Translate this Sanskrit text into Hindi.
Preserve the meaning faithfully. Keep technical/philosophical terms in their original Sanskrit form where Hindi commonly uses them.
Output only the Hindi translation.`,

  // Pipeline B, step 2: Hindi → English
  pivot_to_english: `Translate this Hindi text into English.
Preserve the meaning faithfully. Keep proper nouns and Sanskrit technical terms transliterated.
Output only the English translation.`,

  // Pipeline C: Chain-of-thought via Hindi
  cot_hindi: `Translate this Sanskrit text into English.
First, mentally interpret the Sanskrit through Hindi (as an intermediate step to aid comprehension — Sanskrit and Hindi share grammar and vocabulary).
Then produce a faithful English translation.
Output only the final English translation, not the Hindi intermediate.`,

  // GEMBA-style quality judge
  judge: `You are a translation quality evaluator. Rate the following translation of a Sanskrit text on these dimensions:

1. **Fluency** (1-5): Is the English natural and readable?
2. **Adequacy** (1-5): Does the translation appear to capture the content of the source?
3. **Terminology** (1-5): Are Sanskrit philosophical/technical terms handled appropriately?
4. **Completeness** (1-5): Does the translation cover all the source material without omissions?

Source (Sanskrit/OCR):
{source}

Translation:
{translation}

Respond in JSON format: {"fluency": N, "adequacy": N, "terminology": N, "completeness": N, "overall": N, "notes": "brief comment"}`,
};

// ── Utilities ───────────────────────────────────────────────────────────────

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
    if (i + 5 < texts.length) await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

async function geminiGenerate(prompt, text, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: TRANSLATE_MODEL,
        contents: [{ role: 'user', parts: [{ text: `${prompt}\n\n${text}` }] }],
      });
      return response.text || '';
    } catch (e) {
      if (attempt < RETRY_MAX - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAY * (attempt + 1)));
      } else throw e;
    }
  }
}

async function geminiJudge(source, translation, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = PROMPTS.judge
    .replace('{source}', source.substring(0, 2000))
    .replace('{translation}', translation.substring(0, 2000));
  try {
    const response = await ai.models.generateContent({
      model: JUDGE_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    const text = (response.text || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ── Pipeline runners ────────────────────────────────────────────────────────

async function runDirect(sanskritText, apiKey) {
  return geminiGenerate(PROMPTS.direct, sanskritText, apiKey);
}

async function runPivot(sanskritText, apiKey) {
  const hindi = await geminiGenerate(PROMPTS.pivot_to_hindi, sanskritText, apiKey);
  await new Promise(r => setTimeout(r, 1000));
  const english = await geminiGenerate(PROMPTS.pivot_to_english, hindi, apiKey);
  return { hindi, english };
}

async function runCoT(sanskritText, apiKey) {
  return geminiGenerate(PROMPTS.cot_hindi, sanskritText, apiKey);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: {
      'book-id': { type: 'string' },
      'pages': { type: 'string' },
    },
    strict: false,
  });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }
  if (!process.env.MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log('Sanskrit Pivot Translation Evaluation\n');

  // Find Sanskrit pages to test
  let bookId = values['book-id'];
  let pageNums = values['pages'] ? values['pages'].split(',').map(Number) : null;

  if (!bookId) {
    // Find a Sanskrit book with OCR
    const book = await db.collection('books').findOne(
      { language: /sanskrit/i, pages_ocr: { $gt: 10 } },
      { projection: { title: 1, language: 1, pages_count: 1, pages_ocr: 1 } }
    );
    if (!book) {
      console.error('No Sanskrit books with OCR found');
      process.exit(1);
    }
    bookId = book._id.toString();
    console.log(`Using: ${book.title} (${book.pages_count} pages, ${book.pages_ocr} OCR'd)`);
  }

  // Get pages with OCR
  const query = {
    book_id: bookId,
    'ocr.data': { $exists: true, $ne: '' },
  };
  if (pageNums) query.page_number = { $in: pageNums };

  const pages = await db.collection('pages').find(
    query,
    { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).limit(pageNums ? pageNums.length : 5).toArray();

  console.log(`Found ${pages.length} pages with OCR\n`);

  const allResults = [];

  for (const page of pages) {
    const sanskritText = page.ocr.data.replace(/<[^>]+>/g, '').trim();
    if (sanskritText.length < 50) {
      console.log(`p${page.page_number}: skipping (${sanskritText.length} chars)`);
      continue;
    }

    console.log(`\n=== Page ${page.page_number} (${sanskritText.length} chars) ===`);
    console.log(`Sanskrit preview: ${sanskritText.substring(0, 100)}...\n`);

    const pageResult = {
      page: page.page_number,
      sanskrit_length: sanskritText.length,
      existing_translation: page.translation?.data?.substring(0, 200) || null,
      pipelines: {},
    };

    // Run each pipeline N times
    for (const [pipelineName, runFn] of [
      ['A_direct', runDirect],
      ['C_cot', runCoT],
    ]) {
      console.log(`Pipeline ${pipelineName}:`);
      const runs = [];
      for (let i = 0; i < N_RUNS; i++) {
        try {
          const result = await runFn(sanskritText, apiKey);
          const text = typeof result === 'string' ? result : result.english;
          runs.push(text);
          console.log(`  run${i+1}: ${text.length} chars`);
        } catch (e) {
          console.log(`  run${i+1}: ERROR ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 2000));
      }
      pageResult.pipelines[pipelineName] = { runs };
    }

    // Pipeline B (pivot) — run N times
    console.log('Pipeline B_pivot:');
    const pivotRuns = [];
    const hindiTexts = [];
    for (let i = 0; i < N_RUNS; i++) {
      try {
        const { hindi, english } = await runPivot(sanskritText, apiKey);
        pivotRuns.push(english);
        hindiTexts.push(hindi);
        console.log(`  run${i+1}: Hindi ${hindi.length}ch → English ${english.length}ch`);
      } catch (e) {
        console.log(`  run${i+1}: ERROR ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    pageResult.pipelines['B_pivot'] = { runs: pivotRuns, hindi_runs: hindiTexts };

    // Compute metrics
    console.log('\nMetrics:');
    const allTexts = [];
    const textLabels = [];

    for (const [name, data] of Object.entries(pageResult.pipelines)) {
      for (let i = 0; i < data.runs.length; i++) {
        if (data.runs[i]) {
          allTexts.push(data.runs[i]);
          textLabels.push(`${name}_${i}`);
        }
      }
    }

    if (allTexts.length >= 2) {
      const embeddings = await getEmbeddings(allTexts, apiKey);

      // Self-consistency per pipeline
      for (const [name, data] of Object.entries(pageResult.pipelines)) {
        const indices = textLabels.map((l, i) => l.startsWith(name) ? i : -1).filter(i => i >= 0);
        let sum = 0, count = 0;
        for (let i = 0; i < indices.length; i++) {
          for (let j = i + 1; j < indices.length; j++) {
            const a = embeddings[indices[i]], b = embeddings[indices[j]];
            if (a && b) { sum += cosineSimilarity(a, b); count++; }
          }
        }
        data.self_consistency = count > 0 ? sum / count : null;
        console.log(`  ${name} self-consistency: ${data.self_consistency ? (data.self_consistency * 100).toFixed(1) + '%' : 'n/a'}`);
      }

      // Cross-pipeline comparison (first run of each)
      const pipelineNames = Object.keys(pageResult.pipelines);
      pageResult.cross_pipeline = {};
      for (let i = 0; i < pipelineNames.length; i++) {
        for (let j = i + 1; j < pipelineNames.length; j++) {
          const idxA = textLabels.indexOf(`${pipelineNames[i]}_0`);
          const idxB = textLabels.indexOf(`${pipelineNames[j]}_0`);
          if (idxA >= 0 && idxB >= 0 && embeddings[idxA] && embeddings[idxB]) {
            const sim = cosineSimilarity(embeddings[idxA], embeddings[idxB]);
            const key = `${pipelineNames[i]}_vs_${pipelineNames[j]}`;
            pageResult.cross_pipeline[key] = sim;
            console.log(`  ${key}: ${(sim * 100).toFixed(1)}%`);
          }
        }
      }
    }

    // LLM-as-judge evaluation (first run of each pipeline)
    console.log('\nLLM Judge scores:');
    for (const [name, data] of Object.entries(pageResult.pipelines)) {
      if (data.runs[0]) {
        const scores = await geminiJudge(sanskritText, data.runs[0], apiKey);
        data.judge_scores = scores;
        if (scores) {
          console.log(`  ${name}: fluency=${scores.fluency} adequacy=${scores.adequacy} terminology=${scores.terminology} completeness=${scores.completeness} overall=${scores.overall}`);
          if (scores.notes) console.log(`    "${scores.notes}"`);
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Show translation previews
    console.log('\nTranslation previews:');
    for (const [name, data] of Object.entries(pageResult.pipelines)) {
      if (data.runs[0]) {
        console.log(`  ${name}: ${data.runs[0].substring(0, 150)}...`);
      }
    }

    allResults.push(pageResult);
  }

  // Summary
  console.log('\n\n========== SUMMARY ==========\n');
  console.log('Pipeline        | Self-Consist. | Avg Judge |');
  console.log('----------------|---------------|-----------|');

  for (const pipeline of ['A_direct', 'B_pivot', 'C_cot']) {
    const consistencies = allResults
      .map(r => r.pipelines[pipeline]?.self_consistency)
      .filter(v => v != null);
    const judges = allResults
      .map(r => r.pipelines[pipeline]?.judge_scores?.overall)
      .filter(v => v != null);

    const avgC = consistencies.length ? (consistencies.reduce((a, b) => a + b, 0) / consistencies.length * 100).toFixed(1) + '%' : 'n/a';
    const avgJ = judges.length ? (judges.reduce((a, b) => a + b, 0) / judges.length).toFixed(1) : 'n/a';
    console.log(`${pipeline.padEnd(16)}| ${avgC.padStart(13)} | ${avgJ.padStart(9)} |`);
  }

  // Cross-pipeline summary
  console.log('\nCross-pipeline similarity (avg):');
  const crossKeys = new Set(allResults.flatMap(r => Object.keys(r.cross_pipeline || {})));
  for (const key of crossKeys) {
    const vals = allResults.map(r => r.cross_pipeline?.[key]).filter(v => v != null);
    if (vals.length) {
      console.log(`  ${key}: ${(vals.reduce((a, b) => a + b, 0) / vals.length * 100).toFixed(1)}%`);
    }
  }

  // Save
  const outPath = path.join(RESULTS_DIR, 'sanskrit-pivot.json');
  fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
  console.log(`\nResults saved: ${outPath}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
