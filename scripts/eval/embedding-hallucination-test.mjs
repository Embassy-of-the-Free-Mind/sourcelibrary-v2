#!/usr/bin/env node
/**
 * Embedding-Space Hallucination Detection
 *
 * Tests whether hallucinated OCR is detectable via embeddings:
 *
 * 1. OCR↔Translation distance: Is hallucinated OCR *more* coherent with its
 *    translation (because both are generated) vs real OCR (translation of perception)?
 *
 * 2. Hallucinated↔Fixed distance: How far apart in embedding space are the
 *    hallucinated output and the thinking-fixed output for the same page?
 *
 * 3. Neighbor consistency: Does hallucinated OCR drift from adjacent pages?
 *
 * Uses the 5 pages we already have both hallucinated and fixed OCR for.
 */

import { createClient } from '@supabase/supabase-js';
import { embedTexts } from './lib/embedding-eval.mjs';
import { cosineSimilarity, cosineDistance, cleanText } from './lib/metrics.mjs';
import fs from 'fs';

// Load env
for (const file of ['.env.production.local', '.env.local']) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v;
      }
    }
  } catch {}
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Pages we have both hallucinated (production) and fixed (thinking:HIGH) OCR for
const TEST_PAGES = [
  { book_id: '69099634cf28baa1b4cae779', page: 128, language: 'Russian', label: 'BPH Cyrillic' },
  { book_id: '699438416879ff0184cb8300', page: 632, language: 'Greek', label: 'Patrologia Graeca' },
  { book_id: '69a99d0a510aaf87d0635bfc', page: 194, language: 'Syriac', label: 'Patrologia Orientalis' },
  { book_id: '699258553d2d40d1b058961b', page: 160, language: 'Tamil', label: 'Manimekalai' },
  { book_id: '69924401bc722ec0ee80b312', page: 179, language: 'Hebrew', label: 'Mikraot Gedolot' },
];

// Also get some control pages (non-hallucinated) from the same books for comparison
const CONTROL_PAGES = [
  { book_id: '69924401bc722ec0ee80b312', page: 200, language: 'Hebrew', label: 'Mikraot Gedolot (control)' },
  { book_id: '699438416879ff0184cb8300', page: 137, language: 'Greek', label: 'PG40 (control)' },
];

async function getFixedOcr(bookId, pageNum) {
  // Get the thinking:HIGH result from our sweep
  const sweepFile = `scripts/eval/results/thinking-sweep/${bookId}_p${pageNum}_HIGH.json`;
  if (fs.existsSync(sweepFile)) {
    const data = JSON.parse(fs.readFileSync(sweepFile));
    // The sweep only stored char count, not the actual text. Need to re-run.
    return null;
  }
  return null;
}

async function run() {
  console.log('=== EMBEDDING-SPACE HALLUCINATION ANALYSIS ===\n');

  // For each test page, get:
  // - Production OCR (hallucinated)
  // - Translation of hallucinated OCR
  // - Neighbor pages' OCR (for context drift detection)

  const allResults = [];

  for (const tp of [...TEST_PAGES, ...CONTROL_PAGES]) {
    const isControl = CONTROL_PAGES.includes(tp);

    // Get production OCR + translation
    const { data: page } = await sb.from('pages')
      .select('ocr_data,translation_data,ocr_model')
      .eq('book_id', tp.book_id)
      .eq('page_number', tp.page)
      .single();

    if (!page?.ocr_data) { console.log(`  SKIP ${tp.label} p${tp.page}: no OCR`); continue; }

    // Get neighbor pages (±2) for context
    const neighbors = [];
    for (const offset of [-2, -1, 1, 2]) {
      const { data: n } = await sb.from('pages')
        .select('ocr_data,page_number')
        .eq('book_id', tp.book_id)
        .eq('page_number', tp.page + offset)
        .single();
      if (n?.ocr_data && n.ocr_data.length > 100) neighbors.push(n);
    }

    // Prepare texts for embedding
    const texts = [];
    const labels = [];

    // 1. Production OCR (first 6000 chars to stay within token limits)
    texts.push(cleanText(page.ocr_data).slice(0, 6000));
    labels.push('ocr_production');

    // 2. Translation
    if (page.translation_data) {
      texts.push(cleanText(page.translation_data).slice(0, 6000));
      labels.push('translation');
    }

    // 3. Neighbors
    for (const n of neighbors) {
      texts.push(cleanText(n.ocr_data).slice(0, 6000));
      labels.push(`neighbor_p${n.page_number}`);
    }

    // Embed all
    let embeddings;
    try {
      embeddings = await embedTexts(texts);
    } catch (e) {
      console.log(`  ERROR embedding ${tp.label}: ${e.message}`);
      continue;
    }

    const embMap = {};
    labels.forEach((l, i) => { embMap[l] = embeddings[i]; });

    // Compute distances
    const result = {
      book_id: tp.book_id,
      page: tp.page,
      language: tp.language,
      label: tp.label,
      is_control: isControl,
      ocr_chars: page.ocr_data.length,
      ocr_model: page.ocr_model,
      translation_chars: page.translation_data?.length || 0,
      distances: {},
    };

    // OCR ↔ Translation
    if (embMap.translation) {
      result.distances.ocr_to_translation = +cosineDistance(embMap.ocr_production, embMap.translation).toFixed(4);
      result.distances.ocr_to_translation_sim = +cosineSimilarity(embMap.ocr_production, embMap.translation).toFixed(4);
    }

    // OCR ↔ Neighbors (average)
    const neighborKeys = labels.filter(l => l.startsWith('neighbor_'));
    if (neighborKeys.length > 0) {
      const neighborDists = neighborKeys.map(k => cosineDistance(embMap.ocr_production, embMap[k]));
      result.distances.ocr_to_neighbors_mean = +(neighborDists.reduce((a, b) => a + b, 0) / neighborDists.length).toFixed(4);
      result.distances.ocr_to_neighbors_max = +Math.max(...neighborDists).toFixed(4);
      result.distances.ocr_to_neighbors_min = +Math.min(...neighborDists).toFixed(4);
    }

    // Neighbor ↔ Neighbor (baseline intra-book variation)
    if (neighborKeys.length >= 2) {
      const nnDists = [];
      for (let i = 0; i < neighborKeys.length; i++) {
        for (let j = i + 1; j < neighborKeys.length; j++) {
          nnDists.push(cosineDistance(embMap[neighborKeys[i]], embMap[neighborKeys[j]]));
        }
      }
      result.distances.neighbor_to_neighbor_mean = +(nnDists.reduce((a, b) => a + b, 0) / nnDists.length).toFixed(4);
    }

    allResults.push(result);

    const tag = isControl ? 'CTRL' : 'HALL';
    console.log(`  ${tag} ${tp.language.padEnd(10)} ${tp.label.padEnd(25)} ${page.ocr_data.length.toString().padStart(8)} chars  ocr↔trans=${result.distances.ocr_to_translation?.toFixed(3) || '-'}  ocr↔neighbors=${result.distances.ocr_to_neighbors_mean?.toFixed(3) || '-'}  n↔n=${result.distances.neighbor_to_neighbor_mean?.toFixed(3) || '-'}`);

    await new Promise(r => setTimeout(r, 500));
  }

  // Analysis
  console.log('\n=== ANALYSIS ===\n');

  const hall = allResults.filter(r => !r.is_control);
  const ctrl = allResults.filter(r => r.is_control);

  console.log('Hypothesis 1: Hallucinated OCR is MORE similar to its translation');
  console.log('  (because both are generated text, not one perceived + one generated)\n');
  const hallOcrTrans = hall.filter(r => r.distances.ocr_to_translation != null).map(r => r.distances.ocr_to_translation);
  const ctrlOcrTrans = ctrl.filter(r => r.distances.ocr_to_translation != null).map(r => r.distances.ocr_to_translation);
  if (hallOcrTrans.length > 0) console.log(`  Hallucinated OCR↔Translation distance: ${(hallOcrTrans.reduce((a,b)=>a+b,0)/hallOcrTrans.length).toFixed(4)} (n=${hallOcrTrans.length})`);
  if (ctrlOcrTrans.length > 0) console.log(`  Control OCR↔Translation distance:      ${(ctrlOcrTrans.reduce((a,b)=>a+b,0)/ctrlOcrTrans.length).toFixed(4)} (n=${ctrlOcrTrans.length})`);
  if (hallOcrTrans.length > 0 && ctrlOcrTrans.length > 0) {
    const hallMean = hallOcrTrans.reduce((a,b)=>a+b,0)/hallOcrTrans.length;
    const ctrlMean = ctrlOcrTrans.reduce((a,b)=>a+b,0)/ctrlOcrTrans.length;
    console.log(`  Direction: hallucinated is ${hallMean < ctrlMean ? 'CLOSER (confirms hypothesis)' : 'FARTHER (rejects hypothesis)'}`);
  }

  console.log('\nHypothesis 2: Hallucinated OCR drifts from neighbors');
  console.log('  (fabricated content may be semantically unrelated to surrounding pages)\n');
  const hallNeighbor = hall.filter(r => r.distances.ocr_to_neighbors_mean != null).map(r => r.distances.ocr_to_neighbors_mean);
  const ctrlNeighbor = ctrl.filter(r => r.distances.ocr_to_neighbors_mean != null).map(r => r.distances.ocr_to_neighbors_mean);
  const hallNN = hall.filter(r => r.distances.neighbor_to_neighbor_mean != null).map(r => r.distances.neighbor_to_neighbor_mean);
  if (hallNeighbor.length > 0) console.log(`  Hallucinated OCR↔Neighbors distance:   ${(hallNeighbor.reduce((a,b)=>a+b,0)/hallNeighbor.length).toFixed(4)} (n=${hallNeighbor.length})`);
  if (ctrlNeighbor.length > 0) console.log(`  Control OCR↔Neighbors distance:        ${(ctrlNeighbor.reduce((a,b)=>a+b,0)/ctrlNeighbor.length).toFixed(4)} (n=${ctrlNeighbor.length})`);
  if (hallNN.length > 0) console.log(`  Baseline Neighbor↔Neighbor distance:   ${(hallNN.reduce((a,b)=>a+b,0)/hallNN.length).toFixed(4)} (intra-book variation)`);

  // Per-page detail
  console.log('\n=== PER-PAGE DETAIL ===\n');
  console.log(`${'Type'.padEnd(5)} ${'Language'.padEnd(10)} ${'OCR chars'.padStart(9)} ${'OCR↔Trans'.padStart(10)} ${'OCR↔Neigh'.padStart(10)} ${'N↔N base'.padStart(10)}`);
  console.log('-'.repeat(58));
  for (const r of allResults) {
    const tag = r.is_control ? 'CTRL' : 'HALL';
    console.log(`${tag.padEnd(5)} ${r.language.padEnd(10)} ${r.ocr_chars.toString().padStart(9)} ${(r.distances.ocr_to_translation?.toFixed(4) || '-').padStart(10)} ${(r.distances.ocr_to_neighbors_mean?.toFixed(4) || '-').padStart(10)} ${(r.distances.neighbor_to_neighbor_mean?.toFixed(4) || '-').padStart(10)}`);
  }

  // Save
  fs.writeFileSync('scripts/eval/results/embedding-hallucination-test.json', JSON.stringify({ results: allResults, meta: { date: new Date().toISOString() } }, null, 2));
  console.log('\nSaved: scripts/eval/results/embedding-hallucination-test.json');
}

run().catch(e => console.error(e));
