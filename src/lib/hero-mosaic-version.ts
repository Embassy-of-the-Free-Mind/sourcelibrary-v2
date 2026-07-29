/**
 * The current hero-mosaic cache version. Bumping it invalidates every cached
 * mosaic (forces a full regen), so treat it as a deliberate cache-buster.
 *
 * Lives in its own tiny module (no heavy deps) so the book page — a server
 * component — can import it to decide whether a book's cached mosaic is
 * current, WITHOUT pulling in the mosaic route's sharp/image toolchain.
 */
export const HERO_MOSAIC_VERSION = 23;
