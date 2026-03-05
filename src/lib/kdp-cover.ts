/**
 * KDP Cover Image Generator
 *
 * Generates 2560x1600px JPEG cover images for KDP ebook publishing.
 * Uses Sharp for image processing with SVG text overlays.
 */

import sharp from 'sharp';

// KDP cover dimensions (1.6:1 ratio, Amazon spec)
const COVER_WIDTH = 2560;
const COVER_HEIGHT = 1600;

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
 * Positions title, author, subtitle, and Source Library branding.
 */
function buildTextOverlaySvg(
  title: string,
  author: string,
  subtitle: string
): string {
  const escapedTitle = escapeXml(title);
  const escapedAuthor = escapeXml(author);
  const escapedSubtitle = escapeXml(subtitle);

  // Title: wrap to ~22 chars per line at 110px font
  const titleLines = wrapText(escapedTitle, 22);
  const titleFontSize = titleLines.length > 3 ? 80 : 110;
  const titleCharsPerLine = titleLines.length > 3
    ? wrapText(escapedTitle, 30)
    : titleLines;
  const finalTitleLines = titleLines.length > 3
    ? wrapText(escapedTitle, 30)
    : titleLines;

  // Vertical layout: title centered in upper portion, author below, subtitle + brand at bottom
  const titleStartY = 400;
  const titleLineHeight = titleFontSize * 1.3;

  const titleElements = finalTitleLines.map((line, i) =>
    `<text x="1280" y="${titleStartY + i * titleLineHeight}"
       font-family="serif" font-size="${titleFontSize}" font-weight="700"
       fill="${COLOR_GOLD}" text-anchor="middle"
       letter-spacing="3">${escapeXml(line)}</text>`
  ).join('\n    ');

  // Decorative line below title
  const lineY = titleStartY + finalTitleLines.length * titleLineHeight + 40;

  // Author positioned below decorative line
  const authorY = lineY + 80;

  // Subtitle and branding near bottom
  const subtitleY = COVER_HEIGHT - 280;
  const brandY = COVER_HEIGHT - 180;

  return `<svg width="${COVER_WIDTH}" height="${COVER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <!-- Title -->
    ${titleElements}

    <!-- Decorative line -->
    <line x1="980" y1="${lineY}" x2="1580" y2="${lineY}"
      stroke="${COLOR_GOLD}" stroke-width="2" opacity="0.6"/>

    <!-- Author -->
    <text x="1280" y="${authorY}"
      font-family="serif" font-size="56" font-style="italic"
      fill="${COLOR_GOLD}" text-anchor="middle"
      letter-spacing="2">${escapedAuthor}</text>

    <!-- Subtitle -->
    <text x="1280" y="${subtitleY}"
      font-family="sans-serif" font-size="36"
      fill="${COLOR_GOLD_DIM}" text-anchor="middle"
      letter-spacing="4" text-transform="uppercase">${escapedSubtitle}</text>

    <!-- Source Library branding -->
    <text x="1280" y="${brandY}"
      font-family="sans-serif" font-size="28"
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
 * @returns JPEG buffer at 2560x1600px
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

      // Apply dark overlay for text legibility
      // Create a semi-transparent dark rectangle as an SVG
      const overlaySvg = `<svg width="${COVER_WIDTH}" height="${COVER_HEIGHT}">
        <rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" fill="${COLOR_DARK}" opacity="0.65"/>
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
