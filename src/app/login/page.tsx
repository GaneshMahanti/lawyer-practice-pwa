'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// SVG icon components (no emoji)
function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" /><path d="M12 17h.01" />
    </svg>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') || '/app';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const cleanEmail = email.trim().toLowerCase();
      const cleanPass = password;

      // 1. Check Developer credentials
      if (cleanEmail === 'mahanti9988@gmail.com' && cleanPass === 'Admin@1234') {
        const sessionPayload = JSON.stringify({ email: 'mahanti9988@gmail.com', role: 'developer' });
        document.cookie = `vakildesk_dev_session=${encodeURIComponent(sessionPayload)}; path=/; max-age=86400; SameSite=Lax`;
        router.push(nextPath);
        router.refresh();
        return;
      }

      // 2. Check Lawyer test user credentials
      if (cleanEmail === 'testuser@gmail.com' && cleanPass === 'Test@1234') {
        const sessionPayload = JSON.stringify({ email: 'testuser@gmail.com', role: 'lawyer' });
        document.cookie = `vakildesk_dev_session=${encodeURIComponent(sessionPayload)}; path=/; max-age=86400; SameSite=Lax`;
        router.push(nextPath);
        router.refresh();
        return;
      }

      // 3. If live Supabase credentials exist, authenticate against Supabase Auth
      const isPlaceholder = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
        process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://placeholder.supabase.co';

      if (!isPlaceholder) {
        const supabase = createClient();
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password: cleanPass });
        if (!error) {
          router.push(nextPath);
          router.refresh();
          return;
        }
      }

      setErrorMsg('Invalid email or password. Please check your credentials.');
    } catch {
      setErrorMsg('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      width: '100%',
      maxWidth: 420,
      background: 'var(--bg-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 16,
      padding: '32px 28px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
    }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 24px', color: 'var(--text-primary)' }}>
        Sign in to your account
      </h2>

      {errorMsg && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderRadius: 8,
          background: 'rgba(220,50,50,0.12)',
          border: '1px solid rgba(220,50,50,0.3)',
          color: 'var(--status-danger)',
          fontSize: '0.88rem',
          marginBottom: 20,
        }}>
          <AlertIcon />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div style={{ marginBottom: 16 }}>
          <label className="input-label" htmlFor="login-email">Email address</label>
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text-secondary)', pointerEvents: 'none',
            }}>
              <MailIcon />
            </span>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              className="input-field"
              style={{ paddingLeft: 42 }}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <label className="input-label" htmlFor="login-password">Password</label>
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text-secondary)', pointerEvents: 'none',
            }}>
              <LockIcon />
            </span>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              className="input-field"
              style={{ paddingLeft: 42 }}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        <button
          type="submit"
          className="action-btn action-btn-primary"
          style={{ width: '100%', justifyContent: 'center', padding: '12px 0', fontSize: '0.95rem' }}
          disabled={loading}
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      background: 'var(--bg-app)',
    }}>
      {/* Logo / Brand */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: 'linear-gradient(135deg, var(--accent-gold), var(--accent-gold-muted, #b8860b))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
          boxShadow: '0 4px 16px rgba(200,160,60,0.25)',
        }}>
          <LockIcon />
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
          VakilDesk
        </h1>
        <p style={{ color: 'var(--text-secondary)', margin: '6px 0 0', fontSize: '0.9rem' }}>
          Legal Practice Management
        </p>
      </div>

      <Suspense fallback={
        <div style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--bg-card)',
          borderRadius: 16,
          padding: 32,
          textAlign: 'center',
          color: 'var(--text-muted)',
        }}>
          Loading…
        </div>
      }>
        <LoginForm />
      </Suspense>

      <p style={{ marginTop: 24, color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: 'center' }}>
        Accounts are managed by the system administrator.
        <br />Contact your administrator if you need access.
      </p>
    </div>
  );
}
