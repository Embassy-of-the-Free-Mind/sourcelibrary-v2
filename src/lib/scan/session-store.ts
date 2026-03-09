/**
 * OPFS-backed session store for scan sessions.
 *
 * Persists scan session manifest + page image blobs to the
 * Origin Private File System. Falls back to in-memory storage
 * when OPFS is unavailable (e.g. Firefox private browsing).
 */

export interface ScanSession {
  id: string;
  metadata: {
    title: string;
    author: string;
    language: string;
    year: string;
    ocr_text?: string;
  };
  bookId?: string;
  bookSlug?: string;
  pages: ScanPage[];
  created_at: Date;
  updated_at: Date;
}

export interface ScanPage {
  id: string;
  filename: string;
  uploaded: boolean;
  quality: { blurScore: number; brightnessScore: number };
  capturedAt: Date;
}

const SESSION_DIR = 'scan-session';
const MANIFEST_FILE = 'manifest.json';
const PAGES_DIR = 'pages';

// In-memory fallback when OPFS is unavailable
let memorySession: ScanSession | null = null;
const memoryBlobs = new Map<string, Blob>();

function isOPFSAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage;
}

async function getSessionDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(SESSION_DIR, { create: true });
}

async function getPagesDir(): Promise<FileSystemDirectoryHandle> {
  const sessionDir = await getSessionDir();
  return sessionDir.getDirectoryHandle(PAGES_DIR, { create: true });
}

function serializeSession(session: ScanSession): string {
  return JSON.stringify(session, (_, v) => {
    if (v instanceof Date) return v.toISOString();
    return v;
  });
}

function deserializeSession(json: string): ScanSession {
  const raw = JSON.parse(json);
  return {
    ...raw,
    created_at: new Date(raw.created_at),
    updated_at: new Date(raw.updated_at),
    pages: raw.pages.map((p: Record<string, unknown>) => ({
      ...p,
      capturedAt: new Date(p.capturedAt as string),
    })),
  };
}

async function writeManifest(session: ScanSession): Promise<void> {
  if (!isOPFSAvailable()) {
    memorySession = session;
    return;
  }
  const dir = await getSessionDir();
  const fileHandle = await dir.getFileHandle(MANIFEST_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(serializeSession(session));
  await writable.close();
}

async function readManifest(): Promise<ScanSession | null> {
  if (!isOPFSAvailable()) {
    return memorySession;
  }
  try {
    const dir = await getSessionDir();
    const fileHandle = await dir.getFileHandle(MANIFEST_FILE);
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (!text) return null;
    return deserializeSession(text);
  } catch {
    return null;
  }
}

/**
 * Request persistent storage on first use.
 * Non-blocking — fails silently if denied.
 */
async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist) {
      await navigator.storage.persist();
    }
  } catch {
    // Silently ignore — persistence is best-effort
  }
}

// -- Public API --

export async function createSession(
  metadata: ScanSession['metadata']
): Promise<ScanSession> {
  await requestPersistence();

  const session: ScanSession = {
    id: crypto.randomUUID(),
    metadata,
    pages: [],
    created_at: new Date(),
    updated_at: new Date(),
  };

  await writeManifest(session);
  return session;
}

export async function addPage(
  imageBlob: Blob,
  quality: ScanPage['quality']
): Promise<ScanPage> {
  const session = await readManifest();
  if (!session) throw new Error('No active scan session');

  const pageId = crypto.randomUUID();
  const filename = `${pageId}.jpg`;

  // Store image blob
  if (isOPFSAvailable()) {
    const pagesDir = await getPagesDir();
    const fileHandle = await pagesDir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(imageBlob);
    await writable.close();
  } else {
    memoryBlobs.set(pageId, imageBlob);
  }

  const page: ScanPage = {
    id: pageId,
    filename,
    uploaded: false,
    quality,
    capturedAt: new Date(),
  };

  session.pages.push(page);
  session.updated_at = new Date();
  await writeManifest(session);

  return page;
}

export async function removePage(id: string): Promise<void> {
  const session = await readManifest();
  if (!session) return;

  const page = session.pages.find((p) => p.id === id);
  if (!page) return;

  // Remove blob
  if (isOPFSAvailable()) {
    try {
      const pagesDir = await getPagesDir();
      await pagesDir.removeEntry(page.filename);
    } catch {
      // File may already be gone
    }
  } else {
    memoryBlobs.delete(id);
  }

  session.pages = session.pages.filter((p) => p.id !== id);
  session.updated_at = new Date();
  await writeManifest(session);
}

export async function reorderPages(ids: string[]): Promise<void> {
  const session = await readManifest();
  if (!session) return;

  const pageMap = new Map(session.pages.map((p) => [p.id, p]));
  const reordered: ScanPage[] = [];

  for (const id of ids) {
    const page = pageMap.get(id);
    if (page) reordered.push(page);
  }

  // Append any pages not in the ids list (safety net)
  for (const page of session.pages) {
    if (!ids.includes(page.id)) {
      reordered.push(page);
    }
  }

  session.pages = reordered;
  session.updated_at = new Date();
  await writeManifest(session);
}

export async function getSession(): Promise<ScanSession | null> {
  return readManifest();
}

export async function getPageBlob(pageId: string): Promise<Blob | null> {
  if (!isOPFSAvailable()) {
    return memoryBlobs.get(pageId) ?? null;
  }
  try {
    const pagesDir = await getPagesDir();
    const page = (await readManifest())?.pages.find((p) => p.id === pageId);
    if (!page) return null;
    const fileHandle = await pagesDir.getFileHandle(page.filename);
    const file = await fileHandle.getFile();
    return file;
  } catch {
    return null;
  }
}

export async function markPageUploaded(pageId: string): Promise<void> {
  const session = await readManifest();
  if (!session) return;

  const page = session.pages.find((p) => p.id === pageId);
  if (page) {
    page.uploaded = true;
    session.updated_at = new Date();
    await writeManifest(session);
  }
}

export async function updateSessionBookId(
  bookId: string,
  bookSlug?: string
): Promise<void> {
  const session = await readManifest();
  if (!session) return;

  session.bookId = bookId;
  if (bookSlug) session.bookSlug = bookSlug;
  session.updated_at = new Date();
  await writeManifest(session);
}

export async function clearSession(): Promise<void> {
  if (!isOPFSAvailable()) {
    memorySession = null;
    memoryBlobs.clear();
    return;
  }
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(SESSION_DIR, { recursive: true });
  } catch {
    // Directory may not exist
  }
}

export async function hasIncompleteSession(): Promise<boolean> {
  const session = await readManifest();
  if (!session) return false;
  // Incomplete = has pages that haven't been uploaded
  return session.pages.some((p) => !p.uploaded);
}
