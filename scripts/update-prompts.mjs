import { DEFAULT_PROMPTS, LATIN_PROMPTS, GERMAN_PROMPTS } from '../src/lib/types.ts';

const updates = [
  { id: '6942988af84d061181bc6348', name: 'Standard OCR', content: DEFAULT_PROMPTS.ocr },
  { id: '6942988af84d061181bc6349', name: 'Standard Translation', content: DEFAULT_PROMPTS.translation },
  { id: '6942988af84d061181bc634a', name: 'Standard Summary', content: DEFAULT_PROMPTS.summary },
  { id: '6947c99d49805f4750f69b8e', name: 'Latin OCR', content: LATIN_PROMPTS.ocr },
  { id: '6947c99d49805f4750f69b8f', name: 'Latin Translation', content: LATIN_PROMPTS.translation },
  { id: '6947c99e49805f4750f69b90', name: 'German OCR', content: GERMAN_PROMPTS.ocr },
  { id: '6947c99f49805f4750f69b91', name: 'German Translation', content: GERMAN_PROMPTS.translation },
];

for (const { id, name, content } of updates) {
  const res = await fetch(`http://localhost:3000/api/prompts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  console.log(`${name}: ${res.ok ? 'updated' : 'FAILED'}`);
}
