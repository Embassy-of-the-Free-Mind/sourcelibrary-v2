'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';

const STORAGE_KEY = 'sl_beta_email';

/**
 * Client-side beta gate hook. Not a security boundary — a lead generation mechanism.
 * Grants access if: book is featured, user has next-auth session, or email in localStorage.
 */
export function useBetaGate(bookFeatured?: boolean) {
  const { data: session } = useSession();
  const [hasAccess, setHasAccess] = useState(true); // Default true to avoid flash
  const [showGate, setShowGate] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const email = localStorage.getItem(STORAGE_KEY);
    setHasAccess(!!email || !!bookFeatured || !!session?.user);
  }, [bookFeatured, session]);

  const checkAccess = useCallback(() => {
    if (bookFeatured) return true;
    if (session?.user) return true;
    const email = localStorage.getItem(STORAGE_KEY);
    return !!email;
  }, [bookFeatured, session]);

  const requestAccess = useCallback(() => {
    if (checkAccess()) return true;
    setShowGate(true);
    return false;
  }, [checkAccess]);

  const grantAccess = useCallback((email: string) => {
    localStorage.setItem(STORAGE_KEY, email);
    setHasAccess(true);
    setShowGate(false);
  }, []);

  const dismissGate = useCallback(() => {
    setShowGate(false);
  }, []);

  return {
    hasAccess: !mounted || hasAccess,
    showGate,
    requestAccess,
    grantAccess,
    dismissGate,
    checkAccess,
  };
}
