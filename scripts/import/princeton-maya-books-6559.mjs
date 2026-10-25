#!/usr/bin/env node
/**
 * Turn the Princeton enumeration (princeton-maya-enumerate-6559.mjs) into BOOKS
 * entries for maya-mss-6559.mjs (#6559, wave 2), so the list is generated from the
 * catalogue rather than typed. Prints JS to stdout and the not-imported list to stderr.
 *
 * PRIOR ART: scripts/import/maya-mss-6559.mjs — its wave-1 BOOKS were written by
 * hand for 9 books; 50+ more by hand would drift from the catalogue. Nothing else
 * in scripts/import builds an importer spec from a DPUL table.
 *
 *   node scripts/import/princeton-maya-books-6559.mjs <out-dir>/princeton-maya.json > books.js
 *
 * Selection: a Mayan content language, the manifest's own licence NKC (a
 * multi-volume collection whose top-level licence is CNE does not count, even
 * if its volumes say NKC), and not already held. Grouping: a DPUL multi-title
 * collection is one book (GROUPS below); so is a run of one- or two-leaf
 * Garrett-Gates land deeds with consecutive numbers, which Princeton files as
 * separate records but which nobody can read as a one-page book.
 */
import { readFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const NKC = 'http://rightsstatements.org/vocab/NKC/1.0/';

/** Records that are Mayan + NKC + not held but are not imported, with the reason. */
const SKIP = {
  dcqz20t379r: 'an inscribed shell (Classic Maya glyph, 600–799), 2 photographs of an object, not a manuscript with pages; a gallery item, not a book',
  dc5999ng478: 'a single pictorial sheet dated [1890–1910?], language given only as "Mayan languages"; one image, and the date may fall after 1900',
  dc44558r33s: 'a typescript dated only [19--]: the survey holds [19--] items until the date is confirmed',
};

const GROUPS = [
  {
    key: 'kiche-wills-1760-1787',
    match: (r) => /Will of Joseph Chen/.test(r.relation) || r.ark === 'dc6m312163h',
    title: "K'iche' wills and property documents, 1760–1787",
    display_title: "K'iche' wills and property documents, 1760–1787 (52 testaments, sales and boundary papers from highland Guatemala)",
    author: "K'iche' testators and town notaries of highland Guatemala",
    language: "K'iche' Maya",
    published: '1760-1787',
    notes: [
      "Fifty-one wills, bills of sale and documents on property, town lots and district boundaries, written in K'iche' in highland Guatemala between 1760 and 1787, with one undated will of the 18th century. Princeton catalogues them as one multi-title collection (\"Will of Joseph Chen, and 51 other(s)\") with a record per document.",
      "A fifty-second document, a probable will for Sebastian Lopez dated 23 April 1776 (attested again 27 December 1778), is catalogued by Princeton outside the collection but with the same genre (\"Wills Guatemala 18th century\") and from the same Gates series; it is included here in date order.",
      'Here they are one book in date order; each page carries its document\'s title and DPUL ark.',
    ],
  },
  {
    key: 'totonicapan-land-documents',
    match: (r) => /Juan Vicente Santiago/.test(r.relation),
    title: "K'iche' land documents of Totonicapán and Momostenango, 1689–1812",
    display_title: "K'iche' land documents of Totonicapán and Momostenango, 1689–1812 (deeds, land grants, wills)",
    author: "K'iche' notaries of Totonicapán and Momostenango",
    language: "K'iche' Maya",
    languages: ["K'iche' Maya", 'Spanish'],
    published: '1689-1812',
    notes: [
      "Eighteen documents in K'iche' and Spanish, most from Totonicapán, Guatemala: deeds of sale, land grants (among them to Ysabel Xchak'chal, Pedro Baquiax and Juan Basquez Sik'), the wills of Ysabel Xq'aqui and Francisca Ramos, a mayordomo's account audit of 1690, and an 1812 deed from Juan Vicente Santiago of Momostenango.",
      'Princeton catalogues them as one multi-title collection with a record per document; here they are one book in date order, each page carrying its document\'s title and DPUL ark.',
    ],
  },
  {
    key: 'yucatec-land-deeds-1712-1870',
    match: (r) => /Xluch/.test(r.relation),
    title: 'Yucatec land deeds and wills, 1712–1870',
    display_title: 'Yucatec land deeds and wills, 1712–1870 (Ticul, Kanxoc, Maní, Valladolid, Calotmul, Maxcanú)',
    author: 'Maya town notaries of Yucatán',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1712-1870',
    notes: [
      'Deeds of sale for land and two wills from Yucatán, 1712–1870, from Ticul, Kanxoc, Maní, Valladolid, Calotmul and Maxcanú; the earlier ones in Yucatec Maya with some Spanish, the later mostly Spanish with some Yucatec. Among them the will of Juan Uicab (1804) and the land deeds of Bibiano Tuz (1824–25).',
      'Princeton catalogues them as one multi-title collection with a record per document. One member, a contract between members of the Tus family, is "Copyright Not Evaluated" and is not included. Here they are one book in date order, each page carrying its document\'s title and DPUL ark.',
    ],
  },
  {
    key: 'yucatec-land-deeds-gg-29-34',
    match: (r) => ['pk02cf55x', '9019s629j', '2v23vz22g', '6m311t12x', 'pr76f725s', 'th83m316c'].includes(r.ark),
    title: 'Yucatec land deeds, 1798–1835 (Garrett-Gates nos. 29–34)',
    display_title: 'Yucatec land deeds, 1798–1835 (Ticul, Dzitnup, Valladolid, Chemax; Garrett-Gates nos. 29–34)',
    author: 'Notaries of Yucatán',
    language: 'Spanish',
    languages: ['Spanish', 'Yucatec Maya'],
    published: '1798-1835',
    notes: [
      'Six land documents from Yucatán, Garrett-Gates Mesoamerican Manuscripts nos. 29–34: deeds of sale from Ticul (1798), Dzitnup (1798), Yucatán (1828) and Chemax (1835), a recognition of a sale (1802–1814) and a declaration of land at Valladolid (1824). Spanish, with some Yucatec Maya.',
      'Princeton catalogues each as its own record. They are joined here, in date order, because each is one to eight leaves; each page carries its document\'s title and DPUL ark.',
    ],
  },
  {
    key: 'ebtun-valladolid-land-documents-gg-74-76',
    match: (r) => ['bg257j89b', 'm039k874q', 'cc08hk74r', 'g732dd82h'].includes(r.ark),
    title: 'Ebtún and Valladolid land documents, 1665–1820 (Garrett-Gates nos. 74–76)',
    display_title: 'Ebtún and Valladolid land documents, 1665–1820 (deed to Gaspar Aac, Valladolid title, Tontzimin survey; Garrett-Gates nos. 74–76)',
    author: 'Maya community of Ebtún',
    language: 'Yucatec Maya',
    languages: ['Yucatec Maya', 'Spanish'],
    published: '1665-1820',
    notes: [
      'Four land documents in Yucatec Maya with some Spanish, Garrett-Gates Mesoamerican Manuscripts nos. 74a, 74b, 75 and 76: a deed of sale for land to Gaspar Aac of Cuncunul at Ebtún (1665), a title to land at Valladolid (1789), a survey of the Tontzimin tract at Ebtún (1820?) and an undated 19th-century Ebtún land document.',
      'Princeton catalogues each as its own record. They are joined here, in date order, because each is one to six leaves; each page carries its document\'s title and DPUL ark. The Ebtún land papers (the 1561 title of Juan Canul, 1721 and 1869) are a separate book.',
    ],
  },
];

/** Other reproductions of the same manuscript we already hold (not duplicates of this scan: Princeton's is the colour master under NKC). */
const ALSO_HELD = {
  zs25x9219: 'Other reproductions held: Teobert Maler\'s 1887 photographs (BYU, 6a878ac1d71f2514794f9e40) and a greyscale Internet Archive upload that appears to derive from this Princeton scan (6a87102131598d129803de7b).',
  dczk51vt27j: 'Another reproduction is held: the BYU photostat Chilam Balam de Nah (6a8da255aa8f57838adf7fe4).',
  dc9019sc988: 'Another reproduction is held: the BYU photostat Chilam Balam of Calkiní (6a8ee3de880abaf2b45934c3).',
};

const LANG = [
  [/k'?ich'?e|quich/i, "K'iche' Maya"], [/yucatec|\bmaya\b/i, 'Yucatec Maya'], [/pokonchi/i, "Poqomchi'"],
  [/pokomam/i, 'Poqomam'], [/chorti/i, "Ch'orti'"], [/k'?eq'?chi|kekchi|q'eqchi/i, "Q'eqchi'"],
  [/tzotzil|sotzil/i, 'Tzotzil'], [/kaqchikel|cakchiquel/i, 'Kaqchikel'], [/tzutuhil|tzutujil/i, "Tz'utujil"],
  [/spanish/i, 'Spanish'], [/latin/i, 'Latin'], [/nahuatl/i, 'Nahuatl'],
];
/** "Text in Spanish with some Yucatec." -> ['Spanish', 'Yucatec Maya'], in the order written. */
function languagesOf(r) {
  const text = r.language.split('; ').filter((p) => !/^(Mayan languages|Spanish|Castilian|quc|Latin|Central American Indian languages)$/.test(p)).join(' ');
  const hits = LANG.map(([re, name]) => ({ name, at: text.search(re) })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at);
  return [...new Set(hits.map((h) => h.name))];
}

const ggNo = (r) => (r.call_number.match(/no\. ([0-9]+[a-z]?)/) || [])[1] || null;
function cleanDate(d) {
  const s = d.replace(/[[\].]+$/g, '').replace(/^\[|\]$/g, '').replace(/\]\.?$/, '').trim();
  const between = s.match(/between (\d{4}) and (\d{4})/);
  if (between) return `${between[1]}-${between[2]}`;
  const century = s.match(/^(\d{2})--\??$/);
  if (century) return `${century[1]}00-${century[1]}99`;
  const either = s.match(/^(\d{4}) or (\d{4})/);
  if (either) return `${either[1]}-${either[2]}`;
  const range = s.match(/^(?:ca\.\s*)?(\d{4})-(\d{4})/);
  if (range) return `${range[1]}-${range[2]}`;
  const year = s.match(/(\d{4})/);
  return year ? year[1] : s;
}
const shortTitle = (t) => t.replace(/\s*:\s*(manuscript|typescript)\b.*$/i, '').replace(/,\s*\[?(ca\.\s*)?\d{4}.*$/, '').replace(/,\s*\[[^\]]*\]\.?$/, '').trim();
function authorOf(r) {
  const c = r.creator.split('; ')[0];
  if (!c) return null;
  const m = c.match(/^([^,]+),\s*([^,]+?)(?:,\s*(?:ca\.\s*|active\s*)?[-\d?].*)?$/);
  return m ? `${m[2]} ${m[1]}` : c;
}
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const picked = rows.filter((r) => r.mayan && r.license === NKC && !r.held_by);
const notPicked = rows.filter((r) => r.mayan && !r.held_by && r.license !== NKC);
const books = [];
const used = new Set();
for (const g of GROUPS) {
  const members = picked.filter(g.match);
  members.forEach((r) => used.add(r.ark));
  const { match, ...spec } = g;
  books.push({ ...spec, group: true, arks: members.map((r) => r.ark) });
}
const skipped = picked.filter((r) => SKIP[r.ark]);
const singles = picked.filter((r) => !used.has(r.ark) && !SKIP[r.ark]);
const titleCount = {};
for (const r of singles) titleCount[shortTitle(r.title)] = (titleCount[shortTitle(r.title)] || 0) + 1;
for (const r of singles.sort((a, b) => a.call_number.localeCompare(b.call_number, 'en', { numeric: true }))) {
  const base = shortTitle(r.title);
  const no = ggNo(r);
  const langs = languagesOf(r);
  const mayan = langs.filter((l) => !['Spanish', 'Latin', 'Nahuatl'].includes(l));
  const primary = /^Spanish; Castilian/.test(r.language) || /^Text in Spanish/.test(r.language.split('; ').pop()) ? 'Spanish' : (mayan[0] || langs[0]);
  const date = cleanDate(r.date);
  const dup = titleCount[base] > 1;
  const title = dup && no ? `${base} (Garrett-Gates no. ${no})` : base;
  books.push({
    key: `${slug(base).split('-').slice(0, 6).join('-')}-${no ? `gg${no}` : r.ark}`,
    arks: [r.ark],
    title,
    display_title: `${title} (${mayan.join(', ')} manuscript, ${r.date.replace(/^\[|\]\.?$|\.$/g, '')})`,
    author: authorOf(r) || `Anonymous ${mayan[0].replace(/ Maya$/, '')} scribe`,
    language: primary,
    ...(langs.length > 1 ? { languages: [primary, ...langs.filter((l) => l !== primary)] } : {}),
    published: date,
    notes: [
      ...(r.abstract ? [r.abstract] : []),
      ...(ALSO_HELD[r.ark] ? [ALSO_HELD[r.ark]] : []),
      `Princeton catalogue: ${r.title} ${r.extent}. ${r.language.split('; ').filter((p) => !/^(Mayan languages|Spanish|Castilian|quc|Latin)$/.test(p)).join(' ')}`.replace(/\s+/g, ' ').trim(),
    ],
  });
}

console.log(`  // ---- wave 2 (#6559, 2026-10-24): generated by princeton-maya-books-6559.mjs from the DPUL enumeration ----`);
for (const b of books) console.log(`  ${JSON.stringify(b)},`);
console.error(`${books.length} books (${GROUPS.length} groups, ${books.length - GROUPS.length} single records); ${picked.length} records picked`);
console.error('\nNOT IMPORTED (Mayan + NKC + not held):');
for (const r of skipped) console.error(`  ${r.ark}\t${r.title}\t${SKIP[r.ark]}`);
console.error('\nNOT IMPORTED (Mayan, licence not NKC):');
for (const r of notPicked) console.error(`  ${r.ark}\t${r.date}\t${r.extent}\t${r.license.replace(/http:\/\/rightsstatements.org\/vocab\/|\/1\.0\//g, '')}\t${r.title}`);
