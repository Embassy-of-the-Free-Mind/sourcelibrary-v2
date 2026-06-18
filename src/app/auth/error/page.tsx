import Link from 'next/link';
import { headers } from 'next/headers';

// NextAuth (Auth.js v5) redirects here with ?error=<code>. The codes we
// actually see in production (PostHog, 60d): `Verification` (single-use
// magic-link token already spent — usually an email client previewed/prefetched
// the link, or it was clicked twice) and `Configuration` (the OAuth round-trip
// failed — almost always because sign-in was attempted inside an in-app browser
// webview, e.g. Instagram, which can't preserve the OAuth state cookie). The
// old page ignored the code and showed one generic message; this one reads the
// code + User-Agent and gives recovery-oriented guidance.

// In-app browser webviews break OAuth (lost state cookie) and Google often
// blocks them outright. Detect the common ones so we can tell the user to
// reopen in their real browser — the only reliable cure for those sign-ins.
const IN_APP_BROWSER_RE =
  /(Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\/|Twitter|Snapchat|WhatsApp|Pinterest|TikTok|musical_ly|BytedanceWebview|GSA\/|; wv\))/i;

function describe(error: string | undefined, isInAppBrowser: boolean, isIOS: boolean) {
  const browserName = isIOS ? 'Safari' : 'Chrome';
  const openHint = `You appear to be in an in-app browser. Tap the ⋯ menu and choose “Open in ${browserName}”, then sign in there.`;

  switch (error) {
    case 'Verification':
      return {
        title: 'Your sign-in link expired',
        body: isInAppBrowser
          ? `That magic link was already used or has expired. This often happens when your email app previews the link. ${openHint} Then request a fresh link.`
          : 'That magic link was already used or has expired — this can happen if your email app previewed the link, or if you opened an older one. Request a fresh link and use the newest email.',
        cta: 'Send me a new link',
      };
    case 'Configuration':
    case 'OAuthCallback':
    case 'Callback':
      return {
        title: 'Sign-in couldn’t complete',
        body: isInAppBrowser
          ? `Sign-in can’t finish inside an in-app browser. ${openHint}`
          : 'Something interrupted the sign-in handshake. This usually clears up on a second try — if it keeps happening, try a different browser or use the email sign-in option.',
        cta: 'Try again',
      };
    case 'AccessDenied':
      return {
        title: 'Access denied',
        body: 'You don’t currently have access with that account. If you think this is a mistake, try a different account or contact us.',
        cta: 'Try a different account',
      };
    default:
      return {
        title: 'Sign-in failed',
        body: isInAppBrowser
          ? `Something went wrong during sign-in. ${openHint}`
          : 'Something went wrong during sign-in. The link may have expired or already been used.',
        cta: 'Try again',
      };
  }
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Next.js 16: searchParams arrives as a Promise and must be awaited.
  const { error } = await searchParams;
  const ua = (await headers()).get('user-agent') || '';
  const isInAppBrowser = IN_APP_BROWSER_RE.test(ua);
  const isIOS = /(iPhone|iPad|iPod)/i.test(ua);

  const { title, body, cta } = describe(error, isInAppBrowser, isIOS);

  return (
    <div className="min-h-screen relative flex items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/auth-bg.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-black/50" />

      <div className="relative z-10 w-full max-w-md p-8 rounded-2xl text-center bg-white/95 backdrop-blur-sm border border-white/20 mx-4">
        <svg className="w-12 h-12 mx-auto mb-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="var(--text-primary)" strokeWidth="1" />
          <circle cx="12" cy="12" r="7" stroke="var(--text-primary)" strokeWidth="1" />
          <circle cx="12" cy="12" r="4" stroke="var(--text-primary)" strokeWidth="1" />
        </svg>
        <h1 className="text-2xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h1>
        <p className="text-base mb-6" style={{ color: 'var(--text-muted)' }}>
          {body}
        </p>
        <div className="space-y-3">
          <Link
            href="/auth/signin"
            className="inline-block w-full px-4 py-3 rounded-lg font-medium transition-all hover:opacity-90"
            style={{ background: 'var(--accent-rust)', color: '#ffffff' }}
          >
            {cta}
          </Link>
          <Link
            href="/"
            className="block text-sm underline"
            style={{ color: 'var(--text-muted)' }}
          >
            Return to library
          </Link>
        </div>
      </div>
    </div>
  );
}
