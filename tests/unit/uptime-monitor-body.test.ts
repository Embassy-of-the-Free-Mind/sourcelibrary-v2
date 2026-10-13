/**
 * #5075 — the uptime monitor reported /embed/bhutan 2,016/2,016 OK while the page logged 174
 * streamed render timeouts: the route streams behind loading.tsx, so the error arrives inside
 * a 200 and the old body patterns ('Something went wrong', 'digest:') never appear in the HTML.
 *
 * These cases render through the React build Next actually ships (next/dist/compiled), so if
 * React changes how it streams a server render error, this fails instead of the monitor going
 * quietly green again.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { detectStreamedRenderError } from '../../scripts/uptime-monitor.mjs';

const require = createRequire(import.meta.url);
const React = require('next/dist/compiled/react');
const { renderToReadableStream } = require('next/dist/compiled/react-dom/server.edge');
const h = React.createElement;

async function streamed(Child: () => Promise<unknown>): Promise<string> {
  const stream = await renderToReadableStream(
    h('html', null, h('body', null,
      h(React.Suspense, { fallback: h('div', { 'aria-busy': 'true' }, 'Loading library…') }, h(Child)),
    )),
    { onError: () => '3580489259' },
  );
  return new Response(stream).text();
}

const later = () => new Promise(r => setTimeout(r, 20));

describe('detectStreamedRenderError (#5075)', () => {
  it('flags a loader that throws after the 200 shell has gone out', async () => {
    const html = await streamed(async () => {
      await later();
      throw new Error('operation exceeded time limit');
    });
    // Negative control for the old patterns: neither is in the body.
    expect(html).not.toContain('Something went wrong');
    expect(html).not.toContain('digest:');
    expect(detectStreamedRenderError(html)).toMatch(/streamed render error/);
  });

  it('passes a page whose boundaries all completed', async () => {
    const html = await streamed(async () => {
      await later();
      return h('div', null, 'library grid');
    });
    // The runtime itself names $RX in its helper list; that must not trip the check.
    expect(detectStreamedRenderError(html)).toBeNull();
  });

  it('flags a stream that ended before a boundary was filled', () => {
    const truncated = '<html><body><!--$?--><template id="B:0"></template><div aria-busy="true">Loading</div><!--/$-->';
    expect(detectStreamedRenderError(truncated)).toBe('unresolved suspense boundary (B:0)');
  });

  it('flags an error digest in the inlined RSC payload', () => {
    const body = '<script>self.__next_f.push([1,"5:E{\\"digest\\":\\"3580489259\\"}\\n"])</script>';
    expect(detectStreamedRenderError(body)).toBe('error body detected: RSC error digest');
  });
});
