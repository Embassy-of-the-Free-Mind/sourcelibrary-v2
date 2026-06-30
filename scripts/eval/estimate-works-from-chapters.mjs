#!/usr/bin/env node
/**
 * estimate-works-from-chapters.mjs — derive a contents-manifest estimate for
 * multi-work container books from the EXISTING `books.chapters[]` index, and
 * validate it by page-range coverage. Read-only, zero-token. (Issue #2913.)
 *
 * Why: the enrich-worker chapter index carries `title`/`titleEn`/`level`/
 * `pageNumber`/`endPage`. For a container, the LEVEL-1 chapters with distinct,
 * non-generic titles ARE the constituent works — so ~85% of the contents manifest
 * already exists, free. This estimates the honest book-floored work count
 * (#2909 grain policy) and validates each derived manifest against page coverage:
 * the constituents' page-spans should tile the book (≈100%); low coverage = works
 * missing, heavy overlap = mis-leveling.
 *
 * NOT authoritative: a few level-1 entries may be section-heads (over), some works
 * sit at level-2 or lack chapters (under); and per-constituent FT status is NOT
 * verified here (a container's constituent isn't a "first" just because the
 * container is badged — that needs the ft-verify pass).
 *
 * Usage:
 *   node scripts/eval/estimate-works-from-chapters.mjs            # report
 *   node scripts/eval/estimate-works-from-chapters.mjs --out scripts/output/container-manifests.jsonl
 *   node scripts/eval/estimate-works-from-chapters.mjs --all-ft   # all FT books, not just container-signal
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

const OUT = (() => { const i = process.argv.indexOf('--out'); return i > -1 ? process.argv[i + 1] : null; })();
const ALL_FT = process.argv.includes('--all-ft');

const containerRe = /\b(collected works|complete works|collected|selected works|anthology|miscellany|compilation|omnibus|works of|writings of|various|samhita|collection|opera omnia|sammlung)\b/i;
const authorContainerRe = /various|multiple|anonymous|collective/i;
// generic section / apparatus titles that are NOT distinct works
const genericRe = /^\s*(capitulum|caput|chapter|kapitel|chap|part|pars|liber|book|buch|tomus|vol|section|§|canto|sectio|cap\.?|chapitre)\s*[ivxlcdm0-9.]*\s*$|^\s*[ivxlcdm0-9.]+\s*$|^(vorrede|preface|vorwort|introduction|einleitung|index|register|title|titlepage|titelblatt|inhalt|contents|appendix|errata|colophon|dedication|widmung|frontispiece|prologue|prologus|epilogue|notes|bibliography)\b/i;

function deriveConstituents(b) {
  const chs = b.chapters || [];
  if (!chs.length) return null;
  const top = Math.min(...chs.map((c) => c.level ?? 1));
  const seen = new Set();
  const out = [];
  for (const c of chs) {
    if ((c.level ?? 1) !== top) continue;
    const t = (c.titleEn || c.title || '').trim();
    if (!t || genericRe.test(t)) continue;
    const k = t.toLowerCase().slice(0, 40);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title: t, from: Number(c.pageNumber) || null, to: Number(c.endPage) || Number(c.pageNumber) || null });
  }
  return out;
}

/**
 * Validate the derived manifest against the book's pages. Two honest signals:
 *  - reach:  max endPage across ALL chapters / pages_count — does the chapter
 *            INDEX span the whole book? (low reach ⇒ truncated index = real gap)
 *  - thin:   constituent works whose extent (start_i → next level-1 start) is
 *            <2 pages — likely a section-head mis-leveled as a work (over-count).
 * NB: a level-1 chapter's own `endPage` stops before its level-2 children, so we
 * tile by next-start, not by stored endPage (which under-reports — and is
 * sometimes malformed, e.g. start>end).
 */
function validate(constituents, allChapters, pagesCount) {
  const reach = pagesCount ? Math.min(1, Math.max(0, ...allChapters.map((c) => Number(c.endPage) || Number(c.pageNumber) || 0)) / pagesCount) : null;
  const starts = constituents.map((c) => c.from).filter((n) => n).sort((a, b) => a - b);
  let thin = 0;
  for (let i = 0; i < starts.length; i++) {
    const extent = (i + 1 < starts.length ? starts[i + 1] : (pagesCount || starts[i] + 2)) - starts[i];
    if (extent < 2) thin++;
  }
  return { reach, thin, hasStarts: starts.length };
}

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const books = c.db(process.env.MONGODB_DB || 'bookstore').collection('books');
  const FT = { is_first_translation: true, visible: true, pages_translated: { $gt: 0 } };
  const all = await books.find(FT).project({ _id: 0, id: 1, title: 1, author: 1, pages_count: 1, chapters: 1 }).toArray();
  const containers = ALL_FT ? all : all.filter((b) => containerRe.test(b.title || '') || authorContainerRe.test(b.author || ''));
  const withCh = containers.filter((b) => Array.isArray(b.chapters) && b.chapters.length);

  let sumWorks = 0; const perWorks = []; const reaches = []; const manifests = [];
  let lowReach = 0, singleton = 0, thinTotal = 0;
  for (const b of withCh) {
    const cons = deriveConstituents(b) || [];
    const n = Math.max(1, cons.length);
    sumWorks += n; perWorks.push(n);
    if (n === 1) singleton++;
    const v = validate(cons, b.chapters, b.pages_count);
    if (v.reach != null) { reaches.push(v.reach); if (v.reach < 0.7) lowReach++; }
    thinTotal += v.thin;
    if (OUT) manifests.push({ book_id: b.id, title: b.title, author: b.author, pages_count: b.pages_count, est_works: n, index_reach: v.reach, thin_works: v.thin, contents_works: cons });
  }
  perWorks.sort((a, b) => a - b); reaches.sort((a, b) => a - b);
  const med = (a) => a.length ? a[Math.floor(a.length / 2)] : 0;
  const pct = (a, p) => a.length ? a[Math.floor(a.length * p)] : 0;

  console.log(`FT books: ${all.length} | containers (${ALL_FT ? 'ALL FT' : 'signal'}): ${containers.length} | with chapters: ${withCh.length}`);
  console.log(`\n── constituent works / container (from level-1 chapters) ──`);
  console.log(`  min ${perWorks[0]} / median ${med(perWorks)} / mean ${(sumWorks / withCh.length).toFixed(1)} / max ${perWorks[perWorks.length - 1]}`);
  console.log(`  total constituent works in these ${withCh.length} containers: ${sumWorks}  (+${sumWorks - withCh.length} vs 1-each)`);
  console.log(`  singletons (→1 work; likely false-positive containers): ${singleton} (${(100 * singleton / withCh.length).toFixed(0)}%)`);
  console.log(`\n── validation ──`);
  console.log(`  index REACH (chapter index spans the book): median ${(med(reaches) * 100).toFixed(0)}% / p10 ${(pct(reaches, 0.1) * 100).toFixed(0)}%  (n=${reaches.length})`);
  console.log(`  LOW reach (<70% — truncated index, real gap): ${lowReach} (${(100 * lowReach / (reaches.length || 1)).toFixed(0)}%)`);
  console.log(`  thin works (<2pp, likely mis-leveled section-heads → over-count): ${thinTotal} across all containers`);
  console.log(`\n── headline extrapolation ──`);
  console.log(`  current FT (book-counted): ${all.length}`);
  console.log(`  replace ${withCh.length} chaptered containers (1 each) with ${sumWorks} works → ~${all.length - withCh.length + sumWorks}`);
  console.log(`  (+ ${containers.length - withCh.length} chapterless containers still decompose — number rises further)`);
  console.log(`  NB: estimate of constituent works; per-constituent FT status NOT verified (upper bound on first-translated works).`);

  if (OUT) { fs.mkdirSync('scripts/output', { recursive: true }); fs.writeFileSync(OUT, manifests.map((m) => JSON.stringify(m)).join('\n') + '\n'); console.log(`\nWrote ${manifests.length} derived manifests → ${OUT}`); }
  await c.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
