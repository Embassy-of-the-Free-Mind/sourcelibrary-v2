import { describe, it, expect } from 'vitest';
import { classifyApiError } from '@/lib/mcp-errors';

/**
 * What the REST routes now say on a 404 (#8235), passed through to MCP callers
 * instead of being flattened to "No such book or page".
 */
describe('MCP error mapping keeps what a 404 says', () => {
  it('passes the kept edition of a hidden duplicate through, with a recovery that names it', () => {
    const r = classifyApiError(new Error('API 404: {"error":"Book not found","reason":"duplicate_edition","kept_edition":{"id":"6952d0fa77f38f6761bc5aef","url":"https://sourcelibrary.org/book/instruments-of-the-restored-astronomy-brahe"}}'));
    expect(r.error).toBe('not_found');
    expect(r.kept_edition?.id).toBe('6952d0fa77f38f6761bc5aef');
    expect(r.recovery).toContain('6952d0fa77f38f6761bc5aef');
  });

  it('calls a blank leaf blank and names the next page with text', () => {
    const r = classifyApiError(new Error('API 404: {"error":"This page is blank: the leaf carries no text to quote","page_number":1,"page_defaulted":true,"next_text_page":8,"has_original":true}'));
    expect(r.message).toMatch(/blank/);
    expect(r.next_text_page).toBe(8);
    expect(r.recovery).toContain('page 8');
  });

  it('leaves a plain 404 as it was', () => {
    expect(classifyApiError(new Error('API 404: {"error":"Book not found"}')).message).toBe('No such book or page.');
  });
});
