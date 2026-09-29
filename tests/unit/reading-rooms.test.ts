import { describe, it, expect } from 'vitest';
import {
  getRoomPrefixFromPathname,
  getRoomSlugFromPathname,
  isValidRoomSlug,
  withRoomPrefix,
  RESERVED_ROOM_SEGMENTS,
} from '@/lib/reading-rooms-paths';
import { validateRoomInput, normalizeOriginHost, slugifyRoomName } from '@/lib/reading-rooms';

/**
 * Reading rooms (#5266). These pin the two decisions every leak in a room
 * would trace back to: which pathnames count as "inside a room" (so the
 * embed hooks prefix links and the proxy allows framing), and what the
 * owner is allowed to store (slug grammar, https-only URLs, hostnames).
 */

describe('reading-room paths', () => {
  it('recognises a room and its sub-paths', () => {
    expect(getRoomSlugFromPathname('/rooms/zosimos')).toBe('zosimos');
    expect(getRoomSlugFromPathname('/rooms/zosimos/')).toBe('zosimos');
    expect(getRoomSlugFromPathname('/rooms/zosimos/book/atalanta-fugiens')).toBe('zosimos');
    expect(getRoomPrefixFromPathname('/rooms/zosimos/book/x/page/y')).toBe('/rooms/zosimos');
  });

  it('does not treat management pages or the index as rooms', () => {
    expect(getRoomPrefixFromPathname('/rooms')).toBeNull();
    expect(getRoomPrefixFromPathname('/rooms/')).toBeNull();
    expect(getRoomPrefixFromPathname('/rooms/new')).toBeNull();
    expect(getRoomPrefixFromPathname('/rooms/manage/zosimos')).toBeNull();
    for (const seg of RESERVED_ROOM_SEGMENTS) {
      expect(getRoomPrefixFromPathname(`/rooms/${seg}`)).toBeNull();
    }
  });

  it('ignores other namespaces', () => {
    expect(getRoomPrefixFromPathname('/embed/bph/book/x')).toBeNull();
    expect(getRoomPrefixFromPathname('/book/x')).toBeNull();
    expect(getRoomPrefixFromPathname('/roomsx/y')).toBeNull();
    expect(getRoomPrefixFromPathname(null)).toBeNull();
  });

  it('slug grammar: 3–48 chars, lowercase, no edge hyphens, no reserved words', () => {
    expect(isValidRoomSlug('ab')).toBe(false);
    expect(isValidRoomSlug('abc')).toBe(true);
    expect(isValidRoomSlug('-abc')).toBe(false);
    expect(isValidRoomSlug('abc-')).toBe(false);
    expect(isValidRoomSlug('Abc')).toBe(false);
    expect(isValidRoomSlug('a'.repeat(48))).toBe(true);
    expect(isValidRoomSlug('a'.repeat(49))).toBe(false);
    expect(isValidRoomSlug('manage')).toBe(false);
    expect(isValidRoomSlug('new')).toBe(false);
  });

  it('prefixes site-relative links and leaves external / already-prefixed ones alone', () => {
    const p = '/rooms/zosimos';
    expect(withRoomPrefix('/book/x', p)).toBe('/rooms/zosimos/book/x');
    expect(withRoomPrefix('/book/x/page/y?lang=es', p)).toBe('/rooms/zosimos/book/x/page/y?lang=es');
    expect(withRoomPrefix('/', p)).toBe('/rooms/zosimos');
    expect(withRoomPrefix('/?view=catalog', p)).toBe('/rooms/zosimos?view=catalog');
    expect(withRoomPrefix('/rooms/zosimos/book/x', p)).toBe('/rooms/zosimos/book/x');
    expect(withRoomPrefix('/embed/bph/book/x', p)).toBe('/embed/bph/book/x');
    expect(withRoomPrefix('https://example.org', p)).toBe('https://example.org');
    expect(withRoomPrefix('//cdn.example.org/x', p)).toBe('//cdn.example.org/x');
    expect(withRoomPrefix('#top', p)).toBe('#top');
  });
});

describe('reading-room input validation', () => {
  const good = {
    name: 'The Zosimos Reading Room',
    source: { type: 'collection', slug: 'alchemy' },
    theme: { logo_url: 'https://example.org/logo.svg', accent_hex: '#9E4A3A', home_url: 'https://example.org', home_label: 'Back' },
    allowed_origins: ['example.org', 'https://www.example.org/some/page'],
  };

  it('accepts a full body and derives the slug from the name', () => {
    const r = validateRoomInput(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.slug).toBe('the-zosimos-reading-room');
    expect(r.value.theme?.accent_hex).toBe('#9e4a3a');
    expect(r.value.allowed_origins).toEqual(['example.org', 'www.example.org']);
  });

  it('rejects non-https logo and home URLs', () => {
    expect(validateRoomInput({ ...good, theme: { ...good.theme, logo_url: 'http://example.org/l.png' } }).ok).toBe(false);
    expect(validateRoomInput({ ...good, theme: { ...good.theme, home_url: 'javascript:alert(1)' } }).ok).toBe(false);
  });

  it('rejects a bad accent, a reserved slug, an unknown source shape, and a non-hostname origin', () => {
    expect(validateRoomInput({ ...good, theme: { accent_hex: 'red' } }).ok).toBe(false);
    expect(validateRoomInput({ ...good, slug: 'manage' }).ok).toBe(false);
    expect(validateRoomInput({ ...good, source: { type: 'books', ids: ['x'] } }).ok).toBe(false);
    expect(validateRoomInput({ ...good, allowed_origins: ['not a host'] }).ok).toBe(false);
  });

  it('partial mode validates only what is present', () => {
    const r = validateRoomInput({ tagline: '  new   line  ' }, { partial: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ tagline: 'new line' });
  });

  it('normalises origin hosts and slugifies names', () => {
    expect(normalizeOriginHost(' HTTPS://Example.ORG:443/path ')).toBe('example.org');
    expect(normalizeOriginHost('localhost')).toBeNull();
    expect(slugifyRoomName('Écoute — Séance 3!')).toBe('ecoute-seance-3');
  });
});
