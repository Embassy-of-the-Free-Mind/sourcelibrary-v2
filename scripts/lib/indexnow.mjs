/**
 * IndexNow ping for scripts (#3755). Mirror of notifyBooksPublic in src/lib/indexnow.ts.
 *
 * PRIOR ART: src/lib/indexnow.ts — same key, host and endpoint, but that file is
 * TypeScript behind the '@/' alias and cannot be imported by plain-node scripts.
 * Keep the two in step (the key is public by design: it is served at /<key>.txt).
 */
export const INDEXNOW_HOST = 'sourcelibrary.org';
export const INDEXNOW_KEY = '091651ad52d44f5d9b1c6bcf465196dc';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

/** POST urls in batches of 10,000. Never throws; returns { sent, failed }. */
export async function pingIndexNow(urls, { fetchImpl = fetch } = {}) {
  const list = [...new Set((urls || []).filter((u) => u.startsWith(`https://${INDEXNOW_HOST}/`)))];
  let sent = 0; let failed = 0;
  for (let i = 0; i < list.length; i += 10000) {
    const chunk = list.slice(i, i + 10000);
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          host: INDEXNOW_HOST, key: INDEXNOW_KEY,
          keyLocation: `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`, urlList: chunk,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) sent += chunk.length;
      else { failed += chunk.length; console.error(`[IndexNow] ${res.status} for ${chunk.length} URLs`); }
    } catch (err) {
      failed += chunk.length;
      console.error('[IndexNow] error:', err?.message || err);
    }
  }
  return { sent, failed };
}

/** Ping the canonical /book/<slug> URL of each newly public book. Skipped under tests. */
export async function pingBooksPublic(books) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST || process.env.SKIP_INDEXNOW === '1') return null;
  const urls = (books || []).filter((b) => b.slug).map((b) => `https://${INDEXNOW_HOST}/book/${b.slug}`);
  return urls.length ? pingIndexNow(urls) : null;
}
