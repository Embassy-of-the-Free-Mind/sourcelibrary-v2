/**
 * Zenodo API integration for DOI minting.
 *
 * Uses the InvenioRDM REST API (Zenodo migrated from legacy deposit API).
 * Docs: https://inveniordm.docs.cern.ch/reference/rest_api_drafts_records/
 *
 * Environment variables:
 *   ZENODO_ACCESS_TOKEN - Personal access token from zenodo.org/account/settings/applications/
 *   ZENODO_SANDBOX - Set to "true" to use sandbox.zenodo.org for testing
 */

import { TranslationEdition, Book } from './types';

const ZENODO_API = process.env.ZENODO_SANDBOX === 'true'
  ? 'https://sandbox.zenodo.org/api'
  : 'https://zenodo.org/api';

const ZENODO_URL = process.env.ZENODO_SANDBOX === 'true'
  ? 'https://sandbox.zenodo.org'
  : 'https://zenodo.org';

/* ── Types ── */

interface ZenodoRecord {
  id: number;
  parent: { id: number };
  pids: { doi: { identifier: string } };
  metadata: {
    title: string;
    description?: string;
    publication_date: string;
    resource_type: { id: string };
    creators: { person_or_org: { name: string; type: string; given_name?: string; family_name?: string } }[];
    rights?: { id: string }[];
    version?: string;
    languages?: { id: string }[];
    subjects?: { subject: string }[];
    related_identifiers?: { identifier: string; relation_type: { id: string }; scheme: string }[];
  };
  links: {
    self: string;
    self_html: string;
    files: string;
    draft?: string;
    publish?: string;
    versions?: string;
    latest?: string;
  };
  is_published: boolean;
  files?: { enabled: boolean };
}

interface ZenodoError {
  status: number;
  message: string;
  errors?: { field: string; messages: string[] }[];
}

/* ── Auth ── */

function getAccessToken(): string {
  const token = process.env.ZENODO_ACCESS_TOKEN;
  if (!token) {
    throw new Error('ZENODO_ACCESS_TOKEN environment variable is not set');
  }
  return token;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'Authorization': `Bearer ${getAccessToken()}`, ...extra };
}

/* ── Error handling ── */

async function handleZenodoError(response: Response, context: string): Promise<never> {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const error: ZenodoError = await response.json();
    const fieldErrors = error.errors?.map(e => `${e.field}: ${e.messages.join(', ')}`).join('; ');
    throw new Error(`Zenodo ${context}: ${error.message}${fieldErrors ? ` — ${fieldErrors}` : ''}`);
  } else {
    const text = await response.text();
    if (response.status === 401) {
      throw new Error(`Zenodo ${context}: Unauthorized — check your access token`);
    } else if (response.status === 403) {
      throw new Error(`Zenodo ${context}: Forbidden — token may lack deposit:write + deposit:actions scopes`);
    }
    throw new Error(`Zenodo ${context}: HTTP ${response.status} — ${text.substring(0, 300)}`);
  }
}

/* ── Record operations (InvenioRDM API) ── */

/**
 * Create a new blank draft record.
 */
export async function createDraft(book: Book, edition: TranslationEdition): Promise<ZenodoRecord> {
  const body = {
    access: { record: 'public', files: 'public' },
    files: { enabled: true },
    metadata: buildMetadata(book, edition),
  };

  console.log('Zenodo create draft metadata:', JSON.stringify(body.metadata, null, 2));

  const response = await fetch(`${ZENODO_API}/records`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });

  if (!response.ok) await handleZenodoError(response, 'create draft');
  return response.json();
}

/**
 * Create a new version of a published record. Returns the new draft.
 * Automatically deletes inherited files so fresh ones can be uploaded.
 */
export async function createNewVersion(recordId: number): Promise<ZenodoRecord> {
  // POST /api/records/{id}/versions creates a new version draft
  const response = await fetch(`${ZENODO_API}/records/${recordId}/versions`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({}),
  });

  if (!response.ok) await handleZenodoError(response, 'new version');
  const draft: ZenodoRecord = await response.json();

  // Delete inherited files from the previous version
  const filesResp = await fetch(`${ZENODO_API}/records/${draft.id}/draft/files`, {
    headers: authHeaders(),
  });
  if (filesResp.ok) {
    const filesData = await filesResp.json();
    const entries = filesData.entries || [];
    for (const f of entries) {
      await fetch(`${ZENODO_API}/records/${draft.id}/draft/files/${f.key}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
    }
  }

  return draft;
}

/**
 * Update metadata on a draft record.
 */
export async function updateDraftMetadata(
  draftId: number,
  book: Book,
  edition: TranslationEdition
): Promise<ZenodoRecord> {
  const body = {
    metadata: buildMetadata(book, edition),
  };

  const response = await fetch(`${ZENODO_API}/records/${draftId}/draft`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('Zenodo metadata error:', text);
    try {
      const error = JSON.parse(text);
      const fieldErrors = error.errors?.map((e: { field: string; messages: string[] }) =>
        `${e.field}: ${e.messages.join(', ')}`).join('; ');
      throw new Error(`Zenodo update metadata: ${error.message}${fieldErrors ? ` — ${fieldErrors}` : ''}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Zenodo')) throw e;
      throw new Error(`Zenodo update metadata: HTTP ${response.status} — ${text.substring(0, 500)}`);
    }
  }

  return response.json();
}

/**
 * Upload a file to a draft record (InvenioRDM 3-step: init → upload → commit).
 */
export async function uploadFile(
  draftId: number,
  filename: string,
  content: Buffer | string
): Promise<{ key: string; size: number }> {
  const token = getAccessToken();

  // Step 1: Initialize file upload
  const initResp = await fetch(`${ZENODO_API}/records/${draftId}/draft/files`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ key: filename }]),
  });
  if (!initResp.ok) await handleZenodoError(initResp, `file init (${filename})`);

  // Step 2: Upload content
  const body = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
  const uploadResp = await fetch(
    `${ZENODO_API}/records/${draftId}/draft/files/${encodeURIComponent(filename)}/content`,
    {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body,
    }
  );
  if (!uploadResp.ok) await handleZenodoError(uploadResp, `file upload (${filename})`);

  // Step 3: Commit
  const commitResp = await fetch(
    `${ZENODO_API}/records/${draftId}/draft/files/${encodeURIComponent(filename)}/commit`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    }
  );
  if (!commitResp.ok) await handleZenodoError(commitResp, `file commit (${filename})`);

  const result = await commitResp.json();
  return { key: result.key, size: result.size };
}

/**
 * Publish a draft record (mints DOI).
 */
export async function publishDraft(draftId: number): Promise<ZenodoRecord> {
  const response = await fetch(`${ZENODO_API}/records/${draftId}/draft/actions/publish`, {
    method: 'POST',
    headers: authHeaders(),
  });

  if (!response.ok) await handleZenodoError(response, 'publish');
  return response.json();
}

/**
 * Get a record by ID.
 */
export async function getRecord(recordId: number): Promise<ZenodoRecord> {
  const response = await fetch(`${ZENODO_API}/records/${recordId}`, {
    headers: authHeaders(),
  });

  if (!response.ok) await handleZenodoError(response, 'get record');
  return response.json();
}

/* ── Metadata builder ── */

function buildMetadata(book: Book, edition: TranslationEdition) {
  const licenseMap: Record<string, string> = {
    'CC0-1.0': 'cc-zero',
    'CC-BY-4.0': 'cc-by-4.0',
    'CC-BY-SA-4.0': 'cc-by-sa-4.0',
    'CC-BY-NC-4.0': 'cc-by-nc-4.0',
    'CC-BY-NC-SA-4.0': 'cc-by-nc-sa-4.0',
  };

  // Build InvenioRDM creators
  const creators = edition.contributors.map(c => {
    const displayName = c.type === 'ai' ? `${c.name} (AI)` : c.name;
    // InvenioRDM wants person_or_org with type
    return {
      person_or_org: {
        name: displayName,
        type: 'organizational' as const,
      },
    };
  });

  // Ensure at least one creator
  if (creators.length === 0) {
    creators.push({
      person_or_org: { name: 'Source Library', type: 'organizational' as const },
    });
  }

  const description = buildDescription(book, edition) +
    `\n\n<p><strong>Content hash:</strong> <code>${edition.content_hash}</code></p>`;

  // Build related identifiers for version linking
  const related_identifiers: { identifier: string; relation_type: { id: string }; scheme: string; resource_type?: { id: string } }[] = [];
  if (edition.previous_version_doi) {
    related_identifiers.push({
      identifier: edition.previous_version_doi,
      relation_type: { id: 'isnewversionof' },
      scheme: 'doi',
    });
  }

  return {
    title: edition.citation.title,
    resource_type: { id: 'publication-book' },
    publication_date: edition.published_at
      ? new Date(edition.published_at).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0],
    description,
    rights: [{ id: licenseMap[edition.license] || 'cc-by-4.0' }],
    creators,
    version: edition.version,
    languages: [{ id: 'eng' }],
    subjects: [
      'translation',
      'historical text',
      book.language,
      ...(book.categories || []),
    ].filter(Boolean).map(s => ({ subject: s as string })),
    ...(related_identifiers.length > 0 && { related_identifiers }),
  };
}

function buildDescription(book: Book, edition: TranslationEdition): string {
  const parts = [
    `<p>English translation of <em>${book.title}</em> by ${book.author}`,
    book.published ? ` (${book.published})` : '',
    '.</p>',
    '',
    '<p><strong>Original work:</strong></p>',
    '<ul>',
    `<li>Title: ${book.title}</li>`,
    `<li>Author: ${book.author}</li>`,
    `<li>Language: ${book.language}</li>`,
    book.published ? `<li>Published: ${book.published}</li>` : '',
    book.place_published ? `<li>Place: ${book.place_published}</li>` : '',
    book.publisher ? `<li>Publisher: ${book.publisher}</li>` : '',
    book.ustc_id ? `<li>USTC: ${book.ustc_id}</li>` : '',
    '</ul>',
    '',
    `<p><strong>Translation:</strong> ${edition.page_count} pages translated.</p>`,
    '',
    '<p>The scholarly EPUB includes the complete English translation with facsimile page images, introduction, methodology notes, glossary, and index.</p>',
    '',
    edition.changelog ? `<p><strong>Changes in this version:</strong> ${edition.changelog}</p>` : '',
    '',
    '<p>Generated by <a href="https://sourcelibrary.org">Source Library</a>.</p>',
  ];

  return parts.filter(Boolean).join('\n');
}

/* ── Full workflow ── */

/**
 * Full workflow: Create deposit, upload files, publish, return DOI.
 * Optionally uploads a scholarly EPUB alongside the .txt translation.
 */
export async function mintDoi(
  book: Book,
  edition: TranslationEdition,
  translationText: string,
  options?: { previousZenodoId?: number; epubBuffer?: Buffer; epubFilename?: string }
): Promise<{ doi: string; doi_url: string; zenodo_id: number; zenodo_url: string }> {
  const { previousZenodoId, epubBuffer, epubFilename } = options || {};

  // Create draft (or new version)
  let draft: ZenodoRecord;
  if (previousZenodoId) {
    draft = await createNewVersion(previousZenodoId);
    // Update metadata on the new version draft
    draft = await updateDraftMetadata(draft.id, book, edition);
  } else {
    draft = await createDraft(book, edition);
  }

  console.log(`Zenodo draft created: ${draft.id}`);

  // Upload translation text file
  const txtFilename = `${book.id}-translation-v${edition.version}.txt`;
  await uploadFile(draft.id, txtFilename, translationText);
  console.log(`Uploaded: ${txtFilename}`);

  // Upload scholarly EPUB if provided
  if (epubBuffer) {
    const epubName = epubFilename || `${(book as any).slug || book.id}-scholarly-v${edition.version}.epub`;
    await uploadFile(draft.id, epubName, epubBuffer);
    console.log(`Uploaded: ${epubName} (${(epubBuffer.length / 1024 / 1024).toFixed(1)}MB)`);
  }

  // Publish (mints DOI)
  const published = await publishDraft(draft.id);
  const doi = published.pids?.doi?.identifier;

  return {
    doi: doi || '',
    doi_url: doi ? `https://doi.org/${doi}` : '',
    zenodo_id: published.id,
    zenodo_url: `${ZENODO_URL}/records/${published.id}`,
  };
}

/**
 * Check if Zenodo is configured.
 */
export function isZenodoConfigured(): boolean {
  return !!process.env.ZENODO_ACCESS_TOKEN;
}

export { ZENODO_URL };
