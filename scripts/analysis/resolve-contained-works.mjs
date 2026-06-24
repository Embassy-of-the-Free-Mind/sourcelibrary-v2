#!/usr/bin/env node
/**
 * Contained-works resolver (PROTOTYPE) — the compilation blind spot of the
 * work-id mint. A single book.work_id can't represent an omnibus that bundles
 * several distinct works (Ficino's 1497 Aldine volume = Iamblichus *De Mysteriis*
 * + Proclus + Porphyry + Synesius + Psellus, each in Ficino's Latin). The
 * author+title key picks ONE contained work or mashes the table of contents.
 *
 * But the contained works ARE in `book.chapters[]` — each chapter names its
 * author ("Proclus on the Platonic Alcibiades", "Porphyry's On Abstinence").
 * This extracts them, groups consecutive same-author chapters into a contained
 * work with a page range, and (best-effort) resolves each to an EXISTING
 * standalone work_id elsewhere in the catalog (so /book/<id>/page/<pageId> can be
 * the deep link, and the registry/FT can answer "is THIS contained work translated").
 *
 * Analysis only — no writes. Usage: node scripts/analysis/resolve-contained-works.mjs [--all]
 */

import { MongoClient } from 'mongodb';

const ALL = process.argv.includes('--all');

// historical authors that signal a CONTAINED work when they head a chapter title
const AUTHORS = ['iamblichus', 'jamblichus', 'proclus', 'porphyry', 'porphyrius', 'plotinus',
  'plato', 'synesius', 'psellus', 'priscian', 'hermes trismegistus', 'hermes', 'aristotle',
  'plutarch', 'cicero', 'augustine', 'boethius', 'macrobius', 'apuleius', 'ptolemy',
  'damascius', 'olympiodorus', 'simplicius', 'philo', 'origen', 'aquinas', 'avicenna'];
const AUTHOR_RX = new RegExp(`\\b(${AUTHORS.join('|')})\\b`, 'i');

const deacc = (s) => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
const norm = (s) => deacc(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// pull "{Author} on/of/'s {Work}" out of a chapter title
function parseContained(title) {
  const t = (title || '').replace(/^(from|the|a)\s+/i, '').trim();
  const m = t.match(AUTHOR_RX);
  if (!m) return null;
  const author = m[1];
  // work = the rest after "on/of/: /'s"
  let rest = t.slice(t.toLowerCase().indexOf(author.toLowerCase()) + author.length)
    .replace(/^(the|platonist)\s+/i, '').replace(/^['’]s\s+/, '').replace(/^\s*(on|of|:|concerning|about)\s+/i, '').trim();
  rest = rest.split(/[,;:]/)[0].trim();
  if (rest.length < 3) return null;
  return { author, work: rest };
}

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const B = c.db('bookstore').collection('books');

  // candidate compilations: have chapters, and ≥2 chapters head with a DISTINCT author
  const filter = ALL
    ? { chapters: { $exists: true, $type: 'array', $ne: [] } }
    : { title: /de mysteriis|on the mysteries of the egyptians|pymander|de voluptate/i, chapters: { $exists: true } };
  const books = await B.find(filter, { projection: { id: 1, title: 1, display_title: 1, author: 1, work_id: 1, chapters: 1 } }).toArray();

  // build a resolution index: contained (author,work) → an existing standalone work_id
  // (a book whose primary author matches and title contains the work, that is NOT this compilation)
  let compilations = 0, totalContained = 0, resolved = 0;
  const report = [];
  for (const b of books) {
    const chs = b.chapters || [];
    const contained = [];
    for (const ch of chs) {
      const p = parseContained(ch.titleEn || ch.title);
      if (p) contained.push({ ...p, pageId: ch.pageId ?? ch.pageNumber ?? null, raw: (ch.titleEn || ch.title || '').slice(0, 50) });
    }
    // dedupe consecutive same-author (chapter sub-divisions of one contained work)
    const works = [];
    for (const x of contained) {
      const prev = works[works.length - 1];
      if (prev && prev.author.toLowerCase() === x.author.toLowerCase()) continue; // same author run = same work (keep first)
      works.push(x);
    }
    const distinctAuthors = new Set(works.map((w) => w.author.toLowerCase()));
    if (distinctAuthors.size < 2) continue; // not a multi-work compilation
    compilations++;

    // resolve each contained work to an existing standalone work_id
    for (const w of works) {
      totalContained++;
      const tok = norm(w.work).split(' ').filter((t) => t.length > 3).slice(0, 2);
      const cand = await B.findOne({
        id: { $ne: b.id },
        work_id: { $exists: true, $ne: null },
        author: new RegExp(w.author, 'i'),
        ...(tok.length ? { title: new RegExp(tok.map((t) => t.replace(/[^a-z0-9]/g, '')).join('|'), 'i') } : {}),
      }, { projection: { work_id: 1, title: 1 } });
      if (cand) { resolved++; w.resolved = cand.work_id; }
    }
    report.push({ book: (b.display_title || b.title || '').slice(0, 44), work_id: b.work_id, works });
  }
  await c.close();

  console.log(`compilations detected: ${compilations} | contained works: ${totalContained} | resolved to an existing work_id: ${resolved}\n`);
  for (const r of report.slice(0, 8)) {
    console.log(`📖 "${r.book}"  (currently ONE work: ${String(r.work_id).slice(0, 36)})`);
    for (const w of r.works) console.log(`    p${w.pageId ?? '?'}  ${w.author} — ${w.work.slice(0, 40)}${w.resolved ? `  → ${String(w.resolved).slice(0, 34)}` : '  → (no standalone match)'}`);
    console.log('');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
