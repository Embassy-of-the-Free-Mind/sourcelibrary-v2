#!/usr/bin/env node
// PRIOR ART: scripts/learn/maya-signs/ and scripts/learn/maya-blocks/ load the reference collections this reads;
// scripts/learn/build-maya-items.mjs builds the interactive /learn/maya item bank, which has no printable form.
// Neither picks a teaching set, so this script holds the picks and writes the printable sheets.
//
// Build the printable worksheets for /learn/maya/worksheets (#6921) from `maya_signs` (David Stuart's
// syllabary; the Wayeb handbook for word signs and look-alike pairs) and `maya_glyph_blocks` (Palenque
// Cross Group blocks with Stuart's readings). Every pick is pinned by id below, chosen by eye on contact
// sheets: the clearest variant of each syllable, and only blocks whose signs are whole and unambiguous on
// the drawing. Read-only on Mongo; writes src/app/learn/maya/worksheets/sheets.json.
//   node --env-file=.env.production.local scripts/learn/maya-worksheets/build.mjs
import { writeFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { makeRng } from '../../eval/lib/paired-stats.mjs';

const OUT = new URL('../../../src/app/learn/maya/worksheets/sheets.json', import.meta.url);

// Stuart syllabary: variant 1 unless named here (the clearer full-size form).
const VARIANT = { ha: 2, ki: 2, li: 2 };
const CONSONANTS = ["'", "b'", 'ch', "ch'", 'h', 'j', 'k', "k'", 'l', 'm', 'n', 'p', 's', 't', "t'", 'tz', "tz'", 'w', 'x', 'y'];
const VOWELS = ['a', 'e', 'i', 'o', 'u'];

// Palenque blocks (ids in maya_glyph_blocks). Numbers: whole bar-and-dot coefficient on the drawing.
const NUMBER_BLOCKS = ['tfc-main-tablet-C8', 'tc-main-tablet-F6', 'tc-main-tablet-D3', 'tfc-main-tablet-D15',
  'tc-main-tablet-H17', 'tc-main-tablet-K12', 'tc-main-tablet-E9', 'tc-main-tablet-I2', 'ts-main-tablet-K2'];
const NUMBER_VALUE = { 'tfc-main-tablet-C8': 2, 'tc-main-tablet-F6': 2, 'tc-main-tablet-D3': 4, 'tfc-main-tablet-D15': 7,
  'tc-main-tablet-H17': 8, 'tc-main-tablet-K12': 8, 'tc-main-tablet-E9': 9, 'tc-main-tablet-I2': 9, 'ts-main-tablet-K2': 13 };
// Words spelled only with syllables, all of them in Stuart's chart.
const WORD_BLOCKS = ['tfc-main-tablet-C2', 'tc-main-tablet-E12', 'tc-main-tablet-C17', 'tfc-main-tablet-J2',
  'tfc-main-tablet-H14', 'tfc-main-tablet-F8', 'tfc-main-tablet-K3', 'tc-main-tablet-D17'];

// Wayeb word signs: [value, the translation line that identifies the entry, meaning to print].
const LOGOGRAMS = [
  ['AJAW', 'lord', 'lord, king'], ['K’IN-ni', 'sun', 'sun, day'], ['HA’', 'water', 'water'], ['BALAM', 'jaguar', 'jaguar'],
  ['CHAN', 'sky', 'sky'], ['IK’', 'wind', 'wind, breath'], ['K’AK’', 'fire', 'fire'], ['TE’', 'tree', 'tree, wood'],
  ['WITZ', 'mountain', 'mountain'], ['MO’', 'macaw', 'macaw'], ['AK', 'turtle', 'turtle'], ['YAX', 'blue-green', 'blue-green, first'],
];
// Wayeb look-alike rows that pair two syllables.
const CONFUSABLE_ROWS = ['row104-L', 'row104-R', 'row179-R', 'row247-R', 'row316-L', 'row316-R', 'row453-L', 'row179-L'];

const CREDIT = {
  stuart: 'Syllable drawings © David Stuart, Maya Hieroglyph Syllabary (2013), used with permission. These are Classic carved forms (about AD 700), not the painted forms of the codices.',
  wayeb: 'Sign drawings from Harri Kettunen and Christophe Helmke, Introduction to Maya Hieroglyphs: Workshop Handbook, 20th edition (Wayeb, 2025).',
  palenque: 'Glyph blocks and readings from David Stuart, The Palenque Mythology: Inscriptions from the Cross Group at Palenque (2006), used with permission. Most drawings in the sourcebook are by Linda Schele.',
};

const STUART_KEY = (v) => v.split("/")[0].replace(/^b(?!')/, "b'"); // Wayeb writes ba, Stuart b'a

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const signs = await db.collection('maya_signs').find({ empty: { $ne: true } }).toArray();
const blocks = await db.collection('maya_glyph_blocks').find({ _id: { $in: [...NUMBER_BLOCKS, ...WORD_BLOCKS].map((c) => `palenque-mythology-2006:${c}`) } }).toArray();
await client.close();

const img = (d) => ({ src: d.image.url, w: d.image.w, h: d.image.h });
const stuartAll = signs.filter((s) => s.source === 'stuart-syllabary-v2' && s.image);
const syl = {};
for (const s of stuartAll) {
  if (s.uncertain) continue;
  if (s.variant === (VARIANT[s.value] ?? 1)) syl[s.value] = { value: s.value, ...img(s) };
}
const need = (v) => { const s = syl[v]; if (!s) throw new Error(`no Stuart sign for ${v}`); return s; };

// Deterministic shuffle, so a rebuild prints the same sheets.
function shuffle(arr, seed) {
  const a = [...arr];
  const rand = makeRng([...seed].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7));
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const block = (c) => {
  const d = blocks.find((b) => b._id === `palenque-mythology-2006:${c}`);
  if (!d?.image) throw new Error(`block ${c} missing or without image`);
  return {
    id: c, ...img(d), monument: d.monument_name, coord: d.coord, page: d.printed_page,
    transliteration: d.transliteration, transcription: d.transcription, translation: d.translation.replace('AJaw', 'Ajaw'),
  };
};

const chart = CONSONANTS.map((c) => ({
  consonant: c === "'" ? '' : c,
  cells: VOWELS.map((v) => { const val = c === "'" ? v : c + v; return syl[val] ?? { value: val, missing: true }; }),
}));

const sheets = [];
sheets.push({
  slug: 'syllable-chart', title: 'The syllable chart', level: 'Reference',
  intro: 'Maya scribes wrote with about 80 syllable signs, each a consonant plus a vowel. This chart shows one clear form of each, drawn by David Stuart. Keep it beside you for the other sheets. Empty squares are syllables with no securely known sign.',
  layout: 'chart', chart, credits: ['stuart'],
});
sheets.push({
  slug: 'first-signs', title: 'First signs', level: 'Level 1',
  intro: 'Write the sound of each sign on the line. Start with the five vowels, then use the chart for the rest.',
  layout: 'write', items: ['a', 'e', 'i', 'o', 'u', "b'a", 'ka', 'la', 'ma', 'na', 'ja', 'ya'].map((v) => ({ ...need(v), answer: v })),
  credits: ['stuart'],
});
sheets.push({
  slug: 'more-signs', title: 'More signs', level: 'Level 2',
  intro: 'Write the sound of each sign. Look at the inside details as well as the outline: many signs share the same rounded frame.',
  layout: 'write', items: ['chi', 'hu', "k'u", 'mo', 'pa', 'te', 'tu', 'wa', 'xa', 'yu', 'ku', 'li', 'ti', 'lo', 'ni'].map((v) => ({ ...need(v), answer: v })),
  credits: ['stuart'],
});

// Find the sign: the right sign, its Wayeb look-alike when there is one, and same-vowel signs.
const LOOKALIKE = { ma: ["b'a", 'la'], te: ['lo'], ka: ['sa'], ni: ['wi'], ku: ['pi'], chi: ['ye', 'yo'], la: ['ma'], mu: ['yo', "b'u"], sa: ['ka'], yo: ['chi', 'mu'] };
sheets.push({
  slug: 'find-the-sign', title: 'Find the sign', level: 'Level 2',
  intro: 'Circle the sign that spells the sound on the left. One of the wrong choices is often a sign that looks very like the right one.',
  layout: 'circle',
  items: Object.entries(LOOKALIKE).map(([v, alike]) => {
    const vowel = v.at(-1);
    const fill = shuffle(Object.keys(syl).filter((k) => k.endsWith(vowel) && k !== v && !alike.includes(k)), v).slice(0, 3 - alike.length);
    const options = shuffle([v, ...alike, ...fill], `${v}-opts`).map((k) => need(k));
    return { prompt: v, options, answer: 'ABCD'[options.findIndex((o) => o.value === v)] };
  }),
  credits: ['stuart'],
});

const variantCells = ['a', 'u', 'ma', 'ji', 'ka', 'na'];
sheets.push({
  slug: 'one-sound-many-signs', title: 'One sound, many signs', level: 'Level 2',
  intro: 'Scribes could spell the same syllable with different signs. Every sign here spells one of these six sounds: a, u, ma, ji, ka, na. Write the sound under each.',
  layout: 'write',
  items: shuffle(stuartAll.filter((s) => variantCells.includes(s.value) && !s.uncertain), 'variants').map((s) => ({ value: s.value, ...img(s), answer: s.value })),
  credits: ['stuart'],
});

// Spelling. Final vowels are mostly silent: ka-ka-wa is read kakaw.
const READ_WORDS = [
  [['ka', 'ka', 'wa'], 'kakaw', 'cacao'], [["b'a", 'la', 'ma'], "b'ahlam", 'jaguar'], [['mo', 'o'], "mo'", 'macaw'],
  [['a', 'ku'], 'ahk', 'turtle'], [['pa', 'ka', 'la'], 'pakal', 'shield'], [["ch'o", 'ko'], "ch'ok", 'youth'],
];
sheets.push({
  slug: 'read-a-word', title: 'Read a word', level: 'Level 3',
  intro: 'Maya words are spelled syllable by syllable, and the vowel of the last syllable is usually not spoken: ka-ka-wa is read kakaw, “cacao”. Write the syllables, then the word. The meanings are in the box, in a different order.',
  layout: 'spell-read', bank: shuffle(READ_WORDS.map((w) => w[2]), 'bank'),
  items: READ_WORDS.map(([parts, word, gloss]) => ({ signs: parts.map(need), answer: `${parts.join('-')} → ${word}, “${gloss}”` })),
  credits: ['stuart'],
});
const WRITE_WORDS = [
  [['hu', 'li', 'ya'], 'huliiy', 'he arrived'], [['u', 'ti', 'ya'], 'uhtiiy', 'it happened'], [['yo', 'to', 'ti'], 'yotoot', 'his house'],
  [['ma', 'ta', 'wi', 'la'], 'Matwiil', 'a mythical place'], [["ch'a", 'jo', 'ma'], "ch'ajoom", 'he who scatters incense'],
];
sheets.push({
  slug: 'write-a-word', title: 'Write a word', level: 'Level 3',
  intro: 'Spell each word with signs from the chart, one sign per box. All five words are carved at Palenque, and you will meet them again on the last sheet.',
  layout: 'spell-write',
  items: WRITE_WORDS.map(([parts, word, gloss]) => ({ word, gloss, parts, answerSigns: parts.map(need) })),
  credits: ['stuart'],
});
sheets.push({
  slug: 'copy-the-signs', title: 'Copy the signs', level: 'Level 1',
  intro: 'Draw each sign three times, saying its sound aloud. Copy the outline first, then the details inside. Drawing a sign is the fastest way to remember it.',
  layout: 'trace', items: ['a', 'u', 'ka', 'ma', 'na', 'la', "b'a", 'ya', 'chi', 'ku'].map((v) => ({ ...need(v), answer: v })),
  credits: ['stuart'],
});

const conf = signs.filter((s) => s.kind === 'confusable');
sheets.push({
  slug: 'tell-them-apart', title: 'Tell them apart', level: 'Level 3',
  intro: 'Each pair is two different syllables that beginners often mix up. Write the sound under each sign, then circle the detail that tells them apart. Use the syllable chart to check.',
  layout: 'pairs',
  items: CONFUSABLE_ROWS.map((row) => {
    const pair = conf.filter((c) => c.confusable_group === row).sort((a, b) => a.variant - b.variant);
    return { signs: pair.map((c) => ({ value: STUART_KEY(c.value), ...img(c) })), answer: pair.map((c) => STUART_KEY(c.value)).join(' / ') };
  }),
  credits: ['wayeb'],
});

const logo = signs.filter((s) => s.kind === 'logogram' && !s.note);
const logoItems = LOGOGRAMS.map(([value, key, meaning]) => {
  const d = logo.find((s) => s.value === value && s.translation.some((t) => t.includes(key)));
  if (!d) throw new Error(`no Wayeb logogram ${value} (${key})`);
  return { value, ...img(d), meaning, answer: `${value} (${d.transcription.split(' ')[0]}), “${meaning}”` };
});
sheets.push({
  slug: 'word-signs', title: 'Word signs', level: 'Level 3',
  intro: 'Some signs stand for a whole word. Match each sign to its meaning from the box. Look for the picture in the sign: the macaw’s beak, the jaguar’s spots, the tree’s grain.',
  layout: 'match', bank: shuffle(logoItems.map((l) => l.meaning), 'logo-bank'), items: shuffle(logoItems, 'logo'),
  credits: ['wayeb'],
});

const NUM_READ = [3, 7, 11, 14, 19, 5, 0, 8, 16, 12];
const NUM_DRAW = [4, 9, 13, 17, 10, 6];
sheets.push({
  slug: 'bars-and-dots', title: 'Bars and dots', level: 'Level 1',
  intro: 'A dot is one and a bar is five, so three bars and two dots make seventeen. The shell is zero. Write each number, then draw the numbers in part B.',
  layout: 'numerals', read: NUM_READ, draw: NUM_DRAW, credits: [],
});
sheets.push({
  slug: 'numbers-at-palenque', title: 'Numbers at Palenque', level: 'Level 4',
  intro: 'These blocks are carved on the Cross Group tablets at Palenque. Each begins with a bar-and-dot number, set beside or above the main sign. Write the number. The curls and crescents beside the dots are fillers that keep the block square, and they are not counted.',
  layout: 'blocks-number', items: NUMBER_BLOCKS.map((c) => ({ ...block(c), number: NUMBER_VALUE[c] })), credits: ['palenque'],
});
const wordItems = WORD_BLOCKS.map(block);
const helper = [...new Set(wordItems.flatMap((b) => b.transliteration.replaceAll('’', "'").split('-')))].sort().map(need);
sheets.push({
  slug: 'read-at-palenque', title: 'Read at Palenque', level: 'Level 4',
  intro: 'Each block spells one word with syllable signs only. The signs you need are in the strip below, but on the tablets they are squeezed, turned and joined together. Find them in the block, then write the syllables and the word. Read a block left to right, then top to bottom.',
  layout: 'blocks-word', helper, items: wordItems, credits: ['palenque', 'stuart'],
});

writeFileSync(OUT, JSON.stringify({ built: new Date().toISOString().slice(0, 10), credits: CREDIT, sheets }, null, 1) + '\n');
console.log(`${sheets.length} sheets; ${Object.keys(syl).length} syllables in the chart; wrote ${OUT.pathname}`);
