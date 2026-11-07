/**
 * The homepage featured-collection spread printed collection prose as a plain
 * string, so a description holding `<em>Shennong Bencao Jing</em>` showed the
 * tags as text (#8034). Render the component itself, not just the helper.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import EditorialSpread from '@/components/prototype/EditorialSpread';

const collection = {
  slug: 'cannabis-western-record',
  name: 'An Account of the Plant',
  subtitle: 'The <i>herb</i> in print',
  description: 'From the <em>Shennong Bencao Jing</em> to <script>x</script> the herbals.',
  book_count: 12,
  hero_image: null,
};

describe('EditorialSpread inline markup (#8034)', () => {
  const html = renderToStaticMarkup(<EditorialSpread collection={collection} books={[]} />);

  it('renders <em> in the description as emphasis, not visible tags', () => {
    expect(html).toContain('<em>Shennong Bencao Jing</em>');
    expect(html).not.toContain('&lt;em&gt;');
  });

  it('renders emphasis in the subtitle too', () => {
    expect(html).toContain('<em>herb</em>');
    expect(html).not.toContain('&lt;i&gt;');
  });

  it('keeps tags outside the whitelist escaped', () => {
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});
