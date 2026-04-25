#!/usr/bin/env node
/**
 * Two experiments:
 *
 * Exp A: Stochasticity — run the same page 10x with identical config to
 *        quantify hallucination probability per run.
 *
 * Exp B: Flash + thinking:HIGH — does forcing HIGH on Flash (which already
 *        thinks by default at ~7700 tokens) further reduce hallucination?
 *
 * Exp C: maxOutputTokens cap — does setting maxOutputTokens=4000 prevent
 *        hallucination by hard-stopping generation? (Free fix?)
 */

import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

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
const PROMPT = 'Transcribe ALL text visible in this image using the appropriate Unicode script. Output ONLY the raw text. No commentary, no translation, no labels, no markdown.';

let keys = [...new Set(Object.entries(process.env).filter(([k]) => k.startsWith('GEMINI_API_KEY')).map(([,v]) => v))];
let ki = 0;

async function callGemini(model, imageBuffer, { thinking = null, maxTokens = 16000 } = {}) {
  const apiKey = keys[ki++ % keys.length];
  const genConfig = { temperature: 0, maxOutputTokens: maxTokens };
  if (thinking) genConfig.thinkingConfig = { thinkingLevel: thinking };

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: PROMPT },
          { inline_data: { mime_type: 'image/jpeg', data: imageBuffer.toString('base64') } },
        ]}],
        generationConfig: genConfig,
      }),
    }
  );
  if (resp.status === 429) { await new Promise(r => setTimeout(r, 15000)); throw new Error('RATE_LIMITED'); }
  const data = await resp.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => p.text && !p.thought).map(p => p.text).join('') || parts[0]?.text || '';
  const usage = data.usageMetadata || {};
  return { chars: text.length, thinkTokens: usage.thoughtsTokenCount || 0, finishReason: data.candidates?.[0]?.finishReason };
}

async function getImage(bookId, page) {
  const local = `/tmp/study2-images/${bookId}_p${page}.jpg`;
  if (fs.existsSync(local)) return fs.readFileSync(local);
  const { data } = await sb.from('pages').select('archived_photo,photo').eq('book_id', bookId).eq('page_number', page).single();
  const url = data?.archived_photo || data?.photo || `https://images.sourcelibrary.org/archived/${bookId}/${page}.jpg`;
  const r = await fetch(url);
  return Buffer.from(await r.arrayBuffer());
}

async function run() {
  // Use Hebrew Mikra'ot Gedolot p160 — known hallucinator on Lite
  const bookId = '69924401bc722ec0ee80b312';
  const page = 160;
  const img = await getImage(bookId, page);
  console.log(`Image: ${(img.length/1024).toFixed(0)}KB\n`);

  // ── Exp A: Stochasticity (10 runs, Lite, no thinking) ──
  console.log('=== EXP A: STOCHASTICITY (Lite, no thinking, 10 runs) ===\n');
  const stochResults = [];
  for (let i = 0; i < 10; i++) {
    try {
      const r = await callGemini('gemini-3.1-flash-lite-preview', img);
      stochResults.push(r);
      const hall = r.chars > 10000 ? 'HALL' : 'OK';
      console.log(`  Run ${(i+1).toString().padStart(2)}: ${r.chars.toString().padStart(7)} chars  ${hall}`);
    } catch (e) {
      console.log(`  Run ${(i+1).toString().padStart(2)}: ERROR ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  const hallCount = stochResults.filter(r => r.chars > 10000).length;
  const chars = stochResults.map(r => r.chars).sort((a,b) => a-b);
  console.log(`\n  Hallucination rate: ${hallCount}/${stochResults.length} (${(hallCount/stochResults.length*100).toFixed(0)}%)`);
  console.log(`  Char range: ${chars[0]} - ${chars[chars.length-1]}`);
  console.log(`  Median: ${chars[Math.floor(chars.length/2)]}`);

  // ── Exp B: Flash + explicit thinking:HIGH ──
  console.log('\n=== EXP B: FLASH + THINKING:HIGH (5 runs each) ===\n');
  console.log('Does forcing HIGH on Flash (which defaults to ~7700 think tokens) help?\n');

  for (const config of [
    { label: 'Flash default', model: 'gemini-3-flash-preview', thinking: null },
    { label: 'Flash + HIGH', model: 'gemini-3-flash-preview', thinking: 'HIGH' },
  ]) {
    const results = [];
    for (let i = 0; i < 5; i++) {
      try {
        const r = await callGemini(config.model, img, { thinking: config.thinking });
        results.push(r);
        const hall = r.chars > 10000 ? 'HALL' : 'OK';
        console.log(`  ${config.label.padEnd(16)} run ${i+1}: ${r.chars.toString().padStart(7)} chars  think=${r.thinkTokens.toString().padStart(6)}  ${hall}`);
      } catch (e) {
        console.log(`  ${config.label.padEnd(16)} run ${i+1}: ERROR`);
      }
      await new Promise(r => setTimeout(r, 500));
    }
    const hc = results.filter(r => r.chars > 10000).length;
    console.log(`  → ${config.label}: ${hc}/${results.length} hallucinated\n`);
  }

  // ── Exp C: maxOutputTokens cap ──
  console.log('=== EXP C: maxOutputTokens CAP (Lite, no thinking) ===\n');
  console.log('Does hard-capping output prevent hallucination or just truncate it?\n');

  for (const maxT of [2000, 4000, 8000, 16000]) {
    const results = [];
    for (let i = 0; i < 3; i++) {
      try {
        const r = await callGemini('gemini-3.1-flash-lite-preview', img, { maxTokens: maxT });
        results.push(r);
        console.log(`  maxTokens=${maxT.toString().padEnd(6)} run ${i+1}: ${r.chars.toString().padStart(7)} chars  finish=${r.finishReason}`);
      } catch (e) {
        console.log(`  maxTokens=${maxT.toString().padEnd(6)} run ${i+1}: ERROR`);
      }
      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.log('\nDone.');
}

run().catch(e => console.error(e));
