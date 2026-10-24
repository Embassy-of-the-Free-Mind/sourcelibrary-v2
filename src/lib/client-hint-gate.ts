/**
 * App-layer backstop for the Cloudflare client-hint rule (`cb7dfe4b`, #4476).
 *
 * PRIOR ART: src/lib/blocked-networks.ts — same idea (a durable copy of an edge
 * block that covers every hostname), but it keys on the client's network; this
 * keys on request headers, so it is a separate check. looksLikeBot() in
 * src/proxy.ts is a soft rate-limit signal, not a block.
 *
 * Why: in October 2026 a residential proxy pool rotated its forged Chrome
 * user agent four times in nine days (144 → 147 → 145 → 149), so rules keyed
 * on a version string kept losing. The pool's tell is its client hints. Real
 * Chrome has sent `sec-ch-ua` on every HTTPS request since version 89, and it
 * quotes `sec-ch-ua-platform` ("macOS"). The pool sent no `sec-ch-ua` at all,
 * or `Mac OS X` unquoted. Cloudflare blocks on that at the edge, but a
 * Cloudflare rule covers one zone, and this project also answers on hosts
 * outside it (the July fleet read for nine weeks through one). This check
 * runs in the proxy, which sees every host.
 *
 * Deliberately narrow:
 *   - Only reader paths (book and work pages, page text, the image proxy).
 *   - Only a UA that is EXACTLY the shape desktop Chrome sends:
 *     Windows, Mac or Linux; nothing appended; no "Mobile". Googlebot sends a
 *     Chrome version and no hints, but its UA carries `compatible; Googlebot`,
 *     so it does not match. Edge, Opera and every honest bot append a token,
 *     and our own scripts carry `sourcelibrary-`, so they don't match either.
 *     Android and iOS never match.
 *   - The Cloudflare rule's third clause (headless Chromium on DigitalOcean)
 *     is not mirrored: the app has no ASN for a request.
 */

const READER_PATH_PREFIXES = ['/book', '/work', '/api/pages', '/api/image'];

// The reduced UA desktop Chrome sends since v101: the platform, then a fixed
// tail with the minor version zeroed. Anything appended means another browser
// or a self-identified client.
const DESKTOP_CHROME_UA =
  /^Mozilla\/5\.0 \((?:Windows NT [^)]*|Macintosh; [^)]*|X11; Linux [^)]*)\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/;

export function isReaderPath(pathname: string): boolean {
  return READER_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/**
 * True when a request claims to be desktop Chrome on a reader path but its
 * client hints say otherwise: no `sec-ch-ua` at all, or a platform hint
 * without the quotes Chrome always sends.
 */
export function isForgedChrome(
  pathname: string,
  headers: { get(name: string): string | null },
): boolean {
  if (!isReaderPath(pathname)) return false;
  const ua = headers.get('user-agent') || '';
  if (!DESKTOP_CHROME_UA.test(ua)) return false;

  const chUa = headers.get('sec-ch-ua');
  if (chUa === null) return true;

  const platform = headers.get('sec-ch-ua-platform');
  if (platform !== null && !platform.startsWith('"')) return true;

  return false;
}

// Same text as the Cloudflare rule's block page, so a reader sees one message
// whichever layer stopped them.
export const FORGED_CHROME_RESPONSE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>This page could not be opened</title><style>body{font-family:Georgia,serif;max-width:32em;margin:15vh auto;padding:0 16px;color:#222;background:#fbf8f2;line-height:1.5}h1{font-weight:normal}a{color:#222}</style></head><body><h1>This page could not be opened</h1><p>Source Library blocks programs that copy books in bulk while pretending to be a web browser. Your browser looks like one of them to our filter. That usually happens when an extension or setting changes how the browser identifies itself, such as a user-agent switcher or some privacy tools, or when the page is opened inside another app.</p><p><strong>What usually fixes it:</strong> open the page in an ordinary Chrome, Firefox or Safari window with those extensions turned off.</p><p><strong>If you are a reader and we got it wrong, please tell us.</strong> Write to <a href="mailto:team@sourcelibrary.org?subject=Blocked%20from%20a%20book%20page">team@sourcelibrary.org</a> with the address of the page and roughly when you tried. Every report helps us make the filter more accurate. The Feedback button on our <a href="https://sourcelibrary.org/">home page</a> works too.</p><p>Need many books for research? See <a href="https://sourcelibrary.org/developers">sourcelibrary.org/developers</a> for bulk access.</p></body></html>`;
