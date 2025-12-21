#!/usr/bin/env node
/**
 * Sync prompts from types.ts to the database
 */

const fs = require('fs');
const path = require('path');

const typesPath = path.join(__dirname, '../src/lib/types.ts');
const ts = fs.readFileSync(typesPath, 'utf8');

// Helper to extract template literal content between backticks
function extractPrompt(varName, field) {
  // Find the variable definition first
  const varPattern = new RegExp(`export const ${varName}[^=]*= \\{`, 'm');
  const varMatch = ts.match(varPattern);
  if (!varMatch) return null;

  const startIdx = varMatch.index;
  const subset = ts.slice(startIdx);

  // Now find the field within this object
  const fieldPattern = new RegExp(`${field}: \`([\\s\\S]*?)\`(?:,|\\n\\s*\\})`, 'm');
  const match = subset.match(fieldPattern);
  return match ? match[1] : null;
}

// Extract all prompts
const prompts = {
  LATIN_OCR: extractPrompt('LATIN_PROMPTS', 'ocr'),
  LATIN_TRANSLATION: extractPrompt('LATIN_PROMPTS', 'translation'),
  GERMAN_OCR: extractPrompt('GERMAN_PROMPTS', 'ocr'),
  GERMAN_TRANSLATION: extractPrompt('GERMAN_PROMPTS', 'translation'),
  DEFAULT_OCR: extractPrompt('DEFAULT_PROMPTS', 'ocr'),
  DEFAULT_TRANSLATION: extractPrompt('DEFAULT_PROMPTS', 'translation'),
  DEFAULT_SUMMARY: extractPrompt('DEFAULT_PROMPTS', 'summary'),
};

// Debug: show what was extracted
console.log('Extracted prompts:');
for (const [key, val] of Object.entries(prompts)) {
  console.log(`  ${key}: ${val ? val.length + ' chars' : 'NOT FOUND'}`);
}

// Map to database IDs
const updates = [
  { id: '6942988af84d061181bc6348', name: 'Standard OCR', content: prompts.DEFAULT_OCR },
  { id: '6942988af84d061181bc6349', name: 'Standard Translation', content: prompts.DEFAULT_TRANSLATION },
  { id: '6947c99d49805f4750f69b8e', name: 'Latin OCR', content: prompts.LATIN_OCR },
  { id: '6947c99d49805f4750f69b8f', name: 'Latin Translation', content: prompts.LATIN_TRANSLATION },
  { id: '6947c99e49805f4750f69b90', name: 'German OCR', content: prompts.GERMAN_OCR },
  { id: '6947c99f49805f4750f69b91', name: 'German Translation', content: prompts.GERMAN_TRANSLATION },
];

async function main() {
  const baseUrl = process.env.API_URL || 'http://localhost:3000';

  for (const { id, name, content } of updates) {
    if (!content) {
      console.log(`${name}: SKIPPED (no content found)`);
      continue;
    }

    try {
      const res = await fetch(`${baseUrl}/api/prompts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (res.ok) {
        console.log(`${name}: updated (${content.length} chars)`);
      } else {
        const err = await res.text();
        console.log(`${name}: FAILED - ${err}`);
      }
    } catch (e) {
      console.log(`${name}: ERROR - ${e.message}`);
    }
  }
}

main();
