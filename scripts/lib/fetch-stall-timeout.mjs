/**
 * Fetch an image with a STALL timeout instead of a total-duration cap.
 *
 * Why this exists (measured on Thibault, *Académie de l'Espée*, Gallica
 * bpt6k1912344f, 2026-07-31):
 *
 * The archivers aborted a fetch 60s after it *started*. That is a cap on file
 * size wearing a clock's clothing — at Gallica's ~570 KB/s, 60s buys ~34 MB
 * only if nothing else shares the pipe. The book's 45 double-page engravings
 * are ~21.7 MB each (11,873 × 8,919 px) and take ~38s alone; with two workers
 * sharing bandwidth they cross 60s and abort. Result: 42 of 45 plates failed
 * while the ordinary 6 MB text pages sailed through.
 *
 * The failure therefore selects for the LARGEST page in a book — which is
 * always the foldout, the map, the plate: the pages a reader actually came
 * for. And it is invisible, because the book still reports hundreds of
 * successfully archived pages.
 *
 * A stall timeout asks the right question — "is this connection still
 * delivering?" — rather than "has this taken too long?", so a 200 MB plate on
 * a slow link succeeds while a genuinely dead socket still fails fast. The
 * absolute `maxMs` cap remains as a backstop against a connection that
 * trickles forever.
 *
 * NOTE: do NOT "fix" a timeout of this kind by requesting a smaller IIIF size.
 * Width caps on wide-format material are the #3186 mistake (~2.1M pages left
 * 2-9× below their masters) and are doubly destructive on exactly the
 * double-page plates this function exists to rescue.
 */

import { createWriteStream } from 'node:fs';
import { pipeline as streamPipeline } from 'node:stream/promises';

/**
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.stallMs=60000]  Abort if no bytes arrive for this long.
 * @param {number} [opts.maxMs=900000]   Absolute backstop for a trickling connection.
 * @param {Record<string,string>} [opts.headers]
 * @returns {Promise<{ res: Response, buffer: Buffer }>}
 */
export async function fetchWithStallTimeout(url, opts = {}) {
  const stallMs = opts.stallMs ?? 60_000;
  const maxMs = opts.maxMs ?? 15 * 60_000;
  const headers = opts.headers ?? {};

  const controller = new AbortController();
  let abortReason = null;
  let stallTimer = null;

  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      abortReason = `stalled — no data for ${Math.round(stallMs / 1000)}s`;
      controller.abort();
    }, stallMs);
  };
  const hardTimer = setTimeout(() => {
    abortReason = `exceeded absolute cap of ${Math.round(maxMs / 1000)}s`;
    controller.abort();
  }, maxMs);

  const cleanup = () => {
    if (stallTimer) clearTimeout(stallTimer);
    clearTimeout(hardTimer);
  };

  armStall();
  try {
    const res = await fetch(url, { signal: controller.signal, headers });

    // Caller inspects status (429 handling, etc). Only drain the body on 2xx —
    // reading a large error page would be pointless work.
    if (!res.ok) {
      cleanup();
      return { res, buffer: Buffer.alloc(0) };
    }

    // Stream so the stall timer can be re-armed per chunk. `res.arrayBuffer()`
    // gives no progress signal, which is what forced the total-duration cap.
    const chunks = [];
    if (res.body) {
      for await (const chunk of res.body) {
        chunks.push(Buffer.from(chunk));
        armStall();
      }
    }
    cleanup();
    return { res, buffer: Buffer.concat(chunks) };
  } catch (err) {
    cleanup();
    // Surface WHY it aborted. A bare "This operation was aborted" is what made
    // the original failure read as rate-limiting for two debugging passes.
    if (abortReason) throw new Error(`fetch aborted: ${abortReason} (${url})`);
    throw err;
  }
}

/**
 * Same stall semantics, but streamed to a file instead of buffered in memory —
 * for the archive-bulk / archive-erara whole-book downloads (IA _jp2.zip and
 * e-rara PDFs run hundreds of MB to GB; buffering them would trade a timeout
 * bug for an OOM). The stall timer re-arms per chunk while `pipeline()`
 * preserves backpressure to disk.
 *
 * On a non-2xx response nothing is written and `bytes` is 0 — the caller
 * inspects `res.status`, exactly like fetchWithStallTimeout. On abort the
 * partial file is left for the caller's tmp-dir cleanup.
 *
 * @param {string} url
 * @param {string} destPath
 * @param {object} [opts]
 * @param {number} [opts.stallMs=60000]  Abort if no bytes arrive for this long.
 * @param {number} [opts.maxMs=900000]   Absolute backstop for a trickling connection.
 * @param {Record<string,string>} [opts.headers]
 * @returns {Promise<{ res: Response, bytes: number }>}
 */
export async function fetchToFileWithStallTimeout(url, destPath, opts = {}) {
  const stallMs = opts.stallMs ?? 60_000;
  const maxMs = opts.maxMs ?? 15 * 60_000;
  const headers = opts.headers ?? {};

  const controller = new AbortController();
  let abortReason = null;
  let stallTimer = null;

  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      abortReason = `stalled — no data for ${Math.round(stallMs / 1000)}s`;
      controller.abort();
    }, stallMs);
  };
  const hardTimer = setTimeout(() => {
    abortReason = `exceeded absolute cap of ${Math.round(maxMs / 1000)}s`;
    controller.abort();
  }, maxMs);

  const cleanup = () => {
    if (stallTimer) clearTimeout(stallTimer);
    clearTimeout(hardTimer);
  };

  armStall();
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok || !res.body) {
      cleanup();
      return { res, bytes: 0 };
    }

    let bytes = 0;
    const body = res.body;
    async function* rearmedChunks() {
      for await (const chunk of body) {
        bytes += chunk.length;
        armStall();
        yield chunk;
      }
    }
    await streamPipeline(rearmedChunks(), createWriteStream(destPath));
    cleanup();
    return { res, bytes };
  } catch (err) {
    cleanup();
    if (abortReason) throw new Error(`fetch aborted: ${abortReason} (${url})`);
    throw err;
  }
}
