import { NextRequest, NextResponse } from 'next/server';
import { applyTextRole } from '@/lib/text-role';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { withCuratorAuth } from '@/lib/auth-helpers';
import { generateUniqueBookSlug } from '@/lib/slugify';
import { resolveLanguage } from '@/lib/resolve-language';
import { sourceFingerprint } from '@/lib/dedup';
import { acquisitionGate, confirmClaims } from '@/lib/acquisition-guard';

/**
 * Import a book from a local directory
 *
 * POST /api/import
 * Body: {
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language: string,
 *   published?: string,
 *   pagesDir: string,  // Absolute path to directory with page images
 *   categories?: string[],
 *   ia_identifier?: string
 * }
 */
export const POST = withCuratorAuth(async (request, session) => {
  try {
    const body = await request.json();
    const {
      title,
      display_title,
      author,
      language,
      published,
      pagesDir,
      categories,
      ia_identifier,
      dublin_core,
      image_source,
    } = body;

    // Validate required fields
    if (!title || !author || !pagesDir) {
      return NextResponse.json(
        { error: 'Missing required fields: title, author, pagesDir' },
        { status: 400 }
      );
    }

    // Check if directory exists
    if (!fs.existsSync(pagesDir)) {
      return NextResponse.json(
        { error: `Directory not found: ${pagesDir}` },
        { status: 400 }
      );
    }

    // Get page images
    const pageFiles = fs.readdirSync(pagesDir)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort();

    if (pageFiles.length === 0) {
      return NextResponse.json(
        { error: 'No image files found in directory' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Edition-aware dedup. The old exact `{ title }` check blocked distinct
    // editions that share a title; checkDuplicate() lets a different year/volume
    // through while still catching true duplicates by source + title+author.
    const gate = await acquisitionGate(db, {
      title,
      author,
      display_title,
      published,
      ia_identifier,
      dublin_core,
      image_source,
    }, { importer: 'api:local-directory' });
    if (!gate.ok) {
      const best = gate.matches[0];
      return NextResponse.json(
        {
          error: gate.message,
          existingId: best?.matchedBookId ?? null,
          reason: gate.reason,
          evidence: gate.evidence,
          matches: gate.matches,
        },
        { status: 409 }
      );
    }

    // Create book
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();

    const slug = await generateUniqueBookSlug(db, title, author, display_title);

    // #2185: normalise the caller's language (codes → display names) and stamp
    // provenance. Local-directory imports have no source metadata, so the caller
    // is the only signal — but it's no longer stored raw and unattributed.
    const lang = resolveLanguage({ callerLanguage: language });

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      slug,
      title,
      display_title: display_title || null,
      author,
      language: lang.language,
      ...(lang.original_language ? { original_language: lang.original_language } : {}),
      field_provenance: { language: lang.provenance },
      published: published || 'Unknown',
      categories: categories || [],
      ia_identifier: ia_identifier || null,
      dublin_core: dublin_core || null,
      image_source: image_source || null,
      source_fingerprint: sourceFingerprint({ ia_identifier, dublin_core, image_source }),
      source_fingerprints: gate.fingerprints,
      pageCount: pageFiles.length,
      pages_count: pageFiles.length,
      status: 'draft',
      hidden: true, visible: false,
      created_at: new Date(),
      updated_at: new Date()
    };

    // Classify original-vs-translation at import (issue #2395).
    applyTextRole(bookDoc as Record<string, unknown>);
    await db.collection('books').insertOne(bookDoc);
    // The claim now points at the row it produced, so it stops being
    // reclaimable and the acquisition ledger is joinable to `books`.
    await confirmClaims(db, gate.fingerprints, bookIdStr);

    // Create pages
    const pageDocs = pageFiles.map((filename, index) => {
      const pageId = new ObjectId();
      const imagePath = path.join(pagesDir, filename);

      return {
        _id: pageId,
        id: pageId.toHexString(),
        book_id: bookIdStr,
        page_number: index + 1,
        photo: imagePath,
        thumbnail: imagePath,
        // Don't initialize ocr/translation with empty strings -- they cause
        // false completion in job-completion.ts (see: translation loop bug fix)
        created_at: new Date(),
        updated_at: new Date()
      };
    });

    await db.collection('pages').insertMany(pageDocs);

    // Set thumbnail from first page
    await db.collection('books').updateOne(
      { _id: bookId },
      { $set: { thumbnail: pageDocs[0].photo } }
    );

    return NextResponse.json({
      success: true,
      bookId: bookIdStr,
      title,
      pagesImported: pageDocs.length,
      message: `Created book with ${pageDocs.length} pages`
    });

  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
