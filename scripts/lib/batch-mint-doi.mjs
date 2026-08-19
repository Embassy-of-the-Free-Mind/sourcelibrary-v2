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
import { generateScholarlyPdf } from '../lib/scholarly-typst.mjs';
import { citationLanguageFields } from '../lib/edition-citation-language.mjs';

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
const ALLOW_ANON = hasFlag('--allow-anon');
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

// Parse a catalog author string into Zenodo person creators. Handles
// multi-author strings ("A; B"), catalog brackets ("[Zwack, Franz Xaver von]"),
// and trailing qualifiers ("(attrib.)", "(translator)") — all learned from the
// 2026-07-20 batch, where 9 records needed post-hoc metadata edits.
function parseAuthorPersons(author) {
  if (!author) return [];
  return author.split(';').map(raw => {
    const name = raw.trim().replace(/^\[|\]$/g, '').trim();
    const qual = (name.match(/\(([^)]*)\)\s*$/) || [])[1];
    const base = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (!base) return null;
    let family, given;
    if (base.includes(',')) {
      [family, given] = base.split(',').map(s => s.trim());
    } else {
      const parts = base.split(/\s+/);
      family = parts.pop();
      given = parts.join(' ') || undefined;
    }
    return {
      person_or_org: {
        name: qual ? `${base} (${qual})` : base,
        type: 'personal',
        family_name: family,
        ...(given && { given_name: given }),
      },
    };
  }).filter(Boolean);
}

function buildZenodoMetadata(book, edition) {
  // Original author(s); anonymous works get the conventional "Anonymous"
  const creators = parseAuthorPersons(book.author);
  if (creators.length === 0) {
    creators.push({
      person_or_org: { name: 'Anonymous', type: 'personal', family_name: 'Anonymous' },
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

  // Bibliographic facts
  parts.push('=== BIBLIOGRAPHIC DATA (verified from title page) ===');
  parts.push(`Title: ${book.title}`);
  if (book.display_title) parts.push(`English Title: ${book.display_title}`);
  parts.push(`Author: ${book.author}`);
  parts.push(`Language: ${book.language}`);
  parts.push(`Published: ${book.published}`);
  if (book.place_published) parts.push(`Place of publication: ${book.place_published}`);
  if (book.publisher) parts.push(`Printer/Publisher: ${book.publisher}`);
  if (book.ustc_id) parts.push(`USTC catalog number: ${book.ustc_id}`);
  if (book.is_first_translation) parts.push('NOTE: This is believed to be the FIRST English translation of this work.');
  if (book.ia_identifier) parts.push(`Source scan: Internet Archive (${book.ia_identifier})`);

  // Categories / tradition
  if (book.categories?.length) {
    parts.push(`\nTradition/categories: ${book.categories.join(', ')}`);
  }

  // AI-generated summary (from our own index pipeline)
  if (book.index?.bookSummary?.detailed) {
    parts.push(`\n=== BOOK SUMMARY (AI-generated from the translation) ===\n${book.index.bookSummary.detailed}`);
  } else if (book.index?.bookSummary?.abstract) {
    parts.push(`\n=== BOOK SUMMARY (AI-generated from the translation) ===\n${book.index.bookSummary.abstract}`);
  }

  // Chapter structure
  if (book.chapters?.length) {
    const chapterList = book.chapters
      .filter(c => c.confidence === 'high')
      .slice(0, 15)
      .map(c => `  p.${c.pageNumber}: ${c.titleEn || c.title}`)
      .join('\n');
    parts.push(`\n=== TABLE OF CONTENTS ===\n${chapterList}`);
  }

  // Key figures and concepts from the index
  if (book.index?.people?.length) {
    parts.push(`\nKey people mentioned: ${book.index.people.slice(0, 15).map(p => p.term).join(', ')}`);
  }
  if (book.index?.concepts?.length) {
    parts.push(`Key concepts: ${book.index.concepts.slice(0, 15).map(c => c.term).join(', ')}`);
  }

  // Sample page summaries for flavor
  const samplePages = [...pages.slice(0, 5), ...pages.slice(-3)];
  const summaries = samplePages.filter(p => p.summary?.data).map(p => `  Page ${p.page_number}: ${p.summary.data.slice(0, 200)}`);
  if (summaries.length > 0) parts.push(`\n=== SAMPLE PAGE SUMMARIES ===\n${summaries.join('\n')}`);

  return parts.join('\n');
}

async function generateIntroduction(model, book, context) {
  const prompt = `You are writing the introduction for a scholarly digital edition published by Source Library, a project of the Embassy of the Free Mind in Amsterdam — one of the world's foremost collections of Hermetic, alchemical, Kabbalistic, and early modern philosophical texts.

Source Library's mission is to make these texts readable for the first time in centuries by producing AI-assisted English translations of works that have never been translated, or whose only translations are rare, incomplete, or inaccessible. The collection spans the Western esoteric tradition from antiquity through the early modern period — the Corpus Hermeticum, Paracelsian medicine, Rosicrucian manifestos, Christian Kabbalah, natural philosophy, and the roots of modern science.

Write an introduction (800-1200 words) for this edition:

${context}

Structure:

## The Author and the Work
Ground this in verifiable facts. Use the bibliographic data above. If you know specific, well-documented facts about the author (birth/death dates, city of activity, patrons, documented controversies), include them. If you are uncertain about a biographical detail, omit it — do not guess. Describe what the text actually contains, drawing on the table of contents and summary provided above. Name specific chapters or sections.

## Historical Significance
This is where your knowledge of intellectual history matters. Place this work in its documented tradition — who influenced the author, who was influenced by them, what debates or movements was this text part of? Be specific: name other authors, cite known connections, reference documented events. For example, if the author corresponded with known figures, or if the work was banned, praised, or plagiarized — say so, but only if you are confident it is true.

If the work is obscure and you cannot confidently place it in a broader intellectual context, say so honestly: "This work has received limited scholarly attention" or "The author is not well documented beyond what appears on the title page."

## This Edition
This is a new English translation produced by Source Library using AI (large language models). The original ${book.language || 'source language'} text was transcribed from page scans using OCR, then translated page by page with contextual continuity. This translation has NOT been reviewed or verified by human editors. Readers should treat it as a working translation — useful for access and orientation, but not a substitute for expert scholarship. The digital edition at sourcelibrary.org allows side-by-side viewing of the original page images alongside the translation. See the Methodology section for technical details.

Rules:
- Write in clear, scholarly prose for educated general readers
- Use ## markdown headings
- Do NOT use vague praise like "groundbreaking," "seminal," "masterpiece," or "profoundly influential" — let specific facts speak
- Do NOT fabricate biographical details, publication histories, or scholarly reception you are not confident about
- Do NOT claim human editorial review occurred
- Do NOT include any preamble — start directly with the first heading
- If you include a claim about historical influence or reception, it should be something a scholar could verify`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function generateMethodology(model, book, pages) {
  const models = new Set();
  pages.forEach(p => {
    if (p.ocr?.model) models.add(p.ocr.model);
    if (p.translation?.model) models.add(p.translation.model);
  });

  const prompt = `Write a concise methodology section (400-600 words) for this AI-translated scholarly edition.

**Facts about how this book was produced:**
- Title: ${book.title}
- Original language: ${book.language}
- Published: ${book.published}
- Total pages processed: ${pages.length}
- AI models used: ${Array.from(models).join(', ') || 'Google Gemini'}
- Source scan: ${book.ia_identifier ? `Internet Archive (${book.ia_identifier})` : 'digitized page images from a European digital library'}

**The actual pipeline (describe exactly this, no more):**
1. Page images were imported from a digital library and archived
2. Each page image was processed through an AI vision model for OCR, producing a transcription in the original ${book.language || 'source'} language
3. Each page was then translated into English by a large language model, with the previous page's translation provided as context for continuity
4. After translation, AI generated a reading summary, subject index, and chapter structure
5. The edition was assembled into this PDF with front matter and apparatus

**What to include:**
- ## How This Translation Was Produced — the pipeline above, stated plainly
- ## Editorial Conventions — explain what these inline tags mean in the translation text:
  - [Note: ...] = translator's explanatory comment
  - [Margin: ...] = marginalia from the original page
  - [?...] = uncertain or unclear reading
  - Technical terms are sometimes given with original language equivalents
- ## Limitations — be direct:
  - No human has reviewed this translation
  - AI may misread damaged or faded pages
  - Technical terminology, abbreviations, and wordplay are common failure points
  - ${book.language === 'Latin' ? 'Early modern Latin spelling and abbreviations differ from classical Latin and may cause errors' : book.language === 'German' ? 'Early modern German (Frühneuhochdeutsch) differs significantly from modern German' : `Early modern ${book.language || 'source language'} orthography may cause transcription errors`}
  - This edition is versioned and assigned a DOI — future improvements will be published as new versions
  - Corrections are welcome at sourcelibrary.org

**Rules:**
- Do NOT add steps or processes that aren't listed above
- Do NOT claim human review, editorial boards, or quality assurance processes
- Do NOT pad with filler — short and honest is better than long and vague
- Use ## markdown headings
- Start directly with the first heading`;

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
      // original_language is the language we translated FROM; work_language
      // appears beside it only when the work itself is in a third language.
      ...citationLanguageFields(book),
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
      // --allow-anon admits authorless works (minted with creator "Anonymous")
      ...(ALLOW_ANON ? {} : { author: { $nin: [null, '', 'Unknown', 'Anonymous'] } }),
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
