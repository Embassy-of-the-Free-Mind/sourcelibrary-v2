/**
 * public/rooms/embed.js — the reading-room host script (#5266).
 *
 * Runs the real file in a vm sandbox with a small fake window: a history
 * stack whose length and popstate behave like the browser's, and one
 * iframe.sl-room. jsdom is not a dependency here, and the script only
 * touches a handful of DOM calls.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';

const SCRIPT = readFileSync(path.resolve(__dirname, '../../public/rooms/embed.js'), 'utf8');
const ORIGIN = 'https://sourcelibrary.org';

type Listener = (e: unknown) => void;

function makeHost(startUrl = 'https://host.example/packet') {
  const listeners: Record<string, Listener[]> = {};
  const entries: { url: string; state: unknown }[] = [{ url: startUrl, state: null }];
  let index = 0;
  const location = {
    get href() { return entries[index].url; },
    get search() { return new URL(entries[index].url).search; },
    get hash() { return new URL(entries[index].url).hash; },
  };
  const history = {
    get length() { return entries.length; },
    pushState(state: unknown, _t: string, url: string) { entries.splice(index + 1); entries.push({ url, state }); index = entries.length - 1; },
    replaceState(state: unknown, _t: string, url: string) { entries[index] = { url, state }; },
    // What a full load inside the frame does: a joint entry the host did not write.
    _jointEntry() { entries.splice(index + 1); entries.push({ url: entries[index].url, state: entries[index].state }); index = entries.length - 1; },
    _go(delta: number) { index += delta; fire('popstate', { state: entries[index].state }); },
  };
  const replaced: string[] = [];
  const contentWindow = { location: { replace: (u: string) => replaced.push(u) } };
  const attrs: Record<string, string> = { class: 'sl-room', src: `${ORIGIN}/rooms/yam`, 'data-room': 'yam', style: 'height:90vh' };
  const frame = {
    style: {} as Record<string, string>,
    contentWindow,
    src: attrs.src,
    nextElementSibling: null,
    getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
    setAttribute: (k: string, v: string) => { attrs[k] = v; },
    getBoundingClientRect: () => ({ top: 10, height: 600 }),
    scrollIntoView: () => {},
  };
  const docStyle = { overflow: '' };
  const document = {
    readyState: 'complete',
    documentElement: { style: docStyle },
    querySelectorAll: (sel: string) => (sel.startsWith('iframe') ? [frame] : []),
    addEventListener: () => {},
  };
  function fire(type: string, e: unknown) { (listeners[type] || []).forEach((l) => l(e)); }
  const sandbox: Record<string, unknown> = {
    document, location, history, URL, URLSearchParams,
    setTimeout, clearTimeout, innerHeight: 1000,
    addEventListener: (t: string, l: Listener) => { (listeners[t] ||= []).push(l); },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(SCRIPT, sandbox);

  const post = (data: unknown, origin = ORIGIN, source: unknown = contentWindow) => fire('message', { data, origin, source });
  return { frame, attrs, history, location, replaced, docStyle, post, entries: () => entries.map((e) => e.url) };
}

describe('rooms embed.js — sizing', () => {
  it('grows the frame to its content outside the reader', () => {
    const h = makeHost();
    h.post({ type: 'sl-resize', height: 2400 });
    expect(h.frame.style.height).toBe('2400px');
    h.post({ type: 'sl-resize', height: 100 });
    expect(h.frame.style.height).toBe('560px'); // floor
    h.post({ type: 'sl-resize', height: 99999 });
    expect(h.frame.style.height).toBe('16000px'); // ceiling
  });

  it('caps the frame at the window inside the reader', () => {
    const h = makeHost();
    h.post({ type: 'sl-navigate', book: 'b1', page: 'p1' });
    h.post({ type: 'sl-resize', height: 5000 });
    expect(h.frame.style.height).toBe('920px');
  });

  it('ignores messages from another origin or another frame', () => {
    const h = makeHost();
    h.post({ type: 'sl-resize', height: 2400 }, 'https://evil.example');
    h.post({ type: 'sl-resize', height: 2400 }, ORIGIN, {});
    expect(h.frame.style.height).toBe('560px');
  });

  it('lifts on modal-open and restores on modal-close (Source Bridge messages)', () => {
    const h = makeHost();
    h.post({ type: 'sl-resize', height: 1800 });
    const before = h.attrs.style;
    h.post({ source: 'source-library', type: 'modal-open' });
    expect(h.attrs.style).toContain('position:fixed');
    expect(h.docStyle.overflow).toBe('hidden');
    h.post({ source: 'source-library', type: 'modal-close' });
    expect(h.attrs.style).toBe(before);
    expect(h.docStyle.overflow).toBe('');
    expect(h.frame.style.height).toBe('1800px');
  });
});

describe('rooms embed.js — history', () => {
  let h: ReturnType<typeof makeHost>;
  beforeEach(() => { h = makeHost(); });

  it('pushes one host entry per step, carrying ?room=', () => {
    h.post({ type: 'sl-navigate', book: 'b1' });
    h.post({ type: 'sl-navigate', book: 'b1', page: 'p1' });
    expect(h.history.length).toBe(3);
    expect(h.location.search).toBe('?room=book%2Fb1%2Fpage%2Fp1');
    h.post({ type: 'sl-navigate', book: 'b1', page: 'p1' }); // repeat report
    expect(h.history.length).toBe(3);
  });

  it('writes nothing when a full load in the frame already added an entry', () => {
    h.post({ type: 'sl-navigate', book: 'b1' });
    const urlBefore = h.location.href;
    h.history._jointEntry();
    h.post({ type: 'sl-navigate', book: 'b1', page: 'p1' });
    expect(h.history.length).toBe(3); // the joint entry only
    expect(h.location.href).toBe(urlBefore); // not stamped
  });

  it('steers the frame with location.replace on popstate', () => {
    h.post({ type: 'sl-navigate', book: 'b1' });
    h.post({ type: 'sl-navigate', book: 'b1', page: 'p1' });
    h.history._go(-1);
    expect(h.replaced).toEqual([`${ORIGIN}/rooms/yam/book/b1`]);
    expect(h.frame.src).toBe(`${ORIGIN}/rooms/yam`); // never src=
  });

  it('ignores a differing (stale) report while traversing, and ends on the expected one', () => {
    h.post({ type: 'sl-navigate', book: 'b1' });
    h.post({ type: 'sl-navigate', book: 'b1', page: 'p1' });
    h.history._go(-1);
    const len = h.history.length;
    h.post({ type: 'sl-navigate', book: 'b1', page: 'p1' }); // browser's stale restore
    expect(h.history.length).toBe(len);
    expect(h.location.search).toBe('?room=book%2Fb1');
    h.post({ type: 'sl-navigate', book: 'b1' }); // the expected place
    h.post({ type: 'sl-navigate', book: 'b2' }); // a real click after the traversal
    expect(h.location.search).toBe('?room=book%2Fb2');
  });

  it('drops a lifted frame when Back leaves the reader', () => {
    h.post({ type: 'sl-navigate', book: 'b1' });
    h.post({ type: 'sl-navigate', book: 'b1', page: 'p1' });
    h.post({ source: 'source-library', type: 'modal-open' });
    h.history._go(-1);
    expect(h.attrs.style).not.toContain('position:fixed');
  });
});

describe('rooms embed.js — deep link', () => {
  it('starts the frame at ?room= on arrival', () => {
    const h = makeHost('https://host.example/packet?room=book/b1/page/p9');
    expect(h.frame.src).toBe(`${ORIGIN}/rooms/yam/book/b1/page/p9`);
  });

  it('ignores a malformed ?room=', () => {
    const h = makeHost('https://host.example/packet?room=../../evil');
    expect(h.frame.src).toBe(`${ORIGIN}/rooms/yam`);
  });
});
