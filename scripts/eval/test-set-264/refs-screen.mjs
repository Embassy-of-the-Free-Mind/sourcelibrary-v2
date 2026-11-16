#!/usr/bin/env node
// #264 stage 2, last cells: Hebrew, Arabic, Cyrillic, Indic, Sanskrit, Tibetan and the rest of other-latin-script.
// For each drawn frame row in these cells that no earlier builder looked at, one coverage line (source "screen")
// saying why it has no same-edition e-text, and a located candidate for the one row that does (source
// "he-wikisource": the born-digital Kaufmann-vocalised Mishnah PDF typeset from Hebrew Wikisource).
// What was checked, 2026-11-14:
//  - every Internet Archive id in these cells against Wikimedia Commons (insource search), and each hit's global
//    usage on any Wikisource (only the Mishnah PDF and BL Or 2375 are used there; es.wikisource has an empty index
//    of the 1922 Calpe Crónica del Perú, no page transcribed);
//  - ru.wikisource page and title search for the Russian prints (Chekhov's Кошмар and Bakunin's Исповедь exist, from
//    the 1974–83 Academy edition and az.lib.ru, not our printings);
//  - OpenITI metadata (kitab-metadata-automation, OpenITI_Github_clone_metadata_light.csv) for the Arabic prints:
//    every version is keyed from a modern Beirut/Cairo edition, none from ours;
//  - Sefaria / he.wikisource by title for the Hebrew prints (Sefaria's Bible, Mishnah, Midrash Rabbah and Yerushalmi
//    come from other editions).
// Not searched: BDRC/BUDA e-texts (our records keep no BDRC volume id) and GRETIL/SARIT per edition (their e-texts
// carry no page breaks of the print, so they could not be cut to a page without our reading setting the edges).
// PRIOR ART: scripts/eval/test-set-264/refs-greek.mjs (same SCREENED-table shape for Greek; its sources are
// Perseus/First1K only). This covers the scripts no earlier builder handled.
//   JOB_SCRATCH=... node scripts/eval/test-set-264/refs-screen.mjs   → $JOB_SCRATCH/screen-cands.jsonl, he-cands.jsonl
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, readFrame, REFS } from './refs-lib.mjs';

const J = process.env.JOB_SCRATCH;
const drawn = JSON.parse(fs.readFileSync(path.join(J, 'drawn-books.json'), 'utf8'));
const covered = new Set(readJsonl(path.join(REFS, 'coverage.jsonl')).filter((c) => c.source !== 'screen' && c.source !== 'he-wikisource').map((c) => c.row));
const frame = new Map(readFrame().map((r) => [r.row, r]));
const CELLS = /^(hebrew-flash3\/unknown|other-hebrew|other-arabic|other-cyrillic|other-indic|other-latin-script|other-tibetan|sanskrit-lite\/print|tibetan-yigdzin\/manuscript)$/;

const MS = 'a manuscript (or a facsimile of one): no free e-text transcribes this witness';
const BY_IDENT = {
  // Hebrew prints
  MishnaCorrectedKaufman00WHOLE: ['located', 'born-digital PDF of Dan Be\'eri\'s Kaufmann-based vocalised Mishnah (Commons, CC BY-SA 3.0, 2017-02-20), typeset from the he.wikisource text'],
  vonGall_SamaritanPentateuch: ['no-etext', 'von Gall\'s 1914–18 critical Samaritan Pentateuch: no free e-text of this edition (Sefaria and he.wikisource carry the Masoretic text)'],
  'midrashbereshitr': ['other-edition', 'Theodor–Albeck critical edition; Sefaria\'s Bereshit Rabbah is the Vilna text'],
  M4FE4YXGEsIC: ['no-etext', 'Levita, Composita verborum (1527): no e-text found'],
  'Miqraot-Gedolot-First-Edition_V': ['other-edition', 'Bomberg 1517: Sefaria and he.wikisource carry the Bible and commentaries from other editions (Miqra al pi ha-Masorah, Vilna-type texts), not this printing\'s page'],
  talmudyerushalmi61unse: ['other-edition', 'Sefaria\'s Yerushalmi follows the Venice/Krotoshin text with its own layout, not this printing\'s page'],
  bethamidraschsam01jell: ['no-etext', 'Jellinek, Bet ha-Midrasch I (1853): the scan is on Commons but no Wikisource index uses it; he.wikisource midrash texts are not page-marked to it'],
  abulafiacompletewr: ['no-etext', 'modern (1990s) Hebrew edition, in copyright; no free e-text'],
  AbulafiaLifeOfTheWorldToCome: ['other-witness', MS],
  BL_Or2375_06Song: ['other-witness', `${MS}; he.wikisource links the scan from Miqra al pi ha-Masorah (Aleppo-based), another witness`],
  // Arabic prints (OpenITI checked: other editions)
  'ned-kbn-all-00003397-001': ['no-etext', 'Erpenius\' Arabic New Testament (1616): no free e-text of this edition'],
  MIFAO30: ['other-edition', 'OpenITI\'s Khitat is the Dar al-Kutub al-ʿIlmiyya edition, not Wiet\'s MIFAO'],
  'McGillLibrary-rbsc_isl_arabian-nights_kitab': ['other-edition', 'OpenITI\'s Alf layla versions (Alwaraq, Hindawi, eScriptorium OCR) are other editions; the scan is on Commons with no Wikisource use'],
  b22375533: ['no-etext', 'Sontheimer\'s Analecta medica (1833): no e-text; OpenITI\'s Ibn al-Baytar is a Beirut 2001 edition'],
  bibliothecageogr04goejuoft: ['no-etext', 'BGA IV indices and glossary (de Goeje 1879): no e-text; on Commons with no Wikisource use'],
  AAlexandrina: ['other-edition', 'OpenITI\'s Iḥyāʾ is the Dar al-Maʿrifa (Beirut) text, not this printing'],
  travelsibnjubay00goejgoog: ['other-edition', 'OpenITI\'s Riḥla versions are Beirut/Cairo editions, not Wright–de Goeje (Leiden 1907)'],
  b30411427: ['no-etext', 'Channing\'s Albucasis (Oxford 1778): no e-text; OpenITI\'s Taṣrīf (ALCorpus) is another text; on Commons with no Wikisource use'],
  'ned-kbn-all-00003352-001': ['other-edition', 'Golius\' ʿAjāʾib al-maqdūr (1636): OpenITI\'s version (JK010338, Shamela) is not this edition'],
  lelivredesavares00jahiuoft: ['no-etext', 'a French translation (1900); OpenITI\'s Bukhalāʾ is Arabic, Beirut editions'],
  AAskZad: ['no-etext', 'Thābit ibn Qurra\'s algebra treatise: no OpenITI text'],
  // Cyrillic prints
  polnoesobranesoc46chek: ['other-edition', 'ru.wikisource has Кошмар from the Academy PSS (1974–83, modern spelling); the Marks 1903 indexes there do not include this volume\'s pages'],
  ispovedipismoale00baku: ['other-edition', 'ru.wikisource has Исповедь from az.lib.ru (edition not stated, modern spelling); the scan is on Commons with no Wikisource use'],
  '01003573423': ['no-etext', 'Nikitin, Хожение (1857 edition): on Commons with no Wikisource use'],
  // other-latin-script prints
  lacrnicadelper00ciez: ['no-etext', 'es.wikisource has an index on this very scan (Índice:La crónica del Perú.djvu) but no page of it is transcribed'],
  elingeniosohi00cerv: ['no-etext', 'the scan is on Commons with no Wikisource use; es.wikisource\'s Quijote is not page-marked to it'],
  A086A273: ['no-etext', 'on Commons with no Wikisource use'],
  commentariosdogr00albu: ['no-etext', 'on Commons with no Wikisource use'],
  eventyroghistori05ande: ['other-edition', 'the H.C. Andersen Centre texts follow other editions; the scan is on Commons with no Wikisource use'],
  cuatrolibrosdel00hern: ['no-etext', 'on Commons with no Wikisource use'],
  entenelleretliv00kiergoog: ['other-edition', 'SKS (Søren Kierkegaards Skrifter) is the critical edition, not the 1878 printing'],
  holbergskomedie00martgoog: ['other-edition', 'holbergsskrifter.dk is the critical edition, not this 1897 printing'],
};
const MS_PROVIDERS = new Set(['manchester', 'bodleian', 'harvard', 'laurenziana', 'leiden', 'gallica', 'cambridge', 'museumsofindia', 'penn_colenda', 'bl', 'e-codices', 'bsb', 'bph']);

function judge(o) {
  const key = Object.keys(BY_IDENT).find((k) => o.ident && o.ident.startsWith(k));
  if (key) return BY_IDENT[key];
  const t = o.title || '';
  if (/^(Coin|Doodles|Specimen of Calligraphy)/.test(t)) return ['no-etext', 'not a running text (object, scribbles or a calligraphy specimen)'];
  if (o.cell.startsWith('tibetan') || o.cell === 'other-tibetan') {
    if (o.provider === 'bl') return ['other-witness', `${MS}: a Bhutanese manuscript (BL EAP); the Derge e-Kangyur/Tengyur that the Tibetan aligner (#4523) uses is another witness, scored as agreement only`];
    return ['not-searched', 'a BDRC print: our record keeps no BDRC volume id, and BUDA e-texts (keyed texts of other editions mixed with machine OCR) were not looked up'];
  }
  if (o.cell === 'other-arabic' && MS_PROVIDERS.has(o.provider)) return ['other-witness', `${MS}; OpenITI keys modern printed editions`];
  if (o.cell === 'other-indic') return /Manimekalai/.test(t) ? ['no-page-breaks', 'Project Madurai\'s Maṇimēkalai has no page breaks of any print (edition unstated)'] : ['other-witness', `${MS} (Sharada/Devanagari manuscript)`];
  if (o.cell === 'sanskrit-lite/print') {
    if (/Sharada (March|October)|Catalog|Almanac|Panchang|Urdu|Japa Vidhi|Namavali|Sahasranama/i.test(t)) return ['no-etext', 'a periodical, catalogue, almanac or devotional booklet: no e-text'];
    if (/Dutt|Mahabharata of Krishna|Shamasastry, English/i.test(t)) return ['no-page-breaks', 'an English translation; sacred-texts.com style e-texts carry no page breaks of the print'];
    return ['not-searched', 'GRETIL/SARIT not searched per edition: their e-texts carry no page breaks of the source print, so even a same-edition text could not be cut to this page without our reading setting the edges'];
  }
  if (o.cell === 'other-cyrillic') return ['no-etext', 'no Commons copy of this scan and no ru.wikisource index of this printing'];
  if (o.cell === 'other-latin-script') {
    if (MS_PROVIDERS.has(o.provider) && !/allard_pierson/.test(o.provider)) return ['other-witness', MS];
    return ['no-etext', 'no Commons copy of this scan and no Wikisource index of this edition'];
  }
  // Hebrew cells
  if (['bph', 'allard_pierson', 'google_books'].includes(o.provider)) { // BPH's Hebrew holdings in the frame are prints
    if (/Pentateuch|ḥumše|chumshe|Humas|parašiyot|Misnaioth/i.test(t)) return ['other-edition', 'an Amsterdam print of Bible or Mishnah: Sefaria and he.wikisource carry these texts from other editions, not this printing\'s page (canonical: a model could recite it)'];
    return ['no-etext', 'an early modern Hebrew print: no free e-text of this edition (Sefaria and he.wikisource have none; HebrewBooks has scans, not text)'];
  }
  return ['other-witness', `${MS}; Sefaria and he.wikisource transcribe printed editions`];
}

const screen = [], located = [];
for (const o of drawn) {
  if (!CELLS.test(o.cell) || covered.has(o.row)) continue;
  if (!frame.has(o.row)) throw new Error(`${o.row} not in the frame`);
  const [outcome, why] = judge(o);
  if (outcome === 'located') located.push(o); else screen.push({ row: o.row, frame_cell: o.cell, source: 'screen', outcome, why });
}

// The Mishnah row: the he.wikisource revision of the tractate page that precedes the PDF (2016-09-04 < 2017-02-20),
// cut where our page image starts and ends (read on the image; the leaf check compared the pointing word by word).
const he = [];
for (const o of located) {
  const W = JSON.parse(fs.readFileSync(path.join(J, 'dl/mishnah/yev.json'), 'utf8'));
  const p = Object.values(W.query.pages)[0]; const rev = p.revisions[0]; const t = rev.slots.main['*'];
  const a = t.indexOf('וּבִלְבַד שֶׁתְּהֵא כְתֻבָּתָהּ', t.indexOf('פֶּרֶק רְבִיעִי'));
  const endHead = t.indexOf('משנה ח', a); const b = t.indexOf('\n', t.indexOf('\n', endHead) + 1);
  if (a < 0 || endHead < 0 || b < 0) throw new Error('Mishnah page edges not found');
  he.push({
    row: o.row, frame_cell: o.cell, source: 'he-wikisource', outcome: 'located', host: 'he.wikisource.org', ws_page: p.title,
    revid: rev.revid, rev_ts: rev.timestamp, tractate: 'יבמות', chapter: 'ד',
    source_url: `https://he.wikisource.org/w/index.php?oldid=${rev.revid}`,
    edition_note: 'Dan Be\'eri\'s vocalised Mishnah after MS Kaufmann A50; our scan (IA MishnaCorrectedKaufman00WHOLE = Commons File:Mishna corrected Kaufman 00 WHOLE.pdf, 2017-02-20) is the PDF typeset from this text; the page opens on Yevamot 4:4 "וּבִלְבַד שֶׁתְּהֵא" and ends on the heading of 4:8',
    loc: { rule: 'read on the page image: first line and last heading, then the wikitext cut at those two points' },
    raw: t.slice(a, b),
  });
}
fs.writeFileSync(path.join(J, 'screen-cands.jsonl'), screen.map((c) => JSON.stringify(c)).join('\n') + '\n');
fs.writeFileSync(path.join(J, 'he-cands.jsonl'), he.map((c) => JSON.stringify(c)).join('\n') + '\n');
const tally = {};
for (const c of screen) tally[`${c.frame_cell} ${c.outcome}`] = (tally[`${c.frame_cell} ${c.outcome}`] || 0) + 1;
console.log(tally, 'located', he.length);
