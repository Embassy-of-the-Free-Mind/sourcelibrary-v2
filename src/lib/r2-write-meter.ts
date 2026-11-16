/**
 * R2 write meter: bytes and objects written per key family for one UTC day (v3#94).
 *
 * PRIOR ART: scripts/workers/r2-egress-spike-alert.mjs — same Cloudflare dataset
 * (`r2OperationsAdaptiveGroups`), but it reads bucket totals for reads vs writes and
 * runs on Hetzner; it has no per-prefix split and a Vercel route cannot import it.
 * scripts/audit/spend-reconcile.mjs reads the same dataset per bucket for the bill.
 *
 * Why: R2 grew 7.7 TB in ten days and nobody could say which writer did it until the
 * bill arrived. The storage ceiling (scripts/lib/r2-storage-ceiling.mjs) caps the
 * total; this says which key family the day's writes went to, so a writer nobody
 * remembered to gate shows up the next morning.
 *
 * Method: Cloudflare's own write log, `actionType: PutObject, actionStatus: success`,
 * one aliased group per `objectName_like` pattern, in ONE GraphQL request. No R2 LIST,
 * no cost. The dataset is adaptively sampled, so read figures as about ±2%; "other"
 * is total minus the three top-level families and can sit a little off zero for the
 * same reason (clamped at 0).
 *
 * These are GROSS writes. An overwrite counts here and adds nothing to storage, so
 * the day's figure can exceed the day's growth in `storage.r2_bytes`.
 */

export const R2_WRITE_BUCKET = 'sourcelibrary';
const CF_GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';

/**
 * Key families, as `objectName_like` patterns (`%` = any run of characters).
 * `pages`, `archived` and `deepzoom` are the top-level prefixes that took 99.97% of
 * bytes in the v3#94 window. `pages_marked` and `pages_thumb` are SUBSETS of `pages`
 * (the display-mark sibling was the ungated writer), not additional families.
 */
export const R2_WRITE_FAMILIES = {
  pages: 'pages/%',
  pages_marked: 'pages/%-marked.jpg',
  pages_thumb: 'pages/%-thumb.jpg',
  archived: 'archived/%',
  deepzoom: 'deepzoom/%',
} as const;

export type R2WriteFamily = keyof typeof R2_WRITE_FAMILIES | 'other' | 'total';

export interface R2WriteCount {
  bytes: number;
  objects: number;
}

export interface R2WriteMeter {
  /** The UTC day the figures describe (YYYY-MM-DD), not the day they were read. */
  day: string;
  bucket: string;
  families: Record<R2WriteFamily, R2WriteCount>;
  method: 'cf-r2-operations-putobject';
}

/** The last complete UTC day before `now`. */
export function previousUtcDay(now: Date = new Date()): string {
  return new Date(now.getTime() - 86400e3).toISOString().slice(0, 10);
}

export function buildR2WriteMeterQuery(accountId: string, day: string, bucket = R2_WRITE_BUCKET): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`r2-write-meter: bad day "${day}"`);
  const group = (alias: string, like?: string) =>
    `${alias}: r2OperationsAdaptiveGroups(limit: 1, filter: {date: "${day}", bucketName: "${bucket}", ` +
    `actionType: "PutObject", actionStatus: "success"${like ? `, objectName_like: "${like}"` : ''}}) ` +
    `{ sum { requests responseObjectSize } }`;
  const groups = [
    group('total'),
    ...Object.entries(R2_WRITE_FAMILIES).map(([alias, like]) => group(alias, like)),
  ];
  return `query { viewer { accounts(filter: {accountTag: "${accountId}"}) {\n${groups.join('\n')}\n} } }`;
}

/**
 * Turn the GraphQL response into the meter. An EMPTY group is a real zero (no puts
 * matched). A MISSING alias, an `errors` array or no account is a failed read and
 * throws: a meter that reports zero writes when it could not look is worse than none.
 */
export function parseR2WriteMeter(json: unknown, day: string, bucket = R2_WRITE_BUCKET): R2WriteMeter {
  const j = json as {
    errors?: unknown;
    data?: { viewer?: { accounts?: Record<string, { sum?: { requests?: number; responseObjectSize?: number } }[]>[] } };
  };
  const acct = j?.data?.viewer?.accounts?.[0];
  if ((Array.isArray(j?.errors) && j.errors.length > 0) || !acct) {
    throw new Error(`R2 write meter query failed: ${JSON.stringify(j?.errors ?? json ?? null).slice(0, 300)}`);
  }
  const read = (alias: string): R2WriteCount => {
    const rows = acct[alias];
    if (!Array.isArray(rows)) throw new Error(`R2 write meter: no "${alias}" group in the response`);
    return {
      bytes: Number(rows[0]?.sum?.responseObjectSize ?? 0),
      objects: Number(rows[0]?.sum?.requests ?? 0),
    };
  };
  const total = read('total');
  const named = Object.fromEntries(
    Object.keys(R2_WRITE_FAMILIES).map((k) => [k, read(k)]),
  ) as Record<keyof typeof R2_WRITE_FAMILIES, R2WriteCount>;
  const top = [named.pages, named.archived, named.deepzoom];
  const other: R2WriteCount = {
    bytes: Math.max(0, total.bytes - top.reduce((s, f) => s + f.bytes, 0)),
    objects: Math.max(0, total.objects - top.reduce((s, f) => s + f.objects, 0)),
  };
  return { day, bucket, families: { ...named, other, total }, method: 'cf-r2-operations-putobject' };
}

export async function fetchR2WriteMeter(
  opts: { day?: string; fetchImpl?: typeof fetch } = {},
): Promise<R2WriteMeter> {
  // .trim(): several Vercel env vars carry trailing newlines (see storage-stats route).
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const token = process.env.CF_ANALYTICS_TOKEN?.trim();
  if (!accountId || !token) throw new Error('R2 write meter: R2_ACCOUNT_ID or CF_ANALYTICS_TOKEN is not set');
  const day = opts.day ?? previousUtcDay();
  const res = await (opts.fetchImpl ?? fetch)(CF_GRAPHQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: buildR2WriteMeterQuery(accountId, day) }),
    // The meter is a side reading: a hung Cloudflare call must not take the whole
    // storage-stats run (maxDuration 120 s) down with it.
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`R2 write meter query failed: HTTP ${res.status}`);
  return parseR2WriteMeter(await res.json(), day);
}
