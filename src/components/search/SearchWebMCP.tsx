'use client';

import { useWebMCPTools } from '@/hooks/useWebMCPTools';
import { textResult, type WebMCPTool } from '@/lib/webmcp';

/**
 * Registers a WebMCP `search_library` tool on the search page, so in-browser
 * agents can query the catalogue directly instead of driving the search box.
 * Renders nothing; no-ops in browsers without WebMCP. Read-only (issue
 * #4594) — same same-origin API the page itself calls, in the user's own
 * session, so metering and rate limits apply unchanged.
 */
export default function SearchWebMCP() {
  useWebMCPTools((): WebMCPTool[] => [
    {
      name: 'search_library',
      description:
        'Search the Source Library catalogue of historical primary sources ' +
        '(alchemy, Hermetica, Kabbalah, early modern science, and more) by ' +
        'title, author, or full-text content. Returns the top-ranked matches ' +
        'with links — not an exhaustive list, so it cannot answer "how many" ' +
        'or "show me all" questions.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to search for — a title, author, topic, or phrase.',
          },
        },
        required: ['query'],
      },
      annotations: { readOnlyHint: true },
      execute: async (params) => {
        const query = String(params.query || '').trim();
        if (!query) return textResult('Provide a non-empty query.');
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=10`);
        if (!res.ok) {
          return textResult(`Search failed (HTTP ${res.status}). Try again shortly.`);
        }
        const data = (await res.json()) as {
          total?: number;
          results?: Array<{
            id?: string;
            slug?: string;
            title?: string;
            display_title?: string;
            author?: string;
            book_title?: string;
            book_author?: string;
            published?: string;
            snippet?: string;
          }>;
        };
        const results = data.results || [];
        if (!results.length) return textResult(`No results for "${query}".`);
        const origin = window.location.origin;
        const lines = results.slice(0, 10).map((r) => {
          const title = r.display_title || r.title || r.book_title || 'Untitled';
          const author = r.author || r.book_author;
          const path = r.slug || r.id;
          const url = path ? ` — ${origin}/book/${path}` : '';
          const meta = [author, r.published].filter(Boolean).join(', ');
          return `- ${title}${meta ? ` (${meta})` : ''}${url}`;
        });
        return textResult(
          `${data.total ?? results.length} result(s) for "${query}":\n${lines.join('\n')}`
        );
      },
    },
  ]);

  return null;
}
