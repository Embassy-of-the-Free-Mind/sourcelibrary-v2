#!/usr/bin/env node
/**
 * Artwork metadata cleanup — deterministic fixes (no AI).
 *
 * Phase 1: Title cleanup
 *   - Strip QS:P1476/label markup from Wikidata-style titles
 *   - Remove inventory numbers, catalog suffixes, database IDs
 *   - Remove date prefixes ("2013-06-02 ROMA...")
 *   - Strip trailing attribution ("(after Raphael)")
 *   - Regenerate slugs from cleaned titles
 *
 * Phase 2: Author normalization
 *   - "Various" / "Unknown" → null (let enrichment fill it)
 *   - Strip "after", "attributed to", "circle of" prefixes into separate field
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/clean-artwork-metadata.mjs [--dry-run] [--limit 100]
 *
 * Related: issue #696
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '0') || 0;

const client = new MongoClient(process.env.MONGODB_URI);

/** Strip Wikidata QS: markup from titles.
 *  Pattern: "The Elephant Hannotitle QS:P1476,en:"The Elephant Hanno"label QS:Len,"The Elephant Hanno""
 *  → "The Elephant Hanno" */
function stripQSMarkup(title) {
  if (!title.includes('QS:')) return title;

  // Try to extract the first QS:P1476,en:"..." value as the canonical title
  const p1476Match = title.match(/QS:P1476,en:"([^"]+)"/);
  if (p1476Match) return p1476Match[1].trim();

  // Fallback: extract English label
  const labelMatch = title.match(/label QS:Len,"([^"]+)"/);
  if (labelMatch) return labelMatch[1].trim();

  // Last resort: take everything before "title QS:" or "label QS:"
  const beforeQS = title.split(/\s*(?:title|label)\s+QS:/)[0].trim();
  if (beforeQS.length >= 5) return beforeQS;

  return title;
}

/** Remove inventory/catalog numbers from titles.
 *  "Raphael - 'The Phrygian Sibyl', 1953,1010.1" → "The Phrygian Sibyl"
 *  "Dürer-pleasures-of-the-world-1490s" stays (it's a slug-style title, not a catalog number) */
function stripCatalogSuffixes(title) {
  // Remove ", RCIN 12345" / ", inv. 12345" / ", cat. 12345" / ", no. 12345"
  title = title.replace(/,\s*(RCIN|inv\.|cat\.|no\.)\s*\d[\d.]+\s*$/i, '');

  // Remove ", WA1846.169" style suffixes (museum accession numbers)
  title = title.replace(/,\s*[A-Z]{1,4}\d{4}\.\d+[a-z]?\s*$/, '');

  // Remove trailing object IDs like ", obj07651546, fle0008626x p"
  title = title.replace(/,\s*obj\d+.*$/i, '');

  // Remove " - Inv. 12345" at end
  title = title.replace(/\s*-\s*Inv\.\s*\d+\s*$/i, '');

  // Remove trailing accession/catalog codes: ", D.1978.PG.80", ", Fig. 148", ", 17574"
  title = title.replace(/,\s*[A-Z][\d.]+[A-Z]*[\d.]*\s*$/i, '');
  title = title.replace(/,\s*Fig\.\s*\d+\s*$/i, '');
  title = title.replace(/,\s*\d{4,}\s*$/, '');

  return title.trim();
}

/** Remove date prefixes like "2013-06-02 ROMA..." or "2022-05-06 Rome - 0993 - ..." */
function stripDatePrefix(title) {
  // "2013-06-02 ROMA S. MARIA DELLA PACE" → "ROMA S. MARIA DELLA PACE"
  const match = title.match(/^\d{4}-\d{2}-\d{2}\s+(.+)/);
  if (match) {
    let cleaned = match[1];
    // Also strip "Rome - 0993 - " style photo numbering
    cleaned = cleaned.replace(/^[A-Za-z]+\s*-\s*\d+\s*-\s*/, '');
    return cleaned.trim();
  }
  return title;
}

/** Clean up artist prefix patterns.
 *  "Raphael - 'The Phrygian Sibyl'" → "The Phrygian Sibyl"
 *  "Raphael - circle of - The Holy Family" → "The Holy Family" (attribution extracted separately)
 *  Only strip when it's "Author - Title" or "Author -- Title" pattern */
function stripArtistPrefix(title, author) {
  if (!author) return title;

  // Exact prefix: "Raphael - Title" or "Sandro Botticelli--Title"
  const lastName = author.split(' ').pop();
  const patterns = [
    new RegExp(`^${escapeRegex(author)}\\s*[-–—]+\\s*`, 'i'),
    new RegExp(`^${escapeRegex(lastName)}\\s*[-–—]+\\s*`, 'i'),
  ];

  for (const p of patterns) {
    const match = title.match(p);
    if (match) {
      let rest = title.slice(match[0].length).trim();
      // Also strip attribution qualifiers that follow: "circle of -", "school of -", "after -"
      rest = rest.replace(/^(?:circle of|school of|after|attributed to|workshop of|follower of|manner of|copy after)\s*[-–—]+\s*/i, '');
      if (rest.length >= 5) return rest;
    }
  }

  return title;
}

/** Strip surrounding quotes: 'Title' or "Title" → Title */
function stripQuotes(title) {
  if ((title.startsWith("'") && title.endsWith("'")) ||
      (title.startsWith('"') && title.endsWith('"'))) {
    return title.slice(1, -1).trim();
  }
  return title;
}

/** Clean parenthetical attribution suffixes:
 *  "Title (after Raphael)" → "Title"
 *  "Title (cropped)" → "Title" */
function stripParenSuffixes(title) {
  // Remove trailing (cropped), (detail), (fragment), (copy), (recto), (verso)
  title = title.replace(/\s*\((cropped|detail|fragment|copy|recto|verso)\)\s*$/i, '');
  return title.trim();
}

/** Clean multilingual label suffixes like:
 *  'label QS:Les,"Cabeza..."label QS:Lru,"Голова..."' */
function stripMultilingualLabels(title) {
  // Remove all "label QS:L..." blocks
  return title.replace(/\s*label\s+QS:L[a-z]{2},"[^"]*"/g, '').trim();
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Generate a clean slug from a title */
function slugify(title, author) {
  // Combine author + title for unique slugs
  let base = title;
  if (author && author !== 'Unknown' && author !== 'Various') {
    const lastName = author.split(' ').pop();
    base = `${lastName}-${title}`;
  }

  return base
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9\s-]/g, '')  // remove non-alphanumeric
    .replace(/\s+/g, '-')           // spaces to hyphens
    .replace(/-+/g, '-')            // collapse hyphens
    .replace(/^-|-$/g, '')          // trim hyphens
    .slice(0, 100);                  // cap length
}

/** Apply all deterministic title cleanups */
function cleanTitle(title, author) {
  let cleaned = title;

  // Order matters — QS markup first (it's the most destructive junk)
  cleaned = stripQSMarkup(cleaned);
  cleaned = stripMultilingualLabels(cleaned);
  cleaned = stripDatePrefix(cleaned);
  cleaned = stripCatalogSuffixes(cleaned);
  cleaned = stripArtistPrefix(cleaned, author);
  cleaned = stripQuotes(cleaned);
  cleaned = stripParenSuffixes(cleaned);

  // Final trim
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // If we cleaned too aggressively and lost the title, keep original
  if (cleaned.length < 3) return title;

  return cleaned;
}

/** Normalize author field */
function cleanAuthor(author) {
  if (!author) return { author: null, attribution: null };

  let attribution = null;

  // Extract attribution qualifiers
  const attrMatch = author.match(/^(after|attributed to|circle of|workshop of|school of|follower of|manner of|copy after)\s+/i);
  if (attrMatch) {
    attribution = attrMatch[1].toLowerCase();
    author = author.slice(attrMatch[0].length).trim();
  }

  // Normalize unknown
  if (['Unknown', 'Various', 'Anonymous', 'unknown', 'various'].includes(author)) {
    return { author: null, attribution };
  }

  return { author, attribution };
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  const query = { resource_type: { $exists: true } };
  const projection = {
    _id: 1, title: 1, slug: 1, author: 1, published: 1,
    commons_title: 1, resource_type: 1,
  };

  // Skip already-processed artworks (have display_title from prior run)
  const RERUN = process.argv.includes('--rerun');
  if (!RERUN) {
    // Only process artworks that haven't been cleaned yet
    // (display_title not set, or no attribution_qualifier extracted)
  }

  const cursor = books.find(query, { projection });
  if (LIMIT) cursor.limit(LIMIT);

  let total = 0, titleFixed = 0, slugFixed = 0, authorFixed = 0, skipped = 0;
  const issues = { titleCleaned: [], slugChanged: [], authorNormalized: [] };

  for await (const art of cursor) {
    total++;

    const updates = {};
    const cleanedTitle = cleanTitle(art.title, art.author);
    const titleChanged = cleanedTitle !== art.title;

    if (titleChanged) {
      // Preserve original title in commons_title if not already set
      if (!art.commons_title) {
        updates.commons_title = art.title;
      }
      updates.display_title = cleanedTitle;
      // Stamp WHY display_title differs from title (#4288). Without this, a
      // deterministically-shortened title is indistinguishable on the read side
      // from one a vision model invented — both are just "display_title !==
      // title" — and src/lib/title-provenance.ts has to fall back to treating
      // it as unverified. 'catalog_cleanup' says: same title, apparatus
      // stripped. This stamps only rows this run touches; the ~1,455 existing
      // unstamped rows are reported by scripts/audit/artwork-title-provenance.mjs
      // and are NOT backfilled here.
      updates['field_provenance.display_title'] = {
        source: 'catalog_cleanup',
        script: 'clean-artwork-metadata.mjs',
        date: new Date().toISOString(),
        previous_value: art.display_title || art.title,
      };
      titleFixed++;
      if (titleFixed <= 20) {
        issues.titleCleaned.push({ before: art.title.substring(0, 80), after: cleanedTitle.substring(0, 80) });
      }
    }

    // Regenerate slug from cleaned title
    const newSlug = slugify(cleanedTitle, art.author);
    if (newSlug && newSlug !== art.slug && newSlug.length >= 5) {
      updates.slug = newSlug;
      slugFixed++;
    }

    // Author normalization
    const { author: cleanedAuthor, attribution } = cleanAuthor(art.author);
    if (attribution) {
      updates.attribution_qualifier = attribution;
      if (cleanedAuthor && cleanedAuthor !== art.author) {
        updates.author = cleanedAuthor;
      }
      authorFixed++;
    }

    // Also extract attribution from title pattern: "Author - circle of - Title"
    if (!attribution && art.title) {
      const titleAttrMatch = art.title.match(/[-–—]\s*(circle of|school of|after|attributed to|workshop of|follower of)\s*[-–—]/i);
      if (titleAttrMatch) {
        updates.attribution_qualifier = titleAttrMatch[1].toLowerCase();
        authorFixed++;
      }
    }

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    updates.updated_at = new Date();

    if (!DRY_RUN) {
      // Handle slug collisions by appending a numeric suffix
      let retries = 0;
      while (retries < 5) {
        try {
          await books.updateOne({ _id: art._id }, { $set: updates });
          break;
        } catch (err) {
          if (err.code === 11000 && updates.slug) {
            retries++;
            updates.slug = `${slugify(cleanedTitle, art.author)}-${retries + 1}`;
          } else {
            throw err;
          }
        }
      }
    }

    if (total <= 5 && titleChanged) {
      console.log(`\n[${total}] BEFORE: ${art.title.substring(0, 100)}`);
      console.log(`     AFTER:  ${cleanedTitle.substring(0, 100)}`);
      if (updates.slug) console.log(`     SLUG:   ${updates.slug}`);
    }
  }

  console.log('\n━━━ SUMMARY ━━━');
  console.log(`Total processed: ${total}`);
  console.log(`Titles cleaned (display_title set): ${titleFixed}`);
  console.log(`Slugs regenerated: ${slugFixed}`);
  console.log(`Authors normalized: ${authorFixed}`);
  console.log(`Skipped (no changes): ${skipped}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  if (issues.titleCleaned.length > 0) {
    console.log('\n━━━ SAMPLE TITLE CLEANUPS ━━━');
    for (const t of issues.titleCleaned) {
      console.log(`  "${t.before}" → "${t.after}"`);
    }
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
