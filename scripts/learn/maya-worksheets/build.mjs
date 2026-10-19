#!/usr/bin/env node
// PRIOR ART: scripts/learn/maya-signs/ and scripts/learn/maya-blocks/ load the reference collections this reads;
// scripts/learn/build-maya-items.mjs builds the interactive /learn/maya item bank, which has no printable form.
// Neither picks a teaching set, so this script holds the picks and writes the printable sheets.
//
// Build the printable worksheets for /learn/maya/worksheets (#6921), in the Ts'íib style (Derek's Maya learning
// design system, ~/mayan/design-system). Glyphs are the Ts'íib vector traces in public/learn/maya/glyphs/:
//   stuart/  David Stuart, Maya Hieroglyph Syllabary (2013), traced from the `maya_signs` crops; permission
//            granted to Derek Lomas 2026-10-18 (recorded on #6903 and in maya_signs.rights).
//   twkm/    Logograms from the Bonn TWKM sign catalogue, drawings by Christian Prager, CC BY 4.0.
//   morley/  Day signs from Morley 1915, fig. 17 (codex forms), public domain.
// The Wayeb handbook drawings are not used: Ts'íib records them as not cleared for print.
// Every pick is pinned below, chosen by eye on contact sheets. Writes src/app/learn/maya/worksheets/sheets.json.
// Only the two Palenque sheets read Mongo (`maya_glyph_blocks`), and they are held (RIGHTS_PENDING).
//   node --env-file=.env.production.local scripts/learn/maya-worksheets/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { makeRng } from '../../eval/lib/paired-stats.mjs';

const OUT = new URL('../../../src/app/learn/maya/worksheets/sheets.json', import.meta.url);
const GLYPHS = new URL('../../../public/learn/maya/glyphs/', import.meta.url);
const WEB = '/learn/maya/glyphs/';

// Stuart syllabary: variant 1 unless named here (the clearer full-size form).
const VARIANT = { ha: 2, ki: 2, li: 2 };
const CONSONANTS = ["'", "b'", 'ch', "ch'", 'h', 'j', 'k', "k'", 'l', 'm', 'n', 'p', 's', 't', "t'", 'tz', "tz'", 'w', 'x', 'y'];
const VOWELS = ['a', 'e', 'i', 'o', 'u'];

// Look-alike pairs, Stuart's own forms (file stems), checked side by side.
const LOOKALIKE_PAIRS = [['bqa-1', 'ma-2'], ['lo-1', 'te-1'], ['bqu-2', 'mu-2'], ['e-1', 'bqi-1'],
  ['ja-1', 'i-1'], ['ni-1', 'wi-2'], ['kqu-1', 'chqa-1'], ['ti-1', 'tzqa-1']];

// TWKM logograms: [file stem, transliteration, meaning].
const LOGOGRAMS = [
  ['751st', 'BALAM', 'jaguar'], ['796st', 'CHIJ', 'deer'], ['1573st', 'TZ’I’', 'dog'], ['764st', 'KAN', 'snake'],
  ['544ex', 'K’IN', 'sun, day'], ['731bv', 'UH', 'moon'], ['510bv', 'EK’', 'star'], ['632st', 'MUYAL', 'cloud'],
  ['1516st', 'HA’', 'water'], ['1524st', 'TE’', 'tree, wood'], ['1531st', 'K’AB', 'hand'], ['1646st', 'CHAK', 'red'],
];

// The 20 day signs in calendar order: [file stem, name in Ts'íib spelling, meaning].
const DAYS = [
  ['imix', 'Imix', 'water lily, the earth'], ['ik', 'Ik’', 'wind, breath'], ['akbal', 'Ak’b’al', 'night'],
  ['kan', 'K’an', 'seed, ripe maize'], ['chikchan', 'Chikchan', 'serpent'], ['kimi', 'Kimi', 'death'],
  ['manik', 'Manik’', 'deer'], ['lamat', 'Lamat', 'star, Venus'], ['muluk', 'Muluk', 'water, jade'], ['ok', 'Ok', 'dog'],
  ['chuwen', 'Chuwen', 'monkey, craftsman'], ['eb', 'Eb’', 'road'], ['ben', 'B’en', 'reed, cornfield'], ['ix', 'Ix', 'jaguar'],
  ['men', 'Men', 'eagle'], ['kib', 'Kib’', 'wax'], ['kaban', 'Kab’an', 'earth'], ['etznab', 'Etz’nab’', 'flint'],
  ['kawak', 'Kawak', 'storm, rain'], ['ajaw', 'Ajaw', 'lord, sun'],
];

// Palenque blocks (ids in maya_glyph_blocks). Numbers: whole bar-and-dot coefficient on the drawing.
const NUMBER_BLOCKS = ['tfc-main-tablet-C8', 'tc-main-tablet-F6', 'tc-main-tablet-D3', 'tfc-main-tablet-D15',
  'tc-main-tablet-H17', 'tc-main-tablet-K12', 'tc-main-tablet-E9', 'tc-main-tablet-I2', 'ts-main-tablet-K2'];
const NUMBER_VALUE = { 'tfc-main-tablet-C8': 2, 'tc-main-tablet-F6': 2, 'tc-main-tablet-D3': 4, 'tfc-main-tablet-D15': 7,
  'tc-main-tablet-H17': 8, 'tc-main-tablet-K12': 8, 'tc-main-tablet-E9': 9, 'tc-main-tablet-I2': 9, 'ts-main-tablet-K2': 13 };
// Words spelled only with syllables, all of them in Stuart's chart.
const WORD_BLOCKS = ['tfc-main-tablet-C2', 'tc-main-tablet-E12', 'tc-main-tablet-C17', 'tfc-main-tablet-J2',
  'tfc-main-tablet-H14', 'tfc-main-tablet-F8', 'tfc-main-tablet-K3', 'tc-main-tablet-D17'];

// Held back until the drawings are cleared. The Palenque blocks are the sourcebook's main-tablet drawings, mostly
// Linda Schele's. Stuart's permission covers his sourcebook; the Schele drawings are copyrighted separately
// (Ancient Americas at LACMA asks for written permission to publish), and no permission is on record (#6921).
const RIGHTS_PENDING = new Set(['numbers-at-palenque', 'read-at-palenque']);

const CREDIT = {
  stuart: 'Syllable drawings © David Stuart, Maya Hieroglyph Syllabary (2013), used with permission; vector tracing by Source Library. These are Classic carved forms (about AD 700), not the painted forms of the codices.',
  twkm: 'Word-sign drawings by Christian Prager, Text Database and Dictionary of Classic Mayan (Bonn), CC BY 4.0.',
  morley: 'Day signs from Sylvanus G. Morley, An Introduction to the Study of the Maya Hieroglyphs (1915), fig. 17: the painted forms of the codices. Public domain.',
  palenque: 'Glyph blocks and readings from David Stuart, The Palenque Mythology: Inscriptions from the Cross Group at Palenque (2006), used with permission. Most drawings in the sourcebook are by Linda Schele.',
};

// Labels use modern Yucatec spelling (INALI 2014), as Ts'íib does: ts, not tz.
const label = (v) => v.replace(/tz/g, 'ts');

function svg(dir, stem) {
  const text = readFileSync(new URL(`${dir}/${stem}.svg`, GLYPHS), 'utf8');
  const [, , w, h] = text.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  return { src: `${WEB}${dir}/${stem}.svg`, w: Math.round(w), h: Math.round(h) };
}

const index = JSON.parse(readFileSync(new URL('stuart/index.json', GLYPHS), 'utf8'));
const stem = (s) => s.file.replace(/\.svg$/, '');
const signOf = (s) => ({ value: label(s.value), ...svg('stuart', stem(s)) });
const syl = {};
for (const s of index.signs) {
  if (s.uncertain) continue;
  if (s.variant === (VARIANT[s.value] ?? 1)) syl[s.value] = signOf(s);
}
const need = (v) => { const s = syl[v]; if (!s) throw new Error(`no Stuart sign for ${v}`); return s; };
const byStem = (st) => { const s = index.signs.find((x) => stem(x) === st); if (!s) throw new Error(`no Stuart file ${st}`); return signOf(s); };

// Deterministic shuffle, so a rebuild prints the same sheets.
function shuffle(arr, seed) {
  const a = [...arr];
  const rand = makeRng([...seed].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7));
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const chart = CONSONANTS.map((c) => ({
  consonant: c === "'" ? '' : label(c),
  cells: VOWELS.map((v) => { const val = c === "'" ? v : c + v; return syl[val] ?? { value: label(val), missing: true }; }),
}));

const sheets = [];
sheets.push({
  slug: 'syllable-chart', title: 'The syllable chart', level: 'Reference',
  intro: 'Maya scribes wrote with about 80 syllable signs, each a consonant plus a vowel. Here is one clear form of each, drawn by David Stuart. Keep this chart beside you. An empty square means no sign is securely known yet.',
  layout: 'chart', chart, credits: ['stuart'],
});
sheets.push({
  slug: 'first-signs', title: 'First signs', level: 'Level 1',
  intro: 'Write the sound of each sign on the line. Start with the five vowels, then use the chart for the rest.',
  layout: 'write', items: ['a', 'e', 'i', 'o', 'u', "b'a", 'ka', 'la', 'ma', 'na', 'ja', 'ya'].map((v) => ({ ...need(v), answer: label(v) })),
  credits: ['stuart'],
});
sheets.push({
  slug: 'copy-the-signs', title: 'Copy the signs', level: 'Level 1',
  intro: 'Draw each sign three times and say its sound aloud. Copy the outline first, then the details inside.',
  layout: 'trace', items: ['a', 'u', 'ka', 'ma', 'na', 'la', "b'a", 'ya', 'chi', 'ku'].map((v) => ({ ...need(v), answer: label(v) })),
  credits: ['stuart'],
});
const NUM_READ = [3, 7, 11, 14, 19, 5, 0, 8, 16, 12];
const NUM_DRAW = [4, 9, 13, 17, 10, 6];
sheets.push({
  slug: 'bars-and-dots', title: 'Bars and dots', level: 'Level 1',
  intro: 'A dot is one and a bar is five, so three bars and two dots make seventeen. The shell is zero. Write each number, then draw the numbers in part B.',
  layout: 'numerals', read: NUM_READ, draw: NUM_DRAW, credits: [],
});
const dayItems = shuffle(DAYS.map(([st, name, meaning]) => ({ value: name, ...svg('morley', st), answer: `${name}, “${meaning}”` })), 'days');
sheets.push({
  slug: 'day-signs', title: 'Day signs', level: 'Level 1',
  intro: 'The Maya calendar names each day with one of 20 signs, as they are painted in the codices. Write the name of each sign from the box.',
  layout: 'match', bank: DAYS.map((d) => d[1]), items: dayItems, credits: ['morley'],
});
sheets.push({
  slug: 'more-signs', title: 'More signs', level: 'Level 2',
  intro: 'Write the sound of each sign. Look at the details inside as well as the outline: many signs share the same rounded frame.',
  layout: 'write', items: ['chi', 'hu', "k'u", 'mo', 'pa', 'te', 'tu', 'wa', 'xa', 'yu', 'ku', 'li', 'ti', 'lo', 'ni'].map((v) => ({ ...need(v), answer: label(v) })),
  credits: ['stuart'],
});

// Find the sign: the right sign, Stuart forms that look like it, and same-vowel signs.
const LOOKALIKE = { ma: ["b'a", 'la'], te: ['lo'], ka: ['sa'], ni: ['wi'], ku: ['pi'], chi: ['ye', 'yo'], la: ['ma'], mu: ['yo', "b'u"], sa: ['ka'], yo: ['chi', 'mu'] };
sheets.push({
  slug: 'find-the-sign', title: 'Find the sign', level: 'Level 2',
  intro: 'Circle the sign that spells the sound on the left. One of the wrong choices often looks very like the right one.',
  layout: 'circle',
  items: Object.entries(LOOKALIKE).map(([v, alike]) => {
    const vowel = v.at(-1);
    const fill = shuffle(Object.keys(syl).filter((k) => k.endsWith(vowel) && k !== v && !alike.includes(k)), v).slice(0, 3 - alike.length);
    const options = shuffle([v, ...alike, ...fill], `${v}-opts`).map((k) => need(k));
    return { prompt: label(v), options, answer: 'ABCD'[options.findIndex((o) => o.value === label(v))] };
  }),
  credits: ['stuart'],
});
const variantCells = ['a', 'u', 'ma', 'ji', 'ka', 'na'];
sheets.push({
  slug: 'one-sound-many-signs', title: 'One sound, many signs', level: 'Level 2',
  intro: 'Scribes could spell the same syllable with different signs. Every sign here spells one of six sounds: a, u, ma, ji, ka, na. Write the sound under each.',
  layout: 'write',
  items: shuffle(index.signs.filter((s) => variantCells.includes(s.value) && !s.uncertain), 'variants').map((s) => ({ ...signOf(s), answer: label(s.value) })),
  credits: ['stuart'],
});
sheets.push({
  slug: 'tell-them-apart', title: 'Tell them apart', level: 'Level 2',
  intro: 'Each pair is two different syllables that are easy to mix up. Write the sound under each sign, then circle the detail that tells them apart.',
  layout: 'pairs',
  items: LOOKALIKE_PAIRS.map((pair) => { const signs = pair.map(byStem); return { signs, answer: signs.map((s) => s.value).join(' / ') }; }),
  credits: ['stuart'],
});

// Spelling. Final vowels are mostly silent: ka-ka-wa is read kakaw.
const READ_WORDS = [
  [['ka', 'ka', 'wa'], 'kakaw', 'cacao'], [["b'a", 'la', 'ma'], "b'ahlam", 'jaguar'], [['mo', 'o'], "mo'", 'macaw'],
  [['a', 'ku'], 'ahk', 'turtle'], [['pa', 'ka', 'la'], 'pakal', 'shield'], [["ch'o", 'ko'], "ch'ok", 'youth'],
];
sheets.push({
  slug: 'read-a-word', title: 'Read a word', level: 'Level 3',
  intro: 'Maya words are spelled syllable by syllable, and the vowel of the last syllable is usually silent: ka-ka-wa is read kakaw, “cacao”. Write the syllables, then the word. The meanings are in the box.',
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
  intro: 'Spell each word with signs from the chart, one sign per box. All five words are carved on the Cross Group tablets at Palenque.',
  layout: 'spell-write',
  items: WRITE_WORDS.map(([parts, word, gloss]) => ({ word, gloss, parts, answerSigns: parts.map(need) })),
  credits: ['stuart'],
});
const logoItems = LOGOGRAMS.map(([st, value, meaning]) => ({ value, ...svg('twkm', st), meaning, answer: `${value}, “${meaning}”` }));
sheets.push({
  slug: 'word-signs', title: 'Word signs', level: 'Level 3',
  intro: 'Some signs stand for a whole word. Write the meaning of each sign from the box. Look for the picture in the sign: the jaguar’s spots, the deer’s antler, the hand’s fingers.',
  layout: 'match', bank: shuffle(logoItems.map((l) => l.meaning), 'logo-bank'), items: shuffle(logoItems, 'logo'),
  credits: ['twkm'],
});

// The held Palenque sheets are only built (and Mongo only read) once their drawings are cleared.
if (!RIGHTS_PENDING.has('numbers-at-palenque') || !RIGHTS_PENDING.has('read-at-palenque')) {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const blocks = await client.db('bookstore').collection('maya_glyph_blocks')
    .find({ _id: { $in: [...NUMBER_BLOCKS, ...WORD_BLOCKS].map((c) => `palenque-mythology-2006:${c}`) } }).toArray();
  await client.close();
  const block = (c) => {
    const d = blocks.find((b) => b._id === `palenque-mythology-2006:${c}`);
    if (!d?.image) throw new Error(`block ${c} missing or without image`);
    return {
      id: c, src: d.image.url, w: d.image.w, h: d.image.h, monument: d.monument_name, coord: d.coord, page: d.printed_page,
      transliteration: d.transliteration, transcription: d.transcription, translation: d.translation.replace('AJaw', 'Ajaw'),
    };
  };
  sheets.push({
    slug: 'numbers-at-palenque', title: 'Numbers at Palenque', level: 'Level 4',
    intro: 'These blocks are carved on the Cross Group tablets at Palenque. Each begins with a bar-and-dot number. Write the number. The curls beside the dots are fillers that keep the block square, and they are not counted.',
    layout: 'blocks-number', items: NUMBER_BLOCKS.map((c) => ({ ...block(c), number: NUMBER_VALUE[c] })), credits: ['palenque'],
  });
  const wordItems = WORD_BLOCKS.map(block);
  const helper = [...new Set(wordItems.flatMap((b) => b.transliteration.replaceAll('’', "'").split('-')))].sort().map(need);
  sheets.push({
    slug: 'read-at-palenque', title: 'Read at Palenque', level: 'Level 4',
    intro: 'Each block spells one word with syllable signs only. The signs you need are in the strip, but on the tablets they are squeezed and joined together. Find them, then write the syllables and the word.',
    layout: 'blocks-word', helper, items: wordItems, credits: ['palenque', 'stuart'],
  });
}

const published = sheets.filter((s) => !RIGHTS_PENDING.has(s.slug)).map((s, i) => ({ ...s, number: i + 1 }));
writeFileSync(OUT, JSON.stringify({ credits: CREDIT, sheets: published }, null, 1) + '\n');
console.log(`${published.length} sheets (${RIGHTS_PENDING.size} held for rights); ${Object.keys(syl).length} syllables in the chart; wrote ${OUT.pathname}`);
