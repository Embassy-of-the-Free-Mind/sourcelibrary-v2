/**
 * Public-facing corpus statistics — the single source for counts quoted in
 * copy (developer docs, MCP tool descriptions, marketing surfaces).
 *
 * Before this file, five surfaces quoted five different image counts
 * (110k / 150k / 200k / 215k / 222k — issue #4290), and /llms.txt (read by
 * AI licensing partners) understated the artwork count by 10k. Import these
 * constants instead of hand-writing a number; static files that cannot
 * import (public/llms.txt) must be re-synced by hand when these change.
 *
 * Measured 2026-08-27 (re-measure before updating — they drift):
 *   gallery_images:                       206,372
 *   books with resource_type (artworks):   24,819
 * One-liner to re-measure:
 *   node --env-file=.env.production.local -e "import('mongodb').then(async({MongoClient})=>{const c=new MongoClient(process.env.MONGODB_URI);await c.connect();const db=c.db('bookstore');console.log(await db.collection('gallery_images').countDocuments({}),await db.collection('books').countDocuments({resource_type:{\$exists:true}}));await c.close()})"
 *
 * Keep these as conservative rounded floors ("N+"), never live counts — copy
 * that overstates is worse than copy that lags.
 */
export const IMAGE_CORPUS_STATS = {
  /** Illustrations extracted from book pages (gallery_images collection). */
  illustrations: '200,000+',
  /** Standalone museum artworks (books rows with resource_type). */
  artworks: '24,000+',
} as const;
