/**
 * Zenodo API integration for DOI minting.
 *
 * Zenodo is a free, open research repository operated by CERN.
 * It provides DOIs for any research output.
 *
 * API Docs: https://developers.zenodo.org/
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

interface ZenodoDeposit {
  id: number;
  conceptrecid: number;
  doi: string;
  doi_url: string;
  metadata: {
    title: string;
    upload_type: string;
    publication_date: string;
    description: string;
    access_right: string;
    license: string;
    creators: { name: string; orcid?: string; affiliation?: string }[];
    version?: string;
    language?: string;
    related_identifiers?: { identifier: string; relation: string; scheme: string }[];
    keywords?: string[];
  };
  links: {
    self: string;
    html: string;
    bucket: string;
    publish: string;
    edit: string;
    files: string;
    latest_draft: string;
  };
  state: 'unsubmitted' | 'done' | 'error';
  submitted: boolean;
}

interface ZenodoError {
  status: number;
  message: string;
  errors?: { field: string; message: string }[];
}

function getAccessToken(): string {
  const token = process.env.ZENODO_ACCESS_TOKEN;
  if (!token) {
    throw new Error('ZENODO_ACCESS_TOKEN environment variable is not set');
  }
  return token;
}

/**
 * Helper to handle Zenodo API errors (may return HTML on auth failure)
 */
async function handleZenodoError(response: Response, context: string): Promise<never> {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const error: ZenodoError = await response.json();
    throw new Error(`Zenodo ${context}: ${error.message}${error.errors ? ` - ${error.errors.map(e => e.message).join(', ')}` : ''}`);
  } else {
    // HTML error page (likely auth failure or server error)
    const text = await response.text();
    if (response.status === 401) {
      throw new Error(`Zenodo ${context}: Unauthorized - check your access token`);
    } else if (response.status === 403) {
      throw new Error(`Zenodo ${context}: Forbidden - token may lack required permissions`);
    }
    throw new Error(`Zenodo ${context}: HTTP ${response.status} - ${text.substring(0, 200)}`);
  }
}

/**
 * Create a new Zenodo deposit (draft)
 */
export async function createDeposit(): Promise<ZenodoDeposit> {
  const response = await fetch(`${ZENODO_API}/deposit/depositions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getAccessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    await handleZenodoError(response, 'create deposit');
  }

  return response.json();
}

/**
 * Update deposit metadata
 */
export async function updateDepositMetadata(
  depositId: number,
  book: Book,
  edition: TranslationEdition
): Promise<ZenodoDeposit> {
  // Map our license to Zenodo license IDs
  const licenseMap: Record<string, string> = {
    'CC0-1.0': 'cc-zero',
    'CC-BY-4.0': 'cc-by-4.0',
    'CC-BY-SA-4.0': 'cc-by-sa-4.0',
    'CC-BY-NC-4.0': 'cc-by-nc-4.0',
    'CC-BY-NC-SA-4.0': 'cc-by-nc-sa-4.0',
  };

  // Build creators list
  const creators = edition.contributors.map(c => ({
    name: c.type === 'ai' ? `${c.name} (AI)` : c.name,
    ...(c.orcid && { orcid: c.orcid }),
    ...(c.affiliation && { affiliation: c.affiliation }),
  }));

  // Add Source Library as organization if no human contributors
  if (!creators.some(c => !c.name.includes('(AI)'))) {
    creators.unshift({ name: 'Source Library', affiliation: 'https://sourcelibrary.org' });
  }

  const metadata = {
    title: edition.citation.title,
    upload_type: 'publication',
    publication_type: 'book',
    publication_date: edition.published_at
      ? new Date(edition.published_at).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0],
    description: buildDescription(book, edition),
    access_right: 'open',
    license: licenseMap[edition.license] || 'cc-by-4.0',
    creators,
    version: edition.version,
    language: 'eng',
    keywords: [
      'translation',
      'historical text',
      book.language,
      ...(book.categories || []),
    ],
    related_identifiers: [
      // Link to the original work if we have an identifier
      // Note: 'isDerivedFrom' is used since Zenodo doesn't have 'isTranslationOf'
      ...(book.ustc_id ? [{
        identifier: `USTC ${book.ustc_id}`,
        relation: 'isDerivedFrom',
        scheme: 'other',
      }] : []),
      // Link to previous version if exists
      ...(edition.previous_version_doi ? [{
        identifier: edition.previous_version_doi,
        relation: 'isNewVersionOf',
        scheme: 'doi',
      }] : []),
    ],
    notes: `Content hash: ${edition.content_hash}`,
  };

  const response = await fetch(`${ZENODO_API}/deposit/depositions/${depositId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${getAccessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ metadata }),
  });

  if (!response.ok) {
    await handleZenodoError(response, 'update metadata');
  }

  return response.json();
}

/**
 * Upload a file to the deposit
 */
export async function uploadFile(
  bucketUrl: string,
  filename: string,
  content: Buffer | string
): Promise<{ key: string; size: number; checksum: string }> {
  // Convert Buffer to Uint8Array for fetch compatibility
  const body = typeof content === 'string' ? content : new Uint8Array(content);
  const response = await fetch(`${bucketUrl}/${filename}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${getAccessToken()}`,
      'Content-Type': 'application/octet-stream',
    },
    body,
  });

  if (!response.ok) {
    await handleZenodoError(response, 'file upload');
  }

  return response.json();
}

/**
 * Publish the deposit (mints DOI)
 */
export async function publishDeposit(depositId: number): Promise<ZenodoDeposit> {
  const response = await fetch(`${ZENODO_API}/deposit/depositions/${depositId}/actions/publish`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getAccessToken()}`,
    },
  });

  if (!response.ok) {
    await handleZenodoError(response, 'publish');
  }

  return response.json();
}

/**
 * Get a deposit by ID
 */
export async function getDeposit(depositId: number): Promise<ZenodoDeposit> {
  const response = await fetch(`${ZENODO_API}/deposit/depositions/${depositId}`, {
    headers: {
      'Authorization': `Bearer ${getAccessToken()}`,
    },
  });

  if (!response.ok) {
    await handleZenodoError(response, 'get deposit');
  }

  return response.json();
}

/**
 * Create a new version of an existing deposit
 */
export async function createNewVersion(depositId: number): Promise<ZenodoDeposit> {
  const response = await fetch(`${ZENODO_API}/deposit/depositions/${depositId}/actions/newversion`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getAccessToken()}`,
    },
  });

  if (!response.ok) {
    await handleZenodoError(response, 'new version');
  }

  const result = await response.json();

  // The response contains a link to the new draft
  const latestDraftUrl = result.links.latest_draft;
  const latestDraftResponse = await fetch(latestDraftUrl, {
    headers: {
      'Authorization': `Bearer ${getAccessToken()}`,
    },
  });

  return latestDraftResponse.json();
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
    edition.changelog ? `<p><strong>Changes in this version:</strong> ${edition.changelog}</p>` : '',
    '',
    '<p>Generated by <a href="https://sourcelibrary.org">Source Library</a>.</p>',
  ];

  return parts.filter(Boolean).join('\n');
}

/**
 * Full workflow: Create deposit, upload files, publish, return DOI
 */
export async function mintDoi(
  book: Book,
  edition: TranslationEdition,
  translationText: string,
  previousZenodoId?: number
): Promise<{ doi: string; doi_url: string; zenodo_id: number; zenodo_url: string }> {
  // Create deposit (or new version)
  let deposit: ZenodoDeposit;
  if (previousZenodoId) {
    deposit = await createNewVersion(previousZenodoId);
  } else {
    deposit = await createDeposit();
  }

  // Update metadata
  deposit = await updateDepositMetadata(deposit.id, book, edition);

  // Upload translation file
  const filename = `${book.id}-translation-v${edition.version}.txt`;
  await uploadFile(deposit.links.bucket, filename, translationText);

  // Publish (mints DOI)
  deposit = await publishDeposit(deposit.id);

  return {
    doi: deposit.doi,
    doi_url: deposit.doi_url || `https://doi.org/${deposit.doi}`,
    zenodo_id: deposit.id,
    zenodo_url: `${ZENODO_URL}/record/${deposit.id}`,
  };
}

/**
 * Check if Zenodo is configured
 */
export function isZenodoConfigured(): boolean {
  return !!process.env.ZENODO_ACCESS_TOKEN;
}

export { ZENODO_URL };
