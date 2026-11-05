#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/import-concept-histories.mjs — writes the histories' essays and claims; its decodeQ()
//   reads only the book from a /q/ code, and it knows nothing of pictures. This is its second step: it reads what the
//   importer wrote and adds the printed page behind each quote the pages show. Looked in scripts/maintenance and
//   scripts/lib for a /q/ → page-image resolver usable from a script: none (src/lib/shortlinks.ts is TypeScript).
//
// The quotes and pages the conceptual histories show (#7623), written to
//   src/app/explore/histories/content/figures.json
// From content/picks.json (hand-chosen, checked in): each concept's card quote. Chosen here, by rule:
//   - essays: one library quote per ## section, from the first claim the section cites that has a Source Library
//     quote in English (verified claims before partial ones), not already quoted in the essay's own text, and not
//     from a page already shown earlier in the essay. Sections about the project itself ("What changed", "Open questions", "Evidence still
//     missing") get none. A section with no such claim gets none: no filler.
//   - concept page: three key quotes, the first section quote of the essays after the opening one.
// Each quote's /q/ code is decoded to (book, page) and the page's image fields are read from Mongo, so the page can
// resolve the picture with src/lib/page-image-url.ts. A book that is not public (`visible && pages_count > 0`) or a
// page with no image drops the quote.
//
// Read-only against Mongo. Run after the importer:
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/concept-history-figures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { withMongo } from '../lib/mongo.mjs';

const REPO = path.resolve(new URL('../..', import.meta.url).pathname);
const DIR = path.join(REPO, 'src/app/explore/histories/content');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const index = read('index.json');
const picks = read('picks.json');

// ---- /q/ codes (src/lib/shortlinks.ts decodeShortlink) -------------------------------------------------------
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function b62bytes(s, n) { let x = 0n; for (const ch of s) { const i = B62.indexOf(ch); if (i < 0) throw new Error(`bad base62 ${s}`); x = x * 62n + BigInt(i); } const out = new Array(n).fill(0); for (let i = n - 1; i >= 0; i--) { out[i] = Number(x & 255n); x >>= 8n; } return out; }
const hex = (b, n) => b.slice(0, n).map((x) => x.toString(16).padStart(2, '0')).join('');
function decodeQ(code) {
  if (code.length === 26 && code.startsWith('u')) {
    const b = b62bytes(code.slice(1), 18); const h = hex(b, 16);
    return { book: [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-'), page: (b[16] << 8) | b[17] };
  }
  const b = b62bytes(code, 14);
  return { book: hex(b, 12), page: (b[12] << 8) | b[13] };
}

// ---- choosing ----------------------------------------------------------------------------------------------------
const NO_FIGURE = /^(what changed|open questions|evidence still missing|how to read)/i;
// The library's English: Latin script, reads as English, long enough to say something and short enough to read.
const english = (q) => {
  const letters = q.replace(/[^\p{L}]/gu, ''); const latin = q.replace(/[^A-Za-z]/g, '');
  return letters.length > 0 && latin.length / letters.length > 0.97 && /\b(the|of|and|is|to)\b/.test(q) && q.length >= 50 && q.length <= 420;
};
const norm = (s) => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
/** True when any six running words of the quote are already in the text (the essay quotes it itself). */
const quotedIn = (text, q) => { const w = norm(q).split(' '); for (let i = 0; i + 6 <= w.length; i++) if (text.includes(` ${w.slice(i, i + 6).join(' ')} `)) return true; return false; };

/** The sources of one claim worth showing as a SourceQuote, best first. */
function quotable(claim) {
  return claim.src.map((s, i) => ({ s, i })).filter(({ s }) => s.u?.startsWith('/q/') && s.q && english(s.q));
}

function sectionsOf(md) {
  const parts = md.split(/^(?=## )/m);
  return parts.map((p, i) => ({ i, heading: i === 0 && !p.startsWith('## ') ? '' : p.match(/^## (.*)$/m)[1].trim(), md: p }));
}
const claimRefs = (md) => [...md.matchAll(/\]\(\/explore\/histories\/([a-z]+)\/claims\/[^#)]+#([^)\s]+)\)/g)].map((m) => ({ c: m[1], id: m[2] }));

const claims = new Map();
const claimsOf = (c) => { if (!claims.has(c)) claims.set(c, new Map(read(`${c}-claims.json`).map((x) => [x.id, x]))); return claims.get(c); };

function pickForSection(sec, used, essayText) {
  if (sec.heading && NO_FIGURE.test(sec.heading.replace(/^[\d.A-Z]+\.\s*/, ''))) return null;
  const cands = [];
  for (const r of claimRefs(sec.md)) {
    const cl = claimsOf(r.c).get(r.id); if (!cl) continue;
    for (const { s, i } of quotable(cl)) cands.push({ c: r.c, cl, s, i });
  }
  cands.sort((a, b) => (a.cl.p ? 1 : 0) - (b.cl.p ? 1 : 0)); // stable: section order within verified, then partial
  for (const x of cands) {
    if (used.has(x.s.u) || quotedIn(essayText, x.s.q)) continue;
    used.add(x.s.u);
    return { concept: x.c, claim: x.cl.id, src: x.i };
  }
  return null;
}

const out = { generated: new Date().toISOString().slice(0, 10), concepts: {}, essays: {} };
const refs = [];
for (const c of index.concepts) {
  const essays = read(`${c.slug}-essays.json`);
  const pick = picks.concepts[c.slug];
  if (!pick) throw new Error(`picks.json: no entry for ${c.slug} — choose its picture, word, quote and opening by eye`);
  const op = essays.find((e) => e.slug === pick.opening.essay);
  if (!op || !sectionsOf(op.md).some((s) => s.heading === pick.opening.section)) throw new Error(`picks.json: ${c.slug} opening ${pick.opening.essay} / "${pick.opening.section}" not found`);
  const [qid, qi] = pick.quote.split('#');
  const qc = claimsOf(c.slug).get(qid);
  if (!qc || qc.p || !qc.src[+qi]?.q || !qc.src[+qi].u?.startsWith('/q/')) throw new Error(`picks.json: ${c.slug} quote ${pick.quote} is not a verified claim with a library quote`);
  const card = { concept: c.slug, claim: qid, src: +qi };
  refs.push(card);
  const key = [];
  for (const e of essays) {
    const used = new Set();
    const figs = {};
    const essayText = ` ${norm(e.md)} `;
    for (const sec of sectionsOf(e.md)) { const f = pickForSection(sec, used, essayText); if (f) { figs[sec.i] = f; refs.push(f); } }
    out.essays[`${c.slug}/${e.slug}`] = figs;
    if (e.slug !== pick.opening.essay && key.length < 3) { const first = Object.values(figs)[0]; if (first) key.push(first); }
  }
  out.concepts[c.slug] = { card, key };
}

// ---- resolve every quote to its page (read-only) --------------------------------------------------------------
const pages = {};
await withMongo(async (db) => {
  const want = new Map();
  for (const r of refs) { const s = claimsOf(r.concept).get(r.claim).src[r.src]; const code = s.u.slice(3); want.set(code, decodeQ(code)); }
  const bookIds = [...new Set([...want.values()].map((x) => x.book))];
  const proj = { _id: 1, id: 1, slug: 1, visible: 1, pages_count: 1 };
  const books = new Map();
  for (const b of await db.collection('books').find({ id: { $in: bookIds } }, { projection: proj }).toArray()) books.set(b.id, b);
  const oids = bookIds.filter((x) => !books.has(x) && /^[0-9a-f]{24}$/.test(x)).map((x) => new ObjectId(x));
  if (oids.length) for (const b of await db.collection('books').find({ _id: { $in: oids } }, { projection: proj }).toArray()) books.set(String(b._id), b);
  const IMG = { _id: 0, book_id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, enhanced_photo: 1, cropped_photo: 1, display_photo: 1, image_thumb: 1, split_from_spread: 1, crop: 1 };
  for (const [code, { book, page }] of want) {
    const b = books.get(book);
    if (!b || b.visible !== true || !(b.pages_count > 0)) continue;
    const pg = await db.collection('pages').findOne({ book_id: b.id || book, page_number: page }, { projection: IMG });
    if (!pg) continue;
    const img = Object.fromEntries(Object.entries(pg).filter(([k]) => k !== 'book_id' && k !== 'page_number'));
    if (!Object.keys(img).length) continue;
    pages[code] = { book: b.slug || b.id || book, page, img };
  }
});

// Drop what did not resolve, then write: each figure carries what the page shows, so a route never loads claims for it.
const fig = (r) => {
  const s = claimsOf(r.concept).get(r.claim).src[r.src]; const code = s.u.slice(3); const p = pages[code];
  if (!p) return null;
  return { claim: r.claim, concept: r.concept, q: s.q, ...(s.qo ? { qo: s.qo } : {}), l: s.l, ...(s.loc ? { loc: s.loc } : {}), u: s.u, book: p.book, page: p.page, img: p.img };
};
let shown = 0, dropped = 0, sections = 0;
for (const [k, figs] of Object.entries(out.essays)) {
  const ess = read(`${k.split('/')[0]}-essays.json`).find((e) => e.slug === k.split('/')[1]);
  sections += sectionsOf(ess.md).length;
  for (const [i, r] of Object.entries(figs)) { const f = fig(r); if (f) { figs[i] = f; shown++; } else { delete figs[i]; dropped++; } }
}
for (const [c, v] of Object.entries(out.concepts)) {
  const card = fig(v.card);
  if (!card) throw new Error(`picks.json: ${c} card quote ${v.card.claim} has no public page image`);
  out.concepts[c] = { card, key: v.key.map(fig).filter(Boolean) };
}
fs.writeFileSync(path.join(DIR, 'figures.json'), JSON.stringify(out) + '\n');
console.log(`essays: ${Object.keys(out.essays).length}, sections: ${sections}, sections with a library quote: ${shown}, dropped (no public page image): ${dropped}`);
for (const c of index.concepts) {
  const es = Object.entries(out.essays).filter(([k]) => k.startsWith(`${c.slug}/`));
  const none = es.filter(([, f]) => !Object.keys(f).length).map(([k]) => k.split('/')[1]);
  console.log(`${c.slug}: ${es.reduce((n, [, f]) => n + Object.keys(f).length, 0)} quotes in ${es.length} essays${none.length ? `; none in ${none.join(', ')}` : ''}`);
}
