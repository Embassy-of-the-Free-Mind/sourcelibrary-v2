/**
 * IIIF Metadata Extraction — parse titles, authors, dates, languages
 * from IIIF manifest metadata fields.
 *
 * Handles both Presentation API v2 and v3 metadata formats.
 */

/**
 * Extract a string value from a IIIF label field.
 * Handles: plain string, v2 language array, v3 language map.
 */
export function extractLabel(label) {
  if (!label) return null;
  if (typeof label === 'string') return label.trim();
  // v2: [{ "@value": "Title", "@language": "en" }]
  if (Array.isArray(label)) {
    const en = label.find(l => l['@language'] === 'en');
    return (en?.['@value'] || label[0]?.['@value'] || label[0] || '').toString().trim();
  }
  // v3: { "en": ["Title"], "de": ["Titel"] }
  if (typeof label === 'object') {
    const vals = label['en'] || label['none'] || Object.values(label)[0];
    if (Array.isArray(vals)) return vals[0]?.trim() || null;
  }
  return null;
}

/**
 * Extract metadata field value from IIIF manifest metadata array.
 * IIIF v2: metadata is [{ label: "Author", value: "Paracelsus" }, ...]
 * IIIF v3: metadata is [{ label: { en: ["Author"] }, value: { en: ["Paracelsus"] } }, ...]
 */
export function getMetadataField(metadata, ...fieldNames) {
  if (!Array.isArray(metadata)) return null;

  for (const item of metadata) {
    const label = extractLabel(item.label)?.toLowerCase();
    if (!label) continue;

    for (const name of fieldNames) {
      if (label === name.toLowerCase() || label.includes(name.toLowerCase())) {
        return extractLabel(item.value);
      }
    }
  }
  return null;
}

/**
 * Parse a date string into earliest/latest year range.
 * Handles: "1550", "ca. 1550", "1550-1560", "16th century",
 *          "[1550]", "between 1550 and 1560", "s.XVI", etc.
 */
export function parseDateRange(dateStr) {
  if (!dateStr) return { earliest: null, latest: null };

  const s = dateStr.toString().trim();

  // e-rara approximate decade format: "190u" = 1900-1909, "18uu" = 1800-1899
  const eraraDecade = s.match(/^(\d{3})u$/);
  if (eraraDecade) {
    const base = parseInt(eraraDecade[1]) * 10;
    return { earliest: base, latest: base + 9 };
  }
  const eraraCentury = s.match(/^(\d{2})uu$/);
  if (eraraCentury) {
    const base = parseInt(eraraCentury[1]) * 100;
    return { earliest: base, latest: base + 99 };
  }

  // Direct year: "1550" or "[1550]"
  const directYear = s.match(/\b(\d{4})\b/);
  if (directYear) {
    const year = parseInt(directYear[1]);
    // Range: "1550-1560" or "1550/1560"
    const rangeMatch = s.match(/(\d{4})\s*[-–\/]\s*(\d{4})/);
    if (rangeMatch) {
      return { earliest: parseInt(rangeMatch[1]), latest: parseInt(rangeMatch[2]) };
    }
    // "ca." or "circa" — give ±10 year range
    if (/ca\.|circa|approx|um |vers /i.test(s)) {
      return { earliest: year - 10, latest: year + 10 };
    }
    return { earliest: year, latest: year };
  }

  // Century: "16th century", "XVIe siècle", "s.XVI"
  const centuryMatch = s.match(/(\d{1,2})(?:th|st|nd|rd)?\s*(?:century|cent\.|jh\.|jahrhundert)/i)
    || s.match(/s\.?\s*(XVI{0,3}|XV{0,3}|XIV{0,3}|XIII{0,3}|XII{0,3}|XI{0,3}|X{0,3}|IX|VIII|VII|VI{0,3}|V{0,3}|IV|III{0,3}|II{0,3}|I)/i);

  if (centuryMatch) {
    let century;
    if (/\d/.test(centuryMatch[1])) {
      century = parseInt(centuryMatch[1]);
    } else {
      // Roman numeral
      const roman = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVII: 17, XVIII: 18 };
      century = roman[centuryMatch[1].toUpperCase()] || null;
    }
    if (century) {
      return { earliest: (century - 1) * 100 + 1, latest: century * 100 };
    }
  }

  return { earliest: null, latest: null };
}

/**
 * Detect language from metadata or manifest fields.
 * Returns ISO 639-1/3 code or descriptive name.
 */
const LANGUAGE_MAP = {
  'lat': 'Latin', 'la': 'Latin', 'latin': 'Latin',
  'grc': 'Greek', 'el': 'Greek', 'greek': 'Greek', 'griechisch': 'Greek',
  'deu': 'German', 'de': 'German', 'ger': 'German', 'german': 'German', 'deutsch': 'German',
  'fra': 'French', 'fr': 'French', 'fre': 'French', 'french': 'French', 'français': 'French',
  'ita': 'Italian', 'it': 'Italian', 'italian': 'Italian', 'italiano': 'Italian',
  'eng': 'English', 'en': 'English', 'english': 'English',
  'spa': 'Spanish', 'es': 'Spanish', 'spanish': 'Spanish', 'español': 'Spanish',
  'nld': 'Dutch', 'nl': 'Dutch', 'dut': 'Dutch', 'dutch': 'Dutch', 'nederlands': 'Dutch',
  'ara': 'Arabic', 'ar': 'Arabic', 'arabic': 'Arabic',
  'heb': 'Hebrew', 'he': 'Hebrew', 'hebrew': 'Hebrew',
  'san': 'Sanskrit', 'sa': 'Sanskrit', 'sanskrit': 'Sanskrit',
  'zho': 'Chinese', 'zh': 'Chinese', 'chi': 'Chinese', 'chinese': 'Chinese',
  'por': 'Portuguese', 'pt': 'Portuguese', 'portuguese': 'Portuguese',
  'pol': 'Polish', 'pl': 'Polish', 'polish': 'Polish',
  'swe': 'Swedish', 'sv': 'Swedish', 'swedish': 'Swedish',
  'dan': 'Danish', 'da': 'Danish', 'danish': 'Danish',
  'ces': 'Czech', 'cs': 'Czech', 'cze': 'Czech', 'czech': 'Czech',
  'hun': 'Hungarian', 'hu': 'Hungarian', 'hungarian': 'Hungarian',
  'rus': 'Russian', 'ru': 'Russian', 'russian': 'Russian',
  'tur': 'Turkish', 'tr': 'Turkish', 'turkish': 'Turkish',
  'per': 'Persian', 'fa': 'Persian', 'persian': 'Persian',
  'jpn': 'Japanese', 'ja': 'Japanese', 'japanese': 'Japanese',
  'kor': 'Korean', 'ko': 'Korean', 'korean': 'Korean',
  'syc': 'Syriac', 'syr': 'Syriac', 'syriac': 'Syriac',
  'cop': 'Coptic', 'coptic': 'Coptic',
};

export function normalizeLanguage(langStr) {
  if (!langStr) return 'Unknown';
  const lower = langStr.toLowerCase().trim();
  return LANGUAGE_MAP[lower] || langStr.trim();
}

/**
 * Extract all useful metadata from a IIIF manifest.
 * Returns a normalized object ready for candidate insertion.
 */
export function extractManifestMetadata(manifest) {
  const metadata = manifest.metadata || [];

  const title = extractLabel(manifest.label)
    || getMetadataField(metadata, 'Title', 'Titel', 'Titre')
    || 'Unknown';

  const author = getMetadataField(metadata, 'Author', 'Creator', 'Autor', 'Auteur', 'Verfasser', 'Author/Creator')
    || getMetadataField(metadata, 'Contributor')
    || 'Unknown';

  const dateText = getMetadataField(metadata, 'Date', 'Date of publication', 'Datum', 'Entstehungszeit',
    'Publication date', 'Year', 'Jahr', 'Date of creation', 'Erscheinungsjahr')
    || getMetadataField(metadata, 'navDate');

  const { earliest, latest } = parseDateRange(dateText || manifest.navDate);

  const language = normalizeLanguage(
    getMetadataField(metadata, 'Language', 'Sprache', 'Langue', 'Lingua')
  );

  const pageCount = (() => {
    // v3: items array
    if (manifest.items?.length) return manifest.items.length;
    // v2: sequences[0].canvases
    if (manifest.sequences?.[0]?.canvases?.length) return manifest.sequences[0].canvases.length;
    return null;
  })();

  return {
    title: cleanTitle(title),
    author: cleanAuthor(author),
    display_title: title !== cleanTitle(title) ? title : null,
    language,
    date_text: dateText,
    date_earliest: earliest,
    date_latest: latest,
    page_count: pageCount,
  };
}

/**
 * Clean a title string — strip HTML, normalize whitespace, truncate.
 */
function cleanTitle(title) {
  if (!title) return 'Unknown';
  return title
    .replace(/<[^>]*>/g, '')     // strip HTML
    .replace(/\s+/g, ' ')       // collapse whitespace
    .trim()
    .slice(0, 500);              // reasonable length limit
}

/**
 * Clean an author string.
 */
function cleanAuthor(author) {
  if (!author) return 'Unknown';
  return author
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}
