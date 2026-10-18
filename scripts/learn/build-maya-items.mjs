#!/usr/bin/env node
// PRIOR ART: src/app/api/learn/route.ts — builds vocab quizzes at request time from page <vocab> tags with no answer key a learner could check; this bank needs fixed items, each with its evidence and provenance. scripts/eval/INDEX.md and scripts/maintenance/ have no item-bank builder.
/**
 * Build the /learn/maya item bank (#6921) into the `learn_maya_items` collection.
 *
 * Input: scripts/learn/maya-item-sources.json (hand-measured crops, curated words).
 * Every gloss is pulled VERBATIM from the dictionary page's text (OCR + its
 * translation) at build time; every source line must occur verbatim in its
 * page's OCR or the item is refused. Nothing comes from model recall.
 *
 *   node --env-file=.env.production.local scripts/learn/build-maya-items.mjs            # dry run
 *   node --env-file=.env.production.local scripts/learn/build-maya-items.mjs --apply    # upsert
 *
 * Schema: scripts/learn/README.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const SRC = JSON.parse(fs.readFileSync(path.join(HERE, 'maya-item-sources.json'), 'utf8'));
const B = SRC.books;
const SITE = 'https://sourcelibrary.org';
const LEAF_URL = (leaf) => `https://images.sourcelibrary.org/archived/${B.dresden}/${leaf}.jpg`;
const PAGE_URL = (book, n) => `${SITE}/book/${book}?page=${n}`;
const DICT_NAME = {
  motul1: 'Diccionario de Motul (c. 1577), vol. 1',
  motul2: 'Diccionario de Motul (c. 1577), vol. 2',
  pioperez: 'Pío Pérez, Diccionario de la lengua maya (1866–77)',
};
const SOURCE_NAME = {
  chumayel: 'Chilam Balam of Chumayel',
  chumayel1913: 'Chilam Balam of Chumayel (1913 facsimile)',
  bacabs: 'Ritual of the Bacabs',
  castewar: 'Caste War letters, 1848–1850',
};
const DAY_SIGNS = ['Imix', 'Ik', 'Akbal', 'Kan', 'Chicchan', 'Cimi', 'Manik', 'Lamat', 'Muluc', 'Oc', 'Chuen', 'Eb', 'Ben', 'Ix', 'Men', 'Cib', 'Caban', 'Etznab', 'Cauac', 'Ahau'];
// One sentence each reveal leaves behind. A meaning is quoted only where Pío Pérez gives one
// (page cited); otherwise the sentence says what to look for, as painted in this bank's crops.
const DAY_TEACH = {
  Imix: 'Imix has short strokes hanging down to its lower edge.',
  Ik: 'Ik is the T-shaped mark, and ik means wind or breath (Pío Pérez, p. 197).',
  Akbal: 'Its name holds akab, night (Pío Pérez, p. 49).',
  Kan: 'kan also means yellow (Pío Pérez, p. 208).',
  Chicchan: 'Look for the cross-hatched patch; can is snake (Pío Pérez, p. 82).',
  Cimi: 'Cimi is the death sign: cimil is death (Pío Pérez, p. 91).',
  Manik: 'Manik is drawn as a hand.',
  Lamat: 'Lamat is split into four by a cross, with a small ring in each quarter.',
  Muluc: 'Muluc is a ring with a dot at its centre.',
  Oc: 'oc means foot, footprint (Pío Pérez, p. 295).',
  Chuen: 'Chuen comes right after Oc and before Eb.',
  Eb: 'eb means staircase (Pío Pérez, p. 139).',
  Ben: 'Ben has a band along its lower half crossed by upright strokes.',
  Ix: 'Ix is scattered with spots.',
  Men: 'men means craftsman (Pío Pérez, p. 261); the sign is an old face in profile.',
  Cib: 'cib means wax or candle (Pío Pérez, p. 89).',
  Caban: 'Its name holds cab, earth (Pío Pérez, p. 79).',
  Etznab: 'Etznab follows Caban and comes before Cauac.',
  Cauac: 'In this almanac Cauac carries an X-shaped mark.',
  Ahau: 'ahau means king, lord (Pío Pérez, p. 44).',
};
const NUMBER_PARTS = {
  oxlahun: 'Oxlahun is ox, three, and lahun, ten.',
  lahca: 'Lahca is lah(un), ten, and ca, two.',
  kal: 'Maya numbers count in twenties: hun kal is 20, ca kal is 40 (Motul, p. 480).',
};
const DIRECTIONS = 'In the Chumayel each direction has a colour: red in the east (lakin), white in the north (xaman), black in the west (chikin), yellow in the south (nohol).';
const NAMED_DAY = { ik: 'Ik', kan: 'Kan', eb: 'Eb', oc: 'Oc', men: 'Men', cib: 'Cib', ahau: 'Ahau' };
function explainNumeral(v) {
  if (v === 0) return 'the shell';
  const bars = Math.floor(v / 5), dots = v % 5;
  return [bars && `${bars} bar${bars > 1 ? 's' : ''}`, dots && `${dots} dot${dots > 1 ? 's' : ''}`].filter(Boolean).join(' and ');
}
function wordTeach(w) {
  if (NUMBER_PARTS[w.headword]) return NUMBER_PARTS[w.headword];
  if (w.number != null && w.number < 20) return `On the codex, ${w.number} is ${explainNumeral(w.number)}.`;
  if (['chac', 'zac', 'ek', 'lakin', 'chikin', 'xaman', 'nohol'].includes(w.headword)) return DIRECTIONS;
  if (NAMED_DAY[w.headword]) return `${NAMED_DAY[w.headword]} is also one of the twenty day signs.`;
  if (w.glyph) return `The day sign ${w.glyph} carries this word in its name.`;
  return null;
}

const STOP = new Set('the and for with its his her their that this from which into joined other various being kind thing things also more most same used called such some when what where who whom whose there then than are was were has have had not but per etc means proper endings counted kinds different language maya general may come formerly places again indians began another because marks distinct similar expressions meaning commonly rises rising'.split(' '));

// Same tag-stripping the reader applies before showing page text.
const strip = (s) => (s || '')
  .replace(/<(scan-quality|language|script|page-type|warning|meta|columns|page-num|header|vocab|summary|keywords|image-desc)[^>]*>[\s\S]*?<\/\1>/g, '')
  .replace(/<note>[\s\S]*?<\/note>/g, '')
  .replace(/<column-break\/>/g, '')
  .replace(/<\/?(term|gloss|unclear|insert|del|sup|i|b)[^>]*>/g, '')
  .replace(/\*\*/g, '')
  .replace(/^\|\s*/gm, '')
  .replace(/\s*\|\s*\|\s*\|?\s*\d*\s*\|?\s*$/gm, '');
const lines = (s) => strip(s).split('\n').map((l) => l.trim()).filter(Boolean);

function hashPick(id, pool, n) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const out = [];
  const p = [...pool];
  while (out.length < n && p.length) {
    h = Math.imul(h ^ (h >>> 13), 2246822519) >>> 0;
    out.push(p.splice(h % p.length, 1)[0]);
  }
  return out;
}

/** Content words of the first sense of an English gloss: what a typed answer is matched against. */
function glossKeywords(en, headword) {
  // All senses up to the first worked example (¶): "ZAC: the eleventh month | White" must accept "white".
  const body = en.replace(/^[^:]*:\s*/, '').split('¶')[0];
  const words = body.toLowerCase().replace(/\*[^*]*\*/g, ' ').match(/\p{L}{3,}/gu) || [];
  return [...new Set(words.filter((w) => !STOP.has(w) && w !== headword.toLowerCase()))].slice(0, 12);
}

function numeralDifficulty(n) {
  return (n.value < 5 ? 0 : n.value < 10 ? 1 : 2) + (n.color === 'red' ? 1 : 0) + (n.value === 0 ? 1 : 0);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const pageCache = new Map();
async function page(bookKey, n) {
  const k = `${bookKey}:${n}`;
  if (!pageCache.has(k)) {
    pageCache.set(k, await db.collection('pages').findOne(
      { book_id: B[bookKey], page_number: n },
      { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'translation.data': 1, 'translation.model': 1 } },
    ));
  }
  return pageCache.get(k);
}

const builtAt = new Date();
const provenance = { builder: 'scripts/learn/build-maya-items.mjs', issue: 6921, built_at: builtAt };
const items = [];
const refused = [];
const heldout = new Set(SRC.heldout);

for (const n of SRC.numerals) {
  items.push({
    _id: n.id,
    rung: 'numeral',
    order: numeralDifficulty(n) * 100 + items.length,
    status: heldout.has(n.id) ? 'heldout' : 'live',
    prompt: { kind: 'count', text: 'What number is this?' },
    image: { book_id: B.dresden, leaf: n.leaf, codex_page: n.codex_page, src: LEAF_URL(n.leaf), box: n.box, color: n.color },
    answer: { value: n.value },
    note: n.note || null,
    teach: n.value === 0 ? 'The shell is zero.' : `A bar is five and a dot is one: ${explainNumeral(n.value)} ${n.value === 1 || n.value === 5 ? 'makes' : 'make'} ${n.value}.`,
    ai: { reading: String(n.ai_value), confident: true, model: 'claude-opus-5-5', run: 'dresden-opus-test arm B (#6559)' },
    evidence: [
      { kind: 'leaf', label: `Dresden Codex, page ${n.codex_page}`, url: PAGE_URL(B.dresden, n.leaf) },
      { kind: 'forstemann', label: 'Förstemann, Commentary (1906)', url: PAGE_URL(B.forstemann, n.forstemann_page) },
    ],
    gold: { is_gold: true, basis: n.note ? 'forstemann-painted-value' : 'forstemann+arithmetic', checked_by_eye: true },
    links: {},
    provenance,
  });
}

for (const d of SRC.day_signs) {
  const dictPage = SRC.day_sign_dictionary_pages[d.sign];
  items.push({
    _id: d.id,
    rung: 'day-sign',
    order: items.length,
    status: heldout.has(d.id) ? 'heldout' : 'live',
    prompt: { kind: 'pick', text: 'Which day sign is this?', options: [d.sign, ...hashPick(d.id, DAY_SIGNS.filter((s) => s !== d.sign), 3)].sort() },
    image: { book_id: B.dresden, leaf: d.leaf, codex_page: d.codex_page, src: LEAF_URL(d.leaf), box: d.box, color: 'black' },
    answer: { sign: d.sign, coefficient: d.coefficient, position: DAY_SIGNS.indexOf(d.sign) + 1 },
    note: null,
    teach: DAY_TEACH[d.sign],
    ai: { reading: d.ai_sign + (d.ai_confident ? '' : '?'), confident: d.ai_confident, model: 'claude-opus-5-5', run: 'dresden-opus-test arm B (#6559)' },
    evidence: [
      { kind: 'leaf', label: `Dresden Codex, page ${d.codex_page}`, url: PAGE_URL(B.dresden, d.leaf) },
      { kind: 'forstemann', label: 'Förstemann, Commentary (1906)', url: PAGE_URL(B.forstemann, d.forstemann_page) },
      ...(dictPage ? [{ kind: 'dictionary', label: `${DICT_NAME.pioperez}, p. ${dictPage}`, url: PAGE_URL(B.pioperez, dictPage) }] : []),
    ],
    gold: { is_gold: true, basis: 'forstemann+arithmetic', checked_by_eye: true },
    links: {},
    provenance,
  });
}

for (const w of SRC.words) {
  const dp = await page(w.dict, w.dict_page);
  const es = dp && lines(dp.ocr?.data).find((l) => new RegExp(w.es_match, 'i').test(l));
  const en = dp && lines(dp.translation?.data).find((l) => new RegExp(w.en_match, 'i').test(l));
  const sp = await page(w.source.key, w.source.page);
  // Compared against the page text as the reader shows it (tags stripped), line by line.
  const srcOk = sp && lines(sp.ocr?.data).some((l) => l.includes(w.source.line));
  if (!es || !en || !srcOk) {
    refused.push({ id: w.id, es: !!es, en: !!en, source: !!srcOk });
    continue;
  }
  items.push({
    _id: w.id,
    rung: 'word',
    order: items.length,
    status: heldout.has(w.id) ? 'heldout' : 'live',
    prompt: { kind: 'gloss', text: 'What does this word mean?' },
    word: {
      headword: w.headword,
      form: w.form,
      source: {
        book_id: B[w.source.key], page_number: w.source.page, title: SOURCE_NAME[w.source.key],
        line: w.source.line, url: PAGE_URL(B[w.source.key], w.source.page),
      },
    },
    answer: { gloss_es: es, gloss_en: en, keywords: glossKeywords(en, w.headword), number: w.number ?? null },
    note: null,
    teach: wordTeach(w),
    ai: { reading: en.replace(/^[^:]*:\s*/, ''), confident: true, model: dp.translation?.model || null, run: 'site translation of the dictionary page' },
    evidence: [
      { kind: 'dictionary', label: `${DICT_NAME[w.dict]}, p. ${w.dict_page}`, url: PAGE_URL(B[w.dict], w.dict_page), text: es },
      { kind: 'source', label: `${SOURCE_NAME[w.source.key]}, p. ${w.source.page}`, url: PAGE_URL(B[w.source.key], w.source.page) },
    ],
    gold: { is_gold: false, basis: null, checked_by_eye: false },
    links: { glyph_sign: w.glyph || null },
    provenance,
  });
}

// Cross-links: a word that names a number or a day sign points at the crops that show it, and back.
const byRung = (r) => items.filter((i) => i.rung === r);
for (const w of byRung('word')) {
  if (w.answer.number != null) w.links.numeral_ids = byRung('numeral').filter((n) => n.answer.value === w.answer.number && n.status === 'live').map((n) => n._id).slice(0, 3);
  if (w.links.glyph_sign) w.links.day_sign_ids = byRung('day-sign').filter((d) => d.answer.sign === w.links.glyph_sign && d.status === 'live').map((d) => d._id).slice(0, 3);
}
for (const n of byRung('numeral')) {
  const w = byRung('word').find((x) => x.answer.number === n.answer.value);
  if (w) n.links.word_id = w._id;
}
for (const d of byRung('day-sign')) {
  const w = byRung('word').find((x) => x.links.glyph_sign === d.answer.sign);
  if (w) d.links.word_id = w._id;
}

const counts = items.reduce((a, i) => ((a[`${i.rung}/${i.status}`] = (a[`${i.rung}/${i.status}`] || 0) + 1), a), {});
console.log(JSON.stringify({ items: items.length, counts, refused }, null, 1));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(items, null, 1));

if (APPLY) {
  const col = db.collection('learn_maya_items');
  const ops = items.map(({ _id, ...doc }) => ({
    updateOne: { filter: { _id }, update: { $set: { ...doc, updated_at: builtAt }, $setOnInsert: { created_at: builtAt } }, upsert: true },
  }));
  const r = await col.bulkWrite(ops, { ordered: false });
  await col.createIndex({ rung: 1, status: 1, order: 1 });
  await db.collection('learn_maya_judgements').createIndex({ item_id: 1, created_at: -1 });
  await db.collection('learn_maya_judgements').createIndex({ 'learner.id': 1, created_at: -1 });
  console.log(`upserted ${r.upsertedCount}, modified ${r.modifiedCount}, matched ${r.matchedCount}`);
} else {
  console.log('dry run: pass --apply to write learn_maya_items');
}
await client.close();
