/**
 * Email HTML template builder for Source Library newsletters.
 * Uses inline CSS and table layout for email client compatibility.
 * Visual identity matches the welcome email: cream bg, rust accent, Georgia serif.
 */

export interface DigestContent {
  subject: string;
  greeting: string;
  new_books?: Array<{
    title: string;
    author: string;
    year?: number;
    description: string;
    url: string;
  }>;
  popular_books?: Array<{
    title: string;
    author: string;
    url: string;
    reads: number;
  }>;
  gallery_highlight?: {
    description: string;
    url: string;
  };
  stats?: {
    total_books: number;
    total_pages_ocr: number;
    total_pages_translated: number;
  };
  closing: string;
}

function bookRow(book: { title: string; author: string; year?: number; description?: string; url: string; reads?: number }): string {
  const yearStr = book.year ? ` (${book.year})` : '';
  const subtitle = book.description
    ? `<div style="color: #6b6560; font-size: 13px; margin-top: 4px;">${book.description}</div>`
    : book.reads
      ? `<div style="color: #6b6560; font-size: 13px; margin-top: 4px;">${book.reads} reads</div>`
      : '';
  return `<tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #e8e4dc;">
        <a href="${book.url}" style="color: #9e4a3a; text-decoration: none; font-size: 15px; font-weight: 500;">${book.title}</a>
        <span style="color: #8a8480; font-size: 13px;">${book.author}${yearStr}</span>
        ${subtitle}
      </td>
    </tr>`;
}

export function renderDigestHtml(content: DigestContent): string {
  const newBooksSection = content.new_books?.length
    ? `<div style="margin-bottom: 24px;">
        <h2 style="font-size: 18px; font-weight: 500; color: #1a1612; margin: 0 0 12px; letter-spacing: -0.01em;">New in the Collection</h2>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${content.new_books.map(b => bookRow(b)).join('\n')}
        </table>
      </div>`
    : '';

  const popularSection = content.popular_books?.length
    ? `<div style="margin-bottom: 24px;">
        <h2 style="font-size: 18px; font-weight: 500; color: #1a1612; margin: 0 0 12px; letter-spacing: -0.01em;">Most Read</h2>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${content.popular_books.map(b => bookRow(b)).join('\n')}
        </table>
      </div>`
    : '';

  const gallerySection = content.gallery_highlight
    ? `<div style="background: #f5f0e8; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
        <p style="font-size: 15px; line-height: 1.7; margin: 0 0 12px; color: #1a1612;">${content.gallery_highlight.description}</p>
        <a href="${content.gallery_highlight.url}" style="color: #9e4a3a; text-decoration: none; font-size: 14px; font-weight: 500;">Browse the gallery &rarr;</a>
      </div>`
    : '';

  const statsSection = content.stats
    ? `<div style="background: #f5f0e8; border-radius: 12px; padding: 20px; margin-bottom: 24px; text-align: center;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align: center; padding: 8px;">
              <div style="font-size: 22px; font-weight: 600; color: #9e4a3a;">${content.stats.total_books.toLocaleString()}</div>
              <div style="font-size: 12px; color: #6b6560; margin-top: 2px;">Books</div>
            </td>
            <td style="text-align: center; padding: 8px;">
              <div style="font-size: 22px; font-weight: 600; color: #9e4a3a;">${content.stats.total_pages_ocr.toLocaleString()}</div>
              <div style="font-size: 12px; color: #6b6560; margin-top: 2px;">Pages OCR'd</div>
            </td>
            <td style="text-align: center; padding: 8px;">
              <div style="font-size: 22px; font-weight: 600; color: #9e4a3a;">${content.stats.total_pages_translated.toLocaleString()}</div>
              <div style="font-size: 12px; color: #6b6560; margin-top: 2px;">Translated</div>
            </td>
          </tr>
        </table>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #fdfcf9; -webkit-font-smoothing: antialiased;">
<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #1a1612;">
  <div style="text-align: center; margin-bottom: 32px;">
    <img src="https://sourcelibrary.org/brand/svg/icon-only--black-on-white.svg" alt="Source Library" width="48" height="48" style="margin-bottom: 16px;" />
    <h1 style="font-size: 26px; font-weight: 500; margin: 0 0 8px; letter-spacing: -0.01em;">${content.subject}</h1>
  </div>
  <div style="font-size: 15px; line-height: 1.7; margin-bottom: 24px; color: #1a1612;">
    <p style="margin: 0 0 16px;">${content.greeting}</p>
  </div>
  ${newBooksSection}
  ${popularSection}
  ${gallerySection}
  ${statsSection}
  <div style="font-size: 15px; line-height: 1.7; margin-bottom: 24px; color: #1a1612;">
    <p style="margin: 0;">${content.closing}</p>
  </div>
  <div style="text-align: center; margin: 32px 0;">
    <a href="https://sourcelibrary.org" style="display: inline-block; padding: 12px 32px; background: #9e4a3a; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-family: -apple-system, sans-serif;">
      Explore the collection
    </a>
  </div>
  <div style="border-top: 1px solid #e8e4dc; padding-top: 24px; text-align: center;">
    <p style="color: #8a8480; font-size: 12px; line-height: 1.6; margin: 0;">
      Source Library &mdash; Rare texts, translated and searchable.
      <br />
      <a href="https://sourcelibrary.org" style="color: #8a8480;">sourcelibrary.org</a>
      <br /><br />
      <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color: #8a8480; font-size: 11px;">Unsubscribe</a>
    </p>
  </div>
</div>
</body>
</html>`;
}

/**
 * Wraps arbitrary HTML body content in the Source Library email shell.
 * Used for manual compose mode.
 */
export function wrapInEmailShell(subject: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #fdfcf9; -webkit-font-smoothing: antialiased;">
<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #1a1612;">
  <div style="text-align: center; margin-bottom: 32px;">
    <img src="https://sourcelibrary.org/brand/svg/icon-only--black-on-white.svg" alt="Source Library" width="48" height="48" style="margin-bottom: 16px;" />
    <h1 style="font-size: 26px; font-weight: 500; margin: 0 0 8px; letter-spacing: -0.01em;">${subject}</h1>
  </div>
  <div style="font-size: 15px; line-height: 1.7; color: #1a1612;">
    ${bodyHtml}
  </div>
  <div style="border-top: 1px solid #e8e4dc; padding-top: 24px; margin-top: 32px; text-align: center;">
    <p style="color: #8a8480; font-size: 12px; line-height: 1.6; margin: 0;">
      Source Library &mdash; Rare texts, translated and searchable.
      <br />
      <a href="https://sourcelibrary.org" style="color: #8a8480;">sourcelibrary.org</a>
      <br /><br />
      <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color: #8a8480; font-size: 11px;">Unsubscribe</a>
    </p>
  </div>
</div>
</body>
</html>`;
}
