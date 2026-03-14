/**
 * Fix unclosed/malformed annotation tags in existing translations.
 *
 * Scans all translated pages, applies sanitizeTranslationTags(),
 * creates a revision before modifying, and updates in place.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/maintenance/fix-unclosed-note-tags.mjs
 * Dry run: DRY_RUN=1 node scripts/maintenance/fix-unclosed-note-tags.mjs
 */

import { MongoClient, ObjectId } from 'mongodb';

const DRY_RUN = process.env.DRY_RUN === '1';

// Inline the sanitizer since we can't import TS from mjs easily
const ANNOTATION_TAGS = ['note', 'margin', 'gloss', 'insert', 'unclear', 'term', 'image-desc'];

function sanitizeTranslationTags(text) {
  let result = text;

  for (const tag of ANNOTATION_TAGS) {
    const malformed = new RegExp(`</${tag}([^>])`, 'gi');
    result = result.replace(malformed, (match, trailing) => {
      if (/[a-z]/i.test(trailing)) return match;
      return `</${tag}>${trailing}`;
    });
  }

  for (const openTag of ANNOTATION_TAGS) {
    for (const closeTag of ANNOTATION_TAGS) {
      if (openTag === closeTag) continue;
      const wrongClose = new RegExp(
        `(<${openTag}>)([^<]*?)(</${closeTag}>)`, 'gi'
      );
      result = result.replace(wrongClose, `$1$2</${openTag}>`);
    }
  }

  result = fixUnclosedTags(result);
  return result;
}

function fixUnclosedTags(text) {
  const tagPattern = new RegExp(
    `<(/?)(?:${ANNOTATION_TAGS.join('|')})>`, 'gi'
  );

  const tags = [];
  let m;
  while ((m = tagPattern.exec(text)) !== null) {
    tags.push({
      index: m.index,
      length: m[0].length,
      isClose: m[1] === '/',
      name: m[0].replace(/<\/?/g, '').replace(/>/, '').toLowerCase(),
    });
  }

  if (tags.length === 0) return text;

  const insertions = [];

  for (const tagName of ANNOTATION_TAGS) {
    const typeTags = tags.filter(t => t.name === tagName);
    const openStack = [];

    for (const tag of typeTags) {
      if (!tag.isClose) {
        if (openStack.length > 0 && tagName === 'note') {
          insertions.push({ index: tag.index, text: `</${tagName}>` });
          openStack.pop();
        }
        openStack.push(tag);
      } else {
        if (openStack.length > 0) openStack.pop();
      }
    }

    for (const unclosed of openStack) {
      const afterTag = unclosed.index + unclosed.length;
      const remainder = text.substring(afterTag);
      const breakPoints = [
        remainder.search(/<summary>/i),
        remainder.search(/<keywords>/i),
        remainder.search(/<meta>/i),
        remainder.search(/\n\n/),
      ].filter(i => i >= 0);

      let insertAt;
      if (breakPoints.length > 0) {
        insertAt = afterTag + Math.min(...breakPoints);
      } else {
        insertAt = text.length;
      }
      insertions.push({ index: insertAt, text: `</${tagName}>` });
    }
  }

  if (insertions.length === 0) return text;

  insertions.sort((a, b) => b.index - a.index);
  let result = text;
  for (const ins of insertions) {
    result = result.slice(0, ins.index) + ins.text + result.slice(ins.index);
  }
  return result;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const pages = db.collection('pages');
  const revisions = db.collection('page_revisions');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  // Stream all pages with annotation tags in translation
  const cursor = pages.find(
    { 'translation.data': { $exists: true, $ne: '' } },
    { projection: { _id: 1, book_id: 1, page_number: 1, 'translation.data': 1 } }
  ).batchSize(500);

  let scanned = 0, fixed = 0, errors = 0;

  for await (const page of cursor) {
    scanned++;
    if (scanned % 10000 === 0) {
      process.stdout.write(`\rScanned ${scanned}, fixed ${fixed}...`);
    }

    const original = page.translation.data;

    // Quick check: does this page even have annotation tags?
    if (!/<(note|margin|gloss|insert|unclear|term|image-desc)>/i.test(original)) continue;

    // Check for mismatched counts
    const opens = (original.match(/<note>/gi) || []).length;
    const closes = (original.match(/<\/note>/gi) || []).length;

    // Also check other tag types and malformed patterns
    const hasMalformed = /<\/note[^>]/i.test(original) ||
      /<note>[^<]*<\/(term|margin|gloss|insert|unclear)>/i.test(original);

    if (opens === closes && !hasMalformed) continue;

    const sanitized = sanitizeTranslationTags(original);
    if (sanitized === original) continue;

    fixed++;

    if (DRY_RUN) {
      console.log(`\nWould fix: book=${page.book_id} page=${page.page_number} (opens:${opens} closes:${closes})`);
      // Show diff summary
      const newOpens = (sanitized.match(/<note>/gi) || []).length;
      const newCloses = (sanitized.match(/<\/note>/gi) || []).length;
      console.log(`  Before: ${opens} opens, ${closes} closes → After: ${newOpens} opens, ${newCloses} closes`);
      continue;
    }

    try {
      // Create revision before modifying
      await revisions.insertOne({
        page_id: page._id,
        book_id: page.book_id,
        field: 'translation',
        previous_value: original,
        created_at: new Date(),
        reason: 'fix-unclosed-note-tags',
      });

      // Update translation
      await pages.updateOne(
        { _id: page._id },
        { $set: { 'translation.data': sanitized, updated_at: new Date() } }
      );
    } catch (e) {
      errors++;
      console.error(`\nError fixing page ${page._id}:`, e.message);
    }
  }

  console.log(`\n\nDone. Scanned: ${scanned}, Fixed: ${fixed}, Errors: ${errors}`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
