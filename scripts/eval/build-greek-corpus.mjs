#!/usr/bin/env node
// PRIOR ART: benchmark-refs.mjs (Syriac branch) — reads a flattened local corpus (<dir>/<id>.txt +
// index.json) that a scratch script (fetch-syriac-corpus.py, never committed) produced; the Greek
// reference sources are two TEI repositories on disk, so the flattening step is its own committed
// script here, reproducible from the repo archives. build-ctext-groundtruth.mjs pins a curated
// passage to one page and does not flatten a corpus.
/**
 * build-greek-corpus.mjs — flatten First1KGreek + Perseus canonical-greekLit TEI editions into
 * the local corpus benchmark-refs.mjs's `greek` branch searches (#4925 step 2, #4744).
 *
 *   node scripts/eval/build-greek-corpus.mjs --first1k=<dir>/First1KGreek-master \
 *        --perseus=<dir>/canonical-greekLit-master --out=~/.claude/jobs/417569c5/tmp/refs/greek
 *
 * Per Greek edition file (…-grc*.xml): drop the teiHeader, notes (apparatus), variant readings,
 * deletions and bibliography, strip tags, decode entities, collapse whitespace → <urn>.txt (the
 * edition text with its accents, what a reference window is cut from) and <urn>.fold.txt (the
 * same words diacritic-folded, lowercased, final sigma folded, Greek letters only — what the
 * phrase search runs over). index.json carries author/title/edition per URN from __cts__.xml.
 * The fold is for MATCHING only; a reference is always the accented text. Non-Greek scripts are
 * kept in the .txt (a Latin heading the page prints is printed) and absent from the fold.
 */
import fs from 'fs';
import path from 'path';

const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const HOME = process.env.HOME || '';
const SRC = [
  { name: 'First1KGreek', dir: argOf('first1k', path.join(HOME, '.claude/jobs/10c835f4/tmp/refs/First1KGreek-master')), url: id => `https://github.com/OpenGreekAndLatin/First1KGreek/tree/master/data/${id.split('.')[0]}/${id.split('.')[1]}` },
  { name: 'Perseus canonical-greekLit', dir: argOf('perseus', path.join(HOME, '.claude/jobs/10c835f4/tmp/refs/canonical-greekLit-master')), url: id => `https://github.com/PerseusDL/canonical-greekLit/tree/master/data/${id.split('.')[0]}/${id.split('.')[1]}` },
];
const OUT = argOf('out', path.join(HOME, '.claude/jobs/417569c5/tmp/refs/greek'));
fs.mkdirSync(OUT, { recursive: true });

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10)) : (ENT[e.toLowerCase()] ?? m));
const dropEl = (t, tag) => { for (let i = 0; i < 6; i++) { const n = t.replace(new RegExp(`<${tag}\\b[^>]*?/>`, 'g'), ' ').replace(new RegExp(`<${tag}\\b[^>]*>(?:(?!<${tag}\\b)[\\s\\S])*?<\\/${tag}\\s*>`, 'g'), ' '); if (n === t) break; t = n; } return t; };
export function flattenTei(xml) {
  let t = xml.replace(/<teiHeader[\s\S]*?<\/teiHeader>/, ' ');
  for (const tag of ['note', 'rdg', 'del', 'bibl', 'app']) t = dropEl(t, tag);   // app after rdg: what remains of <app> is the <lem>
  t = t.replace(/<(lb|pb|milestone|p|div|l|head|speaker|sp|lg|item|list|row|cell|ab|seg)\b[^>]*\/?>/g, '\n').replace(/<\/(p|div|l|head|speaker|sp|lg|item|list|row|cell|ab)\s*>/g, '\n');
  t = t.replace(/<[^>]+>/g, ' ');
  t = decode(t).normalize('NFC');
  return t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
}
// Diacritic fold for MATCHING: NFD, strip marks, lowercase, ς→σ, keep Greek letters only.
export const foldGreekWord = w => w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ς/g, 'σ').replace(/[^\p{Script=Greek}]/gu, '');
export const foldGreekText = s => (s.match(/[\p{L}\p{M}]+/gu) || []).map(foldGreekWord).filter(w => w.length >= 2).join(' ');
const greekLetters = s => (s.match(/\p{Script=Greek}/gu) || []).length;

function ctsMeta(dir) {
  const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  const pick = (x, re) => { const m = x.match(re); return m ? decode(m[1]).replace(/\s+/g, ' ').trim() : null; };
  const g = read(path.join(dir, '..', '__cts__.xml')), w = read(path.join(dir, '__cts__.xml'));
  return {
    author: pick(g, /<ti:groupname[^>]*xml:lang="eng"[^>]*>([\s\S]*?)<\/ti:groupname>/) || pick(g, /<ti:groupname[^>]*>([\s\S]*?)<\/ti:groupname>/),
    title: pick(w, /<ti:title[^>]*xml:lang="eng"[^>]*>([\s\S]*?)<\/ti:title>/) || pick(w, /<ti:title[^>]*>([\s\S]*?)<\/ti:title>/),
    work_xml: w,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const index = {}; let files = 0, kept = 0, chars = 0;
  for (const src of SRC) {
    const data = path.join(src.dir, 'data');
    if (!fs.existsSync(data)) { console.log(`! ${src.name}: ${data} not found`); continue; }
    for (const group of fs.readdirSync(data)) {
      const gdir = path.join(data, group); if (!fs.statSync(gdir).isDirectory()) continue;
      for (const work of fs.readdirSync(gdir)) {
        const wdir = path.join(gdir, work); if (!fs.statSync(wdir).isDirectory()) continue;
        for (const f of fs.readdirSync(wdir)) {
          if (!/-grc\d*\.xml$/.test(f)) continue;
          files++;
          const id = f.replace(/\.xml$/, '');
          const text = flattenTei(fs.readFileSync(path.join(wdir, f), 'utf8'));
          if (greekLetters(text) < 500) continue;
          const meta = ctsMeta(wdir);
          const ed = meta.work_xml.match(new RegExp(`<ti:edition[^>]*urn="urn:cts:greekLit:${id.replace(/\./g, '\\.')}"[\\s\\S]*?<ti:description[^>]*>([\\s\\S]*?)<\\/ti:description>`));
          fs.writeFileSync(path.join(OUT, `${id}.txt`), text);
          fs.writeFileSync(path.join(OUT, `${id}.fold.txt`), foldGreekText(text));
          index[id] = { source: src.name, author: meta.author, title: meta.title, edition: ed ? decode(ed[1]).replace(/\s+/g, ' ').trim().slice(0, 200) : null, url: src.url(id), chars: text.length };
          kept++; chars += text.length;
        }
      }
    }
    console.log(`${src.name}: ${kept} editions so far`);
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
  console.log(`\n${kept}/${files} Greek edition files flattened → ${OUT} (${(chars / 1e6).toFixed(1)} M chars, ${Object.keys(index).length} URNs)`);
}
