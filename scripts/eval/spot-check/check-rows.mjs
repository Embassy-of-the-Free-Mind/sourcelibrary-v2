/**
 * PRIOR ART: scripts/maintenance/backfill-book-checks.mjs (#6174 part 1) built these rows inline for the backfill;
 * overview-score.mjs and register.mjs now write the same rows at the end of a run, so the mapping lives here once:
 * a writer and the backfill can never disagree about what a verdict or a serious page is. The write itself is
 * recordBookCheck() in scripts/lib/book-checks.mjs.
 *
 * check-rows — turn a spot-check run's reviews into book_checks inputs (#6174).
 *   seriousPage / seriousClasses   overview-score.mjs's definition of a serious page, and the classes on it
 *   FIT                            shelf-overview's fit_to_show → show | caveat | fix
 *   derivedFortnightly             the fortnightly rule (scripts/eval/methods/fortnightly-spot-check.md)
 *   pageRecords / packetProvenance the text a run read: the packet's model ids, plus the page's *_updated_at when the
 *                                  text has not been rewritten since the check
 *   runCost                        `claude -p` total_cost_usd and model id from run-reviewers.sh's meta/<packet>*.json
 *                                  (what run-cost.py sums), so a row carries its share of the run's cost
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const allErrors = (p) => [...(p.ocr_errors || []), ...(p.tr_errors || []), ...(p.other || [])].filter((e) => e && typeof e === 'object');
export const seriousPage = (p) => allErrors(p).some((e) => e.severity === 'serious') || p.right_page === 'no';
export const seriousClasses = (pages) => [...new Set(pages.flatMap((p) => allErrors(p).filter((e) => e.severity === 'serious' && e.class).map((e) => String(e.class))))];
export const FIT = { show: 'show', show_with_caveat: 'caveat', do_not_show: 'fix' };

/** The fortnightly rule: stricter than a reviewer's own book verdict. Month 0 predates on_sight_defect. */
export function derivedFortnightly(b) {
  if (b.pages.some(seriousPage)) return 'fix';
  const onSight = 'on_sight_defect' in b ? b.on_sight_defect === true
    : !['yes', 'fits'].includes(b.shelf_fit) || b.pages.some((p) => allErrors(p).some((e) => e.severity === 'moderate'));
  return onSight ? 'caveat' : 'show';
}

const PAGE_PROJECTION = { _id: 0, id: 1, page_number: 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'ocr.prompt_version': 1,
  'translation.model': 1, 'translation.source': 1, 'translation.updated_at': 1, 'translation.content_hash': 1 };

/** Current page records of one book, keyed by page number. One indexed query ({book_id, page_number}); no text. */
export async function pageRecords(db, bookId, nums) {
  const rows = await db.collection('pages').find({ book_id: bookId, page_number: { $in: [...nums] } }, { projection: PAGE_PROJECTION }).toArray();
  return new Map(rows.map((r) => [r.page_number, r]));
}

const after = (d, at) => d && new Date(d) > at;

/**
 * Provenance entries for a run that froze its text in a packet. `now` = pageRecords() of the book; `packetPages` = the
 * packet's pages (ocr_model, ocr_engine, translation_model …). Without a packet entry it falls back to the page record,
 * and only when the text predates the check; otherwise the model ids are null with the reason.
 */
export function packetProvenance({ pagesRead, packetPages, now, checkedAt, provenanceFromPage }) {
  return pagesRead.map((n) => {
    const cur = now.get(n);
    const rewritten = cur && (after(cur.ocr?.updated_at, checkedAt) || after(cur.translation?.updated_at, checkedAt));
    const pk = packetPages?.find((p) => p.page_number === n);
    if (pk) {
      const e = { page_number: n, page_id: pk.page_id ?? null, ocr_model: pk.ocr_model ?? (pk.ocr_engine ? `source:${pk.ocr_engine}` : null),
        ocr_source: pk.ocr_engine ?? null, translation_model: pk.translation_model ?? null, translation_source: pk.translation_source ?? null,
        source: 'packet', changed_since_check: !cur || !!rewritten };
      if (cur && !rewritten) Object.assign(e, { ocr_updated_at: cur.ocr?.updated_at ?? null, ocr_prompt_version: cur.ocr?.prompt_version ?? null,
        translation_updated_at: cur.translation?.updated_at ?? null, translation_content_hash: cur.translation?.content_hash ?? null });
      const miss = [!e.ocr_model && 'packet has no ocr_model', !e.translation_model && 'packet has no translation_model'].filter(Boolean);
      if (miss.length) e.unknown_reason = miss.join('; ');
      return e;
    }
    if (!cur) return { page_number: n, ocr_model: null, translation_model: null, source: 'reconstructed', unknown_reason: 'no page record now and no packet' };
    if (rewritten) return { page_number: n, page_id: cur.id ?? null, ocr_model: null, translation_model: null, source: 'reconstructed', changed_since_check: true,
      unknown_reason: `text rewritten after the check (ocr ${cur.ocr?.updated_at?.toISOString?.() ?? '-'}, translation ${cur.translation?.updated_at?.toISOString?.() ?? '-'}) and no packet froze it` };
    return { ...provenanceFromPage(cur, 'reconstructed'), changed_since_check: false };
  });
}

/**
 * Cost and model of one packet's reviewer call(s) from run-reviewers.sh: Σ total_cost_usd over meta/<packet>.json and
 * meta/<packet>.retry.json (a call that wrote nothing still cost money), and the Opus model id from modelUsage. Null
 * when the run was not launched by run-reviewers.sh (a session's subagents leave no meta).
 */
export function runCost(dir, packet) {
  const meta = join(dir, 'meta');
  if (!existsSync(meta)) return null;
  let usd = 0, n = 0, model = null;
  for (const f of readdirSync(meta).filter((x) => x === `${packet}.json` || x === `${packet}.retry.json`)) {
    let r;
    try { r = JSON.parse(readFileSync(join(meta, f), 'utf8')); } catch { continue; }
    usd += r.total_cost_usd ?? 0; n++;
    const ids = Object.keys(r.modelUsage ?? {}).filter((k) => /opus/i.test(k));
    if (ids.length) model = ids.sort((a, b) => (r.modelUsage[b].outputTokens ?? 0) - (r.modelUsage[a].outputTokens ?? 0))[0];
  }
  return n ? { usd, model } : null;
}
