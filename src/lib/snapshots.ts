import { getDb } from './mongodb';
import { nanoid } from 'nanoid';
import type { PageSnapshot } from './types';

/**
 * Creates a snapshot of page content before re-processing.
 * Only creates a snapshot if the page has manually-edited content.
 *
 * @param pageId - The page ID
 * @param snapshotType - What triggered the snapshot
 * @param jobId - Optional job ID that triggered this
 * @returns The snapshot if created, undefined if no manual edits to backup
 */
export async function createSnapshotIfNeeded(
  pageId: string,
  snapshotType: PageSnapshot['snapshot_type'],
  jobId?: string
): Promise<PageSnapshot | undefined> {
  const db = await getDb();

  // Get current page data
  const page = await db.collection('pages').findOne({ id: pageId });
  if (!page) {
    console.warn(`[snapshots] Page ${pageId} not found`);
    return undefined;
  }

  // Check if there are any manual edits to backup
  const hasManualOcr = page.ocr?.source === 'manual' && page.ocr?.data;
  const hasManualTranslation = page.translation?.source === 'manual' && page.translation?.data;
  const hasManualSummary = page.summary?.source === 'manual' && page.summary?.data;

  // Only create snapshot if there's something manually edited
  if (!hasManualOcr && !hasManualTranslation && !hasManualSummary) {
    return undefined;
  }

  // Check if we should create a snapshot based on the operation
  let shouldSnapshot = false;
  if (snapshotType === 'pre_ocr' && hasManualOcr) shouldSnapshot = true;
  if (snapshotType === 'pre_translate' && hasManualTranslation) shouldSnapshot = true;
  if (snapshotType === 'pre_summary' && hasManualSummary) shouldSnapshot = true;
  if (snapshotType === 'manual_backup') shouldSnapshot = hasManualOcr || hasManualTranslation || hasManualSummary;

  if (!shouldSnapshot) {
    return undefined;
  }

  const snapshot: PageSnapshot = {
    id: nanoid(12),
    page_id: pageId,
    book_id: page.book_id,
    snapshot_type: snapshotType,
    created_at: new Date(),
    triggered_by_job_id: jobId,
  };

  // Save the content that was manually edited
  if (hasManualOcr) {
    snapshot.ocr_data = page.ocr.data;
    snapshot.ocr_edited_by = page.ocr.edited_by;
  }
  if (hasManualTranslation) {
    snapshot.translation_data = page.translation.data;
    snapshot.translation_edited_by = page.translation.edited_by;
  }
  if (hasManualSummary) {
    snapshot.summary_data = page.summary.data;
  }

  // Save to database (cast to remove _id type conflict)
  await db.collection('page_snapshots').insertOne(snapshot as unknown as Record<string, unknown>);

  console.log(`[snapshots] Created ${snapshotType} snapshot for page ${pageId} (id: ${snapshot.id})`);

  return snapshot;
}

/**
 * Get all snapshots for a page
 */
export async function getPageSnapshots(pageId: string): Promise<PageSnapshot[]> {
  const db = await getDb();
  const snapshots = await db.collection('page_snapshots')
    .find({ page_id: pageId })
    .sort({ created_at: -1 })
    .toArray();

  return snapshots as unknown as PageSnapshot[];
}

/**
 * Get a specific snapshot by ID
 */
export async function getSnapshot(snapshotId: string): Promise<PageSnapshot | null> {
  const db = await getDb();
  const snapshot = await db.collection('page_snapshots').findOne({ id: snapshotId });
  return snapshot as unknown as PageSnapshot | null;
}

/**
 * Restore a snapshot to the page
 */
export async function restoreSnapshot(
  snapshotId: string,
  restoredBy: string
): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();

  // Get the snapshot
  const snapshot = await db.collection('page_snapshots').findOne({ id: snapshotId });
  if (!snapshot) {
    return { success: false, error: 'Snapshot not found' };
  }

  // Build update object
  const updateData: Record<string, unknown> = { updated_at: new Date() };
  const now = new Date();

  if (snapshot.ocr_data) {
    updateData['ocr.data'] = snapshot.ocr_data;
    updateData['ocr.source'] = 'manual';
    updateData['ocr.edited_by'] = snapshot.ocr_edited_by || restoredBy;
    updateData['ocr.edited_at'] = now;
    updateData['ocr.updated_at'] = now;
  }

  if (snapshot.translation_data) {
    updateData['translation.data'] = snapshot.translation_data;
    updateData['translation.source'] = 'manual';
    updateData['translation.edited_by'] = snapshot.translation_edited_by || restoredBy;
    updateData['translation.edited_at'] = now;
    updateData['translation.updated_at'] = now;
  }

  if (snapshot.summary_data) {
    updateData['summary.data'] = snapshot.summary_data;
    updateData['summary.source'] = 'manual';
    updateData['summary.edited_by'] = restoredBy;
    updateData['summary.edited_at'] = now;
    updateData['summary.updated_at'] = now;
  }

  // Update the page
  const result = await db.collection('pages').updateOne(
    { id: snapshot.page_id },
    { $set: updateData }
  );

  if (result.matchedCount === 0) {
    return { success: false, error: 'Page not found' };
  }

  // Mark snapshot as restored
  await db.collection('page_snapshots').updateOne(
    { id: snapshotId },
    { $set: { restored_at: now, restored_by: restoredBy } }
  );

  console.log(`[snapshots] Restored snapshot ${snapshotId} for page ${snapshot.page_id}`);

  return { success: true };
}
