#!/usr/bin/env node
// Lists answers that quote or name a source (#8142). They are not edited: analyze.mjs reports them and runs a sensitivity without them.
// PRIOR ART: none for this shape; quote-check in src/lib compares a claimed quote to one page, and here there is no claim.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, readJsonl } from './lib.mjs';

const NAMES = /\b(Aristotle|Plato|Socrates|Confucius|Mencius|Laozi|Lao Tzu|Zhuangzi|Seneca|Cicero|Marcus Aurelius|Epictetus|Aquinas|Augustine|Boethius|Kant|Montaigne|Maimonides|Rumi|Buddha|Bible|Scripture|Quran|Qur'an|Torah|Talmud|Proverbs|Ecclesiastes|Gita|Upanishad|Dhammapada|Tao Te Ching|Analects)\b/;
const ALLUSION = /\b(the (old|ancient) (texts?|books?|writers?|authors?)|the passages?|the texts? (you|I)|as (one|an) (old|ancient) (writer|author|text)|an old (proverb|saying|text|book)|ancient (wisdom|text))\b/i;
const toks = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);

const passages = readJsonl(path.join(OUT, 'passages-test.jsonl'));
const answers = readJsonl(path.join(OUT, 'answers-test.jsonl'));
const out = path.join(OUT, 'detector.jsonl');
fs.writeFileSync(out, '');
const counts = {};
for (const a of answers) {
  const flags = [];
  const n = a.text.match(NAMES); if (n) flags.push(`names:${n[0]}`);
  const al = a.text.match(ALLUSION); if (al) flags.push(`allusion:${al[0]}`);
  const ps = passages.filter((p) => p.dilemma === a.dilemma && p.arm === a.arm);
  for (const p of ps) {
    const mentions = [p.author, p.title].filter(Boolean).flatMap((s) => toks(s)).filter((t) => t.length >= 6 && !['unknown', 'author', 'anonymous', 'volume', 'editor', 'edition', 'translated', 'concerning', 'general', 'history', 'second', 'treatise'].includes(t));
    const at = toks(a.text);
    const hit = mentions.find((m) => at.includes(m) && /^[A-Z]/.test(a.text.match(new RegExp(`\\b${m}\\b`, 'i'))?.[0] || ''));
    if (hit) flags.push(`source-word:${hit}`);
    // A run of six words shared with a passage it was given.
    const pt = toks(p.text).join(' ');
    for (let i = 0; i + 6 <= at.length; i++) { const g = at.slice(i, i + 6).join(' '); if (pt.includes(g)) { flags.push(`verbatim:${g}`); break; } }
  }
  fs.appendFileSync(out, JSON.stringify({ dilemma: a.dilemma, arm: a.arm, flags }) + '\n');
  if (flags.length) counts[a.arm] = (counts[a.arm] || 0) + 1;
}
console.log('flagged by arm', counts);
