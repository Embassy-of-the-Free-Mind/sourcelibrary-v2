import type { Db } from 'mongodb';

/**
 * Machine-readable transcriptions of music printed in our books
 * (issue #3161 — Shaker letteral notation → ABC → in-reader playback).
 *
 * One document per piece. `abc` is ABC notation — the canonical storage
 * format: text-based, human-correctable, and rendered/played client-side
 * by abcjs without any audio files. Pieces that span page turns list every
 * page id in `spans_pages` (page_id = the page the piece starts on).
 */
export interface MusicTranscription {
  book_id: string;
  page_id: string;
  spans_pages: string[];
  title: string;
  abc: string;
  /** draft = machine/AI or unreviewed; verified = checked against the scan */
  status: 'draft' | 'verified';
  transcriber: string;
  verified_by?: string;
  notes?: string;
}

const PROJECTION = {
  _id: 0,
  book_id: 1,
  page_id: 1,
  spans_pages: 1,
  title: 1,
  abc: 1,
  status: 1,
  transcriber: 1,
  notes: 1,
} as const;

/** All transcriptions that include this page (starting on it or spanning it). */
export async function getTranscriptionsForPage(
  db: Db,
  pageId: string,
): Promise<MusicTranscription[]> {
  try {
    return (await db
      .collection('music_transcriptions')
      .find(
        { $or: [{ page_id: pageId }, { spans_pages: pageId }] },
        { projection: PROJECTION, maxTimeMS: 3000 },
      )
      .limit(10)
      .toArray()) as unknown as MusicTranscription[];
  } catch {
    // Player is an enhancement — a slow/failed lookup must never sink the reader.
    return [];
  }
}
