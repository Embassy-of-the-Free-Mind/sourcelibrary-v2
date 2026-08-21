/**
 * Collections that have been withdrawn and are not coming back.
 *
 * Distinct from `collection-redirects.json`, which is for collections that were
 * *renamed* — those 308 to their new slug. A withdrawn collection has no
 * successor, so redirecting anywhere would be a lie. It answered 404 instead,
 * which is wrong in a different way: 404 means "not here, try again later", so
 * crawlers keep requesting it and readers get nothing but a dead end. Over 30
 * days `/collections/kloss-collection` took 7 hits, none of them from the
 * scraper fleet — real people following a link that once worked.
 *
 * 410 Gone is the accurate answer: the resource existed, it is deliberately
 * gone, stop asking. Search engines drop a 410 far faster than a 404.
 *
 * Keep the public message factual and minimal — availability only. Do not name
 * parties, state reasons, or characterise any request that led to a withdrawal;
 * that is a legal matter and a proxy response is not the place for it.
 */

export const RETIRED_COLLECTIONS: Record<string, string> = {
  'kloss-collection':
    'This collection has been withdrawn and is no longer available on Source Library.',
};

/**
 * The public message for a retired collection path, or null if the path is not
 * a retired collection. Matches the collection page and nothing below it — a
 * deeper path under a retired slug is a different resource and is left alone.
 */
export function retiredCollectionMessage(pathname: string): string | null {
  const match = /^\/collections\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  const slug = decodeURIComponent(match[1]).toLowerCase();
  return RETIRED_COLLECTIONS[slug] ?? null;
}
