#!/usr/bin/env node
/**
 * Bulk-match the 1946 Vatican Index CSV (4,327 entries) against the Atlas catalog.
 * Complements scripts/banned-books-match.mjs (hand-curated 85 entries for
 * pre-1700 esoterica) — together they form the comprehensive matcher.
 *
 * Source CSV: .claude/docs/index-librorum-1946-bujanda.csv
 *   from https://github.com/aodhanlutetiae/index
 *   columns: ID, title, subtitle, additional_titles, period, language, author,
 *            place_publication, publisher, censorship_type, reason, fuller_name,
 *            original_title, publication_date, ...
 *
 * Output:
 *   .claude/docs/banned-books-csv-match.json
 *   .claude/docs/banned-books-csv-match.md
 *
 * DRY RUN by default. Pass --tag to apply $addToSet 'banned-books' to matched books.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/banned-books-match-csv.mjs
 */

import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CSV_PATH = join(ROOT, '.claude/docs/index-librorum-1946-bujanda.csv');
const REPORT_JSON = join(ROOT, '.claude/docs/banned-books-csv-match.json');
const REPORT_MD = join(ROOT, '.claude/docs/banned-books-csv-match.md');

const TAG = process.argv.includes('--tag');
const SLUG = 'banned-books';

// --- minimal CSV parser (handles quoted fields with embedded commas + newlines) ---
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else { field += c; }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter(r => r.length === header.length).map(r => {
    const o = {};
    for (let i = 0; i < header.length; i++) o[header[i]] = r[i];
    return o;
  });
}

const STOP = new Set([
  'libri','liber','libro','tres','duo','sive','seu','oder','over','quam','est',
  'das','ist','und','von','dans','dell','della','dello','de','del','di','la','le','les',
  'the','and','for','with','sur','que','aux','des','une','par','dell','this','that',
  'opera','omnia','tomus','tomi','volume','vol','editio','epistola','epistolae','liber',
  'libri','tractatus','dialogo','dialogus','commentarius','commentaria','book','books',
  'oeuvres','works','traite','traites','schriften','memoires','schrift'
]);

function norm(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s,'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function authorSurname(a) {
  if (!a) return '';
  // "Surname, Forename" → "Surname"  /  "Surname, Forename [dates]" → "Surname"
  const cleaned = a.replace(/\[[^\]]*\]/g, '').trim();
  if (cleaned.includes(',')) return norm(cleaned.split(',')[0]);
  // Last token if no comma
  const parts = norm(cleaned).split(/\s+/);
  return parts[parts.length - 1] || '';
}

function authorNorm(a) { return norm((a || '').replace(/\[[^\]]*\]/g, '')); }

function titleTokens(t) {
  const n = norm(t);
  return n.split(/\s+/).filter(w => w.length >= 5 && !STOP.has(w));
}

async function main() {
  const text = readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(text);
  console.log(`Loaded ${rows.length} Index entries from CSV.`);

  // Pre-process entries
  const entries = rows.map(r => ({
    id: r.ID,
    title: r.title,
    title_norm: norm(r.title),
    subtitle: r.subtitle,
    additional_titles: r.additional_titles,
    original_title: r.original_title,
    period: r.period,
    author: r.author,
    author_surname: authorSurname(r.author),
    author_norm: authorNorm(r.author),
    publication_date: r.publication_date,
    censorship_type: r.censorship_type,
    reason: r.reason,
    title_tokens: titleTokens(r.title),
    is_opera_omnia: /opera omnia|works|oeuvres compl|sämmtliche werke/i.test(r.title || ''),
  }));

  // Collect distinct surnames for the initial Atlas query (cuts the search space)
  const surnames = [...new Set(entries.map(e => e.author_surname).filter(s => s.length >= 4))];
  console.log(`Distinct surnames: ${surnames.length}`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Chunked $or query to avoid sending one massive query
  const allCandidates = new Map();
  const chunk = 200;
  for (let i = 0; i < surnames.length; i += chunk) {
    const slice = surnames.slice(i, i + chunk);
    const q = {
      $or: slice.flatMap(s => [
        { author: { $regex: `\\b${s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, $options: 'i' } },
        { author_normalized: { $regex: `\\b${s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, $options: 'i' } },
      ]),
      visible: { $ne: false },
    };
    const found = await books.find(q, {
      projection: { id: 1, slug: 1, title: 1, author: 1, author_normalized: 1, canonical_author_normalized: 1, year: 1, language: 1, collections: 1, cover_image: 1, thumbnail: 1 }
    }).toArray();
    for (const b of found) allCandidates.set(String(b._id), b);
    process.stdout.write(`  ${Math.min(i + chunk, surnames.length)}/${surnames.length} surnames → ${allCandidates.size} candidates\r`);
  }
  console.log(`\nFetched ${allCandidates.size} candidate books.`);

  // Match: for each candidate book, find any Index entries whose author matches AND
  // (title matches OR entry is opera_omnia/works)
  const matchedBookIds = new Set();
  const tagAdditions = new Set(); // books to $addToSet (already-tagged ones can still be in here, $addToSet is idempotent)
  const matchesPerEntry = new Map(); // entry.id → [books]

  // Build surname → entries index
  const bySurname = new Map();
  for (const e of entries) {
    if (e.author_surname.length < 4) continue;
    if (!bySurname.has(e.author_surname)) bySurname.set(e.author_surname, []);
    bySurname.get(e.author_surname).push(e);
  }

  for (const book of allCandidates.values()) {
    const authorFields = [book.author, book.author_normalized, book.canonical_author_normalized]
      .filter(Boolean).map(norm).join(' | ');
    const titleN = norm(book.title);
    if (!authorFields || !titleN) continue;

    for (const [surname, ents] of bySurname) {
      if (!new RegExp(`\\b${surname}\\b`).test(authorFields)) continue;
      for (const e of ents) {
        // For opera_omnia/works entries — match on author alone
        if (e.is_opera_omnia) {
          matchedBookIds.add(String(book._id));
          tagAdditions.add(String(book._id));
          if (!matchesPerEntry.has(e.id)) matchesPerEntry.set(e.id, []);
          matchesPerEntry.get(e.id).push({ book, confidence: 'opera_omnia' });
          continue;
        }
        // For specific titles — require token overlap
        if (e.title_tokens.length === 0) continue;
        let hits = 0;
        for (const tok of e.title_tokens) if (titleN.includes(tok)) hits++;
        const need = e.title_tokens.length === 1 ? 1 : 2;
        if (hits >= need) {
          matchedBookIds.add(String(book._id));
          tagAdditions.add(String(book._id));
          if (!matchesPerEntry.has(e.id)) matchesPerEntry.set(e.id, []);
          matchesPerEntry.get(e.id).push({ book, confidence: hits >= 3 ? 'title-strong' : 'title-fair' });
        }
      }
    }
  }

  console.log(`Matched ${matchedBookIds.size} books to ${matchesPerEntry.size} Index entries.`);

  // Build report
  const report = {
    compiled: new Date().toISOString(),
    csv_entries: entries.length,
    candidate_books: allCandidates.size,
    matched_books: matchedBookIds.size,
    matched_index_entries: matchesPerEntry.size,
    have: [],     // entries with ≥1 book matched
    missing: [],  // entries with 0 books matched
  };

  for (const e of entries) {
    const ms = matchesPerEntry.get(e.id) || [];
    if (ms.length > 0) {
      report.have.push({
        index_id: e.id,
        title: e.title,
        author: e.author,
        period: e.period,
        publication_date: e.publication_date,
        match_count: ms.length,
        books: ms.slice(0, 8).map(m => ({
          id: m.book.id || String(m.book._id),
          title: m.book.title,
          author: m.book.author,
          year: m.book.year,
          confidence: m.confidence,
        })),
      });
    } else {
      report.missing.push({
        index_id: e.id,
        title: e.title,
        author: e.author,
        period: e.period,
        publication_date: e.publication_date,
        is_opera_omnia: e.is_opera_omnia,
        reason: e.reason,
      });
    }
  }

  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));

  // Markdown summary
  let md = `# Banned Books — 1946 Vatican Index Match Report\n\n`;
  md += `_Generated ${new Date().toISOString()} from ${entries.length} CSV entries._\n\n`;
  md += `- **Index entries:** ${entries.length}\n`;
  md += `- **Candidate books fetched (surname match):** ${allCandidates.size}\n`;
  md += `- **Books matched STRICT (to tag):** ${matchedBookIds.size}\n`;
  md += `- **Index entries with ≥1 catalog match:** ${matchesPerEntry.size}\n`;
  md += `- **Index entries MISSING from catalog:** ${entries.length - matchesPerEntry.size}\n\n`;

  // Top matched entries
  md += `## Top matched entries\n\n`;
  const top = [...report.have].sort((a, b) => b.match_count - a.match_count).slice(0, 30);
  for (const h of top) {
    md += `### ${h.title?.slice(0, 80) || '(no title)'}\n`;
    md += `- Author: ${h.author || '?'} | Period: ${h.period || '?'} | Matches: ${h.match_count}\n`;
    for (const b of h.books.slice(0, 3)) {
      md += `  - ${b.title?.slice(0, 70) || ''} (${b.year ?? '?'}) [${b.confidence}]\n`;
    }
    md += `\n`;
  }

  writeFileSync(REPORT_MD, md);
  console.log(`Wrote: ${REPORT_JSON}`);
  console.log(`Wrote: ${REPORT_MD}`);

  if (TAG) {
    console.log(`\n--tag flag set — applying writes to DB…`);
    if (tagAdditions.size > 0) {
      // Need to convert back to ObjectIds — track them
      const ids = [...tagAdditions].map(s => {
        const b = allCandidates.get(s);
        return b._id;
      });
      const result = await books.updateMany(
        { _id: { $in: ids } },
        { $addToSet: { collections: SLUG } }
      );
      console.log(`Tagged ${result.modifiedCount} books with collection '${SLUG}' (idempotent — many may already be tagged).`);
    }
    // Update collection book_count
    const totalTagged = await books.countDocuments({ collections: SLUG });
    await db.collection('collections').updateOne(
      { slug: SLUG },
      { $set: { book_count: totalTagged, updated_at: new Date() } }
    );
    console.log(`Collection '${SLUG}' now has book_count = ${totalTagged}`);
  } else {
    console.log(`\n(dry run — no DB writes. Pass --tag to apply.)`);
  }

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
