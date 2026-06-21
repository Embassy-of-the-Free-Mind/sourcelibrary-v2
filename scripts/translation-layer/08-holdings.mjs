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
import { surnameStems, titleFit } from './lib.mjs';
import { bestEdition, holdingStatus, editionVisible } from '../lib/holdings-resolver.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dir, '../../scripts/output/translation-registry-public.json');

async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const works = data.works;

  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db('bookstore');
  console.log('Loading Source Library books (FULL catalog incl. hidden — ownership truth)…');
  // ownership = full catalog incl. hidden/draft (the public read-link applies an
  // editionVisible filter on top — the two predicates stay separate, per the
  // shared holdings-resolver). Pull the fields bestEdition/holdingStatus need.
  const books = await db.collection('books').find(
    {},
    { projection: { id: 1, slug: 1, author: 1, title: 1, display_title: 1, text_role: 1,
        pages_translated: 1, pages_count: 1, pages_ocr: 1, pages_blank: 1, visible: 1, hidden: 1 } },
  ).toArray();
  await c.close();
  console.log(`  ${books.length} books (all)`);

  // index books by author surname stem
  const byStem = new Map();
  for (const b of books) {
    if (!b.slug) continue;
    for (const stem of surnameStems(b.author)) {
      if (!byStem.has(stem)) byStem.set(stem, []);
      byStem.get(stem).push(b);
    }
  }

  let work = 0, workLinkable = 0, author = 0, none = 0;
  const statusCount = { held_readable: 0, held_unprocessed: 0, absent: 0 };
  for (const w of works) {
    const stems = surnameStems(w.a);
    const seen = new Set();
    const cands = [];
    for (const s of stems) for (const b of (byStem.get(s) || [])) if (!seen.has(b.id)) { seen.add(b.id); cands.push(b); }
    if (cands.length === 0) { w.h = 'none'; none++; continue; }
    // editions of THIS exact work (match Latin title, then English) — full set incl. hidden
    const matched = cands.filter((b) => {
      const t = b.title || b.display_title;
      return titleFit(w.wl || w.w, t).match || (w.wl && titleFit(w.w, t).match);
    });
    delete w.sl; // drop the old, misleading flag
    if (matched.length) {
      // ownership status over the FULL matched set (visibility-agnostic)
      const status = holdingStatus(matched);
      statusCount[status] = (statusCount[status] || 0) + 1;
      w.h = 'work';
      w.hstatus = status;
      // the public "Read original" link points at the best VISIBLE readable edition
      const link = bestEdition(matched.filter(editionVisible));
      if (link) { w.slug = link.slug; workLinkable++; }
      work++;
    } else {
      // author held — link a visible readable edition by this author, if any
      const sample = bestEdition(cands.filter(editionVisible)) || cands.find(editionVisible);
      w.h = 'author';
      if (sample) w.asl = sample.slug;
      author++;
    }
  }

  data.holdings = { work, work_linkable: workLinkable, author, none, by_status: statusCount };
  data.generated = '2026-06-21';
  fs.writeFileSync(FILE, JSON.stringify(data));
  console.log(`\n=== HOLDINGS (of ${works.length} registry works) ===`);
  console.log(`  work held (we own this exact work):    ${work}  [${statusCount.held_readable} readable, ${statusCount.held_unprocessed} unprocessed]`);
  console.log(`    of which publicly linkable (visible+readable): ${workLinkable}`);
  console.log(`  author held (we own the author):       ${author}`);
  console.log(`  not held:                              ${none}`);
  console.log(`wrote ${FILE}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
