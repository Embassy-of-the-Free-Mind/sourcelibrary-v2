#!/usr/bin/env node
/**
 * Quick test of the agentic librarian — runs the tool-calling loop directly.
 * Usage: set -a; source .env.production.local; set +a; node scripts/tmp-test-librarian.mjs
 */

import { GoogleGenAI } from '@google/genai';

const MODEL = 'gemini-3-flash-preview';
const MAX_ROUNDS = 6;

// Minimal tool declarations (just search_collection and search_wikipedia for testing)
const TOOL_DECLARATIONS = [
  {
    name: 'search_collection',
    description: 'Search Source Library collection of rare books by keyword.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_wikipedia',
    description: 'Search Wikipedia for historical context.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Wikipedia search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'present_choices',
    description: 'Present 2-4 interpretation options when the question is ambiguous.',
    parameters: {
      type: 'OBJECT',
      properties: {
        preamble: { type: 'STRING', description: 'Brief intro' },
        options: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Options' },
      },
      required: ['preamble', 'options'],
    },
  },
];

// Stub tool execution (no DB needed)
async function executeTool(name, args) {
  if (name === 'search_wikipedia') {
    const query = args.query;
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
        { headers: { 'User-Agent': 'SourceLibrary/1.0' }, signal: AbortSignal.timeout(5000) },
      );
      if (res.ok) {
        const data = await res.json();
        return { found: 1, title: data.title, summary: data.extract?.slice(0, 800), url: data.content_urls?.desktop?.page };
      }
    } catch {}
    return { found: 0, summary: 'No article found.' };
  }
  if (name === 'search_collection') {
    // Stub — return fake result to show the loop works
    return { found: 0, context: 'No results found (test mode — no DB connection).' };
  }
  if (name === 'present_choices') {
    return { status: 'choices_presented' };
  }
  return { error: 'Unknown tool' };
}

const SYSTEM_PROMPT = `You are the Librarian of the Embassy of the Free Mind. You have deep knowledge of alchemy, Hermetica, Kabbalah, astrology, natural philosophy, Rosicrucianism, and early modern intellectual history.

When a user asks a question:
1. Think first — what historical concepts, authors, or traditions are relevant?
2. Search strategically — use tools to validate hypotheses
3. Be honest about what you find and don't find

Use present_choices when the question is genuinely ambiguous.`;

async function test(query) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`QUERY: ${query}`);
  console.log('='.repeat(60));

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const contents = [
    { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
    { role: 'model', parts: [{ text: 'I understand. Ready to help.' }] },
    { role: 'user', parts: [{ text: query }] },
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    console.log(`\n--- Round ${round + 1} ---`);

    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        temperature: 0.7,
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) { console.log('No parts returned'); break; }

    contents.push({ role: 'model', parts: candidate.content.parts });

    const functionCalls = candidate.content.parts.filter(p => p.functionCall);
    const textParts = candidate.content.parts.filter(p => p.text);

    for (const part of textParts) {
      if (part.text?.trim()) {
        if (functionCalls.length > 0) {
          console.log(`THINKING: ${part.text.slice(0, 200)}...`);
        } else {
          console.log(`RESPONSE:\n${part.text}`);
        }
      }
    }

    if (functionCalls.length === 0) break;

    const responseParts = [];
    for (const part of functionCalls) {
      const fc = part.functionCall;
      console.log(`TOOL: ${fc.name}(${JSON.stringify(fc.args)})`);
      const result = await executeTool(fc.name, fc.args || {});
      console.log(`RESULT: ${JSON.stringify(result).slice(0, 200)}`);
      responseParts.push({ functionResponse: { name: fc.name, response: result } });
    }
    contents.push({ role: 'user', parts: responseParts });
  }
}

// Run tests
await test('Are there any books about magic mushrooms?');
await test('What books explore resonance as magic?');
await test('What did Agrippa write about planetary seals?');

console.log('\nDone.');
