/**
 * Key-order mark — a keyed, deterministic order of JSON keys in API records
 * (#8150 slice 7: marks in metadata choices).
 *
 * PRIOR ART: src/lib/provenance.ts / steganographia.ts — they mark served TEXT
 *   with zero-width characters, which text cleaning strips; this marks the
 *   order of a record's keys, which survives cleaning and re-serialisation but
 *   carries no text. src/lib/image-marks.ts marks images. Neither fits records.
 *
 * Where order means nothing, a keyed choice of order can say where a copy came
 * from. JSON object keys are unordered by specification, and every consumer of
 * the carrier routes reads fields by name (read before building: BookLibrary,
 * api-client/search, MCP list_books, sitemap, works, distributions, the
 * public-api-contract audit). So the bytes change and the meaning does not.
 *
 * What this NEVER reorders (read the consumers; order there is meaning):
 *   - arrays: `collections[0]` is the primary collection (SchemaOrgMetadata,
 *     learn), the first 2–4 `categories`/`subjects` are what cards show;
 *   - authors, ranked results, IIIF metadata rows (viewers render them in
 *     order, and readers expect Author before Date);
 *   - any value, title form or date form.
 * Only the order of an object's own keys, with `id` and `title` pinned first so
 * the record still reads naturally to a person.
 *
 * Deterministic per record (HMAC of the record id), so every viewer gets the
 * same bytes and ISR/CDN caching is unaffected. Not per reader. With no key
 * configured it is a no-op.
 *
 * Detection is statistical over many records: for each record, the share of
 * key pairs whose observed order agrees with the keyed order. Unmarked or
 * re-sorted copies sit at 0.5 on average; a preserved copy sits near 1.0.
 */

import crypto from 'crypto';

const DOMAIN = 'key-order:v1:';
export const DEFAULT_PINNED = ['id', 'title'] as const;

function secretOrNull(secret?: string | null): string | null {
  const s = secret === undefined ? process.env.PROVENANCE_SECRET_KEY : secret;
  return s ? s : null;
}

function fieldRank(secret: string, recordId: string, field: string): string {
  return crypto.createHmac('sha256', secret).update(`${DOMAIN}${recordId}\0${field}`).digest('hex');
}

/** The keyed order of `fields` for one record. Pure; same inputs, same order. */
export function keyedFieldOrder(fields: readonly string[], recordId: string, secret: string): string[] {
  const ranked = fields.map(f => [f, fieldRank(secret, recordId, f)] as const);
  ranked.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return ranked.map(([f]) => f);
}

/**
 * Return a shallow copy of `record` with its keys in the keyed order (pinned
 * keys first, in the order given). Values are the same references. A record
 * with no id, or no key configured, is returned unchanged.
 */
export function orderRecordKeys<T extends Record<string, unknown>>(
  record: T,
  opts: { idField?: string; pinned?: readonly string[]; secret?: string | null } = {},
): T {
  const secret = secretOrNull(opts.secret);
  const idField = opts.idField ?? 'id';
  const recordId = record?.[idField];
  if (!secret || typeof recordId !== 'string' || !recordId) return record;
  const pinned = (opts.pinned ?? DEFAULT_PINNED).filter(k => Object.prototype.hasOwnProperty.call(record, k));
  const pinnedSet = new Set(pinned);
  const rest = Object.keys(record).filter(k => !pinnedSet.has(k));
  const out: Record<string, unknown> = {};
  for (const k of pinned) out[k] = record[k];
  for (const k of keyedFieldOrder(rest, recordId, secret)) out[k] = record[k];
  return out as T;
}

/** Share of key pairs in `observed` that agree with the keyed order, or null if < 3 keys. */
export function concordance(observed: readonly string[], recordId: string, secret: string): number | null {
  if (observed.length < 3) return null;
  const pos = new Map(keyedFieldOrder(observed, recordId, secret).map((f, i) => [f, i]));
  let agree = 0, pairs = 0;
  for (let i = 0; i < observed.length; i++) {
    for (let j = i + 1; j < observed.length; j++) {
      pairs++;
      if ((pos.get(observed[i]) as number) < (pos.get(observed[j]) as number)) agree++;
    }
  }
  return agree / pairs;
}

export interface KeyOrderVerdict {
  records: number;      // records offered
  scored: number;       // records with an id and >= 3 unpinned keys
  meanConcordance: number;
  /** Standard deviations above the 0.5 a copy with unrelated order shows. */
  z: number;
  /** Records whose order agrees on >= 95% of pairs. */
  strongRecords: number;
  marked: boolean;
}

/**
 * Test a copy of records (parsed JSON objects, key order as received) for the
 * key-order mark. `marked` needs z >= zThreshold (default 6) over the records.
 * Null variance per record is that of Kendall's tau for k keys under a random
 * permutation: Var(tau) = 2(2k+5) / (9k(k-1)); concordance = (tau+1)/2.
 */
export function detectKeyOrder(
  records: ReadonlyArray<Record<string, unknown>>,
  opts: { secret: string; idField?: string; pinned?: readonly string[]; zThreshold?: number },
): KeyOrderVerdict {
  const idField = opts.idField ?? 'id';
  const pinned = new Set(opts.pinned ?? DEFAULT_PINNED);
  let sum = 0, varSum = 0, scored = 0, strong = 0;
  for (const r of records) {
    const id = r?.[idField];
    if (typeof id !== 'string' || !id) continue;
    const keys = Object.keys(r).filter(k => !pinned.has(k));
    const c = concordance(keys, id, opts.secret);
    if (c === null) continue;
    const k = keys.length;
    scored++;
    sum += c - 0.5;
    varSum += (2 * (2 * k + 5)) / (9 * k * (k - 1)) / 4;
    if (c >= 0.95) strong++;
  }
  const z = scored && varSum > 0 ? sum / Math.sqrt(varSum) : 0;
  return {
    records: records.length,
    scored,
    meanConcordance: scored ? 0.5 + sum / scored : 0.5,
    z,
    strongRecords: strong,
    marked: z >= (opts.zThreshold ?? 6),
  };
}
