// Shared in-app browser (webview) detection. Sign-in inside an in-app browser
// — Instagram, Facebook, TikTok, etc. — is the #1 cause of our auth failures:
// the OAuth round-trip loses the state cookie, and Google blocks many webviews
// outright. Used both server-side (auth error page, via UA header) and
// client-side (sign-in page, via navigator.userAgent) so we can warn users
// BEFORE they fail and steer them to email (whose link opens in their real
// browser) or to reopening in Chrome/Safari.

export const IN_APP_BROWSER_RE =
  /(Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\/|Twitter|Snapchat|WhatsApp|Pinterest|TikTok|musical_ly|BytedanceWebview|GSA\/|; wv\))/i;

export function isInAppBrowser(ua: string | null | undefined): boolean {
  return !!ua && IN_APP_BROWSER_RE.test(ua);
}

export function isIOS(ua: string | null | undefined): boolean {
  return !!ua && /(iPhone|iPad|iPod)/i.test(ua);
}

// The browser to tell the user to reopen in, by platform.
export function preferredBrowser(ua: string | null | undefined): 'Safari' | 'Chrome' {
  return isIOS(ua) ? 'Safari' : 'Chrome';
}

// Best-effort friendly name of the host app, for a more specific message.
export function inAppBrowserName(ua: string | null | undefined): string | null {
  if (!ua) return null;
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/(FBAN|FBAV|FB_IAB|FBIOS)/i.test(ua)) return 'Facebook';
  if (/Line\//i.test(ua)) return 'LINE';
  if (/(TikTok|musical_ly|BytedanceWebview)/i.test(ua)) return 'TikTok';
  if (/Snapchat/i.test(ua)) return 'Snapchat';
  if (/Pinterest/i.test(ua)) return 'Pinterest';
  if (/Twitter/i.test(ua)) return 'X';
  return null;
}
