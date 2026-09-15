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
  /**
   * How the music is written on the page. Decides which recogniser can read it
   * (see .claude/docs/music-notation.md): letteral = pitch printed as a letter
   * (Shaker); neumes = plainchant on a four-line staff; mensural = pre-1650
   * diamond/void noteheads; tablature = lute/keyboard finger positions;
   * common-practice = engraved modern staff notation.
   */
  notation_system?: 'letteral' | 'neumes' | 'mensural' | 'tablature' | 'common-practice' | 'unknown';
  /**
   * Who or what produced `abc`, so a future model's rows are distinguishable
   * from today's and from a human's. Any automated writer MUST fill this
   * (the page_revisions lesson: a store that mixes mechanisms without a label
   * cannot be measured afterwards).
   */
  provenance?: {
    /** e.g. "gemini-3-flash-preview", "rokot-omr-2b", "human" */
    method: string;
    /** prompt or config hash, model revision — whatever pins the run */
    version?: string;
    date: string; // ISO
    /** page image(s) the run saw, as R2/IIIF URLs, so the run is reproducible */
    inputs?: string[];
  };
  /**
   * Scores from scripts/music/eval-transcription.mjs against a verified row
   * (`against` = that row's page_id). Draft rows carry this; verified rows are
   * the reference and never score themselves.
   */
  evaluation?: {
    against: string;
    date: string;
    pitch_ner: number;
    interval_ner: number;
    rhythm_ner: number;
    note_ner: number;
    lyric_wer?: number;
  };
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
  notation_system: 1,
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
