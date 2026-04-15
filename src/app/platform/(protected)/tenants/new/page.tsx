'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export default function NewTenantPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [publicBrowsing, setPublicBrowsing] = useState(true);
  const [allowSignup, setAllowSignup] = useState(false);
  const [geminiQuota, setGeminiQuota] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slugManuallyEdited) {
      setSlug(slugify(name));
    }
  }, [name, slugManuallyEdited]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/platform/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug,
          settings: { publicBrowsing, allowSignup },
          geminiQuota,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create library');
      } else {
        router.push('/platform/dashboard');
      }
    } catch {
      setError('Failed to create library');
    } finally {
      setLoading(false);
    }
  };

  const slugValid = /^[a-z0-9-]+$/.test(slug) && slug.length > 0;

  return (
    <div style={{ maxWidth: 520 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: '#f0f6fc', margin: '0 0 24px' }}>
        New Library
      </h1>

      <form onSubmit={handleSubmit}>
        <div style={fieldStyle}>
          <label style={labelStyle}>Library name</label>
          <input
            type="text"
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="British Library"
            style={inputStyle}
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Slug</label>
          <input
            type="text"
            required
            value={slug}
            onChange={e => {
              setSlug(e.target.value);
              setSlugManuallyEdited(true);
            }}
            placeholder="british-library"
            style={{
              ...inputStyle,
              borderColor: slug && !slugValid ? '#f87171' : '#30363d',
            }}
          />
          <p style={{ fontSize: 12, color: slugValid ? '#8b949e' : '#f87171', margin: '4px 0 0' }}>
            {slug && !slugValid
              ? 'Lowercase letters, numbers, and hyphens only'
              : `Available at /${slug || 'your-slug'}/`}
          </p>
        </div>

        <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={labelStyle}>Public browsing</div>
            <div style={{ fontSize: 12, color: '#8b949e' }}>Anyone can browse the collection without signing in</div>
          </div>
          <Toggle checked={publicBrowsing} onChange={setPublicBrowsing} />
        </div>

        <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={labelStyle}>Allow open signup</div>
            <div style={{ fontSize: 12, color: '#8b949e' }}>Anyone can create an account (off = invite only)</div>
          </div>
          <Toggle checked={allowSignup} onChange={setAllowSignup} />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Max concurrent Gemini jobs</label>
          <input
            type="number"
            min={1}
            max={500}
            value={geminiQuota}
            onChange={e => setGeminiQuota(Number(e.target.value))}
            style={{ ...inputStyle, width: 120 }}
          />
          <p style={{ fontSize: 12, color: '#8b949e', margin: '4px 0 0' }}>
            Pipeline will not submit more than this many Gemini jobs simultaneously
          </p>
        </div>

        {error && (
          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 6,
            background: '#3d1a1a', color: '#f87171', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => router.push('/platform/dashboard')}
            style={{
              padding: '9px 18px', borderRadius: 6, background: 'transparent',
              color: '#8b949e', border: '1px solid #30363d', fontSize: 13, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !slugValid || !name}
            style={{
              padding: '9px 18px', borderRadius: 6, background: '#238636',
              color: '#ffffff', border: 'none', fontSize: 13, fontWeight: 500,
              cursor: 'pointer', opacity: loading || !slugValid || !name ? 0.5 : 1,
            }}
          >
            {loading ? 'Creating...' : 'Create Library'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 40,
        height: 22,
        borderRadius: 11,
        background: checked ? '#238636' : '#30363d',
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        flexShrink: 0,
        transition: 'background 0.15s',
      }}
    >
      <span style={{
        position: 'absolute',
        top: 3,
        left: checked ? 21 : 3,
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: '#ffffff',
        transition: 'left 0.15s',
      }} />
    </button>
  );
}

const fieldStyle: React.CSSProperties = {
  marginBottom: 20,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: '#e6edf3',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 6,
  background: '#0d1117',
  color: '#e6edf3',
  border: '1px solid #30363d',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};
