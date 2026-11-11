// PRIOR ART: scripts/maintenance/work-board-push.mjs (ops_reports `work-board:<box>`: what each box's headless jobs
// are doing, by tmux session, with no book ids); the `book_events` rows cli-ocr / cli-translate `apply` write (one per
// book, AFTER the write, keyed by run id, no lane, no Lands issue); the job directories under $JOB_SCRATCH (on one box,
// gone when reaped). None says, before the work, which books a subscription job has taken and for which lane.
/**
 * The book list of each subscription-lane job, recorded with the job (#7301 item 5), until the standing driver takes
 * books from `pipeline_next` through a queue boost (R6, #5825) and this list is the queue's own record.
 *
 * One document per (lane, job) in `lane_job_books`:
 *   { _id: '<lane>|<job>', lane, job, lands, book_ids: [...], pages (the largest page list loaded), first_at, last_at, box, until: 'R6 #5825' }
 * `job` is the claude-job name (JOB_NAME, exported by scripts/workers/claude-job.sh) or the reader's --job; `lands`
 * is the job's `Lands:` issue (JOB_LANDS). Written by each reader's READ stage when it loads its page list, so the
 * registry and /admin/pipeline can show what each lane owns while the work is still running. It writes nothing to
 * `books` or `pages`, and nothing reads it to select or skip a book: it is a record, not a lock.
 *
 * Best effort: a failure is logged and the read goes on (the reads are the work; this is their label).
 */
import os from 'node:os';

export const LANE_JOB_BOOKS = 'lane_job_books';

/** The job name and its Lands issue, from claude-job.sh's environment, else the reader's own --job. */
export function laneJob(fallbackJob, env = process.env) {
  const lands = String(env.JOB_LANDS ?? '').match(/\d{3,5}/)?.[0];
  return { job: env.JOB_NAME || fallbackJob || 'manual', lands: lands ? Number(lands) : null };
}

/** The update for one call, pure (the test pins it). */
export function laneBooksUpdate({ lane, job, lands, pages, now = new Date(), box = os.hostname() }) {
  const bookIds = [...new Set((pages || []).map((p) => p.book_id).filter(Boolean))].sort();
  return {
    filter: { _id: `${lane}|${job}` },
    update: {
      $setOnInsert: { lane, job, first_at: now, until: 'R6 #5825' },
      $set: { lands: lands ?? null, last_at: now, box },
      $addToSet: { book_ids: { $each: bookIds } },
      // A re-run loads the same list again: the largest list seen, not a running sum.
      $max: { pages: (pages || []).length },
    },
    bookIds,
  };
}

/** Record that `job` of `lane` has taken these pages' books. Never throws. */
export async function recordLaneBooks(db, { lane, job, lands, pages, log = console.log }) {
  if (!lane) { log('lane book list: this reader is not a registered lane; nothing recorded'); return null; }
  try {
    const u = laneBooksUpdate({ lane, job, lands, pages });
    await db.collection(LANE_JOB_BOOKS).updateOne(u.filter, u.update, { upsert: true });
    log(`lane book list: ${u.bookIds.length} book(s) recorded for lane ${lane}, job ${job}${lands ? ` (Lands #${lands})` : ''}`);
    return u.bookIds;
  } catch (e) {
    log(`lane book list: not recorded (${e.message}); the read goes on`);
    return null;
  }
}
