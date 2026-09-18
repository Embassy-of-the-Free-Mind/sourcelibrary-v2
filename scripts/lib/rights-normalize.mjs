/**
 * Rights normalisation — one canonical class per book, with the raw statement
 * and its provenance kept beside it.
 *
 * PRIOR ART: scripts/maintenance/backfill-image-licenses.mjs — writes a
 * truncated string INTO image_source.license (destroying the raw value),
 * recognises three URI families, and cannot tell "manifest silent" from
 * "not looked at". src/lib/import-utils.ts parseLicense — same three families;
 * scripts/iiif-discovery/lib/iiif-metadata.mjs manifestRights — an open/closed
 * screen for discovery, not a classification. None keeps provenance per field.
 *
 * WHY (ops rights/corpus-rights-classification-2026-09-18.md): 13,183 readable
 * books carry image_source.license = 'unknown' although the holding library's
 * manifest states a licence; and public domain is spelled 6+ ways, so any code
 * that string-matches image_source.license drifts. This module is the ONE
 * place the spelling is folded. It never guesses: a manifest that states
 * nothing classifies as `unknown` with status `manifest-silent`.
 *
 * Shape written to `image_source.rights_normalized` (`image_source.rights` is already taken: the IA importers store the archive's raw `rights` string there, 821 non-null) (see backfill-rights-provenance.mjs):
 *   class                 canonical class (RIGHTS_CLASSES)
 *   statement_uri         the CC / rightsstatements.org / provider terms URL, if any
 *   class_from            which field the class was read from (provenance)
 *   attribution_required  required credit text, HTML stripped
 *   attribution_from      which field it was read from
 *   terms_text            a free-text usage statement the manifest carries
 *   raw                   the manifest fields verbatim (capped), never folded
 *   status                stated | assumed-by-importer | manifest-silent | fetch-failed | no-manifest | stated-from-import
 *   source                iiif-manifest | oai-mets | importer-license-field | importer-captured-manifest-field
 *   manifest_url, read_at, http_status, error
 */

export const RIGHTS_CLASSES = Object.freeze([
  'public-domain',   // PDM, CC0, NKC, NoC-US, NoC-OKLR, "public domain"
  'cc-by', 'cc-by-sa', 'cc-by-nd',
  'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nc-nd',
  'noc-nc',          // rightsstatements NoC-NC: no copyright, non-commercial use only
  'in-copyright',    // InC / "© X" / "all rights reserved" with no licence offered
  'terms-of-use',    // the provider points at its own terms page; read it
  'other',           // a real licence we do not model (GPL, ODbL…)
  'unknown',
]);

/** What the class lets us do with the IMAGES commercially. Derived, never stored. */
export function commercialUse(cls) {
  switch (cls) {
    case 'public-domain': case 'cc-by': case 'cc-by-sa': case 'cc-by-nd': return 'yes';
    case 'cc-by-nc': case 'cc-by-nc-sa': case 'cc-by-nc-nd': case 'noc-nc': case 'in-copyright': return 'no';
    case 'terms-of-use': case 'other': return 'read-terms';
    default: return 'unknown';
  }
}

// ── URI recognition ────────────────────────────────────────────────────────
// More specific first (by-nc-sa before by-nc before by); all are anchored on a host path so
// they cannot fire on prose.
const URI_RULES = [
  [/creativecommons\.org\/publicdomain\/mark\//i, 'public-domain'],
  [/creativecommons\.org\/publicdomain\/zero\//i, 'public-domain'],
  [/creativecommons\.org\/licenses\/publicdomain\/?/i, 'public-domain'],
  [/rightsstatements\.org\/vocab\/NKC\//i, 'public-domain'],
  [/rightsstatements\.org\/vocab\/NoC-US\//i, 'public-domain'],
  [/rightsstatements\.org\/vocab\/NoC-OKLR\//i, 'public-domain'],
  [/rightsstatements\.org\/vocab\/NoC-NC\//i, 'noc-nc'],
  [/rightsstatements\.org\/vocab\/(InC|InC-EDU|InC-NC|InC-OW-EU|InC-RUU)\//i, 'in-copyright'],
  // "Copyright Not Evaluated" / "Undetermined" are STATED unknowns — a class of unknown, never in-copyright
  // (18 IA items carried CNE and the copyright-only prose rule would have read them as InC).
  [/rightsstatements\.org\/vocab\/(CNE|UND)\//i, 'unknown'],
  [/creativecommons\.org\/licenses\/by-nc-sa\//i, 'cc-by-nc-sa'],
  [/creativecommons\.org\/licenses\/by-nc-nd\//i, 'cc-by-nc-nd'],
  [/creativecommons\.org\/licenses\/by-nc\//i, 'cc-by-nc'],
  [/creativecommons\.org\/licenses\/by-sa\//i, 'cc-by-sa'],
  [/creativecommons\.org\/licenses\/by-nd\//i, 'cc-by-nd'],
  [/creativecommons\.org\/licenses\/by\//i, 'cc-by'],
  [/gnu\.org\/licenses\//i, 'other'],
  [/opendatacommons\.org\//i, 'other'],
];

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

/** Find the first recognisable rights URI inside a string (URL or prose). Earliest in text wins. */
export function classifyUri(text) {
  if (typeof text !== 'string') return null;
  let best = null;
  for (const [re, cls] of URI_RULES) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.index)) {
      const urls = text.match(URL_RE) || [];
      const full = urls.find(u => re.test(u));
      best = { index: m.index, class: cls, statement_uri: full || m[0] };
    }
  }
  return best ? { class: best.class, statement_uri: best.statement_uri } : null;
}

// ── Short-token / prose recognition ────────────────────────────────────────
// For values that are NOT URLs: 'publicdomain', 'PDM 1.0', 'CC BY-NC 3.0', a manifest's
// "Copyright Status: Public Domain", "free of known restrictions".
// Tier 1 = a licence GRANT or public-domain assertion; tier 2 = copyright asserted with no grant.
// Within tier 1 the EARLIEST match in the text wins (Cambridge: "CC BY-NC 3.0 … metadata is
// CC BY-NC-ND" → the image licence comes first); ties go to the more specific rule listed first.
const GRANT_RULES = [
  [/\bcc[\s_-]?by[\s_-]?nc[\s_-]?sa\b/i, 'cc-by-nc-sa'],
  [/\bcc[\s_-]?by[\s_-]?nc[\s_-]?nd\b/i, 'cc-by-nc-nd'],
  [/attribution[\s-]*non[\s-]?commercial[\s-]*share[\s-]?alike/i, 'cc-by-nc-sa'],
  [/attribution[\s-]*non[\s-]?commercial[\s-]*no[\s-]?deriv/i, 'cc-by-nc-nd'],
  [/\bcc[\s_-]?by[\s_-]?nc\b/i, 'cc-by-nc'],
  [/attribution[\s-]*non[\s-]?commercial/i, 'cc-by-nc'],
  [/\bcc[\s_-]?by[\s_-]?sa\b/i, 'cc-by-sa'],
  [/attribution[\s-]*share[\s-]?alike/i, 'cc-by-sa'],
  [/\bcc[\s_-]?by[\s_-]?nd\b/i, 'cc-by-nd'],
  [/\bcc[\s_-]?by\b/i, 'cc-by'],
  [/\bNoC-NC\b/i, 'noc-nc'],
  [/\bcc[\s_-]?0\b/i, 'public-domain'],
  [/\bpdm\b/i, 'public-domain'],
  [/public[\s_-]?domain/i, 'public-domain'],
  [/publicdomain/i, 'public-domain'],
  [/free of known (copyright )?restrictions/i, 'public-domain'],
  [/no known copyright/i, 'public-domain'],
  [/\bNKC\b/, 'public-domain'],
  [/\bNoC-US\b/i, 'public-domain'],
];
const COPYRIGHT_RULES = [
  [/all rights reserved/i, 'in-copyright'],
  [/\bin copyright\b/i, 'in-copyright'],
  [/\bInC\b/, 'in-copyright'],
  [/(©|\(c\)|\bcopyright\b)/i, 'in-copyright'],
];

// Access-status vocabulary that must never be read as a licence.
const NOT_A_LICENCE = /^(pubblico|public|open access|full access|free|open|available|master)\.?$/i;
// Platform boilerplate that lands in `attribution` and is not a credit line (Goobi viewer instances at
// uvaerfgoed.nl and viewer.cbl.ie emit the software name; BNP emits its export profile).
const NOT_A_CREDIT = /^(goobi viewer|bnp master|pubblico|public domain|master)\.?$/i;
// A statement that qualifies its own grant — do not fold it to a class; keep it as terms_text.
// BL: "Public Domain in most countries other than the UK."
const QUALIFIED = /\b(other than|except|outside|in most countries|in some countries|may be|unless|depending)\b/i;

function earliest(rules, text) {
  let best = null;
  for (const [re, cls] of rules) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.index)) best = { index: m.index, class: cls };
  }
  return best;
}

/**
 * Classify a short stored value or a prose statement. Returns null if nothing recognisable.
 * A grant beats a copyright assertion anywhere in the same text (Cambridge: "© King's College,
 * All rights reserved. Images made available for download are licensed under CC BY-NC 3.0").
 */
export function classifyToken(text, { allowCopyrightOnly = true } = {}) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t || NOT_A_LICENCE.test(t)) return null;
  const byUri = classifyUri(t);
  if (byUri) return byUri;
  const grant = earliest(GRANT_RULES, t);
  if (grant) return { class: grant.class, statement_uri: null };
  if (allowCopyrightOnly && earliest(COPYRIGHT_RULES, t)) return { class: 'in-copyright', statement_uri: null };
  return null;
}

/** True when a prose statement qualifies its own grant (jurisdiction, condition). */
export function isQualified(text) { return typeof text === 'string' && QUALIFIED.test(text); }

// ── Manifest reading ───────────────────────────────────────────────────────

/** HTML → text, keeping anchor targets: <a href="U">T</a> → "T (U)". Decodes the entities IIIF providers actually emit. */
export function stripHtml(s) {
  return String(s)
    .replace(/&#x3A;/gi, ':').replace(/&#x2F;/gi, '/').replace(/&#xA9;/gi, '©').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, u, t) => `${t.replace(/<[^>]*>/g, '').trim()} (${u})`)
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Pull a display string out of a IIIF v2/v3 language-map, array-of-@value, or string. */
export function langValue(v, prefer = ['en', 'none', 'de', 'fr', 'it', 'ja']) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    const en = v.find(x => x && typeof x === 'object' && x['@language'] === 'en');
    const first = en || v.find(x => x && typeof x === 'object' && x['@value'] != null) || v.find(x => typeof x === 'string' && x.trim());
    if (first == null) return null;
    return typeof first === 'string' ? first : (first['@value'] ?? null);
  }
  if (typeof v === 'object') {
    if (v['@value'] != null) return v['@value'];
    for (const k of prefer) if (Array.isArray(v[k]) && v[k].length) return v[k].filter(Boolean).join(' ');
    for (const k of Object.keys(v)) if (Array.isArray(v[k]) && v[k].length) return v[k].filter(Boolean).join(' ');
  }
  return null;
}

const RIGHTS_LABEL = /right|licen|copyright|usage|terms|nutzung|access restrictions|accesscondition|attribution|credit|diritti|licencia|permission/i;
const CONTACT_LABEL = /contact|holder|phone|mail|address/i;

/** Every metadata entry whose label looks rights-related, as {label, value} strings (value keeps anchor URLs). */
export function rightsMetadata(manifest) {
  const out = [];
  for (const entry of manifest?.metadata || []) {
    const label = langValue(entry?.label);
    if (!label || !RIGHTS_LABEL.test(label)) continue;
    const value = langValue(entry?.value);
    if (value == null) continue;
    out.push({ label: String(label).slice(0, 120), value: String(value).slice(0, 2000) });
  }
  return out;
}

/**
 * Read a IIIF manifest (v2 or v3) into the rights shape. Pure — no I/O.
 * Precedence, and why:
 *   1. a recognisable rights URI in `rights` / `license`               (the field the spec reserves for it)
 *   2. a recognisable URI or SHORT token in a rights-labelled metadata   (NDL "Access Restrictions: PDM", Penn "Rights: NoC-US")
 *   3. a recognisable URI in requiredStatement / attribution text        (Bodleian puts the CC link in attribution)
 *   4. an unqualified grant in prose (attribution / requiredStatement /   (Cambridge "CC BY-NC 3.0", HAB "CC BY SA 3.0",
 *      rights metadata)                                                   BPH "free of known restrictions")
 *   5. an unrecognised URL in `rights` / `license` / rights metadata     → terms-of-use, read it (Gallica, BL, V&A, Kyoto)
 *   6. copyright asserted with no licence anywhere                        → in-copyright (Vatican, Chester Beatty)
 *   7. nothing                                                            → unknown, manifest-silent
 * "Pubblico" / "Open Access" / "Full access" are ACCESS status, never a licence. A QUALIFIED
 * statement ("Public Domain in most countries other than the UK") is never folded; it is kept
 * verbatim in terms_text and the class comes from the terms URL instead.
 */
export function readManifestRights(manifest) {
  const m = manifest || {};
  const rightsField = typeof m.rights === 'string' ? m.rights : langValue(m.rights);
  const licenseField = Array.isArray(m.license) ? m.license.filter(x => typeof x === 'string').join(' ') : (typeof m.license === 'string' ? m.license : null);
  const reqStmt = m.requiredStatement ? { label: langValue(m.requiredStatement.label), value: langValue(m.requiredStatement.value) } : null;
  const attribution = langValue(m.attribution);
  const meta = rightsMetadata(m);
  const metaText = meta.map(e => ({ ...e, text: stripHtml(e.value) }));

  const raw = {
    rights: rightsField ?? undefined,
    license: licenseField ?? undefined,
    requiredStatement: reqStmt?.value != null ? { label: reqStmt.label ?? undefined, value: String(reqStmt.value).slice(0, 2000) } : undefined,
    attribution: attribution != null ? String(attribution).slice(0, 2000) : undefined,
    metadata: meta.length ? meta : undefined,
  };

  let cls = null, uri = null, from = null;
  const take = (r, f) => { if (r && !cls) { cls = r.class; uri = r.statement_uri; from = f; } };

  // 1. spec rights field, recognisable
  take(classifyUri(rightsField), 'manifest.rights');
  take(classifyUri(licenseField), 'manifest.license');
  // 2. rights-labelled metadata: a URI, or a short unqualified token
  for (const e of metaText) {
    if (cls) break;
    if (/^(attribution|credit)/i.test(e.label) || CONTACT_LABEL.test(e.label)) continue;
    take(classifyUri(e.text), `manifest.metadata[${e.label}]`);
    if (!cls && e.text.length <= 40 && !isQualified(e.text)) take(classifyToken(e.text, { allowCopyrightOnly: false }), `manifest.metadata[${e.label}]`);
  }
  // 3. recognisable URI inside requiredStatement / attribution
  take(classifyUri(reqStmt?.value), 'manifest.requiredStatement');
  take(classifyUri(attribution), 'manifest.attribution');
  // 4. an unqualified grant in prose — including a `rights` / `license` field that holds prose instead of a URL
  //    (BL v3: rights = "Public Domain in most countries, other than the UK.")
  const isUrl = (v) => typeof v === 'string' && /^\s*https?:\/\/\S+\s*$/.test(v);
  const prose = [
    ...(!isUrl(rightsField) ? [[rightsField, 'manifest.rights']] : []),
    ...(!isUrl(licenseField) ? [[licenseField, 'manifest.license']] : []),
    [reqStmt?.value, 'manifest.requiredStatement'], [attribution, 'manifest.attribution'],
    ...metaText.filter(e => !CONTACT_LABEL.test(e.label)).map(e => [e.text, `manifest.metadata[${e.label}]`]),
  ];
  for (const [text, f] of prose) {
    if (cls) break;
    if (!text) continue;
    const t = stripHtml(text);
    if (isQualified(t)) continue;
    take(classifyToken(t, { allowCopyrightOnly: false }), f);
  }
  // 5. unrecognised URL in a rights field or rights metadata → terms-of-use
  if (!cls) {
    for (const [val, f] of [[rightsField, 'manifest.rights'], [licenseField, 'manifest.license']]) {
      const u = typeof val === 'string' && val.match(/https?:\/\/[^\s"'<>]+/);
      if (u) { cls = 'terms-of-use'; uri = u[0]; from = f; break; }
    }
  }
  if (!cls) {
    for (const e of metaText) {
      if (CONTACT_LABEL.test(e.label) || /^(attribution|credit)/i.test(e.label)) continue;
      const u = e.text.match(/https?:\/\/[^\s"'<>)]+/);
      if (u) { cls = 'terms-of-use'; uri = u[0]; from = `manifest.metadata[${e.label}]`; break; }
    }
  }
  // 5b. a QUALIFIED grant in prose ("Public Domain in most countries, other than the UK.") is a statement
  //     to read, not a class to fold: terms-of-use, with the sentence kept in terms_text.
  let qualifiedText = null;
  if (!cls) {
    for (const [text, f] of prose) {
      if (!text) continue;
      const t = stripHtml(text);
      if (isQualified(t) && classifyToken(t, { allowCopyrightOnly: false })) { cls = 'terms-of-use'; uri = null; from = `${f} (qualified statement)`; qualifiedText = t; break; }
    }
  }
  // 6. copyright asserted, no licence anywhere
  if (!cls) {
    const all = prose.map(([t]) => t).filter(Boolean).map(stripHtml).join(' | ');
    if (classifyToken(all)?.class === 'in-copyright') { cls = 'in-copyright'; from = 'manifest.prose(copyright-only)'; }
  }

  // attribution required: v3 requiredStatement, else v2 attribution, else an "Attribution" metadata entry
  let attributionRequired = null, attributionFrom = null;
  if (reqStmt?.value) { attributionRequired = stripHtml(reqStmt.value); attributionFrom = 'manifest.requiredStatement'; }
  else if (attribution) { attributionRequired = stripHtml(attribution); attributionFrom = 'manifest.attribution'; }
  else { const a = metaText.find(e => /^(attribution|credit)/i.test(e.label)); if (a) { attributionRequired = a.text; attributionFrom = `manifest.metadata[${a.label}]`; } }
  if (attributionRequired && (NOT_A_LICENCE.test(attributionRequired) || NOT_A_CREDIT.test(attributionRequired))) { attributionRequired = null; attributionFrom = null; } // "Pubblico" / "Goobi viewer" are not credit lines

  // terms_text: a usage statement in prose (BL "Usage terms: Public Domain in most countries other than the UK.")
  let termsText = null;
  for (const e of metaText) {
    if (CONTACT_LABEL.test(e.label) || /^(attribution|credit)/i.test(e.label)) continue;
    if (/usage|terms|nutzung|access restrictions|copyright status|licencia|rights|copyright|licen/i.test(e.label) && !/^https?:\/\/\S+$/.test(e.text)) { termsText = `${e.label}: ${e.text}`; break; }
  }
  if (!termsText) {
    const q = qualifiedText || [rightsField, licenseField, reqStmt?.value, attribution].filter(Boolean).map(stripHtml).find(isQualified);
    if (q) termsText = q;
  }

  const statementUri = uri && /^https?:\/\//i.test(uri) ? uri : null;
  return {
    class: cls || 'unknown',
    statement_uri: statementUri,
    class_from: from,
    attribution_required: attributionRequired ? attributionRequired.slice(0, 1000) : null,
    attribution_from: attributionFrom,
    terms_text: termsText ? termsText.slice(0, 1000) : null,
    raw,
    status: cls ? 'stated' : 'manifest-silent',
  };
}

/**
 * Classify what an importer already stored: image_source.license (+ license_url, attribution).
 * Used for the ~28K books whose stored value is not 'unknown', and as the labelled
 * fallback for a book whose manifest cannot be re-read today.
 */
export function classifyStored({ license, license_url, attribution, rights, provider } = {}, { captured = false } = {}) {
  const lic = typeof license === 'string' ? license.trim() : '';
  const attr = typeof attribution === 'string' ? stripHtml(attribution) : '';
  const iaRights = typeof rights === 'string' ? stripHtml(rights) : ''; // IA importers store the archive's own `rights` metadata here
  let r = null, from = null;
  // The IA importers write the literal 'publicdomain' as a DEFAULT when the item has no licenseurl
  // (`license: licenseUrl || 'publicdomain'`), so for IA that literal is an assumption, not a read.
  // The archive's own `rights` string, when present, is the stronger source.
  const iaDefault = lic === 'publicdomain' && !license_url && /^(internet_archive|ia)$/.test(provider || '');
  if (iaDefault && iaRights) { r = classifyToken(iaRights); from = r ? 'image_source.rights (IA rights metadata)' : null; }
  if (!r && lic && lic !== 'unknown' && !NOT_A_LICENCE.test(lic)) { r = classifyToken(lic); from = iaDefault ? 'image_source.license (literal "publicdomain" — IA importer default, not read from the item)' : 'image_source.license'; }
  // `captured` = also read the fields the importer copied VERBATIM from the manifest at import time
  // (license_url, attribution). Off by default so the stored lane never pre-empts a manifest re-read;
  // on for the fetch-failed fallback, which labels the result stated-from-import.
  if (captured && !r && typeof license_url === 'string' && /^https?:/.test(license_url)) { r = classifyUri(license_url); from = 'image_source.license_url'; }
  if (captured && !r && attr && !isQualified(attr)) { r = classifyToken(attr, { allowCopyrightOnly: false }); from = 'image_source.attribution'; }
  if (!r) {
    // an unrecognised URL as the stored licence or license_url → provider terms
    const inLic = (lic.match(/https?:\/\/[^\s)]+/) || [])[0];
    if (inLic) { r = { class: 'terms-of-use', statement_uri: inLic }; from = 'image_source.license'; }
    else if (captured && typeof license_url === 'string' && /^https?:\/\//.test(license_url)) { r = { class: 'terms-of-use', statement_uri: license_url }; from = 'image_source.license_url'; }
    else if (captured) { const inAttr = (attr.match(/https?:\/\/[^\s)]+/) || [])[0]; if (inAttr && /terms|conditions|licen|rights/i.test(attr)) { r = { class: 'terms-of-use', statement_uri: inAttr }; from = 'image_source.attribution'; } }
  }
  if (!r && lic && lic !== 'unknown' && classifyToken(lic)?.class === 'in-copyright') { r = { class: 'in-copyright', statement_uri: null }; from = 'image_source.license'; }
  return {
    class: r ? r.class : 'unknown',
    statement_uri: r?.statement_uri || null,
    class_from: r ? from : null,
    attribution_required: attr && !NOT_A_CREDIT.test(attr) ? attr : null,
    attribution_from: attr && !NOT_A_CREDIT.test(attr) ? 'image_source.attribution' : null,
    terms_text: isQualified(attr) ? attr : null,
    raw: { license: lic || undefined, license_url: license_url || undefined, attribution: attribution || undefined, rights: iaRights ? String(rights).slice(0, 2000) : undefined },
    status: r ? (iaDefault && !iaRights ? 'assumed-by-importer' : 'stated') : 'unknown',
  };
}

/** SLUB Dresden has no IIIF manifest; its OAI METS record carries mods:accessCondition. */
export function readMetsRights(xml) {
  const s = String(xml);
  const use = s.match(/<mods:accessCondition[^>]*type="use and reproduction"[^>]*xlink:href="([^"]+)"[^>]*>([^<]*)/i);
  const dv = s.match(/<dv:license>([^<]*)<\/dv:license>/i);
  const owner = s.match(/<dv:owner>([^<]*)<\/dv:owner>/i);
  const raw = { accessCondition_use: use ? `${use[1]} ${use[2].trim()}`.trim() : undefined, dv_license: dv?.[1]?.trim() || undefined, dv_owner: owner?.[1]?.trim() || undefined };
  let r = use ? classifyUri(use[1]) || classifyToken(use[2]) : null, from = r ? 'mets.mods:accessCondition[use and reproduction]' : null;
  if (!r && dv) { r = classifyToken(dv[1]); from = r ? 'mets.dv:license' : null; }
  return {
    class: r ? r.class : 'unknown',
    statement_uri: r?.statement_uri || (use ? use[1] : null),
    class_from: from,
    attribution_required: owner ? stripHtml(owner[1]) : null,
    attribution_from: owner ? 'mets.dv:owner' : null,
    terms_text: null,
    raw,
    status: r ? 'stated' : 'manifest-silent',
  };
}
