#!/usr/bin/env node
/**
 * Phase 8 — resolve real Source Library holdings for each registry work.
 *
 * The registry's old `sl` flag came from ustc_editions.in_source_library, which
 * is set on only ~4,187 of 1.6M USTC editions (a very sparse USTC↔SL link) — so
 * it badly under-counted what we actually hold (330/1,616). It also conflated
 * "we hold the original Latin" with "the translation is readable here," which it
 * is not: the external translations (I Tatti, Loeb, Brill) are in copyright and
 * NOT hosted on Source Library.
 *
 * This joins each registry work directly to our `books` collection and records
 * the nuanced status used by the rest of the site (cf. IndexCatalogWorksTable):
 *   held:'work'   — we hold this exact work (link to /book/<slug>)
 *   held:'author' — we hold other writings by this author (sample slug)
 *   held:'none'   — neither the work nor the author is in the library
 * Matching the WORK requires the Latin title (book titles are Latin); English-
 * only registry titles fall back to author-held.
 *
 * Reads:  scripts/output/translation-registry-public.json
 * Writes: same file, each work gaining { h: 'work'|'author'|'none', slug?, asl? }
 *
 * Usage: set -a; source .env.production.local; set +a
 *        node scripts/translation-layer/08-holdings.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { surnameStems, titleFit, extractSurname } from './lib.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dir, '../../scripts/output/translation-registry-public.json');

async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const works = data.works;

  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db('bookstore');
  console.log('Loading Source Library books…');
  const books = await db.collection('books').find(
    { visible: { $ne: false } },
    { projection: { id: 1, slug: 1, author: 1, title: 1, text_role: 1, pages_translated: 1 } },
  ).toArray();
  await c.close();
  console.log(`  ${books.length} visible books`);

  // index books by author surname stem
  const byStem = new Map();
  for (const b of books) {
    if (!b.slug) continue;
    for (const stem of surnameStems(b.author)) {
      if (!byStem.has(stem)) byStem.set(stem, []);
      byStem.get(stem).push(b);
    }
  }

  // rank: prefer a book we can read (translated), then an original
  const rank = (b) => (b.pages_translated > 0 ? 2 : 0) + (b.text_role === 'original' ? 1 : 0);

  let work = 0, author = 0, none = 0;
  for (const w of works) {
    const stems = surnameStems(w.a);
    const seen = new Set();
    const cands = [];
    for (const s of stems) for (const b of (byStem.get(s) || [])) if (!seen.has(b.id)) { seen.add(b.id); cands.push(b); }
    if (cands.length === 0) { w.h = 'none'; none++; continue; }
    // try to match the exact work by Latin title (then English as fallback)
    let best = null, bestScore = 0;
    for (const b of cands) {
      const fit = titleFit(w.wl || w.w, b.title);
      const fit2 = w.wl ? titleFit(w.w, b.title) : { match: false, score: 0 };
      const m = fit.match || fit2.match;
      if (m) {
        const sc = Math.max(fit.score, fit2.score) * 10 + rank(b);
        if (sc > bestScore) { bestScore = sc; best = b; }
      }
    }
    if (best) { w.h = 'work'; w.slug = best.slug; work++; }
    else {
      // author held — sample the most readable book by this author
      const sample = cands.sort((a, b) => rank(b) - rank(a))[0];
      w.h = 'author'; w.asl = sample.slug; author++;
    }
    delete w.sl; // drop the old, misleading flag
  }

  data.holdings = { work, author, none };
  data.generated = '2026-06-21';
  fs.writeFileSync(FILE, JSON.stringify(data));
  console.log(`\n=== HOLDINGS (of ${works.length} registry works) ===`);
  console.log(`  work held (we have this exact work):   ${work}`);
  console.log(`  author held (we have the author):      ${author}`);
  console.log(`  not held:                              ${none}`);
  console.log(`wrote ${FILE}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
