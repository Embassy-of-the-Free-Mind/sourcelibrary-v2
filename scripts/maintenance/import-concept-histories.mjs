#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/import-atlas-maps.mjs — the same "copy a private repo's artifacts in, recheck every
//   book link read-only against `books`" shape, and its `lookup()` (id, then _id) is reused here verbatim in spirit.
//   It copies finished HTML/JSON; the histories are claims + markdown that need filtering (status, copyright, private
//   asides), so it does not fit as-is. Looked in scripts/maintenance, scripts/audit, scripts/lib for a concept/claims
//   importer: none.
//
// Copy the conceptual histories (private repo JDerekLomas/conceptual-histories) into sourcelibrary (#7623):
//   src/app/explore/histories/data/index.json            every concept: question, essay list, keep-terms, counts, audit
//   src/app/explore/histories/data/<concept>-essays.json  the essays (ideas/*.md minus README), markdown, refs linked
//   src/app/explore/histories/data/<concept>-claims.json  the claims shown, one page per domain
//
// Rules (#7623, not negotiable):
//   - Claims: `verified` and `partial` only (partial is marked on the page). Unverified and disputed are dropped.
//   - Quote text is kept ONLY for a Source Library source (a sourcelibrary.org /q/ or /book/ url) whose book is public
//     (`visible && pages_count > 0`, looked up by `id`, then `_id`). Any other source keeps its author, title, locator
//     and link and loses its quote text: in-copyright scholarship is cited, never reproduced. A Source Library book
//     that is not public loses its link and its quote.
//   - Essays: [[id]], `id`, <concept>-kb:id, <concept>:id refs become numbered links to
//     /explore/histories/<c>/claims/<domain>#id (one claims page per domain keeps each page a readable size);
//     a ref to a claim that was not kept renders as plain text, never as a dead link.
//   - Private asides: generic rules below ("For Derek" sections, "How we got here" paragraphs), then the per-file
//     redaction lists (--redactions DIR of JSON arrays {file, find, replace, why}); each `find` must match exactly once
//     or the run fails, so a stale list cannot silently publish what it was meant to remove.
//   - Concepts with no essays are skipped, and so is any concept in SKIP.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/import-concept-histories.mjs \
//     --repo /root/conceptual-histories --redactions <dir> [--dry-run] [--report <file.json>]
// The redaction lists live in the PRIVATE repo Embassy-of-the-Free-Mind/sourcelibrary-ops (branch
// histories-redactions-7623, concept-histories/redactions/): each `find` quotes the private text it removes, so they
// must never be committed here.
// Read-only against Mongo. Writes only the data files above.
import fs from 'node:fs';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { withMongo } from '../lib/mongo.mjs';

const argv = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SRC = argv('--repo');
const RED_DIR = argv('--redactions');
const REPORT = argv('--report');
const DRY = process.argv.includes('--dry-run');
if (!SRC || !RED_DIR) { console.error('usage: import-concept-histories.mjs --repo <conceptual-histories checkout> --redactions <dir> [--dry-run] [--report f.json]'); process.exit(1); }
const REPO = path.resolve(new URL('../..', import.meta.url).pathname);
const OUT = path.join(REPO, 'src/app/explore/histories/data');
const SKIP = new Set([]); // a concept still being built goes here (consciousness waited for its wave 1, conceptual-histories#4)
const BASE = '/explore/histories';

// One reader-facing sentence per concept. PURPOSE.md is addressed to the project and is not shown.
const QUESTION = {
  consciousness: 'Where did each tradition put experience: in the soul, the body, their union, a lower vehicle, a faculty, an act of attention, the One? From aisthēsis, synaisthēsis and cit to Cudworth’s and Locke’s “consciousness”, Bewusstsein and the hard problem.',
  aliveness: 'What did people take life to be? Each era’s definition of being alive, the words that carried it in each language, and what people did to make, keep or prolong life.',
  harmony: 'What did people take harmony and resonance to be, from Philolaus and the Chinese classics to Kepler, Helmholtz and the free-energy principle? Ratio and consonance, unlike things joined in one whole, and strings that answer each other.',
  magic: 'What counted as magic, how was it said to work, and who drew the line? Hidden virtues and sympathy, stars and images, spirits, words and names, divination, the witch and her trial, and the power of mind.',
  markets: 'How did the market come to be thought of as a self-ordering, wealth-creating process rather than a place, a moral hazard, a royal privilege or a zero-sum game, from the agora, the Guanzi and the Arthashastra to Smith, Babbage and Marx?',
  nous: 'What was a mind taken to be: a faculty, a cosmic principle, a divine attribute, a skill? And how did the word “intelligence” travel from the celestial Intelligences to superintelligence?',
  soul: 'What is a soul made of, where does it sit, how many does a person have, who has one, does it survive death, and could a machine have one? What each tradition meant by the word we translate “soul”.',
  sympathy: 'Did sympathy move from the cosmos into things, then into the body, the feelings, the brain and society, as the usual story says? And what separates sympathy and resonance (like answering like) from harmony (unlikes joined)?',
};
const TITLE = { aliveness: 'Aliveness', consciousness: 'Consciousness', harmony: 'Harmony', magic: 'Magic', markets: 'Markets', nous: 'Intelligence (nous)', soul: 'Soul', sympathy: 'Sympathy' };
const MAP = { consciousness: '/explore/maps/consciousness', harmony: '/explore/maps/harmony', magic: '/explore/maps/magic' };

const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('//')).map((l) => JSON.parse(l)) : [];
const listJsonl = (d) => fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.jsonl')).sort().map((f) => path.join(d, f)) : [];

// ---- shortlinks (src/lib/shortlinks.ts decodeShortlink, ObjectId and UUID schemes) ----------------------------
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function b62bytes(s, n) { let x = 0n; for (const ch of s) { const i = B62.indexOf(ch); if (i < 0) throw new Error(`bad base62 ${s}`); x = x * 62n + BigInt(i); } const out = new Array(n).fill(0); for (let i = n - 1; i >= 0; i--) { out[i] = Number(x & 255n); x >>= 8n; } return out; }
const hex = (b, n) => b.slice(0, n).map((x) => x.toString(16).padStart(2, '0')).join('');
function decodeQ(code) {
  if (code.length === 26 && code.startsWith('u')) { const h = hex(b62bytes(code.slice(1), 18), 16); return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-'); }
  return hex(b62bytes(code, 14), 12);
}

/** The book a Source Library url points at, or null when the url is not a /q/ or /book/ link. */
function slTarget(url) {
  const m = String(url || '').match(/^https?:\/\/(?:www\.)?sourcelibrary\.org\/(q|book)\/([^/?#]+)/);
  if (!m) return null;
  try { return { kind: m[1], ref: m[1] === 'q' ? decodeQ(m[2]) : decodeURIComponent(m[2]), path: new URL(url).pathname }; } catch { return { kind: m[1], ref: null, path: null }; }
}

async function lookup(db, refs) {
  const proj = { _id: 1, id: 1, slug: 1, visible: 1, pages_count: 1 };
  const books = db.collection('books');
  const rows = await books.find({ id: { $in: refs } }, { projection: proj }).toArray();
  const by = new Map(rows.map((b) => [b.id, b]));
  // books.id first; a re-minted book is reachable by its _id only (book-deletion-and-identity.md); /book/<slug> too
  let rest = refs.filter((r) => !by.has(r));
  const oids = rest.filter((r) => /^[0-9a-f]{24}$/.test(r)).map((r) => new ObjectId(r));
  if (oids.length) for (const b of await books.find({ _id: { $in: oids } }, { projection: proj }).toArray()) by.set(String(b._id), b);
  rest = rest.filter((r) => !by.has(r));
  if (rest.length) for (const b of await books.find({ slug: { $in: rest } }, { projection: proj }).toArray()) by.set(b.slug, b);
  return by;
}
const isPublic = (b) => !!b && b.visible === true && (b.pages_count || 0) > 0;

// ---- audit figures from CONCEPTS.md ---------------------------------------------------------------------------
function audits() {
  const txt = fs.readFileSync(path.join(SRC, 'CONCEPTS.md'), 'utf8');
  const out = {};
  for (const m of txt.matchAll(/^(\w+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+n=(\d+), (\d+) rejected \((\d+)%\), (\d+)–(\d+)%, (\d{4}-\d{2}-\d{2})$/gm)) {
    out[m[1]] = { n: +m[2], rejected: +m[3], pct: +m[4], lo: +m[5], hi: +m[6], date: m[7] };
  }
  if (!out.ALL) throw new Error('CONCEPTS.md: no ALL audit row — the table format changed');
  const judge = txt.match(/caught (\d+) of (\d+) planted mutants \((\d+)%, (\d+)–(\d+)%\)/);
  if (!judge) throw new Error('CONCEPTS.md: no planted-mutant sentence');
  out.judge = { caught: +judge[1], planted: +judge[2], pct: +judge[3], lo: +judge[4], hi: +judge[5] };
  // "Rejected claims were corrected or set `disputed` (not in markets)"
  const nc = txt.match(/corrected or set `disputed` \(not in ([a-z, ]+)\)/);
  out.uncorrected = nc ? nc[1].split(/,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean) : [];
  return out;
}

// ---- essays -----------------------------------------------------------------------------------------------------
const REDACTIONS = fs.readdirSync(RED_DIR).filter((f) => f.endsWith('.json')).sort()
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(RED_DIR, f), 'utf8')).map((r) => ({ ...r, list: f })));
const redLog = [];

/** Remove "For Derek" sections and "How we got here" paragraphs; return [text, count]. */
function genericRedactions(md, file) {
  const lines = md.split('\n'); const out = []; let skipLevel = 0; let n = 0;
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h && skipLevel && h[1].length <= skipLevel) skipLevel = 0;
    if (h && /^For Derek\b/i.test(h[2].trim())) { skipLevel = h[1].length; n++; redLog.push({ file, rule: 'section "For Derek" removed', text: h[2].trim() }); continue; }
    if (!skipLevel) out.push(line);
  }
  let text = out.join('\n');
  text = text.replace(/(^|\n\n)\*\*How we got here\.\*\*[\s\S]*?(?=\n\n|$)/g, (m, lead) => { n++; redLog.push({ file, rule: '"How we got here" paragraph removed', text: m.trim().slice(0, 120) }); return lead; });
  // Table rows whose status cell is ○ (unverified) or ✗ (disputed) are claims that are not shown (the timelines are
  // generated one row per claim). A dropped row that opens a group (when | author | work) hands those cells to the
  // next kept row of its group, so a claim never slides under the previous work.
  const rows = text.split('\n'); const kept = []; let head = null;
  for (const line of rows) {
    const cells = line.startsWith('|') ? line.split('|').slice(1, -1).map((x) => x.trim()) : null;
    if (!cells || cells.length < 2 || /^:?-+:?$/.test(cells[0])) { head = null; kept.push(line); continue; }
    const hasHead = cells[0] !== '';
    if (/^[○✗]$/.test(cells.at(-1))) {
      n++; redLog.push({ file, rule: `table row with status ${cells.at(-1)} removed (claim not shown)`, text: cells.join(' | ').slice(0, 120) });
      head = hasHead ? cells.slice(0, 3) : head;
      continue;
    }
    if (!hasHead && head) { cells.splice(0, head.length, ...head); kept.push(`| ${cells.join(' | ')} |`); }
    else kept.push(line);
    head = null;
  }
  return [kept.join('\n'), n];
}

function cleanTitle(t) {
  let s = t.replace(/^#\s+/, '').trim();
  if (/^U[a-z]/.test(s)) s = s.slice(1); // magic's generated titles carry a stray leading "U"
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildEssay(concept, file, raw, claimIndex, essaySlugs, stats) {
  const rel = `${concept}/ideas/${file}`;
  let md = raw;
  // per-file lists first (they were written against the original text), then the generic rules
  for (const r of REDACTIONS.filter((x) => x.file === rel)) {
    const n = md.split(r.find).length - 1;
    if (n !== 1) throw new Error(`${r.list}: ${rel}: expected 1 match, found ${n}: ${r.find.slice(0, 80)}`);
    md = md.replace(r.find, () => r.replace); r.used = true;
    redLog.push({ file: rel, rule: r.why, text: r.find.replace(/\s+/g, ' ').slice(0, 160), to: r.replace.replace(/\s+/g, ' ').slice(0, 160) });
  }
  let g; [md, g] = genericRedactions(md, rel); stats.generic += g;

  const h1 = md.match(/^#\s+.*$/m);
  const title = h1 ? cleanTitle(h1[0]) : file.replace(/\.md$/, '');
  if (h1) md = md.replace(h1[0], '').replace(/^\s+/, '');

  // claim refs → numbered links; numbering per essay, first-seen order. Each ref becomes a placeholder first, so a
  // later pattern can never re-read a marker an earlier one wrote ([[1]] looks like a [[claim-id]]).
  const num = new Map(); const marks = [];
  const mark = (s) => { marks.push(s); return `\u0001${marks.length - 1}\u0002`; };
  const ref = (c, id) => {
    const hit = claimIndex.get(c)?.get(id);
    if (!hit) {
      // not shown on the site: say why in plain text, never a dead link
      const status = STATUS.get(`${c}:${id}`);
      stats.refsPlain++; (stats.plain ||= []).push(`${c}:${id} (${status || 'unknown'})`);
      return mark(status === 'unverified' || status === 'disputed' ? `[${status}]` : SKIP.has(c) ? '[not yet published]' : '[not in the record]');
    }
    const key = `${c}:${id}`;
    if (!num.has(key)) num.set(key, num.size + 1);
    stats.refsLinked++;
    return mark(`[[${num.get(key)}]](${BASE}/${c}/claims/${hit.d}#${id})`);
  };
  const known = (c) => claimIndex.has(c) || SKIP.has(c);
  // `concept-kb:id` / `concept:id`, then concept-kb `id`, then [[id]] / [[concept:id]], then bare concept-kb:id, then `id`
  md = md.replace(/`([a-z]+)(?:-kb)?:([a-z0-9][a-z0-9-]*[a-z0-9])`/g, (m, c, id) => known(c) ? ref(c, id) : m);
  md = md.replace(/\b([a-z]+)-kb\s+`([a-z0-9][a-z0-9-]*[a-z0-9])`/g, (m, c, id) => known(c) ? `${c === concept ? '' : TITLE[c] || c} ${ref(c, id)}`.trim() : m);
  md = md.replace(/\[\[(?:([a-z]+)(?:-kb)?:)?([^\]\s|]+)\]\]/g, (m, c, id) => ref(c && known(c) ? c : concept, id));
  md = md.replace(/(?<![a-z-])([a-z]+)-kb:([a-z0-9][a-z0-9-]*[a-z0-9])/g, (m, c, id) => known(c) ? ref(c, id) : m);
  md = md.replace(/`([a-z0-9][a-z0-9-]*[a-z0-9])`/g, (m, id) => (claimIndex.get(concept)?.has(id) || STATUS.has(`${concept}:${id}`) ? ref(concept, id) : m));
  md = md.replace(/\u0001(\d+)\u0002/g, (_, i) => marks[+i]);
  // relative .md links: an essay of a published concept becomes a site link, anything else loses its link
  md = md.replace(/\[([^\]]+)\]\(((?!https?:|\/|#)[^)\s]+)\)/g, (m, text, href) => {
    const clean = href.split('#')[0];
    const parts = clean.split('/').filter((p) => p && p !== '.' && p !== '..');
    const base = parts.at(-1)?.replace(/\.md$/, '');
    const c = parts.length >= 3 && parts.at(-2) === 'ideas' ? parts.at(-3) : (parts.length === 2 && parts[0] === 'ideas' ? concept : (parts.length === 1 ? concept : null));
    if (c && base && essaySlugs.get(c)?.has(base)) { stats.essayLinks++; return `[${text}](${BASE}/${c}/${base})`; }
    stats.linksDropped++; return text;
  });
  // links into the private repo or the local machine go too
  md = md.replace(/\[([^\]]+)\]\((?:file:|https?:\/\/github\.com\/JDerekLomas\/)[^)]*\)/g, (m, text) => { stats.linksDropped++; return text; });
  const refs = [...num.keys()];
  return { slug: file.replace(/\.md$/, ''), title, md: md.trim() + '\n', refs: refs.length };
}

// ---- main -------------------------------------------------------------------------------------------------------
const AUD = audits();
const concepts = fs.readdirSync(path.join(SRC, 'concepts')).filter((c) => fs.existsSync(path.join(SRC, 'concepts', c, 'claims'))).sort();
const report = { generated: new Date().toISOString().slice(0, 10), concepts: {}, skipped: [] };

// pass 1: claims and sources, every concept (so cross-concept refs resolve)
const raw = {};
for (const c of concepts) {
  const dir = path.join(SRC, 'concepts', c);
  const ideas = fs.existsSync(path.join(dir, 'ideas')) ? fs.readdirSync(path.join(dir, 'ideas')).filter((f) => f.endsWith('.md') && f !== 'README.md').sort() : [];
  if (SKIP.has(c)) { report.skipped.push({ concept: c, why: 'in SKIP' }); continue; }
  if (!ideas.length) { report.skipped.push({ concept: c, why: 'no essays yet' }); continue; }
  if (!TITLE[c] || !QUESTION[c]) throw new Error(`${c}: no TITLE/QUESTION entry — write the reader-facing question before publishing it`);
  const reg = new Map();
  for (const f of [path.join(dir, 'sources.jsonl'), ...listJsonl(path.join(dir, 'sources.d'))]) for (const s of readJsonl(f)) reg.set(s.id, s);
  const claims = listJsonl(path.join(dir, 'claims')).flatMap(readJsonl);
  raw[c] = { dir, ideas, reg, claims };
}

const STATUS = new Map(Object.entries(raw).flatMap(([c, v]) => v.claims.map((cl) => [`${c}:${cl.id}`, cl.verification?.status])));
const refs = new Set();
for (const { reg, claims } of Object.values(raw)) for (const cl of claims) for (const s of cl.sources || []) {
  const r = reg.get(s.id) || {};
  const t = slTarget(s.url || r.sl?.url || r.url) || (r.sl?.book_id ? { ref: r.sl.book_id } : null);
  if (t?.ref) refs.add(t.ref);
}

let by; await withMongo(async (db) => { by = await lookup(db, [...refs]); }); // withMongo returns nothing
console.log(`books: ${refs.size} referenced, ${by.size} resolved, ${[...refs].filter((r) => isPublic(by.get(r))).length} public`);

const claimIndex = new Map();
const kept = {};
for (const [c, { reg, claims }] of Object.entries(raw)) {
  const st = { claims: claims.length, verified: 0, partial: 0, dropped: { unverified: 0, disputed: 0, other: 0 },
    sources: 0, quotesKept: 0, quotesDroppedCopyright: 0, quotesDroppedNotPublic: 0, slLinksDropped: 0 };
  const out = [];
  for (const cl of claims) {
    const status = cl.verification?.status;
    if (status !== 'verified' && status !== 'partial') { st.dropped[status in st.dropped ? status : 'other']++; continue; }
    st[status]++;
    const src = (cl.sources || []).map((s) => {
      st.sources++;
      const r = reg.get(s.id) || {};
      const url = s.url || r.sl?.url || r.url || null;
      const t = slTarget(url) || (!url && r.sl?.book_id ? { kind: 'book', ref: r.sl.book_id, path: `/book/${r.sl.book_id}` } : null);
      const authors = (r.authors || []).join(', ');
      const label = [authors, r.year, r.title].filter(Boolean).join(', ') || s.id;
      const o = { l: label };
      if (s.locator) o.loc = s.locator;
      if (t) {
        const b = t.ref ? by.get(t.ref) : null;
        if (isPublic(b)) {
          o.u = t.kind === 'book' ? `/book/${b.id || String(b._id)}` : t.path;
          if (s.quote) { o.q = s.quote; st.quotesKept++; }
          if (s.quote_original) o.qo = s.quote_original;
        } else {
          st.slLinksDropped++;
          if (s.quote) st.quotesDroppedNotPublic++;
          o.np = 1; // held, not public: named without a link
        }
      } else {
        if (s.quote) st.quotesDroppedCopyright++;
        if (url && /^https?:\/\//.test(url) && !/github\.com\/JDerekLomas\//.test(url)) o.u = url;
      }
      return o;
    });
    out.push({ id: cl.id, s: cl.statement, d: cl.domain, k: cl.kind, p: status === 'partial' ? 1 : undefined, src });
  }
  claimIndex.set(c, new Map(out.map((x) => [x.id, x])));
  kept[c] = { claims: out, st };
}

const essaySlugs = new Map(Object.entries(raw).map(([c, v]) => [c, new Set(v.ideas.map((f) => f.replace(/\.md$/, '')))]));
const index = { generated: report.generated, audit: { all: AUD.ALL, judge: AUD.judge }, concepts: [] };
if (!DRY) fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [c, { dir, ideas }] of Object.entries(raw)) {
  const est = { generic: 0, refsLinked: 0, refsPlain: 0, essayLinks: 0, linksDropped: 0 };
  const essays = ideas.map((f) => buildEssay(c, f, fs.readFileSync(path.join(dir, 'ideas', f), 'utf8'), claimIndex, essaySlugs, est));
  const keep = readJsonl(path.join(dir, 'keep-terms.jsonl')).map((k) => {
    // the first of the term's claims that is shown is its evidence link
    const id = (k.claims || []).find((x) => claimIndex.get(c).has(x));
    return { term: k.term, translit: k.translit, lang: k.lang, gloss: k.gloss, avoid: k.avoid || [],
      ...(id ? { evidence: `${BASE}/${c}/claims/${claimIndex.get(c).get(id).d}#${id}` } : {}) };
  });
  const { claims, st } = kept[c];
  const domains = [...new Set(claims.map((x) => x.d))];
  const a = AUD[c] || null;
  index.concepts.push({
    slug: c, title: TITLE[c], question: QUESTION[c], map: MAP[c] || null,
    essays: essays.map((e) => ({ slug: e.slug, title: e.title })),
    keepTerms: keep, domains,
    counts: { verified: st.verified, partial: st.partial, dropped: st.dropped.unverified + st.dropped.disputed + st.dropped.other, essays: essays.length },
    audit: a ? { ...a, corrected: !AUD.uncorrected.includes(c) } : null,
  });
  report.concepts[c] = { ...st, essays: essays.length, ...est };
  if (!DRY) {
    for (const [name, data] of [[`${c}-essays.json`, essays.map(({ slug, title, md }) => ({ slug, title, md }))], [`${c}-claims.json`, claims]]) {
      const f = path.join(OUT, name); fs.writeFileSync(f, JSON.stringify(data)); total += fs.statSync(f).size;
    }
  }
}
const unused = REDACTIONS.filter((r) => !r.used && essaySlugs.get(r.file.split('/')[0])?.has(path.basename(r.file, '.md')));
if (unused.length) throw new Error(`redactions never applied: ${unused.map((r) => r.file).join(', ')}`);
if (!DRY) { const f = path.join(OUT, 'index.json'); fs.writeFileSync(f, JSON.stringify(index, null, 1) + '\n'); total += fs.statSync(f).size; }
report.redactions = redLog;
console.table(Object.fromEntries(Object.entries(report.concepts).map(([c, s]) => [c, { shown: s.verified + s.partial, partial: s.partial, dropped: s.dropped.unverified + s.dropped.disputed + s.dropped.other, essays: s.essays, quotesKept: s.quotesKept, quotesCopyright: s.quotesDroppedCopyright, quotesNotPublic: s.quotesDroppedNotPublic, refsLinked: s.refsLinked, refsPlain: s.refsPlain }])));
console.log('skipped', report.skipped, '\nredactions', redLog.length, DRY ? '(dry run, nothing written)' : `\nwrote ${OUT} ${(total / 1e6).toFixed(2)} MB`);
if (REPORT) fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
