import { describe, it, expect } from 'vitest';
import { classifyTraffic } from '@/lib/traffic-classification';

// Pins the write-time traffic classifier. It exists because a gap here is not
// cosmetic: on 2026-09-01 the headless browser Lightpanda — which declares
// itself plainly in its UA — matched none of the bot patterns (no "bot",
// "crawler", or "spider" substring) and 32,069 reads/24h from 26,822
// residential proxy IPs were stored as `traffic_class: human` (#4476).
// Every audience metric downstream of traffic_class inherited that.

describe('classifyTraffic', () => {
  it('classifies self-identifying headless browsers as other_bot', () => {
    expect(classifyTraffic('Lightpanda/1.0')).toBe('other_bot');
    expect(
      classifyTraffic('Mozilla/5.0 (X11; Linux x86_64) Lightpanda/1.0 AppleWebKit/537.36')
    ).toBe('other_bot');
    expect(classifyTraffic('Mozilla/5.0 HeadlessChrome/120.0.0.0')).toBe('other_bot');
  });

  // facebookexternalhit has no "bot" in its UA and was stored as human (#8151).
  it('classifies link-preview fetchers as other_bot', () => {
    expect(
      classifyTraffic('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')
    ).toBe('other_bot');
    expect(classifyTraffic('facebookcatalog/1.0')).toBe('other_bot');
    expect(classifyTraffic('WhatsApp/2.23.20.0 A')).toBe('other_bot');
    expect(
      classifyTraffic('Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5')
    ).toBe('other_bot');
    expect(classifyTraffic('Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)')).toBe(
      'other_bot'
    );
    expect(classifyTraffic('Iframely/1.3.1 (+https://iframely.com/docs/about)')).toBe('other_bot');
  });

  it('keeps the Facebook in-app browser as human', () => {
    expect(
      classifyTraffic(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0.0.0;FBBV/1;FBDV/iPhone15,2]'
      )
    ).toBe('human');
  });

  it('still classifies a real browser UA as human', () => {
    expect(
      classifyTraffic(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
      )
    ).toBe('human');
  });

  it('keeps the AI/search precedence ordering', () => {
    expect(classifyTraffic('Mozilla/5.0 (compatible; ClaudeBot/1.0)')).toBe('ai_trainer');
    expect(classifyTraffic('Mozilla/5.0 (compatible; Claude-User/1.0)')).toBe('ai_agent');
    expect(classifyTraffic('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe('search_crawler');
  });
});
