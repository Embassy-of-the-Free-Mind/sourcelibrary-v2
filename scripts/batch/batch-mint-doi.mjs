#!/usr/bin/env node
/**
 * Batch DOI minting for qualified books via Zenodo.
 *
 * Three-stage pipeline per book:
 *   1. Create edition draft (if none exists)
 *   2. Generate front matter via Gemini (if not cached)
 *   3. Mint DOI via Zenodo (create draft → upload files → publish)
 *
 * Usage:
 *   node scripts/batch/batch-mint-doi.mjs                          # Dry run: list eligible books
 *   node scripts/batch/batch-mint-doi.mjs --sample 3               # Generate front matter for 3 books, don't mint
 *   node scripts/batch/batch-mint-doi.mjs --mint --limit 10        # Mint DOIs for top 10 books
 *   node scripts/batch/batch-mint-doi.mjs --mint --book-id <id>    # Mint a specific book
 *   node scripts/batch/batch-mint-doi.mjs --mint --limit 50 --min-quality 70  # Custom quality threshold
 *
 * Environment:
 *   set -a; source .env.production.local; set +a; node scripts/batch/batch-mint-doi.mjs
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { generateScholarlyPdf } from '../lib/scholarly-pdf.mjs';

// ── Config ──────────────────────────────────────────────────────────

const LICENSE = 'CC-BY-SA-4.0';
const GEMINI_MODEL = 'gemini-3-flash-preview';
const DELAY_BETWEEN_MINTS_MS = 3000;
const DELAY_BETWEEN_FRONT_MATTER_MS = 1000;
const DEFAULT_LIMIT = 50;
const DEFAULT_MIN_QUALITY = 50;
const DEFAULT_MIN_TRANSLATION_PCT = 0.9;
const OUTPUT_FILE = 'scripts/output/doi-mint-results.json';

// Zenodo
const ZENODO_API = process.env.ZENODO_SANDBOX === 'true'
  ? 'https://sandbox.zenodo.org/api'
  : 'https://zenodo.org/api';
const ZENODO_URL = process.env.ZENODO_SANDBOX === 'true'
  ? 'https://sandbox.zenodo.org'
  : 'https://zenodo.org';

// ── Parse args ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getArg = (f) => { const i = args.indexOf(f); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };

const MODE = hasFlag('--mint') ? 'mint' : hasFlag('--sample') ? 'sample' : 'dry-run';
const LIMIT = parseInt(getArg('--limit') || getArg('--sample') || String(DEFAULT_LIMIT));
const BOOK_ID = getArg('--book-id');
const MIN_QUALITY = parseInt(getArg('--min-quality') || String(DEFAULT_MIN_QUALITY));
const MIN_TRANSLATION_PCT = parseFloat(getArg('--min-pct') || String(DEFAULT_MIN_TRANSLATION_PCT));

// ── Language mapping (from zenodo.ts) ───────────────────────────────

const LANG_MAP = {
  'Latin': 'lat', 'Greek': 'grc', 'Ancient Greek': 'grc',
  'German': 'deu', 'French': 'fra', 'Italian': 'ita', 'Spanish': 'spa',
  'Dutch': 'nld', 'Sanskrit': 'san', 'Hebrew': 'heb', 'Arabic': 'ara',
  'Chinese': 'zho', 'Persian': 'fas', 'Syriac': 'syc',
  'Ethiopic': 'gez', "Ge'ez": 'gez', 'Tibetan': 'bod',
  'Russian': 'rus', 'Welsh': 'cym', 'Tamil': 'tam', 'Sumerian': 'sux',
  'English': 'eng', 'Coptic': 'cop', 'Akkadian': 'akk',
};

const LICENSE_MAP = {
  'CC0-1.0': 'cc-zero',
  'CC-BY-4.0': 'cc-by-4.0',
  'CC-BY-SA-4.0': 'cc-by-sa-4.0',
  'CC-BY-NC-4.0': 'cc-by-nc-4.0',
  'CC-BY-NC-SA-4.0': 'cc-by-nc-sa-4.0',
};

// ── Zenodo helpers ──────────────────────────────────────────────────

function zenodoHeaders(extra = {}) {
  return { 'Authorization': `Bearer ${process.env.ZENODO_ACCESS_TOKEN}`, ...extra };
}

async function zenodoError(resp, context) {
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('json')) {
    const err = await resp.json();
    const fields = err.errors?.map(e => `${e.field}: ${e.messages.join(', ')}`).join('; ');
    throw new Error(`Zenodo ${context}: ${err.message}${fields ? ` — ${fields}` : ''}`);
  }
  const text = await resp.text();
  throw new Error(`Zenodo ${context}: HTTP ${resp.status} — ${text.substring(0, 300)}`);
}

async function zenodoCreateDraft(metadata) {
  const resp = await fetch(`${ZENODO_API}/records`, {
    method: 'POST',
    headers: zenodoHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ access: { record: 'public', files: 'public' }, files: { enabled: true }, metadata }),
  });
  if (!resp.ok) await zenodoError(resp, 'create draft');
  return resp.json();
}

async function zenodoUploadFile(draftId, filename, content) {
  const token = process.env.ZENODO_ACCESS_TOKEN;
  // Step 1: init
  const initResp = await fetch(`${ZENODO_API}/records/${draftId}/draft/files`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ key: filename }]),
  });
  if (!initResp.ok) await zenodoError(initResp, `file init (${filename})`);

  // Step 2: upload
  const body = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
  const uploadResp = await fetch(
    `${ZENODO_API}/records/${draftId}/draft/files/${encodeURIComponent(filename)}/content`,
    { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body },
  );
  if (!uploadResp.ok) await zenodoError(uploadResp, `file upload (${filename})`);

  // Step 3: commit
  const commitResp = await fetch(
    `${ZENODO_API}/records/${draftId}/draft/files/${encodeURIComponent(filename)}/commit`,
    { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } },
  );
  if (!commitResp.ok) await zenodoError(commitResp, `file commit (${filename})`);
  return commitResp.json();
}

async function zenodoPublish(draftId) {
  const resp = await fetch(`${ZENODO_API}/records/${draftId}/draft/actions/publish`, {
    method: 'POST',
    headers: zenodoHeaders(),
  });
  if (!resp.ok) await zenodoError(resp, 'publish');
  return resp.json();
}

// ── Zenodo metadata builder ─────────────────────────────────────────

function buildZenodoMetadata(book, edition) {
  const creators = [];

  // Original author
  if (book.author) {
    const parts = book.author.split(' ');
    const familyName = parts.pop() || book.author;
    const givenName = parts.join(' ') || undefined;
    creators.push({
      person_or_org: {
        name: book.author, type: 'personal',
        family_name: familyName,
        ...(givenName && { given_name: givenName }),
      },
    });
  }

  // Source Library as translator
  creators.push({
    person_or_org: { name: 'Source Library (Translator)', type: 'organizational' },
    role: { id: 'other' },
  });

  // AI contributors
  for (const c of edition.contributors) {
    if (c.name === 'Source Library') continue;
    creators.push({
      person_or_org: {
        name: c.type === 'ai' ? `${c.name} (AI)` : c.name,
        type: c.type === 'human' ? 'personal' : 'organizational',
      },
      role: { id: 'other' },
    });
  }

  const description = buildDescription(book, edition) +
    `\n\n<p><strong>Content hash:</strong> <code>${edition.content_hash}</code></p>`;

  const related_identifiers = [];
  const iaId = book.ia_identifier || book.ia_id;
  if (iaId) {
    related_identifiers.push({ identifier: `https://archive.org/details/${iaId}`, relation_type: { id: 'isderivedfrom' }, scheme: 'url' });
  }
  const bookSlug = book.slug || book.id;
  related_identifiers.push({ identifier: `https://sourcelibrary.org/book/${bookSlug}`, relation_type: { id: 'issupplementedby' }, scheme: 'url' });

  const languages = [{ id: 'eng' }];
  if (book.language && book.language !== 'English') {
    const code = LANG_MAP[book.language];
    if (code) languages.push({ id: code });
  }

  return {
    title: edition.citation.title,
    publisher: 'Source Library',
    resource_type: { id: 'publication-book' },
    publication_date: new Date().toISOString().split('T')[0],
    description,
    rights: [{ id: LICENSE_MAP[edition.license] || 'cc-by-4.0' }],
    creators,
    version: edition.version,
    languages,
    subjects: ['translation', 'historical text', book.language, ...(book.categories || [])].filter(Boolean).map(s => ({ subject: s })),
    ...(related_identifiers.length > 0 && { related_identifiers }),
  };
}

function buildDescription(book, edition) {
  const author = book.author || 'Anonymous';
  return [
    `<p>English translation of <em>${book.title}</em> by ${author}`,
    book.published ? ` (${book.published})` : '', '.</p>', '',
    '<p><strong>Original work:</strong></p>', '<ul>',
    `<li>Title: ${book.title}</li>`, `<li>Author: ${author}</li>`,
    `<li>Language: ${book.language}</li>`,
    book.published ? `<li>Published: ${book.published}</li>` : '',
    book.place_published ? `<li>Place: ${book.place_published}</li>` : '',
    book.publisher ? `<li>Publisher: ${book.publisher}</li>` : '',
    book.ustc_id ? `<li>USTC: ${book.ustc_id}</li>` : '',
    '</ul>', '',
    `<p><strong>Translation:</strong> ${edition.page_count} pages translated.</p>`, '',
    '<p>Generated by <a href="https://sourcelibrary.org">Source Library</a>.</p>',
  ].filter(Boolean).join('\n');
}

// ── Front matter generation ─────────────────────────────────────────

async function generateFrontMatter(book, pages) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const bookContext = buildBookContext(book, pages);

  const [introResult, methodResult] = await Promise.all([
    generateIntroduction(model, book, bookContext),
    generateMethodology(model, book, pages),
  ]);

  return {
    introduction: introResult,
    methodology: methodResult,
    generated_at: new Date(),
    generated_by: GEMINI_MODEL,
  };
}

function buildBookContext(book, pages) {
  const parts = [];
  parts.push(`Title: ${book.title}`);
  if (book.display_title) parts.push(`English Title: ${book.display_title}`);
  parts.push(`Author: ${book.author}`);
  parts.push(`Language: ${book.language}`);
  parts.push(`Published: ${book.published}`);
  if (book.place_published) parts.push(`Place: ${book.place_published}`);
  if (book.publisher) parts.push(`Publisher: ${book.publisher}`);
  if (book.ustc_id) parts.push(`USTC ID: ${book.ustc_id}`);

  if (book.index?.bookSummary?.detailed) {
    parts.push(`\nBook Summary:\n${book.index.bookSummary.detailed}`);
  } else if (book.index?.bookSummary?.abstract) {
    parts.push(`\nBook Summary:\n${book.index.bookSummary.abstract}`);
  }

  const samplePages = [...pages.slice(0, 5), ...pages.slice(-3)];
  const summaries = samplePages.filter(p => p.summary?.data).map(p => `Page ${p.page_number}: ${p.summary.data.slice(0, 300)}...`);
  if (summaries.length > 0) parts.push(`\nSample Page Summaries:\n${summaries.join('\n')}`);

  if (book.index?.people) parts.push(`\nKey People: ${book.index.people.slice(0, 10).map(p => p.term).join(', ')}`);
  if (book.index?.concepts) parts.push(`\nKey Concepts: ${book.index.concepts.slice(0, 15).map(c => c.term).join(', ')}`);

  return parts.join('\n');
}

async function generateIntroduction(model, book, context) {
  const prompt = `You are a scholarly editor writing an introduction for a digital edition of a historical text.

Write a comprehensive but accessible introduction (800-1200 words) for this work:

${context}

The introduction should include:

1. **Historical Context** (2-3 paragraphs)
   - When and where was this written?
   - What was happening in the intellectual/cultural world at this time?
   - Who was the author and what do we know about them?

2. **The Work Itself** (2-3 paragraphs)
   - What is this text about?
   - What genre does it belong to (natural philosophy, alchemy, etc.)?
   - How does it relate to other works of its period?

3. **Significance** (1-2 paragraphs)
   - Why does this text matter today?
   - What can modern readers learn from it?
   - How does it fit into the history of science/philosophy?

4. **This Edition** (1 paragraph)
   - Note that this is a new English translation produced by Source Library
   - Mention the digital format allows side-by-side facsimile + translation viewing
   - State clearly that the translation was produced using AI (large language models) and has NOT been reviewed by human editors
   - Point readers to the Methodology section for details

Write in clear, scholarly prose accessible to educated general readers. Use markdown formatting with ## headings. Do not use bullet points in the main text. Include specific historical details where possible.

CRITICAL: Do NOT claim that human editors reviewed, refined, or verified the translation. This is an AI-generated translation that has not undergone human editorial review. Be honest and transparent about this.

Do NOT include any preamble like "Here is an introduction..." - start directly with the first heading.`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function generateMethodology(model, book, pages) {
  const models = new Set();
  const promptNames = new Set();
  pages.forEach(p => {
    if (p.ocr?.model) models.add(p.ocr.model);
    if (p.translation?.model) models.add(p.translation.model);
    if (p.ocr?.prompt_name) promptNames.add(p.ocr.prompt_name);
    if (p.translation?.prompt_name) promptNames.add(p.translation.prompt_name);
  });

  const prompt = `You are a scholarly editor writing a methodology section for a digital edition that uses AI-assisted translation.

Write a clear methodology section (500-800 words) explaining how this translation was produced:

**Source Text:**
- Title: ${book.title}
- Language: ${book.language}
- Published: ${book.published}
- Total pages: ${pages.length}

**Technical Details:**
- AI Models used: ${Array.from(models).join(', ')}
- Processing pipeline: Import → Image archiving → OCR → Translation → Enrichment (summary, index, chapters) → Scholarly EPUB

The methodology section should include:
1. **Pipeline Overview** - digitized page images imported from digital library sources, archived, then processed through sequential AI stages
2. **OCR Process** - vision AI models, source language preserved, multi-column detection
3. **Translation Process** - AI-generated, NOT reviewed by human translators, sequential with context
4. **Enrichment** - summary, index, chapters, illustration detection
5. **Editorial Conventions** - <note>, <margin>, <unclear>, <term> tags
6. **Limitations & Future Work** - honest about AI limitations, versioned with DOI, community feedback welcome

CRITICAL: Do NOT claim human editors, reviewers, or translators were involved. Be transparent about AI generation.

Write in clear, professional prose. Use ## markdown headings. Do NOT include any preamble.`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ── Edition creation ────────────────────────────────────────────────

function createEdition(book, translatedPages) {
  const translationText = translatedPages
    .map(p => `--- Page ${p.page_number} ---\n${p.translation?.data || ''}`)
    .join('\n\n');
  const contentHash = crypto.createHash('sha256').update(translationText).digest('hex');

  const existingEditions = book.editions || [];
  let version = '1.0.0';
  if (existingEditions.length > 0) {
    const latest = existingEditions
      .map(e => e.version)
      .sort((a, b) => {
        const [aM, am, ap] = a.split('.').map(Number);
        const [bM, bm, bp] = b.split('.').map(Number);
        return bM - aM || bm - am || bp - ap;
      })[0];
    const [major, minor] = latest.split('.').map(Number);
    version = `${major}.${minor + 1}.0`;
  }

  // Collect AI models used
  const models = new Set();
  translatedPages.forEach(p => { if (p.translation?.model) models.add(p.translation.model); });
  const contributors = [];
  models.forEach(m => {
    contributors.push({
      name: m.includes('gemini') ? 'Google Gemini' : m,
      role: 'translator', type: 'ai', model: m,
    });
  });

  return {
    id: crypto.randomUUID(),
    book_id: book.id,
    version,
    status: 'draft',
    created_at: new Date(),
    page_ids: translatedPages.map(p => p.id),
    page_count: translatedPages.length,
    content_hash: contentHash,
    contributors,
    citation: {
      title: `English Translation of ${book.display_title || book.title}`,
      original_title: book.title,
      original_author: book.author,
      original_language: book.language,
      original_published: book.published,
      target_language: 'en',
    },
    license: LICENSE,
    previous_version_id: existingEditions.find(e => e.status === 'published')?.id,
    previous_version_doi: existingEditions.find(e => e.status === 'published')?.doi,
  };
}

// ── Full mint workflow for one book ─────────────────────────────────

async function mintOneBook(db, book) {
  const steps = [];

  // Step 1: Get translated pages
  const pages = await db.collection('pages')
    .find({ book_id: book.id })
    .sort({ page_number: 1 })
    .toArray();
  const translatedPages = pages.filter(p => p.translation?.data);

  if (translatedPages.length === 0) {
    return { bookId: book.id, title: book.title, error: 'No translated pages', steps };
  }

  // Step 2: Create or find edition
  let edition;
  const existingEditions = book.editions || [];
  const draftEdition = existingEditions.find(e => e.status === 'draft' && !e.doi);

  if (draftEdition) {
    edition = draftEdition;
    steps.push('edition: reused existing draft');
  } else {
    edition = createEdition(book, translatedPages);
    await db.collection('books').updateOne(
      { id: book.id },
      { $push: { editions: edition }, $set: { updated_at: new Date() } }
    );
    steps.push(`edition: created v${edition.version}`);
  }

  // Step 3: Generate front matter if needed
  if (!edition.front_matter?.introduction) {
    const contextPages = await db.collection('pages')
      .find({ book_id: book.id }, { projection: { page_number: 1, summary: 1, 'translation.model': 1, 'ocr.model': 1, 'ocr.prompt_name': 1, 'translation.prompt_name': 1 } })
      .sort({ page_number: 1 })
      .toArray();

    const frontMatter = await generateFrontMatter(book, contextPages);
    edition.front_matter = frontMatter;

    // Save front matter to edition in DB
    const editions = (await db.collection('books').findOne({ id: book.id })).editions || [];
    const updatedEditions = editions.map(e => e.id === edition.id ? { ...e, front_matter: frontMatter } : e);
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { editions: updatedEditions, updated_at: new Date() } }
    );
    steps.push('front-matter: generated');
  } else {
    steps.push('front-matter: cached');
  }

  // Step 4: Mint DOI via Zenodo
  const metadata = buildZenodoMetadata(book, edition);

  // Create draft
  const draft = await zenodoCreateDraft(metadata);
  steps.push(`zenodo: draft ${draft.id}`);

  // Generate and upload scholarly PDF
  const pdfBuffer = await generateScholarlyPdf(book, translatedPages, {
    introduction: edition.front_matter?.introduction,
    methodology: edition.front_matter?.methodology,
  });
  const pdfFilename = `${book.slug || book.id}-scholarly-v${edition.version}.pdf`;
  await zenodoUploadFile(draft.id, pdfFilename, pdfBuffer);
  steps.push(`zenodo: uploaded pdf (${(pdfBuffer.length / 1024 / 1024).toFixed(1)}MB)`);

  // Publish (mints DOI)
  const published = await zenodoPublish(draft.id);
  const doi = published.pids?.doi?.identifier || published.doi;
  steps.push(`zenodo: published, DOI ${doi}`);

  // Update edition in DB
  const bookDoc = await db.collection('books').findOne({ id: book.id });
  const allEditions = (bookDoc.editions || []).map(e => {
    if (e.id === edition.id) {
      return { ...e, status: 'published', published_at: new Date(), doi, doi_url: `https://doi.org/${doi}`, zenodo_id: published.id, zenodo_url: `${ZENODO_URL}/records/${published.id}` };
    }
    if (e.status === 'published' && e.id !== edition.id) {
      return { ...e, status: 'superseded' };
    }
    return e;
  });

  await db.collection('books').updateOne(
    { id: book.id },
    { $set: { editions: allEditions, doi, updated_at: new Date() } }
  );
  steps.push('db: updated');

  return {
    bookId: book.id,
    title: book.display_title || book.title,
    author: book.author,
    doi,
    doi_url: `https://doi.org/${doi}`,
    zenodo_url: `${ZENODO_URL}/records/${published.id}`,
    pageCount: edition.page_count,
    steps,
  };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Batch DOI Minting ===`);
  console.log(`Mode: ${MODE} | Limit: ${LIMIT} | Min quality: ${MIN_QUALITY} | Min translation: ${(MIN_TRANSLATION_PCT * 100).toFixed(0)}%`);
  console.log(`Zenodo: ${process.env.ZENODO_SANDBOX === 'true' ? 'SANDBOX' : 'PRODUCTION'}\n`);

  // Validate environment
  if (MODE === 'mint' && !process.env.ZENODO_ACCESS_TOKEN) {
    console.error('ERROR: ZENODO_ACCESS_TOKEN not set. Cannot mint DOIs.');
    process.exit(1);
  }
  if ((MODE === 'mint' || MODE === 'sample') && !process.env.GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY not set. Cannot generate front matter.');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  try {
    // Build query
    const matchQuery = {
      hidden: { $ne: true },
      pages_ocr: { $gt: 0 },
      quality_score: { $gte: MIN_QUALITY },
      author: { $nin: [null, '', 'Unknown', 'Anonymous'] },
      language: { $nin: [null, '', 'Unknown'] },
      $or: [
        { 'reading_summary.overview': { $exists: true } },
        { 'index.generatedAt': { $exists: true } },
      ],
      doi: { $exists: false },
    };

    if (BOOK_ID) {
      matchQuery.id = BOOK_ID;
      delete matchQuery.doi; // Allow re-checking specific books
    }

    const eligible = await db.collection('books').aggregate([
      { $match: matchQuery },
      { $addFields: { _pct: { $cond: [{ $gt: ['$pages_ocr', 0] }, { $divide: ['$pages_translated', '$pages_ocr'] }, 0] } } },
      { $match: { _pct: { $gte: MIN_TRANSLATION_PCT } } },
      { $sort: { quality_score: -1, pages_translated: -1 } },
      { $limit: BOOK_ID ? 1 : LIMIT },
      { $project: { id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, place_published: 1, publisher: 1, ustc_id: 1, quality_score: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, _pct: 1, slug: 1, ia_identifier: 1, ia_id: 1, editions: 1, categories: 1, reading_summary: 1, index: 1 } }
    ]).toArray();

    console.log(`Found ${eligible.length} eligible book(s)\n`);

    if (eligible.length === 0) {
      console.log('No books match the criteria.');
      await client.close();
      return;
    }

    // ── DRY RUN ──
    if (MODE === 'dry-run') {
      console.log('Top candidates:\n');
      console.log('  # | Score | Trans% | Pages | Author / Title');
      console.log('----+-------+--------+-------+' + '-'.repeat(60));
      eligible.forEach((b, i) => {
        const pct = ((b._pct || 0) * 100).toFixed(0);
        const title = (b.display_title || b.title || '').substring(0, 50);
        const author = (b.author || '').substring(0, 20);
        console.log(`${String(i + 1).padStart(3)} | ${String(b.quality_score).padStart(5)} | ${pct.padStart(5)}% | ${String(b.pages_translated).padStart(5)} | ${author} / ${title}`);
      });
      console.log(`\nRun with --sample ${Math.min(3, eligible.length)} to preview front matter, or --mint --limit N to mint DOIs.`);
      await client.close();
      return;
    }

    // ── SAMPLE MODE ──
    if (MODE === 'sample') {
      console.log(`Generating front matter for ${eligible.length} book(s)...\n`);
      for (const book of eligible) {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`${book.display_title || book.title}`);
        console.log(`by ${book.author} (${book.published})`);
        console.log(`Quality: ${book.quality_score} | Pages: ${book.pages_translated}`);
        console.log('='.repeat(70));

        const pages = await db.collection('pages')
          .find({ book_id: book.id }, { projection: { page_number: 1, summary: 1, 'translation.model': 1, 'ocr.model': 1, 'ocr.prompt_name': 1, 'translation.prompt_name': 1 } })
          .sort({ page_number: 1 })
          .toArray();

        const frontMatter = await generateFrontMatter(book, pages);
        console.log('\n--- INTRODUCTION (first 500 chars) ---');
        console.log(frontMatter.introduction.substring(0, 500) + '...');
        console.log('\n--- METHODOLOGY (first 500 chars) ---');
        console.log(frontMatter.methodology.substring(0, 500) + '...');

        if (eligible.indexOf(book) < eligible.length - 1) {
          await delay(DELAY_BETWEEN_FRONT_MATTER_MS);
        }
      }
      console.log('\n\nSample complete. Run with --mint --limit N to actually mint DOIs.');
      await client.close();
      return;
    }

    // ── MINT MODE ──
    console.log(`Minting DOIs for ${eligible.length} book(s)...\n`);

    const results = [];
    const errors = [];
    let interrupted = false;

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\nInterrupted. Finishing current book and saving results...');
      interrupted = true;
    });

    for (let i = 0; i < eligible.length && !interrupted; i++) {
      const book = eligible[i];
      const progress = `[${i + 1}/${eligible.length}]`;

      // Skip if already has DOI (resumability)
      if (book.doi || book.editions?.some(e => e.doi)) {
        console.log(`${progress} SKIP ${book.display_title || book.title} — already has DOI`);
        continue;
      }

      console.log(`${progress} ${book.display_title || book.title} (${book.author})...`);

      try {
        const result = await mintOneBook(db, book);
        results.push(result);
        console.log(`  ✓ DOI: ${result.doi}`);
        console.log(`    ${result.steps.join(' → ')}`);
      } catch (err) {
        const errorMsg = err.message || String(err);
        errors.push({ bookId: book.id, title: book.title, error: errorMsg });
        console.log(`  ✗ ERROR: ${errorMsg}`);

        // Retry transient errors once
        if (errorMsg.includes('HTTP 5') || errorMsg.includes('fetch failed')) {
          console.log('  Retrying in 5s...');
          await delay(5000);
          try {
            const result = await mintOneBook(db, book);
            results.push(result);
            errors.pop(); // Remove the error since retry succeeded
            console.log(`  ✓ Retry succeeded: ${result.doi}`);
          } catch (retryErr) {
            console.log(`  ✗ Retry failed: ${retryErr.message}`);
          }
        }
      }

      // Delay between mints
      if (i < eligible.length - 1 && !interrupted) {
        await delay(DELAY_BETWEEN_MINTS_MS);
      }
    }

    // Write results
    const outputDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const output = {
      timestamp: new Date().toISOString(),
      mode: MODE,
      params: { limit: LIMIT, minQuality: MIN_QUALITY, minTranslationPct: MIN_TRANSLATION_PCT },
      summary: { total: eligible.length, minted: results.length, errors: errors.length, interrupted },
      results,
      errors,
    };
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Results: ${results.length} minted, ${errors.length} errors`);
    console.log(`Output: ${OUTPUT_FILE}`);

  } finally {
    await client.close();
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
