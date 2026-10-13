import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import FramedImg from '@/components/FramedImg';

const frame = { x: 0.1, y: 0, w: 0.8, h: 1, ar: 0.75, v: 3 };

describe('<FramedImg>', () => {
  it('with no frame renders the image alone, with the props it was given', () => {
    const html = renderToStaticMarkup(createElement(FramedImg, { frame: null, src: '/a.jpg', alt: 'A', className: 'w-full h-full object-cover' }));
    // No wrapper, no added style: an unframed image is exactly what it was.
    expect(html).toContain('<img src="/a.jpg" alt="A" class="w-full h-full object-cover"/>');
    expect(html).not.toContain('<span');
    expect(html).not.toContain('style=');
  });

  it('with a frame clips the image inside a page-shaped box', () => {
    const html = renderToStaticMarkup(createElement(FramedImg, { frame, src: '/a.jpg', alt: 'A', className: 'object-cover', style: { opacity: 0.5 } }));
    expect(html).toContain('data-framed');
    expect(html).toContain('container-type:size');
    expect(html).toContain('class="framed-box framed-box-page"');
    expect(html).toContain('--framed-a:0.6');
    // The whole scan, scaled so the frame fills the box, shifted left by the bed.
    expect(html).toContain('left:-12.5%');
    expect(html).toContain('width:125%');
    expect(html).toContain('height:100%');
    // The caller's own style survives.
    expect(html).toContain('opacity:0.5');
  });
});
