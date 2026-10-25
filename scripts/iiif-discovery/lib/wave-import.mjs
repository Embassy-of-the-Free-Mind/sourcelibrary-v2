/**
 * One acquisition-wave candidate → one hidden, held book (#7343). The library
 * half of scripts/iiif-discovery/import-wave.mjs; pure helpers plus importCandidate().
 *
 * PRIOR ART: scripts/iiif-discovery/import-from-cache.mjs builds the same book from
 * a candidate, but only from `manifest_cache` (none of the ~800K pre-1850 tier B/C
 * rows has one, and caching their pages in Mongo is the cost lazy pages avoids) and
 * it always writes page docs. scripts/iiif-discovery/import-batch.mjs goes through a
 * Vercel route, which bulk must not (import-cost-and-egress.md). The tier A driver
 * (job acq-wave-a-7343) is not in the repo. This module keeps import-from-cache's
 * book shape, the gate (insertBookIfNew) and the tier A rules: hold and archive
 * block written in the insert itself, fewer than 5 canvases skipped, Hijri-suspect
 * dates skipped, a host parked after two identical refusals.
 *
 * MANIFEST-ONLY (`manifestOnly: true`): the book gets its true `pages_count` (the
 * canvas count of the same manifest the materializer will read, through the same
 * getCanvases) and `pages_state: manifest_only`, and NO page docs. Without it the
 * book is inserted the same way and materialized at once through
 * materializePages(), so there is one page builder either way.
 */

import { ObjectId } from 'mongodb';
import { insertBookIfNew } from '../../lib/acquire-book.mjs';
import { initialPagesState, materializePages } from '../../lib/lazy-pages.mjs';
import { HOLD_STATUS, HOLD_EVENT } from '../../lib/pipeline-hold.mjs';
import { yearFromPublished } from '../../lib/catalogue-year.mjs';
import { getCanvases, extractCanvasImage } from './manifest-store.mjs';

export const IMPORTER = 'script:iiif-discovery/import-wave';

const slugify = (t, max = 70) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, max).replace(/-$/, '');
const normText = t => (t || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
const str = v => (Array.isArray(v) ? str(v[0]) : typeof v === 'string' ? v : v == null ? '' : String(v));

/**
 * Arabic-script catalogues often give an AH year alone. A row in these languages
 * whose date text carries only one number cannot be placed before 1850 with
 * confidence, so the tier A rule skips it rather than guess (#7343).
 */
const HIJRI_LANGS = new Set(['Arabic', 'Persian', 'Urdu', 'Ottoman Turkish']);
export function isHijriSuspect(language, dateText) {
  if (!HIJRI_LANGS.has(language)) return false;
  const years = String(dateText || '').match(/\d{3,4}/g) || [];
  return years.length < 2;
}

/** The candidate's stable key, as the tier survey writes it (`id`). */
export function candidateKey(c) {
  return `${c.source}:${c.source_id || c.oai_id || c.manifest_url}`;
}

/** Manifest rights → the `image_source.license` vocabulary import-from-cache uses. */
export function licenseOf(manifest) {
  const raw = str(manifest?.rights ?? manifest?.license);
  if (!raw) return 'unknown';
  if (/publicdomain|public-domain|\/mark\//i.test(raw)) return 'publicdomain';
  return raw.slice(0, 200);
}

/**
 * The insert-time pipeline hold: the same marker holdBook() writes, put in the
 * insert document so the book never exists unheld.
 */
export function holdAtInsert(hold, now) {
  return {
    status: HOLD_STATUS,
    hold: { reason: hold.reason, issue: hold.issue ?? null, held_at: now, held_from_status: null, release: hold.release, detail: null },
    last_updated: now,
  };
}

/**
 * The book fields for one candidate. Pure.
 * @param {object} c          the import_candidates row
 * @param {object} manifest   the fetched IIIF manifest
 * @param {object} o          { language, campaign, hold, slug, now, bookId }
 */
export function buildWaveBook(c, manifest, o) {
  const { language, campaign, hold, slug, now, bookId } = o;
  const canvases = getCanvases(manifest);
  const first = canvases.length ? extractCanvasImage(canvases[0]) : {};
  const title = (str(c.title) || str(c.display_title) || `${c.source} item`).slice(0, 500);
  const author = str(c.author) && str(c.author) !== 'Unknown' ? str(c.author) : 'Unknown';
  const year = yearFromPublished(c.date_text);
  const fp = candidateKey(c);
  return {
    _id: bookId, id: bookId.toHexString(), slug,
    title, display_title: title, author,
    language: language && language !== 'Unknown' ? language : 'Unknown',
    published: c.date_text || 'Unknown', ...(year ? { year } : {}),
    thumbnail: first.thumbnail || first.photo || '',
    // makeBookDoc() declares the other five counters from this one.
    pages_count: canvases.length,
    // Every wave book is born manifest-only; without `manifestOnly` the importer
    // materializes it straight after insert, through the same writer.
    pages_state: initialPagesState({ now }),
    content_type: 'book',
    status: 'draft', hidden: true, visible: false,
    categories: [],
    pipeline_auto: holdAtInsert(hold, now),
    // The archivers skip a blocked book; nothing is copied to R2 until someone asks.
    archive_metadata: { blocked: true, blocked_reason: `${campaign}: hidden acquisition, images hot-linked`, blocked_at: now },
    image_source: {
      provider: c.source, provider_name: c.provider_name || c.origin_library || c.source,
      source_url: c.source_url || c.viewer_url || c.manifest_url, iiif_manifest: c.manifest_url,
      license: licenseOf(manifest),
      ...(c.origin_library ? { contributing_library: c.origin_library } : {}),
      access_date: now,
    },
    dublin_core: { dc_identifier: [fp], dc_source: c.source_url || c.manifest_url },
    ...(c.metadata?.shelfmark ? { shelfmark: c.metadata.shelfmark } : {}),
    acquisition_campaign: campaign,
    source_fingerprint: fp, normalized_title: normText(title), normalized_author: normText(author),
    created_at: now, updated_at: now,
  };
}

async function uniqueSlug(db, base) {
  let slug = base || 'item', i = 2;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) slug = `${base}-${i++}`;
  return slug;
}

/**
 * Import one candidate. Never throws for a per-book problem; returns an outcome.
 *
 * @param {import('mongodb').Db} db
 * @param {object} c  the import_candidates row (full)
 * @param {object} o
 * @param {(url: string) => Promise<object>} o.fetchManifest
 * @param {string} o.language      canonical language name (the tier survey's)
 * @param {string} o.campaign      acquisition_campaign
 * @param {{reason: string, release: string, issue?: number}} o.hold
 * @param {boolean} o.manifestOnly
 * @param {number} [o.minCanvases=5]
 * @param {boolean} [o.dryRun]
 * @returns {Promise<{ outcome: 'imported'|'materialized'|'dry_run'|'not_candidate'|'hijri_suspect'|'fetch_failed'|'too_few_canvases'|'gate_declined'|'materialize_failed',
 *   book_id?: string, pages?: number, error?: string, http_status?: number, reason?: string }>}
 */
export async function importCandidate(db, c, o) {
  const { fetchManifest, language, campaign, hold, manifestOnly, minCanvases = 5, dryRun = false } = o;
  if (!hold?.reason || !hold?.release) throw new TypeError('importCandidate: a hold { reason, release } is required');
  if (!campaign) throw new TypeError('importCandidate: campaign is required');
  if (!['discovered', 'failed'].includes(c.status)) return { outcome: 'not_candidate', reason: `status ${c.status}` };
  if (!c.manifest_url) return { outcome: 'not_candidate', reason: 'no manifest_url' };
  if (isHijriSuspect(language, c.date_text)) return { outcome: 'hijri_suspect' };

  let manifest;
  try {
    manifest = await fetchManifest(c.manifest_url);
  } catch (e) {
    const m = /HTTP (\d{3})/.exec(String(e?.message));
    return { outcome: 'fetch_failed', error: String(e?.message ?? e).slice(0, 200), ...(m ? { http_status: +m[1] } : {}) };
  }
  const n = getCanvases(manifest).length;
  if (n < minCanvases) return { outcome: 'too_few_canvases', pages: n };
  if (dryRun) return { outcome: 'dry_run', pages: n };

  const now = new Date();
  const title = str(c.title) || str(c.display_title);
  const slug = await uniqueSlug(db, slugify(title) || slugify(`${c.source}-${c.source_id || c.oai_id || c._id}`));
  const fields = buildWaveBook(c, manifest, { language, campaign, hold, slug, now, bookId: new ObjectId() });
  if (fields.pages_state?.state !== 'manifest_only') throw new Error('importCandidate: a wave book must be born manifest_only');
  const acquired = await insertBookIfNew(db, fields, { importer: IMPORTER, sourceIdentifier: fields.source_fingerprint, sourceUrl: c.manifest_url });
  if (!acquired.inserted) return { outcome: 'gate_declined', reason: acquired.reason, error: acquired.message };
  const bookId = acquired.bookId;

  // The hold's paper trail, as holdBook() writes it.
  await db.collection('book_events').insertOne({ book_id: bookId, type: HOLD_EVENT, at: now, source: IMPORTER, details: { reason: hold.reason, issue: hold.issue ?? null, from_status: null, release: hold.release } });
  await db.collection('audit_log').insertOne({ action: 'pipeline_status_changed', book_id: bookId, book_title: fields.title, metadata: { from: 'none', to: HOLD_STATUS, source: IMPORTER, reason: hold.reason }, timestamp: now }).catch(() => {});
  await db.collection('import_candidates').updateOne({ _id: c._id }, { $set: { status: 'imported', book_id: bookId, imported_at: now } });

  if (manifestOnly) return { outcome: 'imported', book_id: bookId, pages: n };
  // Not lazy: create the pages now, through the one materializer, from the manifest already in hand.
  const m = await materializePages(db, bookId, { trigger: 'import', fetchManifest: async () => manifest, cooldownMs: 0 });
  if (m.status !== 'materialized') return { outcome: 'materialize_failed', book_id: bookId, error: m.error || m.status };
  return { outcome: 'materialized', book_id: bookId, pages: m.pages };
}

/**
 * Parks a host after `after` consecutive identical refusals (401/403): a walled
 * host refuses every request, so one more try per row would only hammer it.
 * Any other outcome resets the streak.
 */
export class HostParker {
  constructor(after = 2) { this.after = after; this.streak = new Map(); this.parked = new Map(); }
  note(host, httpStatus) {
    if (this.parked.has(host)) return true;
    if (httpStatus === 401 || httpStatus === 403) {
      const s = this.streak.get(host);
      const next = s && s.status === httpStatus ? { status: httpStatus, n: s.n + 1 } : { status: httpStatus, n: 1 };
      this.streak.set(host, next);
      if (next.n >= this.after) { this.parked.set(host, `HTTP ${httpStatus} x${next.n}`); return true; }
      return false;
    }
    this.streak.delete(host);
    return false;
  }
  isParked(host) { return this.parked.has(host); }
}

export function hostOf(url) {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
}

/**
 * A sample spread across sources and languages: round-robin over source|language
 * cells (largest first), so a 200-row test touches every cell it can.
 * Deterministic for a given input order.
 */
export function spreadSample(rows, n) {
  const cells = new Map();
  for (const r of rows) {
    const k = `${r.source}|${r.language}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(r);
  }
  const lists = [...cells.values()].sort((a, b) => b.length - a.length);
  const out = [];
  for (let i = 0; out.length < n; i++) {
    let took = false;
    for (const l of lists) {
      if (i < l.length && out.length < n) { out.push(l[i]); took = true; }
    }
    if (!took) break;
  }
  return out;
}
