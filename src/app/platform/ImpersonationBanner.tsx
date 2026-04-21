'use client';

import { useEffect, useState } from 'react';

interface ImpersonationInfo {
  userId: string;
  userEmail: string;
  userName: string;
  tenantId: string;
  tenantName: string;
  expiresAt: Date;
}

export function ImpersonationBanner() {
  const [mounted, setMounted] = useState(false);
  const [impersonation, setImpersonation] = useState<ImpersonationInfo | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    // Check for impersonation status from cookie or session
    const checkImpersonation = async () => {
      try {
        // Try to get from session cookie
        const impersonationCookie = document.cookie
          .split('; ')
          .find(row => row.startsWith('impersonation-token='));
        
        if (impersonationCookie) {
          // For now, we'll assume impersonation is active if the cookie exists
          // In production, you'd decode the JWT and extract the info
          // This is a simplified version that just shows the banner exists
          setImpersonation({
            userId: 'impersonating-user',
            userEmail: 'user@example.com',
            userName: 'User Name',
            tenantId: 'tenant-id',
            tenantName: 'Tenant Name',
            expiresAt: new Date(Date.now() + 3600000),
          });
        }
      } catch (err) {
        console.error('Failed to check impersonation status:', err);
      }
    };

    checkImpersonation();
  }, [mounted]);

  const handleStop = async () => {
    setStopping(true);
    try {
      const res = await fetch('/api/platform/impersonate/stop', { method: 'POST' });
      if (res.ok) {
        setImpersonation(null);
        // Reload to clear auth state
        window.location.reload();
      }
    } catch (err) {
      console.error('Failed to stop impersonation:', err);
      setStopping(false);
    }
  };

  if (!mounted || !impersonation) return null;

  const timeLeft = Math.max(0, Math.round((impersonation.expiresAt.getTime() - Date.now()) / 1000));
  const minutesLeft = Math.floor(timeLeft / 60);

  return (
    <div style={{
      background: '#4d1a1a',
      border: '1px solid #f85149',
      color: '#ffa198',
      padding: '10px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      fontSize: 13,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>🕵️</span>
        <span>
          <strong>Impersonating</strong> {impersonation.userName} ({impersonation.userEmail}) on {impersonation.tenantName}
          {minutesLeft > 0 && ` • ${minutesLeft}m remaining`}
        </span>
      </div>
      <button
        onClick={handleStop}
        disabled={stopping}
        style={{
          padding: '4px 12px',
          background: '#f85149',
          border: 'none',
          color: '#fff',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {stopping ? 'Stopping...' : 'Stop'}
      </button>
    </div>
  );
}
