import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// #7098 — the handwritten-manuscript notice and the Page Info page chip were
// hard-coded English under /es, /la, /nl and /zh chrome.
let pathname = '/book/x/page/1';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

import NotesRenderer from '@/components/reader/NotesRenderer';

const PAGE = '<script>handwritten</script>\n<page-num>12</page-num>\n\nVerum, sine mendacio, certum et verissimum.';

const render = (path: string, showMetadata: boolean) => {
  pathname = path;
  return renderToStaticMarkup(React.createElement(NotesRenderer, { text: PAGE, showMetadata, showNotes: true }));
};

describe('NotesRenderer chrome follows the URL locale (#7098)', () => {
  it('keeps the English notice and page chip at the root', () => {
    const html = render('/book/x/page/1', true);
    expect(html).toContain('Handwritten manuscript');
    expect(html).toContain('transcription may contain uncertain readings');
    expect(html).toContain('p. 12');
  });

  it('renders the notice and page chip in Chinese under /zh', () => {
    const html = render('/zh/book/x/page/1', true);
    expect(html).toContain('手写稿');
    expect(html).toContain('转录可能含有不确定的释读');
    expect(html).toContain('第 12 页');
    expect(html).not.toContain('Handwritten');
    expect(html).not.toContain('uncertain readings');
  });

  it('localizes the notice when the metadata panel is hidden too', () => {
    for (const [path, word] of [['/es/book/x/page/1', 'lecturas inciertas'], ['/la/book/x/page/1', 'lectiones incertas'], ['/nl/book/x/page/1', 'onzekere lezingen']]) {
      const html = render(path, false);
      expect(html).toContain(word);
      expect(html).not.toContain('uncertain readings');
    }
  });
});
