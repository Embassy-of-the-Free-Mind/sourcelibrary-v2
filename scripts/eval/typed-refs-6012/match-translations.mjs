#!/usr/bin/env node
// #6012 step 3, EEBO-TCP only: English texts that TRANSLATE a work we hold in Latin or German.
// Work level (work-identity.md): the claim attaches to our work_id, never to one edition. Read-only,
// from the local books projection and the EEBO manifest. $0.
//
// Evidence, strongest first, kept on every row:
//   uniform-title   the TCP header (from the MARC record) names the original and the language:
//                   "Helvetius, Johann Friedrich, d. 1709. Vitulus aureus … English." The cataloguer says it
//                   is a translation and of what; our title must CONTAIN that uniform title and the
//                   author must agree (scripts/lib/work-identity-match.mjs `uniformTitleContainment`).
//   author+title    the first-named author is the author of a book we hold, the English title says it is
//                   translated ("translated out of", "Englished", "written in Latin by"), and the two
//                   titles share a distinctive stem ("Archidoxis", "Basilica chymica").
//   author-only     author and translation statement agree, no title link: which of the author's works it
//                   translates is NOT established. Counted apart; never a work-level match.
//
// PRIOR ART: scripts/lib/work-identity-match.mjs (uniform-title containment, the gold-set-pinned rule for
//   "is this catalogue record the same WORK as this book") and scripts/lib/name-equivalence.mjs
//   (`sameNameForm`) are imported, not reimplemented. scripts/analysis/loc-marc-translations.json is the LoC
//   MARC list of modern translations (#2453); it has no 17th-century printing. Nothing joins TCP to works.
//
//   node scripts/eval/typed-refs-6012/match-translations.mjs [--work=DIR]
// Writes <work>/eebo/translations.jsonl

import fs from 'node:fs';
import path from 'node:path';
import { editionSurname } from '../../lib/identity-fields.mjs';
import { titleTokens, stem, bookTitleTokens, uniformTitleContainment } from '../../lib/work-identity-match.mjs';
import { sameNameForm, nameStems } from '../../lib/name-equivalence.mjs';
import { argOf } from './lib.mjs';

const WORK = argOf('work', '/data/scratch/sl/typed-refs-6012');
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ORIG = new Set(['Latin', 'German']);
const ours = readJsonl(`${WORK}/books.jsonl`).filter((b) => ORIG.has(b.language) && b.text_role !== 'modern-translation' && b.author && !/^(unknown|anonymous|various)/i.test(b.author));
const bySurStem = new Map();
for (const b of ours) {
  b._sur = editionSurname(String(b.author).split(/;|&| and /)[0]);
  b._toks = bookTitleTokens(b.title);
  b._stems = new Set(b._toks.filter((t) => t.length >= 6).map(stem));
  for (const s of nameStems(b._sur)) { if (s.length < 4) continue; if (!bySurStem.has(s)) bySurStem.set(s, []); bySurStem.get(s).push(b); }
}
// A stem that many of our titles carry is a genre word, not a title ("historia", "tractatus", "medicina").
const df = new Map();
for (const b of ours) for (const s of b._stems) df.set(s, (df.get(s) || 0) + 1);
const distinctive = (s) => (df.get(s) || 0) <= 60;
// Rarity counted over AUTHORS, not books: we hold Paracelsus' Archidoxa in a dozen editions, and a count
// over books called its one distinctive word common.
const adf = new Map();
for (const b of ours) for (const s of b._stems) { if (!adf.has(s)) adf.set(s, new Set()); adf.get(s).add(b._sur); }
const authorsWith = (s) => adf.get(s)?.size || 0;

const MARK = /\btranslat|\benglished\b|\bout of (the )?(latin|high[- ]?dutch|german|low[- ]?dutch|teutonick)|\b(done|put|turned|rendered|made) in(to)? english\b|\bwritten (originally |first )?in (latin|high[- ]?dutch|german)|\bfaithfully (rendred|rendered)\b/i;
const DATES = /,?\s*(?:(?:ca\.|fl\.|b\.|d\.)\s*)?\d{3,4}\??(?:\s*(?:or|-)\s*(?:ca\.\s*)?\d{0,4}\??)*\.?|,?\s*\d+(?:th|st|nd|rd) cent\.?(?:\s*B\.C\.)?/;
function segments(author) {
  return String(author || '').split(';').map((s) => s.trim()).filter(Boolean).map((seg) => {
    const m = seg.match(DATES);
    const name = (m ? seg.slice(0, m.index) : seg.split('. ')[0]).replace(/[.,]\s*$/, '').trim();
    const rest = m ? seg.slice(m.index + m[0].length).replace(/^[.\s]+/, '') : seg.split('. ').slice(1).join('. ');
    const eng = rest.match(/^(.*?)\.\s*English\b/);
    return { name, surname: editionSurname(name), uniform: eng ? eng[1].trim() : null, rest };
  });
}
// Surname agreement is not identity (John Barclay / William Barclay; Saint Cyprian / Johann Cyprian): where
// both sides give other name parts, one of them must agree too (Julius ~ Gaius Iulius).
const otherParts = (name, surname) => [...nameStems(String(name || '').replace(/\(.*?\)/g, ' '))].filter((t) => t.length >= 3 && ![...nameStems(surname)].includes(t) && !/^(saint|sir|pope|bishop|king|von|der|van)$/.test(t));
const givenAgree = (aName, aSur, bName, bSur) => {
  const A = otherParts(aName, aSur), B = otherParts(bName, bSur);
  if (!A.length || !B.length) return true;
  return A.some((x) => B.some((y) => x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x))) || sameNameForm(x, y)));
};
const cands = (surname) => { const out = new Set(); for (const s of nameStems(surname)) for (const b of bySurStem.get(s) || []) if (sameNameForm(surname, b._sur)) out.add(b); return [...out]; };

const manifest = readJsonl(path.join(WORK, 'eebo', 'manifest.jsonl'));
const out = fs.createWriteStream(path.join(WORK, 'eebo', 'translations.jsonl'));
const tally = {}, tallyConf = {}; let authorOnly = 0;
for (const r of manifest) {
  if (!/eng|sco/.test(r.language || '')) continue;
  const segs = segments(r.author);
  if (!segs.length) continue;
  const marked = MARK.test(r.title || '');
  const rows = new Map();
  const add = (b, tier, confidence, reason) => { const old = rows.get(b.id); const rank = { 'uniform-title': 3, 'author+title': 2, 'author-only': 1 }; if (!old || rank[tier] > rank[old.tier]) rows.set(b.id, { source: 'eebo-tcp', source_id: r.source_id, book_id: b.id, kind: tier === 'author-only' ? 'english-translation-of-our-author' : 'english-translation-of-our-work', tier, confidence, reason,
    work_id: b.work_id || null, tcp: { title: String(r.title || '').slice(0, 160), author: r.author, year: r.year, phase: r.phase, chars: r.chars }, book: { title: String(b.title || '').slice(0, 140), author: b.author, published: b.published ?? null, language: b.language, visible: !!b.visible, pages_translated: b.pages_translated || 0 } }); };
  // 1. uniform title + "English"
  for (const s of segs) if (s.uniform && s.surname.length >= 4) for (const b of cands(s.surname)) {
    if (!givenAgree(s.name, s.surname, String(b.author).split(/;|&| and /)[0], b._sur)) continue;
    const hit = uniformTitleContainment(b._toks, s.uniform, { bookAuthorSurname: 'x', recordAuthorSurnames: ['x'] });   // the author already agrees (cands)
    if (hit) add(b, 'uniform-title', 'high', `TCP header: "${s.name}. ${s.uniform}. English"; our title contains that uniform title; author ${b.author}`);
  }
  // 2. first-named author + translation statement + a distinctive shared title stem
  const main = segs[0];
  if (marked && main.surname.length >= 4) {
    const tt = new Set(titleTokens(r.title).filter((t) => t.length >= 6).map(stem));
    for (const b of cands(main.surname)) {
      if (!givenAgree(main.name, main.surname, String(b.author).split(/;|&| and /)[0], b._sur)) continue;
      // Names carry no work identity: every title by an author can contain the author (personalNameTokens' rule).
      const nameToks = new Set(titleTokens(`${segs.map((x) => x.name).join(' ')} ${b.author}`.replace(/\d{3,4}/g, ' ')).map(stem));
      const uv = (t) => t.replace(/v/g, 'u').replace(/j/g, 'i').replace(/y/g, 'i');
      const isName = (t) => [...nameToks].some((n) => uv(n).slice(0, 4) === uv(t).slice(0, 4));   // Hemmingsen / Hemmingii, Boethius / Boetii, Urbanus / Vrbani
      const shared = [...tt].filter((t) => t.length >= 5 && b._stems.has(t) && distinctive(t) && !isName(t) && !/^(teutonic|philosoph|german|engl|latin|compil|translat|world|booke?$|treatis|written|learned)/.test(t));
      // One shared stem is right about half the time (read: 23 pairs, 2026-10-06), so it counts only when the
      // stem is rare in our titles, and then as a candidate, not a match.
      const mine = cands(main.surname);
      const within = (t) => mine.filter((x) => x._stems.has(t)).length / Math.max(1, mine.length);   // share of this author's held books whose title has the stem
      const strong = shared.length >= 2, weak = shared.length === 1 && shared[0].length >= 6 && (authorsWith(shared[0]) <= 3 || within(shared[0]) <= 0.5);
      if (strong || weak) add(b, 'author+title', strong ? 'high' : 'medium', `author ${main.name} = ${b.author}; the English title says it is translated; shared title stems: ${shared.slice(0, 5).join(', ')}`);
      else add(b, 'author-only', 'low', `author ${main.name} = ${b.author}; the English title says it is translated; which work is not established`);
    }
  }
  const vals = [...rows.values()];
  const work = vals.filter((v) => v.tier !== 'author-only');
  for (const v of work) tallyConf[`${v.tier}|${v.confidence}`] = (tallyConf[`${v.tier}|${v.confidence}`] || 0) + 1;
  if (work.length) { for (const v of work) { tally[v.tier] = (tally[v.tier] || 0) + 1; out.write(JSON.stringify(v) + '\n'); } }
  else if (vals.length) { authorOnly++; out.write(JSON.stringify({ ...vals[0], book_id: null, book: null, work_id: null, held_books_by_author: vals.length, reason: vals[0].reason }) + '\n'); }
}
out.end(); await new Promise((res) => out.on('finish', res));
const rowsOut = readJsonl(path.join(WORK, 'eebo', 'translations.jsonl'));
const w = rowsOut.filter((x) => x.book_id && x.confidence === 'high');
const cand = rowsOut.filter((x) => x.book_id && x.confidence !== 'high');
console.log(JSON.stringify({ our_latin_german_books_with_author: ours.length, tcp_texts: manifest.length, pairs_by_tier: tally, pairs_by_tier_confidence: tallyConf, candidate_tcp_texts_single_stem: new Set(cand.map((x) => x.source_id)).size, tcp_texts_work_level: new Set(w.map((x) => x.source_id)).size, our_books: new Set(w.map((x) => x.book_id)).size,
  our_works: new Set(w.map((x) => x.work_id || `book:${x.book_id}`)).size, tcp_texts_author_only: authorOnly }));
