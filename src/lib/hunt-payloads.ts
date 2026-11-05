/**
 * Riddle payloads for the readable colophon (#8150 slice 2).
 *
 * PRIOR ART: src/lib/provenance.ts — owns the colophon and the mark, but must stay free of a database
 * import (it is called synchronously from ~20 export paths); this module is only the loader that feeds
 * its registry (`setHuntPayloads`). No other hunt/riddle store exists (git grep hunt_clues, riddle).
 *
 * The riddles live in the `hunt_clues` collection, never in this repo: the repo is public and the
 * riddles are the game. A clue document that carries a colophon payload looks like
 *   { carrier_book_id: '<book id>', payload: '<riddle, <= 320 bytes>', active: true, ... }
 * (the rest of the document — chain, step, answer hashes — belongs to the hunt itself, slice 3).
 *
 * Callers `await primeHuntPayloads()` before they mark text. It is bounded (never slows a render by
 * more than PRIME_TIMEOUT_MS), never throws, and serves the cached set for CACHE_TTL_MS. When the
 * set cannot be loaded, the registry keeps what it had, and with nothing loaded yet the colophon
 * is simply the stock note — the mark itself is unaffected either way.
 */
import { getDb } from './mongodb';
import { setHuntPayloads } from './provenance';

export const HUNT_CLUES_COLLECTION = 'hunt_clues';
const CACHE_TTL_MS = 10 * 60 * 1000;
const PRIME_TIMEOUT_MS = 1500;

let loadedAt = 0;
let inflight: Promise<void> | null = null;

async function load(): Promise<void> {
  const db = await getDb();
  const rows = await db
    .collection(HUNT_CLUES_COLLECTION)
    .find(
      { active: true, carrier_book_id: { $type: 'string' }, payload: { $type: 'string' } },
      { projection: { _id: 0, carrier_book_id: 1, payload: 1 } },
    )
    .limit(500)
    .toArray();
  setHuntPayloads(rows.map((r) => [String(r.carrier_book_id), String(r.payload)] as const));
  loadedAt = Date.now();
}

export async function primeHuntPayloads(): Promise<void> {
  if (!process.env.PROVENANCE_SECRET_KEY) return; // nothing is marked, so nothing to carry
  if (Date.now() - loadedAt < CACHE_TTL_MS) return;
  if (!inflight) {
    inflight = load()
      .catch((err) => {
        console.warn('[hunt-payloads] load failed; colophons keep the stock note', err instanceof Error ? err.message : err);
        loadedAt = Date.now() - CACHE_TTL_MS + 60_000; // retry in a minute, not on every request
      })
      .finally(() => {
        inflight = null;
      });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    inflight,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, PRIME_TIMEOUT_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

/** Test hook. */
export function __resetHuntPayloadCache(): void {
  loadedAt = 0;
  inflight = null;
}
