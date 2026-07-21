'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { BookLoader } from '@/components/ui/BookLoader';
import { isInAppBrowser, preferredBrowser, inAppBrowserName } from '@/lib/in-app-browser';
import { trackEvent } from '@/lib/track-event';
import { TurnstileWidget, turnstileConfigured } from '@/components/auth/TurnstileWidget';
import { suggestEmailFix } from '@/lib/email-typo';
import type { Locale } from '@/lib/i18n';

// Page-specific copy. Funnel pages (sign-in, support) get native Spanish so the
// acquisition front door reads in the visitor's language — Instagram/webview
// users have no browser-translate button (#2763). Deep pages stay English +
// browser translate (the thin-i18n bargain).
interface SignInStrings {
  checkEmail: string;
  sentLinkTo: (email: string) => string;
  clickLink: string;
  useDifferentEmail: string;
  signIn: string;
  subtitle: string;
  inAppWarn: (app: string | null, browser: string) => string;
  errAlreadyLinked: string;
  errEmailSignin: string;
  errGeneric: string;
  errSendLink: string;
  errRateLimited: string;
  didYouMean: (suggestion: string) => string;
  errVerify: string;
  errGoogle: string;
  emailLabel: string;
  sendingLink: string;
  continueEmail: string;
  or: string;
  redirectingGoogle: string;
  continueGoogle: string;
  googleOftenBlocked: string;
  agreePrefix: string;
  terms: string;
  and: string;
  privacy: string;
}

const STRINGS: Record<Locale, SignInStrings> = {
  en: {
    checkEmail: 'Check your email',
    sentLinkTo: () => 'We sent a sign-in link to',
    clickLink: 'Click the link to access the library.',
    useDifferentEmail: 'Use a different email',
    signIn: 'Sign In',
    subtitle: 'Access the full collection of rare texts in alchemy, Hermetica, and natural philosophy.',
    inAppWarn: (app, browser) =>
      `You're in ${app ? `${app}'s` : 'an'} in-app browser, where Google sign-in is usually blocked. Use email below — we'll send a link that opens in your normal browser and signs you in. (Or tap the … menu and choose "Open in ${browser}".)`,
    errAlreadyLinked: 'This email is already associated with another account.',
    errEmailSignin: 'Could not send sign-in email. Please try again.',
    errGeneric: 'An error occurred during sign in. Please try again.',
    errSendLink: 'Could not send sign-in link. Please try again.',
    errRateLimited: 'Too many sign-in requests from your network in the last hour. Wait a little and try again — this limit is shared by everyone on the same connection.',
    didYouMean: (suggestion) => `Did you mean ${suggestion}?`,
    errVerify: 'Please complete the verification below.',
    errGoogle: 'Could not connect to Google. Please try again.',
    emailLabel: 'Email address',
    sendingLink: 'Sending link...',
    continueEmail: 'Continue with Email',
    or: 'or',
    redirectingGoogle: 'Redirecting to Google...',
    continueGoogle: 'Continue with Google',
    googleOftenBlocked: 'Often blocked in in-app browsers — email is more reliable here.',
    agreePrefix: 'By signing in, you agree to our',
    terms: 'terms of service',
    and: 'and',
    privacy: 'privacy policy',
  },
  es: {
    checkEmail: 'Revisa tu correo',
    sentLinkTo: () => 'Enviamos un enlace de acceso a',
    clickLink: 'Haz clic en el enlace para acceder a la biblioteca.',
    useDifferentEmail: 'Usar otro correo',
    signIn: 'Iniciar sesión',
    subtitle: 'Accede a la colección completa de textos raros de alquimia, hermética y filosofía natural.',
    inAppWarn: (app, browser) =>
      `Estás en el navegador interno de ${app ?? 'una app'}, donde el acceso con Google suele estar bloqueado. Usa el correo abajo — te enviaremos un enlace que se abre en tu navegador normal y te identifica. (O toca el menú … y elige "Abrir en ${browser}".)`,
    errAlreadyLinked: 'Este correo ya está asociado a otra cuenta.',
    errEmailSignin: 'No se pudo enviar el correo de acceso. Inténtalo de nuevo.',
    errGeneric: 'Ocurrió un error al iniciar sesión. Inténtalo de nuevo.',
    errSendLink: 'No se pudo enviar el enlace de acceso. Inténtalo de nuevo.',
    errRateLimited: 'Demasiadas solicitudes de acceso desde tu red en la última hora. Espera un poco e inténtalo de nuevo — este límite se comparte con todos los que usan la misma conexión.',
    didYouMean: (suggestion) => `¿Quisiste decir ${suggestion}?`,
    errVerify: 'Por favor completa la verificación abajo.',
    errGoogle: 'No se pudo conectar con Google. Inténtalo de nuevo.',
    emailLabel: 'Correo electrónico',
    sendingLink: 'Enviando enlace...',
    continueEmail: 'Continuar con correo',
    or: 'o',
    redirectingGoogle: 'Redirigiendo a Google...',
    continueGoogle: 'Continuar con Google',
    googleOftenBlocked: 'A menudo bloqueado en navegadores internos — el correo es más fiable aquí.',
    agreePrefix: 'Al iniciar sesión, aceptas nuestros',
    terms: 'términos de servicio',
    and: 'y',
    privacy: 'política de privacidad',
  },
};

function SignInContent({ locale }: { locale: Locale }) {
  const s = STRINGS[locale];
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const error = searchParams.get('error');
  // 'limit' when arriving from an anon-gate wall (search/librarian/voice tag
  // their sign-in links with reason=limit); 'direct' otherwise (nav, etc.).
  const reason = searchParams.get('reason') === 'limit' ? 'limit' : 'direct';
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  // Non-blocking domain-typo hint. A mistyped domain mints a token, bounces at
  // Resend, and the person never learns why nothing arrived — see src/lib/email-typo.ts.
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const [inApp, setInApp] = useState(false);
  const [browser, setBrowser] = useState<'Safari' | 'Chrome'>('Chrome');
  const [appName, setAppName] = useState<string | null>(null);
  const loggedView = useRef(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    const webview = isInAppBrowser(ua);
    setInApp(webview);
    setBrowser(preferredBrowser(ua));
    setAppName(inAppBrowserName(ua));

    if (loggedView.current) return;
    loggedView.current = true;
    trackEvent('signin_view', {
      reason,
      source: callbackUrl,
      channel: webview ? `in-app:${inAppBrowserName(ua) ?? 'unknown'}` : 'browser',
      locale,
    });
  }, [reason, callbackUrl, locale]);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    if (turnstileConfigured && !turnstileToken) {
      setEmailError(s.errVerify);
      return;
    }
    setLoading(true);
    setEmailError('');
    trackEvent('signup_start', { source: 'signin_page', method: 'email' });
    try {
      const result = await signIn('nodemailer', {
        email,
        callbackUrl,
        redirect: false,
        'cf-turnstile-response': turnstileToken ?? '',
      });
      if (result?.error) {
        // 429 comes from our own magic-link guard (5/hour per IP, shared across
        // everyone behind one NAT). Saying so beats a generic failure the user
        // can only respond to by retrying into the same wall.
        setEmailError(result.status === 429 ? s.errRateLimited : s.errSendLink);
      } else {
        setEmailSent(true);
      }
    } catch {
      setEmailError(s.errSendLink);
    } finally {
      setLoading(false);
    }
  };

  if (emailSent) {
    return (
      <div className="min-h-screen relative flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/auth-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative z-10 w-full max-w-md p-8 rounded-2xl text-center bg-white/95 backdrop-blur-sm border border-white/20 mx-4">
          <svg className="w-12 h-12 mx-auto mb-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="var(--text-primary)" strokeWidth="1" />
            <circle cx="12" cy="12" r="7" stroke="var(--text-primary)" strokeWidth="1" />
            <circle cx="12" cy="12" r="4" stroke="var(--text-primary)" strokeWidth="1" />
          </svg>
          <h1 className="text-2xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>{s.checkEmail}</h1>
          <p className="text-base mb-6" style={{ color: 'var(--text-muted)' }}>
            {s.sentLinkTo(email)} <strong>{email}</strong>. {s.clickLink}
          </p>
          <button onClick={() => setEmailSent(false)} className="text-sm underline" style={{ color: 'var(--text-muted)' }}>
            {s.useDifferentEmail}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/auth-bg.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-black/50" />

      <div className="relative z-10 w-full max-w-md p-8 rounded-2xl bg-white/95 backdrop-blur-sm border border-white/20 mx-4">
        <div className="text-center mb-8">
          <Link href={locale === 'es' ? '/es' : '/'} className="inline-flex items-center gap-3 mb-4" aria-label="Source Library home">
            <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="var(--text-primary)" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="var(--text-primary)" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="var(--text-primary)" strokeWidth="1" />
            </svg>
            <span className="text-xl uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
              <span className="font-semibold">Source</span>
              <span className="font-light">Library</span>
            </span>
          </Link>
          <h1 className="text-2xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
            {s.signIn}
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {s.subtitle}
          </p>
        </div>

        {inApp && (
          <div className="mb-6 p-3 rounded-lg text-sm" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
            {s.inAppWarn(appName, browser)}
          </div>
        )}

        {(error || emailError) && (
          <div className="mb-6 p-3 rounded-lg text-sm" style={{ background: '#fef2f2', color: '#991b1b' }}>
            {emailError
              ? emailError
              : error === 'OAuthAccountNotLinked'
                ? s.errAlreadyLinked
                : error === 'EmailSignin'
                  ? s.errEmailSignin
                  : s.errGeneric}
          </div>
        )}

        {/* Email sign-in */}
        <form onSubmit={handleEmailSignIn} className="mb-4">
          <label htmlFor="email" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            {s.emailLabel}
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (suggestion) setSuggestion(null);
            }}
            onBlur={(e) => setSuggestion(suggestEmailFix(e.target.value))}
            placeholder="you@example.com"
            required
            className="w-full px-4 py-3 rounded-lg text-base outline-none transition-all"
            style={{
              background: 'var(--bg-warm)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-medium)',
            }}
          />
          {/* A hint, never a block: plenty of valid addresses live on domains no
              list will contain, and this audience uses hotmail.es / yahoo.com.ar
              heavily. One tap accepts it; typing dismisses it. */}
          {suggestion && (
            <button
              type="button"
              onClick={() => {
                setEmail(suggestion);
                setSuggestion(null);
              }}
              className="mt-1.5 text-sm underline text-left"
              style={{ color: 'var(--accent-rust)' }}
            >
              {s.didYouMean(suggestion)}
            </button>
          )}
          {/* Renders only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set. */}
          <TurnstileWidget onVerify={setTurnstileToken} />
          <button
            type="submit"
            disabled={loading || !email || (turnstileConfigured && !turnstileToken)}
            className="w-full mt-3 px-4 py-3 rounded-lg text-base font-medium transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: 'var(--accent-rust)', color: '#ffffff' }}
          >
            {loading ? s.sendingLink : s.continueEmail}
          </button>
        </form>

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px" style={{ background: 'var(--border-light)' }} />
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{s.or}</span>
          <div className="flex-1 h-px" style={{ background: 'var(--border-light)' }} />
        </div>

        <div className="space-y-3">
          <button
            onClick={async () => {
              setGoogleLoading(true);
              setEmailError('');
              trackEvent('signup_start', { source: 'signin_page', method: 'google' });
              try {
                await signIn('google', { callbackUrl });
              } catch {
                setEmailError(s.errGoogle);
                setGoogleLoading(false);
              }
            }}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg font-medium transition-all hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--bg-warm)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)', opacity: inApp ? 0.6 : 1 }}
          >
            {googleLoading ? (
              <>
                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                  <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                {s.redirectingGoogle}
              </>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                {s.continueGoogle}
              </>
            )}
          </button>
          {inApp && (
            <p className="text-center text-xs" style={{ color: 'var(--text-faint)' }}>
              {s.googleOftenBlocked}
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-xs" style={{ color: 'var(--text-faint)' }}>
          {s.agreePrefix}{' '}
          <Link href="/terms" className="underline hover:opacity-80">{s.terms}</Link>
          {' '}{s.and}{' '}
          <Link href="/privacy" className="underline hover:opacity-80">{s.privacy}</Link>.
        </p>
      </div>
    </div>
  );
}

export default function SignInForm({ locale = 'en' }: { locale?: Locale }) {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-cream)' }}>
        <BookLoader size="xs" />
      </div>
    }>
      <SignInContent locale={locale} />
    </Suspense>
  );
}
