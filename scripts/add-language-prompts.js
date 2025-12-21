#!/usr/bin/env node
/**
 * Add Latin and German specialized prompts to the database
 * Run with: node scripts/add-language-prompts.js
 */

const prompts = [
  {
    name: 'Latin OCR (Neo-Latin)',
    type: 'ocr',
  },
  {
    name: 'Latin Translation (Neo-Latin)',
    type: 'translation',
  },
  {
    name: 'German OCR (Fraktur)',
    type: 'ocr',
  },
  {
    name: 'German Translation (Early Modern)',
    type: 'translation',
  },
];

async function addPrompts() {
  const baseUrl = process.env.NEXT_PUBLIC_URL || 'http://localhost:3000';

  // Fetch existing prompts to check what we already have
  const existingRes = await fetch(`${baseUrl}/api/prompts`);
  const existing = await existingRes.json();
  const existingNames = new Set(existing.map(p => p.name));

  console.log('Existing prompts:', existingNames);

  // Import the prompt content from types
  const { LATIN_PROMPTS, GERMAN_PROMPTS } = await import('../src/lib/types.ts');

  const fullPrompts = [
    { name: 'Latin OCR (Neo-Latin)', type: 'ocr', content: LATIN_PROMPTS.ocr },
    { name: 'Latin Translation (Neo-Latin)', type: 'translation', content: LATIN_PROMPTS.translation },
    { name: 'German OCR (Fraktur)', type: 'ocr', content: GERMAN_PROMPTS.ocr },
    { name: 'German Translation (Early Modern)', type: 'translation', content: GERMAN_PROMPTS.translation },
  ];

  for (const prompt of fullPrompts) {
    if (existingNames.has(prompt.name)) {
      console.log(`Skipping "${prompt.name}" - already exists`);
      continue;
    }

    console.log(`Adding "${prompt.name}"...`);
    const res = await fetch(`${baseUrl}/api/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prompt),
    });

    if (res.ok) {
      console.log(`  Added successfully`);
    } else {
      console.error(`  Failed:`, await res.text());
    }
  }

  console.log('Done!');
}

addPrompts().catch(console.error);
