import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { Document } from 'mongodb';

/**
 * OAI-PMH 2.0 endpoint — exposes Source Library catalog for harvesting
 * by WorldCat, Europeana, and other library aggregators.
 *
 * GET /api/oai?verb=Identify|ListMetadataFormats|ListSets|ListIdentifiers|ListRecords|GetRecord
 */

export const revalidate = 3600; // ISR: 1 hour

const BASE_URL = 'https://sourcelibrary.org/api/oai';
const REPO_NAME = 'Source Library';
const ADMIN_EMAIL = 'derek@sourcelibrary.org';
const PAGE_SIZE = 100;

// ─── XML helpers ───

function xmlHeader(responseDate: string, verb: string, params: Record<string, string> = {}): string {
  const attrs = Object.entries(params).map(([k, v]) => `${k}="${escXml(v)}"`).join(' ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/ http://www.openarchives.org/OAI/2.0/OAI-PMH.xsd">
  <responseDate>${responseDate}</responseDate>
  <request verb="${verb}" ${attrs}>${BASE_URL}</request>`;
}

function xmlFooter(): string {
  return `\n</OAI-PMH>`;
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function xmlResponse(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}

function oaiError(code: string, message: string, verb?: string): NextResponse {
  const now = new Date().toISOString();
  return xmlResponse(
    `<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/ http://www.openarchives.org/OAI/2.0/OAI-PMH.xsd">
  <responseDate>${now}</responseDate>
  <request>${BASE_URL}</request>
  <error code="${code}">${escXml(message)}</error>
</OAI-PMH>`
  );
}

// ─── Dublin Core mapping ───

function bookToOaiDc(book: Document): string {
  const dc: string[] = [];
  const add = (field: string, value: string | undefined | null) => {
    if (value) dc.push(`    <dc:${field}>${escXml(value)}</dc:${field}>`);
  };

  add('title', book.display_title || book.title);
  if (book.display_title && book.title !== book.display_title) {
    add('title', book.title); // original title as alternate
  }
  add('creator', book.author);
  add('date', book.year_published?.toString());
  add('language', book.language);
  add('description', book.ai_metadata?.description);
  add('type', 'Text');
  add('publisher', book.dublin_core?.dc_publisher || book.image_source?.provider_name);
  add('source', book.image_source?.source_url);
  add('rights', book.dublin_core?.dc_rights || 'CC BY-SA 4.0');
  add('identifier', `https://sourcelibrary.org/book/${book.slug || book.id}`);

  // Subjects from categories and faceted tags
  if (book.categories) {
    for (const cat of book.categories) add('subject', cat);
  }
  if (book.subject_keywords) {
    for (const kw of book.subject_keywords) add('subject', kw);
  }

  // Additional identifiers
  if (book.dublin_core?.dc_identifier) {
    for (const id of book.dublin_core.dc_identifier) add('identifier', id);
  }
  if (book.ustc_sn) add('identifier', `USTC:${book.ustc_sn}`);
  if (book.doi) add('identifier', `doi:${book.doi}`);

  // Contributors
  add('contributor', 'Source Library (AI translation)');
  if (book.dublin_core?.dc_contributor) {
    for (const c of book.dublin_core.dc_contributor) add('contributor', c);
  }

  // Format
  if (book.pages_count) add('format', `${book.pages_count} pages`);
  add('coverage', book.dublin_core?.dc_coverage);

  // Relations
  if (book.dublin_core?.dc_relation) {
    for (const r of book.dublin_core.dc_relation) add('relation', r);
  }

  return `      <oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/"
                  xmlns:dc="http://purl.org/dc/elements/1.1/"
                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/oai_dc/ http://www.openarchives.org/OAI/2.0/oai_dc.xsd">
${dc.join('\n')}
      </oai_dc:dc>`;
}

function bookToRecord(book: Document, headersOnly = false): string {
  const identifier = `oai:sourcelibrary.org:${book.id}`;
  const datestamp = (book.updated_at || book.created_at || new Date()).toISOString().split('T')[0];
  const sets = (book.categories || []).map((c: string) =>
    `      <setSpec>${escXml(c.toLowerCase().replace(/\s+/g, '-'))}</setSpec>`
  ).join('\n');

  let xml = `    <record>
      <header>
        <identifier>${identifier}</identifier>
        <datestamp>${datestamp}</datestamp>
${sets}
      </header>`;

  if (!headersOnly) {
    xml += `\n      <metadata>\n${bookToOaiDc(book)}\n      </metadata>`;
  }

  xml += '\n    </record>';
  return xml;
}

// ─── Resumption token (base64 JSON with offset + filters) ───

interface TokenData {
  offset: number;
  metadataPrefix: string;
  from?: string;
  until?: string;
  set?: string;
}

function encodeToken(data: TokenData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

function decodeToken(token: string): TokenData | null {
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString());
  } catch {
    return null;
  }
}

// ─── Query builder ───

function buildQuery(from?: string, until?: string, set?: string): Document {
  const query: Document = {
    pages_count: { $gt: 0 },
    pages_ocr: { $gt: 0 },
  };
  if (from || until) {
    query.updated_at = {};
    if (from) query.updated_at.$gte = new Date(from);
    if (until) query.updated_at.$lte = new Date(until + 'T23:59:59Z');
  }
  if (set) {
    query.categories = { $regex: new RegExp(`^${set.replace(/-/g, '[\\s-]')}$`, 'i') };
  }
  return query;
}

// ─── Verb handlers ───

async function handleIdentify(now: string): Promise<NextResponse> {
  const db = await getDb();
  const earliest = await db.collection('books').findOne(
    { pages_count: { $gt: 0 } },
    { sort: { created_at: 1 }, projection: { created_at: 1 } }
  );
  const earliestDate = earliest?.created_at
    ? new Date(earliest.created_at).toISOString().split('T')[0]
    : '2022-01-01';

  return xmlResponse(
    `${xmlHeader(now, 'Identify')}
  <Identify>
    <repositoryName>${REPO_NAME}</repositoryName>
    <baseURL>${BASE_URL}</baseURL>
    <protocolVersion>2.0</protocolVersion>
    <adminEmail>${ADMIN_EMAIL}</adminEmail>
    <earliestDatestamp>${earliestDate}</earliestDatestamp>
    <deletedRecord>no</deletedRecord>
    <granularity>YYYY-MM-DD</granularity>
    <description>
      <oai-identifier xmlns="http://www.openarchives.org/OAI/2.0/oai-identifier"
                      xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/oai-identifier http://www.openarchives.org/OAI/2.0/oai-identifier.xsd">
        <scheme>oai</scheme>
        <repositoryIdentifier>sourcelibrary.org</repositoryIdentifier>
        <delimiter>:</delimiter>
        <sampleIdentifier>oai:sourcelibrary.org:example123</sampleIdentifier>
      </oai-identifier>
    </description>
  </Identify>${xmlFooter()}`
  );
}

function handleListMetadataFormats(now: string): NextResponse {
  return xmlResponse(
    `${xmlHeader(now, 'ListMetadataFormats')}
  <ListMetadataFormats>
    <metadataFormat>
      <metadataPrefix>oai_dc</metadataPrefix>
      <schema>http://www.openarchives.org/OAI/2.0/oai_dc.xsd</schema>
      <metadataNamespace>http://purl.org/dc/elements/1.1/</metadataNamespace>
    </metadataFormat>
  </ListMetadataFormats>${xmlFooter()}`
  );
}

async function handleListSets(now: string): Promise<NextResponse> {
  const db = await getDb();
  const categories = await db.collection('books').distinct('categories', { pages_count: { $gt: 0 } });
  const sets = categories
    .filter(Boolean)
    .sort()
    .map((c: string) => {
      const spec = c.toLowerCase().replace(/\s+/g, '-');
      return `    <set>\n      <setSpec>${escXml(spec)}</setSpec>\n      <setName>${escXml(c)}</setName>\n    </set>`;
    })
    .join('\n');

  return xmlResponse(
    `${xmlHeader(now, 'ListSets')}
  <ListSets>
${sets}
  </ListSets>${xmlFooter()}`
  );
}

async function handleListRecords(
  now: string,
  params: URLSearchParams,
  headersOnly: boolean
): Promise<NextResponse> {
  const verbName = headersOnly ? 'ListIdentifiers' : 'ListRecords';
  let offset = 0;
  let metadataPrefix = 'oai_dc';
  let from: string | undefined;
  let until: string | undefined;
  let set: string | undefined;

  const resumptionToken = params.get('resumptionToken');
  if (resumptionToken) {
    const token = decodeToken(resumptionToken);
    if (!token) return oaiError('badResumptionToken', 'Invalid resumption token', verbName);
    offset = token.offset;
    metadataPrefix = token.metadataPrefix;
    from = token.from;
    until = token.until;
    set = token.set;
  } else {
    metadataPrefix = params.get('metadataPrefix') || '';
    if (!metadataPrefix) return oaiError('badArgument', 'metadataPrefix is required', verbName);
    if (metadataPrefix !== 'oai_dc') return oaiError('cannotDisseminateFormat', 'Only oai_dc is supported', verbName);
    from = params.get('from') || undefined;
    until = params.get('until') || undefined;
    set = params.get('set') || undefined;
  }

  const db = await getDb();
  const query = buildQuery(from, until, set);
  const total = await db.collection('books').countDocuments(query);

  if (total === 0) return oaiError('noRecordsMatch', 'No records match the request', verbName);

  const books = await db.collection('books')
    .find(query)
    .sort({ updated_at: -1 })
    .skip(offset)
    .limit(PAGE_SIZE)
    .toArray();

  const records = books.map(b => bookToRecord(b, headersOnly)).join('\n');
  const nextOffset = offset + books.length;
  const hasMore = nextOffset < total;

  let tokenXml = '';
  if (hasMore) {
    const token = encodeToken({ offset: nextOffset, metadataPrefix, from, until, set });
    tokenXml = `\n    <resumptionToken completeListSize="${total}" cursor="${offset}">${token}</resumptionToken>`;
  } else if (offset > 0) {
    // Final page: empty resumptionToken signals end of list
    tokenXml = `\n    <resumptionToken completeListSize="${total}" cursor="${offset}"/>`;
  }

  return xmlResponse(
    `${xmlHeader(now, verbName, { metadataPrefix })}
  <${verbName}>
${records}${tokenXml}
  </${verbName}>${xmlFooter()}`
  );
}

async function handleGetRecord(now: string, params: URLSearchParams): Promise<NextResponse> {
  const identifier = params.get('identifier');
  const metadataPrefix = params.get('metadataPrefix');

  if (!identifier) return oaiError('badArgument', 'identifier is required', 'GetRecord');
  if (!metadataPrefix) return oaiError('badArgument', 'metadataPrefix is required', 'GetRecord');
  if (metadataPrefix !== 'oai_dc') return oaiError('cannotDisseminateFormat', 'Only oai_dc is supported', 'GetRecord');

  // Parse identifier: oai:sourcelibrary.org:BOOK_ID
  const parts = identifier.split(':');
  const bookId = parts.length === 3 ? parts[2] : parts[parts.length - 1];

  const db = await getDb();
  const book = await db.collection('books').findOne({
    $or: [{ id: bookId }, { slug: bookId }],
  });

  if (!book) return oaiError('idDoesNotExist', `No record with identifier ${identifier}`, 'GetRecord');

  return xmlResponse(
    `${xmlHeader(now, 'GetRecord', { identifier, metadataPrefix })}
  <GetRecord>
${bookToRecord(book)}
  </GetRecord>${xmlFooter()}`
  );
}

// ─── Main handler ───

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const verb = searchParams.get('verb');
  const now = new Date().toISOString();

  if (!verb) return oaiError('badVerb', 'verb argument is required');

  switch (verb) {
    case 'Identify':
      return handleIdentify(now);
    case 'ListMetadataFormats':
      return handleListMetadataFormats(now);
    case 'ListSets':
      return handleListSets(now);
    case 'ListIdentifiers':
      return handleListRecords(now, searchParams, true);
    case 'ListRecords':
      return handleListRecords(now, searchParams, false);
    case 'GetRecord':
      return handleGetRecord(now, searchParams);
    default:
      return oaiError('badVerb', `"${verb}" is not a valid OAI-PMH verb`);
  }
}
