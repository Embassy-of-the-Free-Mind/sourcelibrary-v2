'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';

const STORAGE_KEY = 'sl_beta_email';
const VIEW_COUNT_KEY = 'sl_page_views';
const FREE_VIEWS = 1; // Allow 1 free page view before gating

/**
 * Client-side beta gate hook. Not a security boundary — a lead generation mechanism.
 * Grants access if: user has next-auth session, email in localStorage, or still has free views.
 */
export function useBetaGate() {
  const { data: session } = useSession();
  const [hasAccess, setHasAccess] = useState(true); // Default true to avoid flash
  const [showGate, setShowGate] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const email = localStorage.getItem(STORAGE_KEY);
    setHasAccess(!!email || !!session?.user);
  }, [session]);

  const checkAccess = useCallback(() => {
    if (session?.user) return true;
    const email = localStorage.getItem(STORAGE_KEY);
    if (email) return true;
    // Check free views remaining
    const views = parseInt(localStorage.getItem(VIEW_COUNT_KEY) || '0', 10);
    return views < FREE_VIEWS;
  }, [session]);

  const requestAccess = useCallback(() => {
    if (session?.user) return true;
    const email = localStorage.getItem(STORAGE_KEY);
    if (email) return true;
    // Increment view count and check
    const views = parseInt(localStorage.getItem(VIEW_COUNT_KEY) || '0', 10);
    if (views < FREE_VIEWS) {
      localStorage.setItem(VIEW_COUNT_KEY, String(views + 1));
      return true;
    }
    setShowGate(true);
    return false;
  }, [session]);

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
