// PRIOR ART: src/lib/auth.ts and src/app/api/beta/subscribe/route.ts each held a
// copy of this email as a static string with "over 2,000 rare books" typed in;
// both went stale. src/lib/library-stats.ts is the live count, reused here.
import { getLibraryStats, roundedCountLabel, type LibraryStats } from '@/lib/library-stats';

/**
 * The welcome email, sent on a new account (src/lib/auth.ts) and on a
 * mailing-list signup (/api/beta/subscribe). The two differ only in the first
 * line under the heading.
 *
 * The collection figures are read at send time from the homepage stats cache,
 * rounded down, so the email cannot drift from the site again. If the cache is
 * unreachable the email says "tens of thousands" and leaves out the numbers
 * rather than guessing.
 */
export async function welcomeEmailHtml(lead: string): Promise<string> {
  const stats = await getLibraryStats();
  return renderWelcomeEmail(lead, stats);
}

const LINKS: Array<{ href: string; label: string; note: string }> = [
  { href: 'https://sourcelibrary.org/articles', label: 'Read the articles', note: 'Stories and research built on quotations you can check against the page' },
  { href: 'https://sourcelibrary.org/search', label: 'Search the collection', note: 'Full-text search across all books and translations' },
  { href: 'https://sourcelibrary.org/gallery', label: 'Browse the gallery', note: 'Illustrations, woodcuts and diagrams from the books' },
  { href: 'https://sourcelibrary.org/encyclopedia', label: 'Explore the encyclopedia', note: 'People, places, and concepts across the collection' },
  { href: 'https://sourcelibrary.org/developers', label: 'Developer tools (MCP)', note: 'Use Source Library from Claude, ChatGPT, or your own tools' },
];

export function renderWelcomeEmail(lead: string, stats: LibraryStats | null): string {
  const about = stats && stats.books > 0
    ? `Source Library holds ${roundedCountLabel(stats.books)} rare books and manuscripts in ${stats.languages} languages, from Sumerian tablets to the 19th century: theology, philosophy, alchemy, science, medicine, magic and more.${stats.readableInEnglish > 0 ? ` ${roundedCountLabel(stats.readableInEnglish)} of them can be read in English.` : ''}`
    : 'Source Library holds tens of thousands of rare books and manuscripts, from Sumerian tablets to the 19th century: theology, philosophy, alchemy, science, medicine, magic and more.';

  const rows = LINKS.map((l, i) => `
    <tr>
      <td style="padding: 12px 0;${i < LINKS.length - 1 ? ' border-bottom: 1px solid #e8e4dc;' : ''}">
        <a href="${l.href}" style="color: #9e4a3a; text-decoration: none; font-size: 15px; font-weight: 500;">${l.label}</a>
        <div style="color: #6b6560; font-size: 13px; margin-top: 4px;">${l.note}</div>
      </td>
    </tr>`).join('');

  return `
<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #1a1612;">
  <div style="text-align: center; margin-bottom: 32px;">
    <img src="https://sourcelibrary.org/brand/svg/icon-only--black-on-white.svg" alt="Source Library" width="48" height="48" style="margin-bottom: 16px;" />
    <h1 style="font-size: 26px; font-weight: 500; margin: 0 0 8px; letter-spacing: -0.01em;">Welcome to Source Library</h1>
    <p style="color: #6b6560; font-size: 15px; line-height: 1.6; margin: 0;">
      ${lead}
    </p>
  </div>
  <div style="background: #f5f0e8; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
    <p style="font-size: 15px; line-height: 1.7; margin: 0 0 16px; color: #1a1612;">
      ${about}
    </p>
    <p style="font-size: 15px; line-height: 1.7; margin: 0; color: #1a1612;">
      Every text is free to read, search, and cite. Most English translations are made with AI, and each page says so. Here are a few places to start:
    </p>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">${rows}
  </table>
  <div style="text-align: center; margin: 32px 0;">
    <a href="https://sourcelibrary.org" style="display: inline-block; padding: 12px 32px; background: #9e4a3a; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-family: -apple-system, sans-serif;">
      Start reading
    </a>
  </div>
  <div style="border-top: 1px solid #e8e4dc; padding-top: 24px; text-align: center;">
    <p style="color: #8a8480; font-size: 12px; line-height: 1.6; margin: 0;">
      Source Library: rare texts, translated and searchable.
      <br />
      <a href="https://sourcelibrary.org" style="color: #8a8480;">sourcelibrary.org</a>
    </p>
  </div>
</div>
`;
}

/** First line for a new account. */
export const ACCOUNT_WELCOME_LEAD = 'Your account is ready. Your likes, saved articles and reading history will sync across all your devices.';

/** First line for a mailing-list signup (no account). */
export const LIST_WELCOME_LEAD = "Thank you for joining the mailing list. We'll write now and then with new articles and finds from the collection.";
