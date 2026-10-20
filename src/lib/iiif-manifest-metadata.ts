/**
 * Read the bibliographic fields a IIIF manifest states about itself — its
 * `metadata` label/value pairs — for the IIIF import route (#6113).
 *
 * PRIOR ART: src/app/api/import/iiif/route.ts — the inline flattenIiifValue /
 * labelGet this was lifted out of so it could be unit-tested; scripts/lib/
 * rights-normalize.mjs reads the manifest's licence, not its metadata;
 * src/lib/iiif-refs.ts / iiif-manifest-store.ts handle manifest URLs and
 * storage, not label pairs.
 *
 * Two defects this fixes, both seen on BSB (MDZ) v2 manifests:
 *
 *  - v2 language-tagged values (`[{"@language":"en","@value":"Date"}, …]`)
 *    were flattened by taking `Object.values(obj)[0]` — the LANGUAGE CODE, not
 *    the value — so every BSB label was stored as `"en / de / zh"` (14,821
 *    books on 2026-10-13) and no label lookup could ever match.
 *  - BSB labels the statement of responsibility `By` and the imprint
 *    `Published` (`Place : Publisher`), which `creator`/`author`/`publisher`
 *    substring lookups never hit.
 */

type LangTagged = { '@language'?: string; '@value'?: unknown };

function isLangTagged(v: unknown): v is LangTagged {
  return !!v && typeof v === 'object' && !Array.isArray(v) && '@value' in (v as object);
}

/**
 * Flatten a IIIF label or value (string, v2 `@value` object or array of them,
 * v3 language map) to plain text. Language-tagged alternatives are
 * translations of ONE value, so only one language is kept: English, else
 * untagged/`none`, else the first language listed.
 */
export function flattenIiifValue(v: unknown): string {
  if (typeof v === 'string') return v.replace(/<[^>]*>/g, '').trim();
  if (Array.isArray(v)) {
    const tagged = v.filter(isLangTagged);
    if (tagged.length > 0 && tagged.length === v.length) {
      const langs = tagged.map(t => t['@language']);
      const pick = langs.includes('en') ? 'en'
        : langs.some(l => !l || l === 'none') ? undefined
        : langs[0];
      const chosen = tagged.filter(t => pick === undefined ? (!t['@language'] || t['@language'] === 'none') : t['@language'] === pick);
      return chosen.map(t => flattenIiifValue(t['@value'])).filter(Boolean).join(' / ');
    }
    return v.map(flattenIiifValue).filter(Boolean).join(' / ');
  }
  if (isLangTagged(v)) return flattenIiifValue(v['@value']);
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    // v3 language map: {en: ['…']}
    const en = obj['en'] || obj['none'] || Object.values(obj)[0];
    if (Array.isArray(en)) return en.map(flattenIiifValue).filter(Boolean).join(' / ');
    if (typeof en === 'string') return en;
  }
  return '';
}

export type IiifMetadataPair = { label: string; value: string };

export function readManifestMetadataPairs(metadata: unknown): IiifMetadataPair[] {
  const pairs: IiifMetadataPair[] = [];
  for (const item of Array.isArray(metadata) ? metadata : []) {
    const label = flattenIiifValue(item?.label);
    const value = flattenIiifValue(item?.value);
    if (label && value) pairs.push({ label, value });
  }
  return pairs;
}

/** First pair whose label CONTAINS any needle (case-insensitive), in needle order. */
export function labelContains(pairs: IiifMetadataPair[], ...needles: string[]): string | null {
  for (const n of needles) {
    const hit = pairs.find(m => m.label.toLowerCase().includes(n.toLowerCase()));
    if (hit) return hit.value;
  }
  return null;
}

/** First pair whose label IS one of the names (case-insensitive) — for short labels like `By`. */
export function labelIs(pairs: IiifMetadataPair[], ...names: string[]): string | null {
  for (const n of names) {
    const hit = pairs.find(m => m.label.trim().toLowerCase() === n.toLowerCase());
    if (hit) return hit.value;
  }
  return null;
}

/**
 * Split a `Place : Publisher` imprint (BSB `Published`). A trailing `, 1569`
 * is the date, which has its own field; drop it from the publisher.
 */
export function splitImprint(imprint: string | null): { place: string | null; publisher: string | null } {
  if (!imprint) return { place: null, publisher: null };
  const i = imprint.indexOf(' : ');
  if (i < 0) return { place: null, publisher: null };
  const place = imprint.slice(0, i).trim() || null;
  const publisher = imprint.slice(i + 3).replace(/,\s*\[?\d{3,4}\]?\.?\s*$/, '').trim() || null;
  return { place, publisher };
}

/** Placeholder authors a discovery candidate sends when it has none. */
export function isUnknownAuthor(author: unknown): boolean {
  if (typeof author !== 'string') return true;
  return /^\s*(unknown|unknown author|n\.?\s*a\.?|\[?s\.\s*n\.?\]?)?\s*$/i.test(author);
}

/**
 * The author a book is created with: the candidate's own author whenever it
 * has one (unchanged), else the manifest's `By` (statement of responsibility —
 * what #6056's hand corrections used), else its `Creator`/`Author`, else the
 * candidate's placeholder. Returns null only when nothing at all was given.
 */
export function resolveImportAuthor(candidate: unknown, by: string | null, creator: string | null): string | null {
  if (!isUnknownAuthor(candidate)) return candidate as string;
  const fromManifest = by || creator;
  if (fromManifest) return fromManifest;
  return typeof candidate === 'string' && candidate.trim() ? candidate : null;
}
