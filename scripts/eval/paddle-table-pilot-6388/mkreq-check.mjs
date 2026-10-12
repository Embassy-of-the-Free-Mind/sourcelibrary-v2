// PRIOR ART: scripts/eval/paddle-table-6388/mkreview.mjs — same review prompt (review-prompt.txt, copied) and the same
// Opus suffix; no planted controls here (the by-image withhold sample checks the DETECTOR, not a reviewer).
// Usage: node mkreq-check.mjs <sample.json> <out.jsonl>
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const P = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'review-prompt.txt'), 'utf8');
const [, , SAMPLE, OUT] = process.argv;
const S = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
const suffix = '\n\nThe page image is the file ./page.jpg in the current directory. Open it with the Read tool (the only tool you may use), then reply with the JSON only.';
fs.writeFileSync(OUT, S.map((s) => JSON.stringify({ uid: s.uid, image: s.image, prompt: P.replace('{{TEXT}}', s.paddle) + suffix })).join('\n') + '\n');
console.log(OUT, S.length);
