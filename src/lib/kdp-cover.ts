/**
 * KDP Cover Image Generator
 *
 * Generates portrait JPEG cover images for KDP ebook publishing.
 * KDP eBook covers must be TALLER than wide — Amazon's recommended size is
 * 1600 × 2560 px (a 1.6:1 height:width ratio). Uses Sharp for image processing
 * with SVG text overlays.
 */

import sharp from 'sharp';
import type { Db } from 'mongodb';

// KDP eBook cover dimensions (portrait, 1.6:1 height:width — Amazon spec)
const COVER_WIDTH = 1600;
const COVER_HEIGHT = 2560;
const CENTER_X = COVER_WIDTH / 2;

// Only illustrations at/above this quality are considered as cover art.
const COVER_MIN_QUALITY = 0.75;
// Wide enough that the type bias, not the truncation, decides the cover.
const COVER_CANDIDATE_POOL = 200;

/** Minimal shape of a page needed to resolve its scan URL. */
interface CoverPage {
  page_number: number;
  photo?: string | null;
  cropped_photo?: string | null;
  archived_photo?: string | null;
}

interface CoverGalleryImage {
  page_number: number;
  type?: string;
  gallery_quality?: number;
  extracted_url?: string;
  image_url?: string;
}

/**
 * Bias certain illustration types toward (or away from) being the cover.
 * Frontispieces are literally designed to open a book; diagrams / maps / tables
 * / musical scores make poor covers even when they score well for the gallery.
 */
function coverTypeBias(type?: string): number {
  const t = (type || '').toLowerCase();
  if (t.includes('frontispiece') || t.includes('title')) return 0.15;
  if (t.includes('engraving') || t.includes('emblem') || t.includes('figure') || t.includes('portrait') || t.includes('allegor') || t.includes('illustration')) return 0.05;
  if (t.includes('diagram') || t.includes('map') || t.includes('table') || t.includes('music') || t.includes('score')) return -0.2;
  return 0;
}

/**
 * Pick the best cover-image URL for a book from its extracted illustrations.
 *
 * Returns the FULL page scan of the page holding the highest-scoring figural
 * plate (a full manuscript/print page fills the portrait cover frame far better
 * than a tightly-cropped emblem), falling back to the emblem crop itself. Books
 * with no suitable plates return `null` — callers should then fall back to the
 * binding/first-page thumbnail.
 */
export async function pickKdpCoverImageUrl(
  db: Db,
  bookId: string,
  pages: CoverPage[]
): Promise<string | null> {
  let candidates: CoverGalleryImage[] = [];
  try {
    candidates = await db.collection('gallery_images')
      .find({
        book_id: bookId,
        gallery_quality: { $gte: COVER_MIN_QUALITY },
        type: { $nin: ['decorative'] },
      })
      // Sorting by gallery_quality and truncating BEFORE the type bias is
      // applied would change the winner: eligible quality spans 0.25 (0.75-1.0)
      // while the bias spans 0.35 (+0.15 frontispiece to -0.2 diagram), so a
      // frontispiece at the bottom of the range can outscore a diagram at the
      // top. The pool therefore has to be wide enough to hold every eligible
      // plate, not just the highest-quality handful.
      .project({ gallery_quality: 1, type: 1, page_number: 1, extracted_url: 1, image_url: 1 })
      .sort({ gallery_quality: -1 })
      .limit(COVER_CANDIDATE_POOL)
      .toArray() as unknown as CoverGalleryImage[];
  } catch (e) {
    console.error('[kdp-cover] gallery lookup failed', e);
    return null;
  }
  if (!candidates.length) return null;

  const best = candidates
    .map(c => ({ img: c, score: (c.gallery_quality ?? 0) + coverTypeBias(c.type) }))
    .sort((a, b) => b.score - a.score)[0].img;

  const page = pages.find(p => p.page_number === best.page_number);
  return (
    page?.cropped_photo ||
    page?.archived_photo ||
    page?.photo ||
    best.extracted_url ||
    best.image_url ||
    null
  );
}

// Brand colors from style system
const COLOR_GOLD = '#c9a86c';
const COLOR_DARK = '#1a1612';
const COLOR_GOLD_DIM = '#8a7a54'; // Muted gold for secondary text

/**
 * Escape XML special characters in text for safe SVG embedding.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Word-wrap text to fit within a given width at a given font size.
 * Returns an array of lines. Uses a conservative character-per-line estimate
 * since SVG text rendering doesn't support auto-wrapping.
 */
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (candidate.length > maxCharsPerLine && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = candidate;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Build the SVG text overlay for the cover.
 * Positions title (upper-middle), author (below), subtitle + Source Library
 * branding (lower third), all centered on a portrait canvas.
 */
function buildTextOverlaySvg(
  title: string,
  author: string,
  subtitle: string
): string {
  const escapedAuthor = escapeXml(author);
  const escapedSubtitle = escapeXml(subtitle);

  // Title: fewer chars/line at the larger size; step down font + widen wrap for
  // long titles so they still fit the 1600px-wide canvas.
  const firstPass = wrapText(title, 16);
  const isLong = firstPass.length > 3;
  const titleFontSize = isLong ? 88 : 118;
  const titleLines = isLong ? wrapText(title, 20) : firstPass;
  const titleLineHeight = titleFontSize * 1.28;

  // Vertical layout (portrait): title block centered in the upper-middle.
  const titleStartY = 760;
  const titleElements = titleLines.map((line, i) =>
    `<text x="${CENTER_X}" y="${titleStartY + i * titleLineHeight}"
       font-family="serif" font-size="${titleFontSize}" font-weight="700"
       fill="${COLOR_GOLD}" text-anchor="middle"
       letter-spacing="3">${escapeXml(line)}</text>`
  ).join('\n    ');

  // Decorative line below the title.
  const lineY = titleStartY + titleLines.length * titleLineHeight + 30;

  // Author below the decorative line.
  const authorY = lineY + 100;

  // Subtitle + brand near the bottom.
  const subtitleY = COVER_HEIGHT - 360;
  const brandY = COVER_HEIGHT - 240;

  return `<svg width="${COVER_WIDTH}" height="${COVER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <!-- Title -->
    ${titleElements}

    <!-- Decorative line -->
    <line x1="${CENTER_X - 300}" y1="${lineY}" x2="${CENTER_X + 300}" y2="${lineY}"
      stroke="${COLOR_GOLD}" stroke-width="2" opacity="0.6"/>

    <!-- Author -->
    <text x="${CENTER_X}" y="${authorY}"
      font-family="serif" font-size="60" font-style="italic"
      fill="${COLOR_GOLD}" text-anchor="middle"
      letter-spacing="2">${escapedAuthor}</text>

    <!-- Subtitle -->
    <text x="${CENTER_X}" y="${subtitleY}"
      font-family="sans-serif" font-size="40"
      fill="${COLOR_GOLD_DIM}" text-anchor="middle"
      letter-spacing="4">${escapedSubtitle}</text>

    <!-- Source Library branding -->
    <text x="${CENTER_X}" y="${brandY}"
      font-family="sans-serif" font-size="30"
      fill="${COLOR_GOLD_DIM}" text-anchor="middle"
      letter-spacing="6" opacity="0.7">SOURCE LIBRARY</text>
  </svg>`;
}

/**
 * Build an SVG for the solid-color fallback cover with decorative border.
 * Used when no cover image is available.
 */
function buildFallbackSvg(
  title: string,
  author: string,
  subtitle: string
): string {
  const textSvg = buildTextOverlaySvg(title, author, subtitle);

  // Insert decorative border elements into the text SVG
  const borderElements = `
    <!-- Outer border -->
    <rect x="60" y="60" width="${COVER_WIDTH - 120}" height="${COVER_HEIGHT - 120}"
      fill="none" stroke="${COLOR_GOLD}" stroke-width="2" opacity="0.4"/>
    <!-- Inner border -->
    <rect x="80" y="80" width="${COVER_WIDTH - 160}" height="${COVER_HEIGHT - 160}"
      fill="none" stroke="${COLOR_GOLD}" stroke-width="1" opacity="0.25"/>
    <!-- Corner ornaments (small diamonds) -->
    <polygon points="130,90 140,80 150,90 140,100" fill="${COLOR_GOLD}" opacity="0.3"/>
    <polygon points="${COVER_WIDTH - 150},90 ${COVER_WIDTH - 140},80 ${COVER_WIDTH - 130},90 ${COVER_WIDTH - 140},100" fill="${COLOR_GOLD}" opacity="0.3"/>
    <polygon points="130,${COVER_HEIGHT - 90} 140,${COVER_HEIGHT - 80} 150,${COVER_HEIGHT - 90} 140,${COVER_HEIGHT - 100}" fill="${COLOR_GOLD}" opacity="0.3"/>
    <polygon points="${COVER_WIDTH - 150},${COVER_HEIGHT - 90} ${COVER_WIDTH - 140},${COVER_HEIGHT - 80} ${COVER_WIDTH - 130},${COVER_HEIGHT - 90} ${COVER_WIDTH - 140},${COVER_HEIGHT - 100}" fill="${COLOR_GOLD}" opacity="0.3"/>`;

  // Insert border elements right after the opening SVG tag
  return textSvg.replace(
    `xmlns="http://www.w3.org/2000/svg">`,
    `xmlns="http://www.w3.org/2000/svg">\n${borderElements}`
  );
}

/**
 * Fetch an image from a URL and return as a Buffer.
 * Throws on non-OK responses.
 */
async function fetchImage(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Generate a KDP-ready cover image.
 *
 * @param book - Book record with title, author, display_title, language
 * @param coverImageUrl - URL of the cover image to use as background (optional)
 * @returns JPEG buffer at 1600x2560px (portrait, KDP eBook spec)
 *
 * @example
 * const coverBuffer = await generateKdpCover(book, book.thumbnail_blob || book.thumbnail);
 * // Write to file or upload
 */
export async function generateKdpCover(
  book: {
    title: string;
    display_title?: string;
    author: string;
    language?: string;
  },
  coverImageUrl?: string | null
): Promise<Buffer> {
  const title = book.display_title || book.title;
  const author = book.author;
  const subtitle = book.language && book.language.toLowerCase() !== 'english'
    ? 'English Translation'
    : 'Modern English Edition';

  // Try to fetch and process cover image as background
  let backgroundBuffer: Buffer;

  if (coverImageUrl) {
    try {
      const imageBuffer = await fetchImage(coverImageUrl);

      // Resize to fill cover dimensions, crop to fit
      const resizedImage = await sharp(imageBuffer)
        .resize(COVER_WIDTH, COVER_HEIGHT, {
          fit: 'cover',
          position: 'centre',
        })
        .toBuffer();

      // Darken only the text zones with a vertical gradient scrim: a strong
      // scrim behind the title (top third) and behind the subtitle/brand
      // (bottom eighth), fading to fully transparent through the middle so the
      // artwork keeps its colour. A flat full-image overlay (the old approach)
      // greyed out the plate; the gradient keeps it vivid where there's no text.
      const overlaySvg = `<svg width="${COVER_WIDTH}" height="${COVER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${COLOR_DARK}" stop-opacity="0.80"/>
            <stop offset="28%" stop-color="${COLOR_DARK}" stop-opacity="0.66"/>
            <stop offset="42%" stop-color="${COLOR_DARK}" stop-opacity="0.60"/>
            <stop offset="52%" stop-color="${COLOR_DARK}" stop-opacity="0.06"/>
            <stop offset="72%" stop-color="${COLOR_DARK}" stop-opacity="0.06"/>
            <stop offset="82%" stop-color="${COLOR_DARK}" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="${COLOR_DARK}" stop-opacity="0.85"/>
          </linearGradient>
        </defs>
        <rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" fill="url(#scrim)"/>
      </svg>`;

      backgroundBuffer = await sharp(resizedImage)
        .composite([{
          input: Buffer.from(overlaySvg),
          top: 0,
          left: 0,
        }])
        .toBuffer();
    } catch {
      // Fall back to solid background if image fetch/processing fails
      backgroundBuffer = await sharp({
        create: {
          width: COVER_WIDTH,
          height: COVER_HEIGHT,
          channels: 3,
          background: { r: 26, g: 22, b: 18 }, // #1a1612
        },
      })
        .jpeg()
        .toBuffer();
    }
  } else {
    // Solid dark background
    backgroundBuffer = await sharp({
      create: {
        width: COVER_WIDTH,
        height: COVER_HEIGHT,
        channels: 3,
        background: { r: 26, g: 22, b: 18 }, // #1a1612
      },
    })
      .jpeg()
      .toBuffer();
  }

  // Build the text overlay SVG
  const textSvg = coverImageUrl
    ? buildTextOverlaySvg(title, author, subtitle)
    : buildFallbackSvg(title, author, subtitle);

  // Composite text overlay onto background and output as JPEG
  const coverBuffer = await sharp(backgroundBuffer)
    .composite([{
      input: Buffer.from(textSvg),
      top: 0,
      left: 0,
    }])
    .jpeg({ quality: 90, progressive: true })
    .toBuffer();

  return coverBuffer;
}
