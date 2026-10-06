#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/build-packet.mjs builds the blind FIDELITY packet (used here
// unchanged for that pass) and scripts/eval/xlref-t4/build-dims-packet.mjs an unblinded ours-vs-reference dimension
// packet. Neither builds a blind several-candidate dimension packet, nor a note-fact packet from the #5647 lane's
// candidate filter (scripts/lib/note-claims.mjs pageNotes), which are the two this writes.
/** Judge packets for #5698 v17: the blind dimension pass (one judge) and the note-fact pass (stage-1 candidates + 8 seeded false notes). */
import fs from 'node:fs';
import path from 'node:path';
import { pageNotes, noteAnchor } from '../../lib/note-claims.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { readJsonl, writeJsonl, itemId } from '../translation-vs-reference/common.mjs';

const DIR = new URL('../results/translation-prompt-v17-2026-10/', import.meta.url).pathname;
const OUT = path.join(DIR, 'work');
const rng = makeRng(5698);
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const recs = readJsonl(path.join(DIR, 'records.jsonl'));

// ── dimension packet: T-labels shuffled per item, items shuffled, 6 per chunk ──
const key = {}; const items = [];
for (const r of recs) {
  const id = itemId(r); const order = shuffle(r.candidates.map((c) => c.arm));
  key[id] = Object.fromEntries(order.map((arm, i) => [`T${i + 1}`, arm]));
  items.push({ id, lang: r.lang, reference_translator: r.reference_meta.translator, reference_year: r.reference_meta.year, reference_style: r.reference_meta.style,
    source: r.source_text, reference: r.reference_text, translations: Object.fromEntries(order.map((arm, i) => [`T${i + 1}`, r.candidates.find((c) => c.arm === arm).text])) });
}
const sh = shuffle(items); const chunks = [];
for (let i = 0; i < sh.length; i += 6) chunks.push(sh.slice(i, i + 6));
chunks.forEach((c, i) => writeJsonl(path.join(OUT, 'dims', 'packets', `dims-${String(i + 1).padStart(2, '0')}.jsonl`), c));
fs.mkdirSync(path.join(OUT, 'dims', 'verdicts'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'dims', 'key.json'), JSON.stringify(key, null, 1));
console.log(`dims: ${items.length} items in ${chunks.length} chunks`);

// ── note-fact packet: the lane's stage-1 candidates, typed non-claims excluded, identical notes checked once ──
const NOT_CLAIM = /^(original|alternative|clarification|image)\s*:/i;
const SEEDS = [ // false on purpose; written in the notes' own style. Never shipped anywhere.
  ['Latin', 'context: Hugo Grotius wrote De Jure Belli ac Pacis in 1725, while imprisoned in Loevestein Castle.'],
  ['Greek', 'context: Pausanias was a geographer of the fourth century BC, a pupil of Aristotle known for his Description of Greece.'],
  ['Hebrew', 'context: Rabbi David Kimchi, known as Radak, was a twelfth-century commentator born in Baghdad and a disciple of Rashi.'],
  ['Arabic', 'context: al-Biruni composed the Chronology of Ancient Nations in Cordoba, in the tenth century, for the caliph al-Hakam II.'],
  ['Persian', 'This refers to Saadi of Shiraz, author of the Gulistan, who was born in Herat and is known as the founder of the Naqshbandi order.'],
  ['Sanskrit', 'context: Bhaskara II, the author of the Lilavati, was a seventh-century astronomer who is known as the teacher of Aryabhata.'],
  ['Pali', 'The Anguttara Nikaya is the first of the five collections of the Sutta Pitaka and was composed in Sanskrit.'],
  ['Chinese', 'context: Zhuangzi was a Confucian philosopher of the Tang dynasty, identified by tradition as a disciple of Mencius.'],
];
const byNote = new Map();
for (const r of recs) for (const c of r.candidates) for (const n of pageNotes(c.text)) {
  if (NOT_CLAIM.test(n.note)) continue;
  // Extension (As executed): the #5624 cue filter was tuned on Tibetan notes and passes few here, so every
  // `context:` note and every untyped note of >= 40 chars is checked too, flagged `extra` and reported apart.
  const extra = !n.candidate;
  if (extra && !(/^context\s*:/i.test(n.note) || n.note.length >= 40)) continue;
  const k = `${itemId(r)}\u0000${n.note}`;
  if (!byNote.has(k)) byNote.set(k, { page: itemId(r), set: r.set, extra, lang: r.lang, book: r.reference_meta.title, anchor: noteAnchor(c.text, n.offset), note: n.note, source: r.source_text, arms: [] });
  byNote.get(k).arms.push(c.arm);
}
const real = [...byNote.values()];
const seeds = SEEDS.map(([lang, note]) => { const r = recs.find((x) => x.lang === lang); return { page: itemId(r), set: 'seed', lang, book: r.reference_meta.title, anchor: '', note, source: r.source_text, arms: [], seed: true }; });
const all = shuffle([...real, ...seeds]).map((x, i) => ({ id: `n${String(i + 1).padStart(3, '0')}`, ...x }));
const nchunks = Math.ceil(all.length / 45);
for (let i = 0; i < nchunks; i++) writeJsonl(path.join(OUT, 'facts', 'packets', `facts-${i + 1}.jsonl`), all.slice(i * 45, (i + 1) * 45).map(({ id, lang, book, anchor, note, source }) => ({ id, lang, book, anchor, note, source })));
fs.mkdirSync(path.join(OUT, 'facts', 'verdicts'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'facts', 'key.json'), JSON.stringify(all.map(({ source, ...x }) => x), null, 1));
const per = {}; for (const x of real) for (const a of x.arms) { const k = `${a}${x.extra ? ' (extra)' : ''}`; per[k] = (per[k] || 0) + 1; }
console.log(`facts: ${real.length} distinct candidate notes + ${seeds.length} seeds in ${nchunks} chunk(s); per arm`, per);
