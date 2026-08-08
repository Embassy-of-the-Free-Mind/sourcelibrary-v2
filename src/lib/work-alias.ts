import type { Db } from 'mongodb';
import { canonWorkForWorkId } from '@/lib/canon-works';

/**
 * Resolve a retired work_id to its current address (#3759).
 *
 * When work_id clusters are merged, the losing ids are kept on every edition
 * of the work in `books.work_id_aliases` (indexed). A /work/<old-id> URL then
 * finds no editions by direct match; this lookup recovers the current
 * work_id from any book carrying the alias, and prefers the canon slug when
 * the surviving id belongs to a canon entry — one stable reading address.
 *
 * Returns the target route param (slug or work_id) or null when the id is not
 * a known alias. No visibility filter: even a fully hidden cluster should
 * redirect rather than 404, so the address stays stable when books resurface.
 */
export async function workAliasTarget(db: Db, id: string): Promise<string | null> {
  if (!id) return null;
  const holder = await db
    .collection('books')
    .findOne({ work_id_aliases: id }, { projection: { work_id: 1 } });
  const current = holder?.work_id as string | undefined;
  if (!current || current === id) return null;
  const canon = canonWorkForWorkId(current);
  return canon ? canon.slug : current;
}
