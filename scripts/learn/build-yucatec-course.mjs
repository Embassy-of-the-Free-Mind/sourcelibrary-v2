#!/usr/bin/env node
// PRIOR ART: scripts/learn/build-maya-items.mjs — builds the /learn/maya item bank into Mongo from hand-measured crops; this course is a fixed set of units and lessons that ships with the page, so it is checked the same way (verbatim against page text) but written to a JSON file, not a collection.
/**
 * Build the /learn/yucatec course (#6921) into src/data/learn-yucatec-course.json.
 *
 * Input: scripts/learn/yucatec-course-sources.json (hand-picked lines and words).
 * Every sentence must occur verbatim in its page's text as the reader shows it;
 * every gloss is pulled VERBATIM from the dictionary page (OCR line + its
 * translation line); every page a sentence or word comes from must carry an
 * image check in `page_checks`. Anything that fails is refused and the build
 * exits non-zero. Nothing comes from model recall.
 *
 *   node --env-file=.env.production.local scripts/learn/build-yucatec-course.mjs           # check only
 *   node --env-file=.env.production.local scripts/learn/build-yucatec-course.mjs --write   # write the JSON
 *
 * Schema: scripts/learn/README.md (Yucatec section)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '../../src/data/learn-yucatec-course.json');
const WRITE = process.argv.includes('--write');
const SRC = JSON.parse(fs.readFileSync(path.join(HERE, 'yucatec-course-sources.json'), 'utf8'));
const B = SRC.books;

// Same tag-stripping the reader applies before showing page text, plus markdown marks.
const stripTags = (s) => (s || '')
  .replace(/<(scan-quality|language|script|page-type|warning|meta|columns|page-num|header|vocab|summary|keywords|image-desc|sig|margin)[^>]*>[\s\S]*?<\/\1>/g, '')
  .replace(/<note>[\s\S]*?<\/note>/g, '')
  .replace(/<column-break\/>/g, '')
  .replace(/<\/?(term|gloss|unclear|insert|del|sup|i|b)[^>]*>/g, '');
const plainLine = (l) => l
  .replace(/\*\*/g, '').replace(/\*/g, '')
  .replace(/^#+\s*/, '').replace(/^>\s*/, '').replace(/^->|<-$/g, '')
  .replace(/^\|\s*/, '').replace(/\s*\|\s*\|?\s*\d*\s*\|?\s*$/, '')
  .replace(/\s+/g, ' ').trim();
const linesOf = (s) => stripTags(s).split('\n').map(plainLine).filter(Boolean);
const flat = (s) => s.replace(/\s+/g, ' ').trim();
const STOP = new Set('the and for with its his her one who that this from into are was has have not but per etc ending endings'.split(' '));
const contentWords = (s) => (s.toLowerCase().match(/\p{L}{3,}/gu) || []).filter((w) => !STOP.has(w));

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');

const pageCache = new Map();
async function page(key, n) {
  const k = `${key}:${n}`;
  if (!pageCache.has(k)) {
    if (!B[key]) throw new Error(`unknown book key ${key}`);
    const p = await db.collection('pages').findOne(
      { book_id: B[key].id, page_number: n },
      { projection: { 'ocr.data': 1, 'translation.data': 1 } },
    );
    if (!p) throw new Error(`no page ${k}`);
    const ocr = p.ocr?.data || '';
    const tr = p.translation?.data || '';
    pageCache.set(k, {
      raw: flat(ocr),
      ocrLines: linesOf(ocr),
      ocrFlat: flat(linesOf(ocr).join(' ')),
      trLines: linesOf(tr),
      trFlat: flat(linesOf(tr).join(' ')),
    });
  }
  return pageCache.get(k);
}

const refused = [];
const refuse = (id, why) => refused.push(`${id}: ${why}`);
const url = (key, n) => `/book/${B[key].id}?page=${n}`;
const checked = (key, n) => SRC.page_checks[`${key}:${n}`] || null;

/** A dictionary entry: the OCR line whose start matches `head`, and its translation line. */
async function dictEntry(id, d) {
  const p = await page(d.key, d.page);
  const re = new RegExp(d.head, 'u');
  const hits = p.ocrLines.filter((l) => re.test(l));
  if (hits.length !== 1) { refuse(id, `${hits.length} OCR lines match ${d.head} on ${d.key} p.${d.page}`); return null; }
  const es = hits[0];
  let en;
  if (d.en_excerpt) {
    en = p.trLines.find((l) => l.includes(d.en_excerpt));
  } else {
    // The translation keeps the headword: match it, and the same position among lines sharing it.
    const prefix = (es.match(/^[^:]{1,40}:/) || es.match(/^[^.,]{1,30}[.,]/) || [''])[0];
    const sameEs = p.ocrLines.filter((l) => l.startsWith(prefix));
    const sameEn = p.trLines.filter((l) => l.startsWith(prefix));
    if (prefix && sameEs.length === sameEn.length) en = sameEn[sameEs.indexOf(es)];
  }
  if (!en) { refuse(id, `no translation line for "${es.slice(0, 50)}" on ${d.key} p.${d.page}`); return null; }
  if (d.es_excerpt && !es.includes(d.es_excerpt)) { refuse(id, `es_excerpt not in "${es.slice(0, 60)}"`); return null; }
  return {
    key: d.key,
    page: d.page,
    url: url(d.key, d.page),
    es: d.es_excerpt || es,
    en: d.en_excerpt || en.replace(/\s+([.,;:])/g, '$1'),
  };
}

const words = [];
const wordIds = new Set();
for (const w of SRC.words) {
  if (wordIds.has(w.id)) { refuse(w.id, 'duplicate id'); continue; }
  wordIds.add(w.id);
  const dict = await dictEntry(w.id, w.dict);
  if (!dict) continue;
  const enLow = dict.en.toLowerCase();
  const need = w.keywords || contentWords(w.short);
  const missing = need.filter((k) => !enLow.includes(k.toLowerCase()));
  if (missing.length) { refuse(w.id, `short gloss words not in the dictionary's English: ${missing.join(', ')} | ${dict.en}`); continue; }
  const a = w.attest;
  const ap = await page(a.key, a.page);
  if (!ap.ocrFlat.includes(flat(a.text)) && !ap.raw.includes(flat(a.text))) { refuse(w.id, `attestation "${a.text}" not on ${a.key} p.${a.page}`); continue; }
  if (!checked(a.key, a.page)) { refuse(w.id, `no image check recorded for ${a.key} p.${a.page}`); continue; }
  let dresden = null;
  if (w.dresden) {
    const item = await db.collection('learn_maya_items').findOne({ _id: w.dresden }, { projection: { 'answer.value': 1, image: 1, status: 1, 'gold.checked_by_eye': 1 } });
    if (!item || item.answer?.value !== w.number || !item.image?.crop_url) { refuse(w.id, `Dresden crop ${w.dresden} missing or not ${w.number}`); continue; }
    dresden = { item_id: w.dresden, value: item.answer.value, crop_url: item.image.crop_url, codex_page: item.image.codex_page, url: url('dresden', item.image.leaf), color: item.image.color };
  }
  words.push({
    id: w.id,
    form: w.form,
    short: w.short,
    number: w.number ?? null,
    note: w.note ?? null,
    source_note: w.source_note ?? null,
    note_ref: w.note_ref ? { ...w.note_ref, url: url(w.note_ref.key, w.note_ref.page) } : null,
    dict,
    attest: { key: a.key, page: a.page, url: url(a.key, a.page), text: a.text, form: a.form || w.form, checked: checked(a.key, a.page) },
    dresden,
    modern: null,
  });
}

const sentences = [];
for (const s of SRC.sentences) {
  const p = await page(s.key, s.page);
  if (!p.ocrFlat.includes(flat(s.maya))) { refuse(s.id, `"${s.maya}" not in ${s.key} p.${s.page} OCR`); continue; }
  if (s.es && !p.ocrFlat.includes(flat(s.es))) { refuse(s.id, `Spanish "${s.es}" not on the page`); continue; }
  if (!p.trFlat.includes(flat(s.en))) { refuse(s.id, `English "${s.en}" not in the page's translation`); continue; }
  if (!checked(s.key, s.page)) { refuse(s.id, `no image check recorded for ${s.key} p.${s.page}`); continue; }
  const bad = (s.words || []).filter((id) => !wordIds.has(id));
  if (bad.length) { refuse(s.id, `unknown words ${bad.join(', ')}`); continue; }
  if (s.fill && !s.words.includes(s.fill)) { refuse(s.id, 'fill word not among its words'); continue; }
  if (s.fill) {
    const wf = SRC.words.find((w) => w.id === s.fill);
    const shown = s.show || s.maya;
    const form = wf.attest.key === s.key && wf.attest.page === s.page && wf.attest.form ? wf.attest.form : wf.form;
    if (!new RegExp(`(^|[\\s,.;:¿?¡!])${form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s,.;:?!])`, 'iu').test(shown)) { refuse(s.id, `fill word "${form}" is not a whole word in "${shown}"`); continue; }
  }
  if (s.fill_text) {
    const ft = s.fill_text;
    const esc = ft.blank.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`(^|[\\s,.;:])${esc}(?=$|[\\s,.;:?!])`, 'iu').test(s.show || s.maya)) { refuse(s.id, `blank "${ft.blank}" is not a whole word`); continue; }
    if (ft.choices[0].text !== ft.blank || ft.choices.some((c) => !wordIds.has(c.word))) { refuse(s.id, 'fill_text choices: first must be the blank, all must name a word'); continue; }
  }
  if (s.tiles) {
    const target = flat(s.show || s.maya);
    if (!target.includes(s.tiles.join(' '))) { refuse(s.id, `tiles "${s.tiles.join(' ')}" are not a run of "${target}"`); continue; }
  }
  sentences.push({
    id: s.id,
    key: s.key,
    page: s.page,
    url: url(s.key, s.page),
    maya: s.maya,
    show: s.show || s.maya,
    show_note: s.show_note || null,
    es: s.es || null,
    en: s.en,
    en_short: s.en_short || null,
    words: s.words,
    tiles: s.tiles || null,
    tiles_en: s.tiles_en || null,
    rule: s.rule || null,
    fill: s.fill || null,
    fill_text: s.fill_text || null,
    checked: checked(s.key, s.page),
  });
}

// Every Maya word a learner can meet in the course, for checking a note's examples.
const KNOWN = new Set([
  ...SRC.words.flatMap((w) => [w.form, w.attest.form || w.form]),
  ...sentences.flatMap((s) => s.show.split(/\s+/)),
].map((t) => t.toLowerCase().replace(/[.,;:¿?¡!]/g, '')));

const notes = [];
for (const n of SRC.notes) {
  const quotes = [];
  for (const q of n.quotes) {
    const p = await page(q.key, q.page);
    if (q.es && !p.ocrFlat.includes(flat(q.es))) { refuse(n.id, `quote "${q.es.slice(0, 40)}" not on ${q.key} p.${q.page}`); continue; }
    const enHay = p.trFlat.length > 50 ? p.trFlat : p.ocrFlat;
    if (q.en && !enHay.includes(flat(q.en)) && !p.ocrFlat.includes(flat(q.en))) { refuse(n.id, `quote "${q.en.slice(0, 40)}" not on ${q.key} p.${q.page}`); continue; }
    quotes.push({ ...q, url: url(q.key, q.page), cite: B[q.key].cite });
  }
  let table = null;
  if (n.table) {
    const p = await page(n.table.key, n.table.page);
    const ok = n.table.rows.every(([h, es, en]) => p.ocrFlat.includes(h) && p.ocrFlat.includes(es) && p.trFlat.includes(en));
    if (!ok) refuse(n.id, 'table cell not on the page');
    else table = { ...n.table, url: url(n.table.key, n.table.page), cite: B[n.table.key].cite };
  }
  // The card leads with Maya the learner will meet: every word of an example is a course word or on a course line.
  for (const [maya] of n.examples || []) {
    const unknown = maya.toLowerCase().split(/\s+/).filter((t) => !KNOWN.has(t));
    if (unknown.length) refuse(n.id, `example "${maya}": ${unknown.join(', ')} not in the course`);
  }
  if (!n.examples?.length) refuse(n.id, 'no examples');
  notes.push({ id: n.id, title: n.title, examples: n.examples || [], body: n.body, quotes, table });
}

/**
 * One real glyph per lesson, never drawn here: a bar-and-dot numeral (drawn by
 * <Numeral> from the value), a Stuart syllabary drawing (only certain, filled
 * cells with granted rights), or a Dresden day-sign crop already shown by a
 * live /learn/maya study card.
 */
const units = [];
for (const u of SRC.units) {
  const lessons = [];
  for (const l of u.lessons) {
    const g = l.glyph;
    let glyph = null;
    if (!g) refuse(l.id, 'no glyph');
    else if (g.word && !wordIds.has(g.word)) refuse(l.id, `glyph word ${g.word} unknown`);
    else if (g.kind === 'numeral') {
      const w = g.word && SRC.words.find((x) => x.id === g.word);
      if (!Number.isInteger(g.value) || g.value < 1 || g.value > 19 || (w && w.number !== g.value)) refuse(l.id, `numeral ${g.value} does not match ${g.word}`);
      else glyph = { kind: 'numeral', value: g.value, word: g.word || null, says: g.says };
    } else if (g.kind === 'stuart') {
      const signs = [];
      for (const ref of g.signs) {
        const [value, variant] = ref.split(':');
        const d = await db.collection('maya_signs').findOne({ source: 'stuart-syllabary-v2', value, variant: Number(variant) }, { projection: { 'image.data': 0 } });
        if (!d || d.empty || d.uncertain || !d.image?.url || !String(d.rights?.permission || '').startsWith('granted')) { refuse(l.id, `Stuart ${ref} missing, empty, uncertain or not cleared`); continue; }
        signs.push({ id: d._id, value: d.value, url: d.image.url, w: d.image.w, h: d.image.h });
      }
      if (signs.length === g.signs.length) glyph = { kind: 'stuart', signs, spells: g.spells, word: g.word || null, spelling_ref: g.spelling_ref || null, says: g.says, credit: 'Drawing © David Stuart, used with permission' };
    } else if (g.kind === 'day') {
      const d = await db.collection('learn_maya_items').findOne({ _id: g.item, rung: 'study', status: 'live' }, { projection: { title: 1, figures: 1 } });
      const f = d?.figures?.find((x) => x.kind === 'codex' && x.crop_url);
      const page = f && /page (\d+)/.exec(f.label || '');
      if (!f || !page) refuse(l.id, `day-sign card ${g.item} missing or has no codex crop`);
      else glyph = { kind: 'day', item: g.item, sign: d.title, crop_url: f.crop_url, codex_page: Number(page[1]), url: f.url.replace(/^https:\/\/sourcelibrary\.org/, ''), word: g.word || null, says: g.says };
    } else refuse(l.id, `glyph kind ${g.kind}`);
    lessons.push({ ...l, glyph });
  }
  units.push({ ...u, lessons });
}

const sentenceIds = new Set(sentences.map((s) => s.id));
for (const s of sentences) {
  if (s.rule?.note && !notes.find((n) => n.id === s.rule.note && n.quotes[s.rule.quote])) refuse(s.id, `rule points at a missing quote ${s.rule.note}#${s.rule.quote}`);
  const fe = s.fill_text?.explain;
  if (fe?.note && !notes.find((n) => n.id === fe.note && n.quotes[fe.quote])) refuse(s.id, 'fill_text explain points at a missing quote');
}
for (const u of SRC.units) {
  if (!notes.find((n) => n.id === u.note)) refuse(u.id, `missing note ${u.note}`);
  for (const l of u.lessons) {
    for (const id of [...l.new, ...(l.review || [])]) if (!wordIds.has(id) || !words.find((w) => w.id === id)) refuse(l.id, `word ${id} missing or refused`);
    for (const id of l.sentences) if (!sentenceIds.has(id)) refuse(l.id, `sentence ${id} missing or refused`);
  }
}

await client.close();

console.log(`words ${words.length}/${SRC.words.length}, sentences ${sentences.length}/${SRC.sentences.length}, notes ${notes.length}, units ${SRC.units.length}`);
if (refused.length) {
  console.error(`\nREFUSED (${refused.length}):\n  ${refused.join('\n  ')}`);
  process.exit(1);
}

const course = {
  _doc: 'Built by scripts/learn/build-yucatec-course.mjs from scripts/learn/yucatec-course-sources.json (#6921). Do not edit by hand: change the sources and rebuild.',
  built_at: new Date().toISOString().slice(0, 10),
  books: Object.fromEntries(Object.entries(B).map(([k, v]) => [k, { id: v.id, cite: v.cite }])),
  notes,
  words,
  sentences,
  units,
};
if (WRITE) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(course, null, 1) + '\n');
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
} else {
  console.log('check only; pass --write to write the course file');
}
