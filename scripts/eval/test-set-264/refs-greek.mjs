#!/usr/bin/env node
// #264 stage 2: candidate references for the sealed frame's Greek rows from the two free TEI corpora that transcribe
// printed Greek editions page by page: Perseus canonical-greekLit and OpenGreekAndLatin First1KGreek. One coverage
// line for every drawn Greek row, so the cell's coverage is over the rows drawn.
// PRIOR ART: refs-tei.mjs (DTA/EEBO-TCP: same-edition pairs from #6012, cut at <pb> with typed-refs-6012/lib.mjs
// teiPages(), used here unchanged). #6012 never paired Greek, so the edition screen here is by hand: every drawn
// Greek print row was read against the <sourceDesc> of the 3,270 TEI files in the two clones (editor, publisher,
// year, volume; the scan's own title page where the catalogue was unsure). Same work in another edition is not a
// reference (Philo in Richter's 1828 Leipzig edition is not Cohn-Wendland's Philo).
//   node scripts/eval/test-set-264/refs-greek.mjs --corpora=$JOB_SCRATCH/dl/greek --out=$JOB_SCRATCH/greek-cands.jsonl
// Needs the two clones (git clone --depth 1 github.com/PerseusDL/canonical-greekLit, github.com/OpenGreekAndLatin/
// First1KGreek) and read-only Mongo (our stored reading only LOCATES the <pb>; the text is the corpus's).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { readFrame } from './refs-lib.mjs';
import { teiPages } from '../typed-refs-6012/lib.mjs';

const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const CORPORA = argOf('corpora');
const OUT = argOf('out');
const REPO = { perseus: 'canonical-greekLit', first1k: 'First1KGreek' };
const GH = { perseus: 'PerseusDL/canonical-greekLit', first1k: 'OpenGreekAndLatin/First1KGreek' };

// Same edition, by the TEI header against our scan. covers: what of our page image the source transcribes.
const SAME = {
  'ts264-fbea89e8ed0c': { source: 'first1k', file: 'tlg2023/tlg006/tlg2023.tlg006.1st1K-grc1.xml', ed: 'Parthey, Jamblichi De mysteriis liber, Berlin: Nicolai 1857 (our scan: the same Parthey 1857)', covers: 'main-text', excludes: ['critical apparatus', 'Latin translation printed below the Greek'] },
  'ts264-9bb1f54dbd61': { source: 'perseus', file: 'tlg0555/tlg004/tlg0555.tlg004.perseus-grc2.xml', ed: 'Stählin, Clemens Alexandrinus 2 (GCS), Leipzig: Hinrichs 1906 (our scan: the same 1906 volume)', covers: 'main-text', excludes: ['critical apparatus', 'testimonia'] },
  'ts264-4dda0e212330': { source: 'perseus', file: 'tlg0385/tlg001/tlg0385.tlg001.perseus-grc2.xml', ed: 'Cary, Dio\'s Roman History vol. 3 (Loeb 53), London: Heinemann 1914 (our scan: the same Loeb 53)', covers: 'greek-page-of-spread', excludes: ['the facing English page (Perseus has no Cary English)'] },
  'ts264-52607903568d': { source: 'perseus', file: 'tlg2003/tlg013/tlg2003.tlg013.perseus-grc2.xml', ed: 'Wright, The Works of the Emperor Julian vol. 3 (Loeb), London: Heinemann 1923 (our scan: the 1923 volume, the Letters)', covers: 'main-text', excludes: ['footnotes'] },
  'ts264-31fd23099a17': { source: 'perseus', file: 'tlg0007/tlg047/tlg0007.tlg047.perseus-grc2.xml', ed: 'Perrin, Plutarch\'s Lives vol. 7 (Loeb 99), London: Heinemann 1919 (our scan: the same Loeb 99)', covers: 'greek-page-of-spread', excludes: ['the facing English page (Perseus English carries no page breaks)', 'footnotes'] },
  'ts264-8bd030ef2ff9': { source: 'perseus', file: 'tlg0007/tlg042/tlg0007.tlg042.perseus-grc2.xml', ed: 'Perrin, Plutarch\'s Lives vol. 8 (Loeb 100), London: Heinemann 1919 (our scan: the same Loeb 100)', covers: 'greek-page-of-spread', excludes: ['the facing English page (Perseus English carries no page breaks)', 'footnotes'] },
  'ts264-43c8659d296d': { source: 'first1k', file: 'tlg0057/tlg089/tlg0057.tlg089.1st1K-grc1.xml', ed: 'Kühn, Claudii Galeni opera omnia 17a, Leipzig: Knobloch 1828 (our scan: the same Kühn 17.1)', covers: 'main-text', excludes: ['Latin translation column', 'marginal Chartier/Basel references'] },
  'ts264-ff962e7de6f9': { source: 'first1k', file: 'tlg0057/tlg101/tlg0057.tlg101.1st1K-grc1.xml', ed: 'Kühn, Claudii Galeni opera omnia 18b, Leipzig: Knobloch 1830 (our scan: the same Kühn 18.2)', covers: 'main-text', excludes: ['Latin translation column', 'marginal Chartier/Basel references'] },
  'ts264-2df8514f70bb': { source: 'first1k', file: 'tlg0363/tlg001/tlg0363.tlg001.1st1K-grc1.xml', ed: 'Heiberg, Claudii Ptolemaei opera 1.1 (Syntaxis I-VI), Leipzig: Teubner 1898 (our scan: the same 1898 volume)', covers: 'whole-page', excludes: [] }, // the page holds only the end of a table caption, keyed as a <note>
  'ts264-dd509682573f': { source: 'first1k', file: 'tlg4013/tlg005/tlg4013.tlg005.1st1K-grc1.xml', ed: 'Hayduck, Simplicii in libros Aristotelis De anima commentaria (CAG 11), Berlin: Reimer 1882 (our scan: the same CAG XI)', covers: 'main-text', excludes: ['marginal line numbers'] },
};

// Rows whose work IS in the two corpora, but not in our scan's edition or not as this page (screened by hand).
const SCREENED = {
  'ts264-ac93367368fb': ['other-edition', 'our scan is the 1939 second edition of GCS Clemens 2 (Stählin, "2. Aufl. mit zahlreichen Nachträgen"); Perseus keyed the 1906 first edition. The page opens on the same words, but a revised edition is not the edition keyed'],
  'ts264-f0cc7d7c30f7': ['not-in-source', 'a half-title page (ΚΛΗΜΕΝΤΟΣ / ΛΟΓΟΣ / ΤΙΣ Ο ΣΩΙΖΟΜΕΝΟΣ ΠΛΟΥΣΙΟΣ) of the right edition (Stählin 1909); First1K moves the title to the first text page and keeps no <pb> for this one'],
  'ts264-135fb4e1438e': ['no-etext', 'Loeb 37 (Dio books 12-35, fragments): Perseus keyed only Cary vols 3-6 (books 36-55)'],
  'ts264-e32706acec72': ['other-edition', 'Loeb Moralia 1 (Babbitt 1927): Perseus has Babbitt\'s English only; its Greek is Bernardakis (Teubner 1888)'],
  'ts264-da3e87dee9d9': ['no-page-breaks', 'Heiberg\'s Euclid, the same edition, but the Perseus TEI carries no <pb>: the page cannot be cut from the source without our reading setting its edges'],
  'ts264-9743c57f069c': ['no-page-breaks', 'Marchant\'s Loeb Memorabilia (1923), the same edition (Perseus eng2), but the TEI carries no <pb>; the Greek is the OCT, another edition'],
  'ts264-e029a29e1c2b': ['no-page-breaks', 'Bury\'s Loeb Laws (1926), the same edition (Perseus eng2), but its page milestones are Stephanus pages, not the Loeb\'s'],
  'ts264-32dbd30f736f': ['other-edition', 'Oldfather\'s Loeb Epictetus: Perseus keyed Schenkl (Teubner 1916) and the Long and Higginson translations'],
  'ts264-bb72451edbaa': ['no-etext', 'an English page of Hort\'s Loeb Theophrastus 1 (1916): First1K keyed Hort\'s Greek only'],
  'ts264-6d22f47bd6c9': ['no-etext', 'an English page of Hort\'s Loeb Theophrastus 2 (Weather Signs): no e-text of Hort\'s English, and First1K keyed only the Enquiry\'s Greek'],
  'ts264-df1b2c7b72d0': ['no-etext', 'a German translation page of Heiberg\'s Hero 4 (Definitiones): no e-text of the German'],
  'ts264-fdeeab9e1aea': ['other-edition', 'Philo in Richter\'s Leipzig edition (1828): both corpora keyed Cohn-Wendland (Reimer 1896-)'],
  'ts264-5557fb90fda5': ['other-edition', 'Philo in Richter\'s Leipzig edition (1829): both corpora keyed Cohn-Wendland (Reimer 1896-)'],
  'ts264-a943bac925e6': ['other-edition', 'Allen and Sikes, Homeric Hymns (1904): Perseus keyed Evelyn-White\'s Loeb (1914)'],
  'ts264-31243b76f6b4': ['other-edition', 'Demosthenes (1885 Teubner): Perseus keyed Butcher\'s OCT (1903)'],
  'ts264-293161271214': ['other-edition', 'Bekker\'s Rhetorica et Poetica (1873): Perseus keyed Ross\'s OCT (1959)'],
  'ts264-acd61f4bd9a2': ['other-edition', 'Bury\'s Symposium (1909): Perseus keyed Burnet\'s OCT'],
  'ts264-4c9c9ad6b312': ['other-edition', 'Haury\'s Teubner Procopius (1905): Perseus keyed Dewing\'s Loeb'],
  'ts264-c8b19129d7c7': ['other-edition', 'Sintenis\'s Teubner Lives (1869): Perseus keyed Perrin\'s Loeb'],
  'ts264-a4dbacdb6a47': ['other-edition', 'Merry\'s school Odyssey (1890): Perseus keyed Murray\'s Loeb'],
  'ts264-1ee0ba157d7a': ['other-edition', 'Koechly\'s Teubner Nonnus: Perseus keyed Rouse\'s Loeb (1940-42)'],
  'ts264-5fc5b5c58fcf': ['other-edition', 'Graefe\'s Nonnus (1819-26): Perseus keyed Rouse\'s Loeb (1940-42)'],
  'ts264-0bf6f329c3ba': ['no-etext', 'Planisphaerium survives in Latin; First1K keyed none of Heiberg\'s Opera astronomica minora Latin'],
  'ts264-ec1360afe978': ['other-edition', 'Hort and Mayor\'s Stromata VII (1902): Perseus keyed Stählin (GCS 1909)'],
  'ts264-f1ba01f37021': ['no-etext', 'Patrologia Graeca 27: no First1K or Perseus file is keyed from this Migne volume'],
  'ts264-7d93aa88c0cf': ['no-etext', 'Patrologia Graeca 6: no First1K or Perseus file is keyed from this Migne volume'],
  'ts264-5007e7829cce': ['no-etext', 'Patrologia Graeca 146: no First1K or Perseus file is keyed from this Migne volume'],
  'ts264-29946bafaddf': ['no-etext', 'Patrologia Graeca 86 (Leontius): no First1K or Perseus file is keyed from this Migne volume'],
};
const NONE = 'no First1KGreek or Perseus TEI of this edition (sourceDesc screen of 3,270 files in the 2026-11-14 clones)';
const MS = 'a manuscript or a facsimile of one: Perseus and First1K transcribe printed editions, not this witness';

const foldGreek = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ').replace(/[^α-ω]/g, '');
const grams = (s, k = 5) => { const g = new Set(); for (let i = 0; i + k <= s.length; i++) g.add(s.slice(i, i + k)); return g; };
const containment = (a, b) => { if (!a.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / a.size; };
const stripOurs = (t) => String(t || '').replace(/<[^>]+>[^<]*<\/[^>]+>/g, ' ').replace(/<[^>]+>/g, ' ');

// Page breaks of OTHER editions (ed="alt": Potter's pages in Clement, the 1624 Paris pages in Plutarch) are references,
// not this edition's pages; they are taken out before cutting.
const ownPbOnly = (x) => x.replace(/<pb\b[^>]*\bed="[^"]*"[^>]*\/?>/g, '').replace(/<pb\b[^>]*\bn="paris\.[^"]*"[^>]*\/?>/g, '');

const frame = readFrame().filter((r) => r.drawn && /greek/.test(r.frame_cell));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pagesC = c.db('bookstore').collection('pages');
const sha = {};
for (const [k, d] of Object.entries(REPO)) sha[k] = execFileSync('git', ['-C', path.join(CORPORA, d), 'rev-parse', 'HEAD']).toString().trim();
const out = [];
for (const r of frame) {
  const base = { row: r.row, frame_cell: r.frame_cell, image_url: r.image?.url ?? null };
  const s = SAME[r.row];
  if (!s) {
    const [outcome, why] = SCREENED[r.row] || (/manuscript/.test(r.frame_cell) || /\bMS\b|Codex|manuscript|Bodleian Library MS|Grec \d/.test(r.catalogue?.title || '') || ['bodleian', 'cambridge', 'vatican', 'e-codices', 'gallica', 'laurenziana', 'harvard'].includes(r.catalogue?.provider) && (r.catalogue?.year ?? 9999) < 1500 ? ['other-witness', MS] : ['no-etext', NONE]);
    out.push({ ...base, source: 'greek-tei', outcome, why }); continue;
  }
  const file = path.join(CORPORA, REPO[s.source], 'data', s.file);
  const xml = fs.readFileSync(file, 'utf8');
  const own = ownPbOnly(xml);
  const pages = teiPages(own);
  const ours = await pagesC.findOne({ book_id: r.book_id, page_number: r.page_number }, { projection: { _id: 0, 'ocr.data': 1 } });
  const g = grams(foldGreek(stripOurs(ours?.ocr?.data)));
  // Locate: the <pb> page whose Greek best contains our reading's 5-grams (our reading locates only).
  // A <pb> page of a few words (a heading run between two breaks) is contained in anything: score pages of 150+ 5-grams.
  const scored = pages.map((p, i) => { const pg = grams(foldGreek(p.text + ' ' + p.notes.join(' '))); return { i, sc: pg.size >= 150 ? containment(pg, g) : 0 }; }).sort((a, b) => b.sc - a.sc);
  const best = scored[0], second = scored[1];
  const p = pages[best.i];
  const at = [...own.matchAll(/<pb[\s/][^>]*>/g)].map((m) => m.index);
  const pbIdx = pages[0].n === null && pages[0].facs === null ? best.i : best.i + 1;
  const raw = own.slice(at[pbIdx - 1] ?? 0, at[pbIdx] ?? own.length);
  const words = (t) => t.replace(/\s+/g, ' ').trim();
  const text = [p.text, ...p.notes].filter(Boolean).join('\n');
  out.push({ ...base, source: s.source, outcome: best.sc >= 0.5 && best.sc - (second?.sc ?? 0) >= 0.2 ? 'located' : 'unlocated',
    why: best.sc >= 0.5 ? null : `best <pb> holds ${best.sc.toFixed(2)} of our page's Greek 5-grams`,
    file: s.file, pb: p.n ?? p.facs, loc: { rule: '5-gram containment of our stored reading in the <pb> page', score: +best.sc.toFixed(3), second: +(second?.sc ?? 0).toFixed(3) },
    raw, text, head: words(p.text).slice(0, 120), tail: words(p.text).slice(-120),
    covers: s.covers, excludes: s.excludes, edition_note: s.ed,
    source_url: `https://github.com/${GH[s.source]}/blob/${sha[s.source]}/data/${s.file}`, commit: sha[s.source],
    licence_target: (xml.match(/<licence[^>]*target="([^"]+)"/) || [])[1] ?? null,
    resp: [...xml.slice(0, xml.indexOf('</teiHeader>')).matchAll(/<respStmt>([\s\S]*?)<\/respStmt>/g)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter((t) => /key|correct|digit|conver|encod/i.test(t)).join('; ').slice(0, 300) });
}
await c.close();
fs.writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
const tally = out.reduce((t, o) => { const k = `${o.frame_cell}|${o.outcome}`; t[k] = (t[k] || 0) + 1; return t; }, {});
console.log(JSON.stringify(tally, null, 1));
for (const o of out.filter((o) => o.file)) console.log(o.row, o.outcome, o.pb, JSON.stringify(o.loc), o.licence_target);
