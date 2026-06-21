'use client';

import { useEffect, useState } from 'react';

// Minimal, client-side-only localization for the homepage hero — the
// bounce-critical first screen. We deliberately do NOT localize server-side:
// the homepage HTML is edge-cached for 24h, and branching SSR output on
// Accept-Language without a cache-key change would serve a cached Spanish page
// to English visitors (same failure class as the stale-CSS incident). Keeping
// this purely client-side leaves the cache untouched — English renders first,
// then this swaps to Spanish after hydration for es-locale visitors.
//
// Audience context: ~84% mobile, mostly from Instagram webviews where the
// browser "translate" button does not exist — but navigator.language still
// reflects the device language, so detection works there too.

export type Lang = 'en' | 'es';

const STORAGE_KEY = 'sl_lang';

export const HERO_STRINGS = {
  en: {
    title: 'A New Renaissance of Ancient Wisdom',
    subtitleLine1: 'Welcome to the world’s largest library',
    subtitleLine2: 'of AI-translated ancient sources.',
    emailPlaceholder: 'Your email address',
    join: 'Join us',
    sending: 'Sending…',
    checkEmail: 'Check your email — we sent a sign-in link to',
    differentEmail: 'Use a different email',
    google: 'Or continue with Google',
    haveAccount: 'Already have an account?',
    explore: 'Explore the collection',
  },
  es: {
    title: 'Un nuevo Renacimiento de la sabiduría antigua',
    subtitleLine1: 'Bienvenido a la mayor biblioteca del mundo',
    subtitleLine2: 'de fuentes antiguas traducidas con IA.',
    emailPlaceholder: 'Tu correo electrónico',
    join: 'Únete',
    sending: 'Enviando…',
    checkEmail: 'Revisa tu correo — enviamos un enlace de acceso a',
    differentEmail: 'Usar otro correo',
    google: 'O continúa con Google',
    haveAccount: '¿Ya tienes una cuenta?',
    explore: 'Explora la colección',
  },
} as const;

export type HeroStrings = { readonly [K in keyof (typeof HERO_STRINGS)['en']]: string };

/**
 * Resolve the hero language client-side. Priority: saved override (the toggle)
 * > navigator.language > English. Starts at 'en' so SSR and first paint match
 * the cached English HTML; updates after mount.
 */
export function useHeroLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'en' || saved === 'es') {
        setLangState(saved);
        return;
      }
      const nav = (navigator.language || '').toLowerCase();
      if (nav.startsWith('es')) setLangState('es');
    } catch {
      // localStorage/navigator unavailable — stay English.
    }
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore persistence failure
    }
  };

  return [lang, setLang];
}
