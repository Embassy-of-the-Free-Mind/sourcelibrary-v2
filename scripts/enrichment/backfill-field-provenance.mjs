#!/usr/bin/env node
/**
 * Backfill field_provenance for existing books.
 *
 * Infers provenance from available signals:
 *   - image_source.provider → import source
 *   - ai_metadata.changes[] → AI enrichment
 *   - translation_census → cross-reference
 *   - translation_verification → AI knowledge lookup
 *   - created_at → import date
 *   - audit_log → manual edits
 *
 * Usage:
 *   node scripts/backfill-field-provenance.mjs --dry-run
 *   node scripts/backfill-field-provenance.mjs --apply
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

function loadEnv() {
  const env = {};
  try {
    const content = fs.readFileSync('.env.local', 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
          v = v.slice(1, -1);
        env[m[1].trim()] = v;
      }
    }
  } catch {}
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB || 'bookstore';
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// Map provider strings to human-readable import sources
const PROVIDER_LABELS = {
  ia: 'Internet Archive',
  gallica: 'Gallica (BnF)',
  mdz: 'MDZ (Bavarian State Library)',
  wellcome: 'Wellcome Collection',
  'e-rara': 'e-rara (Swiss)',
  bodleian: 'Bodleian Library',
  cambridge: 'Cambridge Digital Library',
  hab: 'HAB Wolfenbüttel',
  vatican: 'Vatican Library',
  loc: 'Library of Congress',
  iiif: 'IIIF import',
  europeana: 'Europeana',
  google_books: 'Google Books (via IA)',
  efm: 'Embassy of the Free Mind',
};

function getImportSource(book) {
  // Try image_source.provider first
  const provider = book.image_source?.provider;
  if (provider) {
    return {
      source: 'import',
      provider: provider,
      provider_name: PROVIDER_LABELS[provider] || provider,
      date: book.created_at || null,
    };
  }
  // Try to infer from ia_identifier, gallica_ark, etc.
  if (book.ia_identifier) return { source: 'import', provider: 'ia', provider_name: 'Internet Archive', date: book.created_at };
  if (book.gallica_ark) return { source: 'import', provider: 'gallica', provider_name: 'Gallica (BnF)', date: book.created_at };
  if (book.bsb_id) return { source: 'import', provider: 'mdz', provider_name: 'MDZ (Bavarian State Library)', date: book.created_at };
  // Default
  return { source: 'import', provider: 'unknown', date: book.created_at };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 10000;

  console.log(`=== Field Provenance Backfill ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLYING'}\n`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(MONGODB_DB);

  // Get books that don't have field_provenance yet
  const books = await db.collection('books')
    .find({ field_provenance: { $exists: false } })
    .limit(limit)
    .toArray();

  console.log(`Found ${books.length} books without field_provenance\n`);

  // Pre-load audit log entries for manual edits
  const auditEntries = await db.collection('audit_log')
    .find({ action: 'book_metadata_updated' })
    .project({ book_id: 1, timestamp: 1, changes: 1 })
    .toArray();

  const auditByBook = {};
  for (const entry of auditEntries) {
    if (!auditByBook[entry.book_id]) auditByBook[entry.book_id] = [];
    auditByBook[entry.book_id].push(entry);
  }

  console.log(`Loaded ${auditEntries.length} audit log entries\n`);

  let updated = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const provenance = {};
    const importSource = getImportSource(book);
    const aiMeta = book.ai_metadata;
    const aiChanges = aiMeta?.changes || [];
    const bookAudits = auditByBook[book.id] || [];

    // --- title ---
    if (book.title) {
      const auditEdit = bookAudits.find(a => a.changes?.title);
      if (auditEdit) {
        provenance.title = { source: 'manual_edit', date: auditEdit.timestamp, previous: auditEdit.changes.title?.from };
      } else {
        provenance.title = { ...importSource };
      }
    }

    // --- author ---
    if (book.author) {
      const auditEdit = bookAudits.find(a => a.changes?.author);
      if (auditEdit) {
        provenance.author = { source: 'manual_edit', date: auditEdit.timestamp };
      } else {
        provenance.author = { ...importSource };
      }
    }

    // --- language ---
    if (book.language && book.language !== 'Unknown') {
      const aiChange = aiChanges.find(c => c.field === 'language');
      if (aiChange) {
        provenance.language = {
          source: 'ai_enrichment',
          model: aiMeta.model,
          date: aiMeta.enriched_at,
          confidence: aiMeta.confidence,
          previous_value: aiChange.previous,
        };
      } else {
        provenance.language = { ...importSource };
        // If AI enrichment ran but didn't change language, it confirmed it
        if (aiMeta?.language) {
          provenance.language.ai_confirmed = true;
          provenance.language.ai_confirmed_at = aiMeta.enriched_at;
          provenance.language.ai_confidence = aiMeta.confidence;
        }
      }
    }

    // --- year ---
    if (book.year) {
      const aiChange = aiChanges.find(c => c.field === 'year');
      if (aiChange) {
        provenance.year = {
          source: 'ai_enrichment',
          model: aiMeta.model,
          date: aiMeta.enriched_at,
          previous_value: aiChange.previous,
        };
      } else {
        provenance.year = { ...importSource };
      }
    }

    // --- published ---
    if (book.published && book.published !== 'Unknown') {
      const aiChange = aiChanges.find(c => c.field === 'published');
      if (aiChange) {
        provenance.published = {
          source: 'ai_enrichment',
          model: aiMeta.model,
          date: aiMeta.enriched_at,
        };
      } else {
        provenance.published = { ...importSource };
      }
    }

    // --- categories ---
    if (book.categories?.length > 0) {
      const aiChange = aiChanges.find(c => c.field === 'categories');
      if (aiChange) {
        provenance.categories = {
          source: aiChange.previous?.length > 0 ? 'ai_enrichment + import' : 'ai_enrichment',
          model: aiMeta.model,
          date: aiMeta.enriched_at,
          ai_suggested: aiChange.ai_suggested,
          note: aiChange.previous?.length > 0 ? 'AI categories merged with existing' : 'AI classification',
        };
      } else if (book.image_source?.provider === 'efm') {
        provenance.categories = { source: 'efm_curation', note: 'Curated by Embassy of the Free Mind' };
      } else {
        provenance.categories = { ...importSource };
      }
    }

    // --- description (from ai_metadata) ---
    if (aiMeta?.description) {
      provenance.description = {
        source: 'ai_enrichment',
        model: aiMeta.model,
        date: aiMeta.enriched_at,
      };
    }

    // --- first_translation ---
    if (aiMeta?.first_translation) {
      provenance.first_translation = {
        source: 'ai_enrichment',
        model: aiMeta.model,
        date: aiMeta.enriched_at,
        status: aiMeta.first_translation.status,
      };
    }

    // --- translation_census ---
    if (book.translation_census) {
      provenance.translation_census = {
        source: 'cross_reference',
        dataset: 'latin_translations_master.csv (UNESCO + 50 publishers)',
        records: book.translation_census.census_size,
        date: book.translation_census.checked_at,
      };
    }

    // --- translation_verification ---
    if (book.translation_verification) {
      provenance.translation_verification = {
        source: 'ai_knowledge_lookup',
        model: book.translation_verification.model,
        date: book.translation_verification.verified_at,
        validated: book.translation_verification.validated,
      };
    }

    // --- reading_summary ---
    if (book.reading_summary) {
      provenance.reading_summary = {
        source: 'ai_generation',
        model: book.reading_summary.model,
        date: book.reading_summary.generated_at,
      };
    }

    // --- index ---
    if (book.index?.generatedAt) {
      provenance.index = {
        source: 'ai_generation',
        date: book.index.generatedAt,
      };
    }

    const shortTitle = (book.display_title || book.title || '').substring(0, 55);
    const fieldCount = Object.keys(provenance).length;
    console.log(`  [${i + 1}/${books.length}] ${shortTitle} — ${fieldCount} fields tracked`);

    if (!dryRun && fieldCount > 0) {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { field_provenance: provenance } }
      );
      updated++;
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Processed: ${books.length}`);
  console.log(`Updated: ${updated}`);
  if (dryRun) console.log('\n(Dry run — use --apply to write)');

  await client.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
