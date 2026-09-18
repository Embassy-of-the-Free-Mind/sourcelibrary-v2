/**
 * PRIOR ART: twin of `scripts/lib/translation-source.mjs` (#4927) — the app's
 * translation writers (`translate-write.ts`, the SQS processor, batch-save, the
 * page editor PUT) need the same hash and the same marker as the scripts side,
 * and a rule with two copies drifts unless a test pins them together:
 * `tests/unit/translation-source-parity.test.ts`. Read the .mjs header for the
 * reasoning; this file carries none of it on purpose.
 */
import { createHash } from 'crypto';
import type { AnyBulkWriteOperation, Collection, Document } from 'mongodb';

export function sourceHash(text: unknown): string {
  return createHash('sha256').update(typeof text === 'string' ? text : '').digest('hex').slice(0, 16);
}

export const STALE_FIELD = 'translation_stale';

export const STALE_REASONS = Object.freeze({
  HASH_MISMATCH: 'hash_mismatch',
  OCR_NEWER: 'ocr_newer',
  UNDATED: 'undated',
  OCR_REWRITTEN: 'ocr_rewritten',
} as const);

export type StaleReason = (typeof STALE_REASONS)[keyof typeof STALE_REASONS];

export const STALE_MARGIN_MS = 60_000;

export const PLACEHOLDER_RE = /^\s*\[[^\]]{0,200}\]\s*$/;
export const PLACEHOLDER_SOURCES: readonly string[] = Object.freeze(['skip', 'system']);

interface TranslationLike {
  data?: unknown;
  source?: unknown;
  source_hash?: unknown;
  updated_at?: unknown;
  edited_at?: unknown;
}

interface PageLike {
  ocr?: { data?: unknown; updated_at?: unknown } | null;
  translation?: TranslationLike | string | null;
}

export function isPlaceholderTranslation(tr: unknown): boolean {
  if (!tr || typeof tr !== 'object') return false;
  const t = tr as TranslationLike;
  if (typeof t.source === 'string' && PLACEHOLDER_SOURCES.includes(t.source)) return true;
  return typeof t.data === 'string' && PLACEHOLDER_RE.test(t.data);
}

export function translationText(tr: unknown): string {
  if (typeof tr === 'string') return tr;
  const d = (tr as TranslationLike | null | undefined)?.data;
  return typeof d === 'string' ? d : '';
}

export function translationSourceFields(
  ocrText: unknown,
  ocrUpdatedAt?: unknown,
  { dotted = false }: { dotted?: boolean } = {},
): Record<string, string | Date> {
  const f: Record<string, string | Date> = { source_hash: sourceHash(ocrText) };
  const at = toDate(ocrUpdatedAt);
  if (at) f.source_updated_at = at;
  if (!dotted) return f;
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [`translation.${k}`, v]));
}

export const CLEAR_STALE_UNSET: Readonly<Record<string, ''>> = Object.freeze({ [STALE_FIELD]: '' });

export function translationStaleness(
  page: PageLike | null | undefined,
  { marginMs = STALE_MARGIN_MS }: { marginMs?: number } = {},
): { stale: false } | { stale: true; reason: StaleReason } {
  const tr = page?.translation;
  const text = translationText(tr);
  if (!text) return { stale: false };
  if (typeof tr === 'object' && tr !== null && isPlaceholderTranslation(tr)) return { stale: false };
  if (typeof tr === 'string' && PLACEHOLDER_RE.test(tr)) return { stale: false };

  const ocrText = page?.ocr?.data;
  if (typeof tr === 'object' && tr !== null && typeof tr.source_hash === 'string' && tr.source_hash) {
    return tr.source_hash === sourceHash(ocrText)
      ? { stale: false }
      : { stale: true, reason: STALE_REASONS.HASH_MISMATCH };
  }

  const ocrAt = toTime(page?.ocr?.updated_at);
  const trAt = typeof tr === 'object' && tr !== null ? toTime(tr.updated_at ?? tr.edited_at) : null;
  if (ocrAt === null) return { stale: false };
  if (trAt === null) return { stale: true, reason: STALE_REASONS.UNDATED };
  if (ocrAt - trAt > marginMs) return { stale: true, reason: STALE_REASONS.OCR_NEWER };
  return { stale: false };
}

export interface StaleMarker { reason: StaleReason; since: Date; lane?: string }

export function staleMarker(reason: StaleReason, { now = new Date(), lane }: { now?: Date; lane?: string } = {}): StaleMarker {
  const m: StaleMarker = { reason, since: now };
  if (lane) m.lane = lane;
  return m;
}

export const REAL_TRANSLATION_FILTER = Object.freeze({
  'translation.data': { $type: 'string', $ne: '', $not: PLACEHOLDER_RE },
  'translation.source': { $nin: PLACEHOLDER_SOURCES },
});

export interface StaleEntry { id?: unknown; _id?: unknown; text: string }

export function staleMarkerOps(entries: StaleEntry[] | null | undefined, { lane, now = new Date() }: { lane?: string; now?: Date } = {}) {
  const ops: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } }> = [];
  for (const e of entries || []) {
    if (!e || typeof e.text !== 'string') continue;
    const key = e.id !== undefined ? { id: e.id } : e._id !== undefined ? { _id: e._id } : null;
    if (!key) continue;
    ops.push({
      updateOne: {
        filter: { ...key, ...REAL_TRANSLATION_FILTER, 'translation.source_hash': { $ne: sourceHash(e.text) } },
        update: { $set: { [STALE_FIELD]: staleMarker(STALE_REASONS.OCR_REWRITTEN, { now, lane }) } },
      },
    });
  }
  return ops;
}

export async function markStaleAfterOcrWrite(
  pages: Collection<Document>,
  entries: StaleEntry[],
  { lane, now }: { lane?: string; now?: Date } = {},
): Promise<number> {
  const ops = staleMarkerOps(entries, { lane, now });
  if (ops.length === 0) return 0;
  try {
    const r = await pages.bulkWrite(ops as AnyBulkWriteOperation<Document>[], { ordered: false });
    return r.modifiedCount ?? 0;
  } catch (err) {
    console.warn(`[translation-source] stale marker write failed (${ops.length} ops): ${(err as Error).message}`);
    return 0;
  }
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toTime(v: unknown): number | null {
  const d = toDate(v);
  return d ? d.getTime() : null;
}
