#!/usr/bin/env node
/**
 * Run unscanned verification on Kloss catalog records.
 *
 * Reads from the `kloss_catalog` collection (populated by scrape-kloss-catalog.mjs)
 * and runs each record through the Gemini-powered scan verification pipeline.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/verify-kloss-unscanned.mjs
 *
 * Options:
 *   --limit N         Process at most N records (default: 10)
 *   --manuscripts      Only verify manuscripts (Kl.MS. items)
 *   --books            Only verify printed books (not manuscripts)
 *   --recheck          Re-verify records that already have scan_verification
 *   --delay N          Delay between verifications in ms (default: 2000)
 *   --dry-run          Run verification but don't persist results
 *   --report           Print summary report of existing verifications
 */

import { MongoClient } from 'mongodb';

// Dynamic import for the TS library (compiled by tsx or via Next.js)
// We import the functions directly to avoid needing tsx compilation
import { GoogleGenAI } from '@google/genai';

const args = process.argv.slice(2);
const limit = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1], 10) : 10; })();
const delayMs = (() => { const i = args.indexOf('--delay'); return i >= 0 ? parseInt(args[i + 1], 10) : 2000; })();
const manuscriptsOnly = args.includes('--manuscripts');
const booksOnly = args.includes('--books');
const recheck = args.includes('--recheck');
const dryRun = args.includes('--dry-run');
const reportOnly = args.includes('--report');

// ── Inline verification (avoids TSX compilation requirement) ──────────

const MODEL = 'gemini-3-flash-preview';
const MAX_ROUNDS = 6;
const TEMPERATURE = 0.1;

function buildPrompt(record) {
  const title = record.title || 'Unknown title';
  const authors = Array.isArray(record.authors) ? record.authors.join(', ') : record.authors || 'Unknown';
  const year = record.year || 'Unknown date';
  const place = record.place_of_publication || '';
  const publisher = record.publisher || '';
  const shelfMark = record.shelf_mark || record.kloss_shelf_mark || '';
  const notes = Array.isArray(record.notes) ? record.notes.join('; ') : record.notes || '';
  const materialType = record.material_type || '';

  return `You are checking whether a historical book from the Bibliotheca Klossiana (a Masonic/esoteric collection in The Hague) has been digitally scanned and is available online.

## Book to Check
- **Title:** ${title}
- **Author(s):** ${authors}
- **Year:** ${year}
- **Place:** ${place}
- **Publisher:** ${publisher}
- **Type:** ${materialType}
- **Shelf mark:** ${shelfMark}
- **Notes:** ${notes}

## Instructions
1. ALWAYS call \`search_internet_archive\` first.
2. If IA finds nothing, try \`search_hathitrust\` and/or \`search_google_books\`.
3. For European texts, also try \`search_gallica\`.
4. Call \`make_determination\` after 2-4 searches.

## Match Criteria
Match THIS SPECIFIC BOOK — not just any work by the same author. Consider title, author, date, and edition. Manuscripts (Kl.MS.) are unique and almost certainly unscanned — a quick IA search suffices.

## Dispositions
- **confirmed_unscanned**: No scan found across 2+ sources.
- **likely_unscanned**: No clear scan, some ambiguous matches.
- **scan_found**: Complete, accessible scan exists. Cite URL.
- **partial_scan**: Restricted or incomplete scan.
- **needs_review**: Conflicting evidence.`;
}

const TOOL_DECLARATIONS = [
  {
    name: 'search_internet_archive',
    description: 'Search Internet Archive for scanned copies. Returns identifiers, titles, dates, and links.',
    parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'Author + title keywords' } }, required: ['query'] },
  },
  {
    name: 'search_hathitrust',
    description: 'Search HathiTrust Digital Library. Returns catalog records with access status.',
    parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'Author/title keywords' } }, required: ['query'] },
  },
  {
    name: 'search_google_books',
    description: 'Search Google Books. Check viewability: ALL_PAGES = full scan, PARTIAL = some pages.',
    parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'Author + title keywords' } }, required: ['query'] },
  },
  {
    name: 'search_gallica',
    description: 'Search Gallica (BnF) for European historical texts.',
    parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'Author/title keywords' } }, required: ['query'] },
  },
  {
    name: 'make_determination',
    description: 'Final verdict. MUST be called to complete verification.',
    parameters: {
      type: 'OBJECT',
      properties: {
        disposition: { type: 'STRING', enum: ['confirmed_unscanned', 'likely_unscanned', 'scan_found', 'partial_scan', 'needs_review'] },
        confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
        reasoning: { type: 'STRING', description: '2-4 sentence explanation' },
        scans_found: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING' },
              source: { type: 'STRING', enum: ['internet_archive', 'hathitrust', 'google_books', 'gallica'] },
              url: { type: 'STRING' },
              year: { type: 'STRING' },
              access: { type: 'STRING', enum: ['open', 'restricted', 'partial', 'unknown'] },
              match_confidence: { type: 'STRING', enum: ['exact', 'likely', 'possible'] },
            },
            required: ['title', 'source', 'url', 'access', 'match_confidence'],
          },
        },
      },
      required: ['disposition', 'confidence', 'reasoning', 'scans_found'],
    },
  },
];

// ── Tool implementations ─────────────────────────────────────────────

async function searchIA(query) {
  try {
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=language&fl[]=mediatype&output=json&rows=10&page=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `IA ${res.status}`, results: [] };
    const data = await res.json();
    const docs = (data.response?.docs || []).map(d => ({
      ...d, url: `https://archive.org/details/${d.identifier}`,
    }));
    return { total: data.response?.numFound || 0, results: docs };
  } catch (e) { return { error: e.message, results: [] }; }
}

async function searchHT(query) {
  try {
    const url = `https://catalog.hathitrust.org/api/volumes/brief/title/${encodeURIComponent(query)}.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `HT ${res.status}`, results: [] };
    const data = await res.json();
    const records = data.records || {};
    const items = data.items || [];
    const results = [];
    for (const [rid, rec] of Object.entries(records)) {
      const recItems = items.filter(i => String(i.fromRecord) === rid);
      for (const item of recItems.slice(0, 3)) {
        results.push({
          title: rec.titles?.[0], published: rec.publishDates?.[0],
          ht_id: item.htid, access: item.usRightsString,
          url: `https://babel.hathitrust.org/cgi/pt?id=${item.htid}`,
        });
      }
    }
    return { total: Object.keys(records).length, results: results.slice(0, 10) };
  } catch (e) { return { error: e.message, results: [] }; }
}

async function searchGB(query) {
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { error: `GB ${res.status}`, results: [] };
    const data = await res.json();
    const results = (data.items || []).map(item => {
      const v = item.volumeInfo || {};
      const a = item.accessInfo || {};
      return {
        title: v.title, authors: v.authors, publishedDate: v.publishedDate,
        viewability: a.viewability, publicDomain: a.publicDomain,
        url: v.infoLink || v.previewLink,
      };
    });
    return { total: data.totalItems || 0, results };
  } catch (e) { return { error: e.message, results: [] }; }
}

async function searchGallica(query) {
  try {
    const url = `https://gallica.bnf.fr/SRU?version=1.2&operation=searchRetrieve&query=(gallica all "${query}")&maximumRecords=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `Gallica ${res.status}`, results: [] };
    const xml = await res.text();
    const records = xml.match(/<srw:record>[\s\S]*?<\/srw:record>/g) || [];
    const results = records.slice(0, 10).map(r => {
      const get = (tag) => { const m = r.match(new RegExp(`<dc:${tag}[^>]*>([^<]+)</dc:${tag}>`)); return m?.[1]?.trim(); };
      const ids = [...r.matchAll(/<dc:identifier[^>]*>([^<]+)<\/dc:identifier>/g)].map(m => m[1].trim());
      return { title: get('title'), creator: get('creator'), date: get('date'), url: ids.find(i => i.includes('gallica.bnf.fr')) || ids[0] };
    });
    const totalMatch = xml.match(/<srw:numberOfRecords>(\d+)<\/srw:numberOfRecords>/);
    return { total: totalMatch ? parseInt(totalMatch[1]) : results.length, results };
  } catch (e) { return { error: e.message, results: [] }; }
}

async function executeTool(name, toolArgs) {
  switch (name) {
    case 'search_internet_archive': return searchIA(toolArgs.query);
    case 'search_hathitrust': return searchHT(toolArgs.query);
    case 'search_google_books': return searchGB(toolArgs.query);
    case 'search_gallica': return searchGallica(toolArgs.query);
    case 'make_determination': return toolArgs;
    default: return { error: `Unknown tool: ${name}` };
  }
}

// ── Run verification for one record ──────────────────────────────────

async function verifyOne(ai, record) {
  const prompt = buildPrompt(record);
  const toolsCalled = [];
  let inputTokens = 0, outputTokens = 0;
  let determination = null;

  const contents = [{ role: 'user', parts: [{ text: prompt }] }];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        temperature: TEMPERATURE,
      },
    });

    const usage = response.usageMetadata || {};
    inputTokens += (usage.promptTokenCount || 0);
    outputTokens += (usage.candidatesTokenCount || 0);

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) break;

    contents.push({ role: 'model', parts: candidate.content.parts });

    const fcs = candidate.content.parts.filter(p => p.functionCall);
    if (!fcs.length) {
      // Model responded with text instead of a tool call — nudge it
      if (toolsCalled.length > 0) {
        contents.push({
          role: 'user',
          parts: [{ text: 'You must call the make_determination tool now to complete the verification. Do not respond with text — call the tool.' }],
        });
        continue;
      }
      break;
    }

    const responseParts = [];
    for (const part of fcs) {
      const { name, args: fcArgs } = part.functionCall;
      toolsCalled.push(name);
      const result = await executeTool(name, fcArgs || {});
      if (name === 'make_determination') determination = result;
      responseParts.push({ functionResponse: { name, response: result } });
    }
    contents.push({ role: 'user', parts: responseParts });
    if (determination) break;

    if (round >= 2) {
      contents.push({ role: 'user', parts: [{ text: 'Call make_determination now with your verdict.' }] });
    }
  }

  if (!determination) return { success: false, error: 'No determination made' };

  const cost = (inputTokens / 1e6) * 0.50 + (outputTokens / 1e6) * 3.00;

  return {
    success: true,
    verification: {
      disposition: determination.disposition,
      confidence: determination.confidence,
      reasoning: determination.reasoning,
      scans_found: determination.scans_found || [],
      tools_called: toolsCalled,
      verified_at: new Date(),
      model: MODEL,
      cost_usd: Math.round(cost * 1e6) / 1e6,
    },
    is_scanned: ['scan_found', 'partial_scan'].includes(determination.disposition),
  };
}

// ── Report mode ──────────────────────────────────────────────────────

async function printReport(db) {
  const coll = db.collection('kloss_catalog');
  const total = await coll.countDocuments({ is_kloss: true });
  const verified = await coll.countDocuments({ is_kloss: true, scan_verification: { $exists: true } });
  const unverified = total - verified;

  const pipeline = [
    { $match: { is_kloss: true, scan_verification: { $exists: true } } },
    { $group: { _id: '$scan_verification.disposition', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ];
  const dispositions = await coll.aggregate(pipeline).toArray();

  const costPipeline = [
    { $match: { is_kloss: true, 'scan_verification.cost_usd': { $exists: true } } },
    { $group: { _id: null, total_cost: { $sum: '$scan_verification.cost_usd' }, count: { $sum: 1 } } },
  ];
  const costResult = await coll.aggregate(costPipeline).toArray();
  const totalCost = costResult[0]?.total_cost || 0;
  const avgCost = costResult[0]?.count ? totalCost / costResult[0].count : 0;

  // Sample scans found
  const scansFound = await coll.find(
    { is_kloss: true, 'scan_verification.disposition': 'scan_found' },
    { projection: { title: 1, year: 1, 'scan_verification.scans_found': 1 } },
  ).limit(5).toArray();

  console.log(`\n=== Kloss Catalog Verification Report ===\n`);
  console.log(`Total Kloss records: ${total}`);
  console.log(`Verified: ${verified} (${(verified / total * 100).toFixed(1)}%)`);
  console.log(`Remaining: ${unverified}\n`);

  console.log(`Dispositions:`);
  for (const d of dispositions) {
    console.log(`  ${d._id}: ${d.count}`);
  }

  console.log(`\nCost: $${totalCost.toFixed(4)} total, $${avgCost.toFixed(4)} avg per record`);

  if (scansFound.length > 0) {
    console.log(`\nSample scans found:`);
    for (const r of scansFound) {
      const scan = r.scan_verification?.scans_found?.[0];
      console.log(`  - ${r.title} (${r.year || 'n.d.'})`);
      if (scan) console.log(`    ${scan.source}: ${scan.url}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const coll = db.collection('kloss_catalog');

  const catalogCount = await coll.countDocuments();
  if (catalogCount === 0) {
    console.error('No records in kloss_catalog. Run scrape-kloss-catalog.mjs first.');
    await client.close();
    process.exit(1);
  }

  if (reportOnly) {
    await printReport(db);
    await client.close();
    return;
  }

  // Build query
  const query = { is_kloss: true };
  if (!recheck) query.scan_verification = { $exists: false };
  if (manuscriptsOnly) query.kloss_shelf_mark = { $regex: /Kl\.?\s*MS/i };
  if (booksOnly) query.kloss_shelf_mark = { $not: { $regex: /Kl\.?\s*MS/i } };

  const records = await coll.find(query).limit(limit).toArray();
  console.log(`Found ${records.length} records to verify (limit: ${limit})`);

  if (records.length === 0) {
    console.log('Nothing to verify. Use --recheck to re-process verified records.');
    await client.close();
    return;
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const stats = { total: 0, scanned: 0, unscanned: 0, partial: 0, review: 0, errors: 0, totalCost: 0 };

  for (const record of records) {
    stats.total++;
    const label = `[${stats.total}/${records.length}] ${(record.title || 'untitled').slice(0, 60)}`;
    process.stdout.write(`${label}... `);

    try {
      const result = await verifyOne(ai, record);

      if (!result.success) {
        console.log(`ERROR: ${result.error}`);
        stats.errors++;
        continue;
      }

      const v = result.verification;
      stats.totalCost += v.cost_usd;

      const icon = {
        confirmed_unscanned: 'UNSCANNED',
        likely_unscanned: 'LIKELY UNSCANNED',
        scan_found: 'SCAN FOUND',
        partial_scan: 'PARTIAL',
        needs_review: 'REVIEW',
      }[v.disposition] || v.disposition;

      console.log(`${icon} (${v.confidence}) — $${v.cost_usd.toFixed(4)}`);

      if (v.scans_found?.length > 0) {
        for (const s of v.scans_found) {
          console.log(`    → ${s.source}: ${s.url} (${s.access}, ${s.match_confidence})`);
        }
      }

      // Track stats
      if (v.disposition === 'scan_found') stats.scanned++;
      else if (v.disposition === 'partial_scan') stats.partial++;
      else if (v.disposition === 'needs_review') stats.review++;
      else stats.unscanned++;

      // Persist
      if (!dryRun) {
        await coll.updateOne(
          { priref: record.priref },
          {
            $set: {
              scan_verification: v,
              is_scanned: result.is_scanned,
              verified_at: new Date(),
            },
          },
        );
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      stats.errors++;
    }

    // Delay between requests
    if (stats.total < records.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Processed: ${stats.total}`);
  console.log(`Unscanned: ${stats.unscanned}`);
  console.log(`Scan found: ${stats.scanned}`);
  console.log(`Partial: ${stats.partial}`);
  console.log(`Needs review: ${stats.review}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Total cost: $${stats.totalCost.toFixed(4)}`);

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
