#!/usr/bin/env node
/**
 * Upgrade B+ collections to Tier C.
 *
 * Automatically backfills:
 * 1. languages — aggregate from books in the collection
 * 2. mentioned_books — match book titles in expanded_description
 * 3. featured_images — re-run backfill for collections with < 3
 * 4. subtitle — generate from description if missing
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/thumbnails/upgrade-b-plus-collections.mjs
 *   node scripts/thumbnails/upgrade-b-plus-collections.mjs --dry-run
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');

const SLUGS = [
  'hermetic-image','philosophical-theology','the-visionary','kabbalah-sacred-geometry',
  'gnostic-texts','visions-ecstasies','indigenous-traditions','before-ficino',
  'haarlem-mannerists','portraits-tradition','esoteric-engravers','angels-celestials',
  'wrathful-deities','thought-forms','sleep-and-dreams','wine-and-the-vine',
  'the-infernal','yokai-oni','polynesian','leonardo-drawings',
  'alchemists-studio','venetian-mystery','book-of-the-dead','dreams-unconscious',
  'middle-east-africa','art-of-altdorfer-baldung','navajo-dine','pawnee',
];

async function run() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  let langFixed = 0, mentionedFixed = 0, subtitleFixed = 0, imagesFixed = 0;

  for (const slug of SLUGS) {
    const col = await db.collection('collections').findOne({ slug });
    if (!col) { console.log(`SKIP ${slug}: not found`); continue; }

    const updates = {};
    const bookIds = await db.collection('books').distinct('id', {
      collections: slug, deleted: { $ne: true },
    });

    // --- 1. Languages ---
    if (!col.languages || col.languages.length === 0) {
      const langAgg = await db.collection('books').aggregate([
        { $match: { id: { $in: bookIds }, language: { $exists: true, $ne: null, $ne: '' } } },
        { $group: { _id: '$language', count: { $sum: 1 } } },
        { $match: { count: { $gte: 2 } } },
        { $sort: { count: -1 } },
        { $limit: 15 },
      ]).toArray();

      // Filter out noise languages
      const filteredLangs = langAgg.filter(l =>
        l._id && !['Unknown', 'Visual', 'undefined', 'null', ''].includes(l._id)
      );
      if (filteredLangs.length > 0) {
        updates.languages = filteredLangs.map(l => ({ lang: l._id, count: l.count }));
        langFixed++;
        console.log(`  ${slug}: languages = ${langAgg.map(l => `${l._id}(${l.count})`).join(', ')}`);
      }
    }

    // --- 2. Mentioned books ---
    if ((!col.mentioned_books || col.mentioned_books.length === 0) && col.expanded_description) {
      const desc = col.expanded_description;

      // Get highlighted book IDs to prioritize
      const highlightIds = new Set((col.highlighted_books || []).map(h => h.book_id));

      // Get books with titles that could appear in the description
      const books = await db.collection('books').find({
        id: { $in: bookIds },
        deleted: { $ne: true },
      }).project({ id: 1, title: 1, display_title: 1, author: 1 }).toArray();

      const mentions = [];
      const usedIds = new Set();

      for (const book of books) {
        if (usedIds.has(book.id)) continue;

        // Try display_title first, then title
        for (const rawTitle of [book.display_title, book.title].filter(Boolean)) {
          // Clean the title for matching
          let title = rawTitle.replace(/\s*\([^)]*\)\s*/g, '').trim();
          if (title.length < 10) continue; // Too short, would false-match

          // Skip generic titles and single-word matches
          if (/^(the |a |an )?book/i.test(title)) continue;
          if (/^works|opera|letters|poems|print|sleep|florence|demon$/i.test(title)) continue;
          if (!title.includes(' ')) continue; // Must be multi-word

          if (desc.includes(title)) {
            mentions.push({ text: title, book_id: book.id });
            usedIds.add(book.id);
            break;
          }

          // Try italic-style markers: *Title* or _Title_
          const italicPatterns = [`*${title}*`, `_${title}_`, `"${title}"`];
          for (const pattern of italicPatterns) {
            if (desc.includes(pattern)) {
              mentions.push({ text: title, book_id: book.id });
              usedIds.add(book.id);
              break;
            }
          }
        }
      }

      // Deduplicate by book_id
      const seen = new Set();
      const dedupMentions = mentions.filter(m => {
        if (seen.has(m.book_id)) return false;
        seen.add(m.book_id);
        return true;
      });

      if (dedupMentions.length > 0) {
        const mentions = dedupMentions;
        // Sort: highlighted books first, then by position in text
        mentions.sort((a, b) => {
          const aHl = highlightIds.has(a.book_id) ? 0 : 1;
          const bHl = highlightIds.has(b.book_id) ? 0 : 1;
          if (aHl !== bHl) return aHl - bHl;
          return desc.indexOf(a.text) - desc.indexOf(b.text);
        });

        updates.mentioned_books = mentions;
        mentionedFixed++;
        console.log(`  ${slug}: ${mentions.length} mentioned_books (${mentions.slice(0, 3).map(m => m.text.substring(0, 30)).join(', ')}${mentions.length > 3 ? '...' : ''})`);
      } else {
        console.log(`  ${slug}: no title matches found in expanded_description`);
      }
    }

    // --- 3. Subtitle ---
    if (!col.subtitle && col.description) {
      // Take first sentence of description, max 80 chars
      const firstSentence = col.description.match(/^[^.!?]+[.!?]/)?.[0] || col.description;
      const subtitle = firstSentence.length > 80
        ? firstSentence.substring(0, 77) + '...'
        : firstSentence;
      updates.subtitle = subtitle;
      subtitleFixed++;
      console.log(`  ${slug}: subtitle = "${subtitle}"`);
    }

    // --- 4. Featured images ---
    if (!col.featured_images || col.featured_images.length < 3) {
      const candidates = await db.collection('gallery_images').find({
        book_id: { $in: bookIds },
        gallery_quality: { $gte: 0.7 },
        $or: [
          { thumbnail_url: { $exists: true, $ne: null } },
          { extracted_url: { $exists: true, $ne: null } },
        ],
      }).sort({ gallery_quality: -1 }).limit(6).project({
        thumbnail_url: 1, extracted_url: 1, image_url: 1,
        description: 1, book_title: 1, book_id: 1,
      }).toArray();

      if (candidates.length > (col.featured_images?.length || 0)) {
        // Merge: keep existing, add new
        const existing = col.featured_images || [];
        const existingUrls = new Set(existing.map(e => e.thumbnail_url || e.extracted_url || e.image_url));
        const newImages = candidates.filter(c => {
          const url = c.thumbnail_url || c.extracted_url || c.image_url;
          return !existingUrls.has(url);
        });
        updates.featured_images = [...existing, ...newImages].slice(0, 6);
        imagesFixed++;
        console.log(`  ${slug}: featured_images ${existing.length} → ${updates.featured_images.length}`);
      }
    }

    // --- Apply ---
    if (Object.keys(updates).length > 0 && !DRY_RUN) {
      await db.collection('collections').updateOne({ slug }, { $set: updates });
    }
  }

  console.log(`\n=== Summary${DRY_RUN ? ' [DRY RUN]' : ''} ===`);
  console.log(`Languages backfilled: ${langFixed}`);
  console.log(`Mentioned books extracted: ${mentionedFixed}`);
  console.log(`Subtitles generated: ${subtitleFixed}`);
  console.log(`Featured images expanded: ${imagesFixed}`);

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
