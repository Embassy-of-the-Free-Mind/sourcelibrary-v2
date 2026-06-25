import { NextResponse } from 'next/server';
import { posts } from '@/app/blog/page';

// Atom feed for the Research Notes blog. Reads the same `posts` array the index
// renders, so the feed never drifts from the site.

export const dynamic = 'force-static';
export const revalidate = 3600;

const BASE_URL = 'https://sourcelibrary.org';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

// Parse the human date strings the blog uses ("25 June 2026") to ISO. Falls back
// to now() on anything unexpected so a malformed date never breaks the feed.
function toISO(date: string): string {
  const m = date.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month !== undefined) {
      return new Date(Date.UTC(Number(m[3]), month, Number(m[1]), 12)).toISOString();
    }
  }
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

export async function GET() {
  const dated = posts.map((p) => ({ ...p, iso: toISO(p.date) }))
    .sort((a, b) => b.iso.localeCompare(a.iso));
  const updated = dated[0]?.iso || new Date().toISOString();

  const entries = dated.map((post) => {
    const url = `${BASE_URL}/blog/${post.slug}`;
    const image = post.image
      ? `<img src="${escapeXml(post.image.startsWith('/') ? BASE_URL + post.image : post.image)}" alt="${escapeXml(post.imageAlt || post.title)}" /><br/>`
      : '';
    return `  <entry>
    <id>${escapeXml(url)}</id>
    <title>${escapeXml(post.title)}</title>
    <link href="${escapeXml(url)}" rel="alternate" type="text/html"/>
    <updated>${post.iso}</updated>
    <published>${post.iso}</published>
    <summary type="text">${escapeXml(post.subtitle)}</summary>
    <content type="html"><![CDATA[${image}<p>${escapeXml(post.subtitle)}</p><p><a href="${url}">Read the full note &rarr;</a></p>]]></content>
    ${post.tag ? `<category term="${escapeXml(post.tag)}"/>` : ''}
    <author><name>Source Library</name></author>
  </entry>`;
  });

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${BASE_URL}/blog</id>
  <title>Source Library — Research Notes</title>
  <subtitle>AI-assisted research on the collection: OCR, translation, the history of science, and the texts behind it.</subtitle>
  <link href="${BASE_URL}/blog" rel="alternate" type="text/html"/>
  <link href="${BASE_URL}/api/feed/blog" rel="self" type="application/atom+xml"/>
  <updated>${updated}</updated>
  <icon>${BASE_URL}/favicon.ico</icon>
  <author><name>Source Library</name><uri>${BASE_URL}</uri></author>
${entries.join('\n')}
</feed>`;

  return new NextResponse(feed, {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
