/**
 * Background upload manager for scan sessions.
 *
 * Reads page blobs from OPFS (via session-store) and uploads
 * them to `/api/scan/upload` in batches. Runs independently of
 * the capture loop — never blocks the camera.
 */

import { getSession, getPageBlob, markPageUploaded } from './session-store';

const BATCH_SIZE = 5;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // exponential backoff

export interface UploadProgressEvent {
  pageId: string;
  status: 'uploading' | 'done' | 'error';
  totalUploaded: number;
  totalPages: number;
}

export interface UploadCompleteEvent {
  totalUploaded: number;
  failed: string[];
}

export interface UploadErrorEvent {
  pageId: string;
  error: string;
}

export class UploadQueue extends EventTarget {
  private bookId: string;
  private running = false;
  private pendingPages: string[] = [];
  private uploadedCount = 0;
  private failedPages: string[] = [];
  private totalPages = 0;
  private processingPromise: Promise<void> | null = null;

  constructor(bookId: string) {
    super();
    this.bookId = bookId;
  }

  /**
   * Start the upload queue. First recovers any un-uploaded pages
   * from a previous session, then processes newly added pages.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.processingPromise = this.recover().then(() => this.processLoop());
  }

  /**
   * Pause uploads. In-flight requests will complete but no new
   * batches will start.
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Notify the queue that a new page is ready for upload.
   */
  addPage(pageId: string): void {
    this.pendingPages.push(pageId);
    this.totalPages++;
    // Kick the loop if it's idle
    if (this.running && !this.processingPromise) {
      this.processingPromise = this.processLoop();
    }
  }

  getProgress(): { uploaded: number; total: number; failed: string[] } {
    return {
      uploaded: this.uploadedCount,
      total: this.totalPages,
      failed: [...this.failedPages],
    };
  }

  // -- Internal --

  private async recover(): Promise<void> {
    const session = await getSession();
    if (!session) return;

    const unuploaded = session.pages.filter((p) => !p.uploaded);
    if (unuploaded.length === 0) return;

    // Add un-uploaded pages to the front of the queue
    const existingIds = new Set(this.pendingPages);
    for (const page of unuploaded) {
      if (!existingIds.has(page.id)) {
        this.pendingPages.push(page.id);
        this.totalPages++;
      }
    }
  }

  private async processLoop(): Promise<void> {
    while (this.running && this.pendingPages.length > 0) {
      const batch = this.pendingPages.splice(0, BATCH_SIZE);
      await this.uploadBatch(batch);

      // Yield to the main thread between batches
      await new Promise<void>((resolve) => {
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(() => resolve());
        } else {
          setTimeout(resolve, 0);
        }
      });
    }

    this.processingPromise = null;

    // If everything has been processed, emit complete
    if (this.pendingPages.length === 0 && this.totalPages > 0) {
      const event = new CustomEvent<UploadCompleteEvent>('complete', {
        detail: {
          totalUploaded: this.uploadedCount,
          failed: [...this.failedPages],
        },
      });
      this.dispatchEvent(event);
    }
  }

  private async uploadBatch(pageIds: string[]): Promise<void> {
    // Resolve blobs from OPFS
    const entries: Array<{ id: string; blob: Blob }> = [];
    for (const id of pageIds) {
      const blob = await getPageBlob(id);
      if (blob) {
        entries.push({ id, blob });
      } else {
        // Blob missing — mark as failed
        this.failedPages.push(id);
        this.emitProgress(id, 'error');
        this.emitError(id, 'Page blob not found in OPFS');
      }
    }

    if (entries.length === 0) return;

    // Build FormData
    const formData = new FormData();
    formData.append('bookId', this.bookId);

    // Calculate start page number from already-uploaded count
    const session = await getSession();
    if (session) {
      const uploadedBefore = session.pages.filter((p) => p.uploaded).length;
      formData.append('startPageNumber', String(uploadedBefore + 1));
    }

    for (const entry of entries) {
      formData.append('files', entry.blob, `${entry.id}.jpg`);
      this.emitProgress(entry.id, 'uploading');
    }

    // Upload with retries
    let lastError = '';
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetch('/api/scan/upload', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          lastError = `HTTP ${res.status}: ${await res.text()}`;
          if (attempt < MAX_RETRIES - 1) {
            await this.delay(RETRY_DELAYS[attempt]);
            continue;
          }
        } else {
          // Success — mark all pages as uploaded
          for (const entry of entries) {
            await markPageUploaded(entry.id);
            this.uploadedCount++;
            this.emitProgress(entry.id, 'done');
          }
          return;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_RETRIES - 1) {
          await this.delay(RETRY_DELAYS[attempt]);
          continue;
        }
      }
    }

    // All retries exhausted
    for (const entry of entries) {
      this.failedPages.push(entry.id);
      this.emitProgress(entry.id, 'error');
      this.emitError(entry.id, lastError);
    }
  }

  private emitProgress(pageId: string, status: UploadProgressEvent['status']): void {
    this.dispatchEvent(
      new CustomEvent<UploadProgressEvent>('progress', {
        detail: {
          pageId,
          status,
          totalUploaded: this.uploadedCount,
          totalPages: this.totalPages,
        },
      })
    );
  }

  private emitError(pageId: string, error: string): void {
    this.dispatchEvent(
      new CustomEvent<UploadErrorEvent>('error', {
        detail: { pageId, error },
      })
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
