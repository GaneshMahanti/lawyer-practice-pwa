'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Lock, Mail, AlertTriangle } from 'lucide-react';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.26v3.15C3.25 21.36 7.33 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.26C.46 8.16 0 9.98 0 12s.46 3.84 1.26 5.42l4.02-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.25 2.64 1.26 6.58l4.02 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') || '/app';
  const urlError = searchParams.get('error');
  const urlErrorDesc = searchParams.get('error_description');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (urlError) {
      if (urlError.includes('access_denied') || urlError.includes('unauthorized')) {
        setErrorMsg('Access denied: Only explicitly approved accounts may sign in.');
      } else if (urlError === 'auth_failed') {
        setErrorMsg('Authentication failed. Please try again.');
      } else {
        setErrorMsg(urlErrorDesc || 'Sign-in was cancelled or encountered an error.');
      }
    }
  }, [urlError, urlErrorDesc]);

  // Google OAuth Login
  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setGoogleLoading(true);

    try {
      const supabase = createClient();
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) {
        setErrorMsg('Unable to initiate Google Sign-In. Please check your connection.');
        setGoogleLoading(false);
      }
    } catch {
      setErrorMsg('Google authentication service is currently unavailable.');
      setGoogleLoading(false);
    }
  };

  // Password Login
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
      <h2 style={{ fontSize: '1.15rem', fontWeight: 600, margin: '0 0 20px', color: 'var(--text-primary)', textAlign: 'center' }}>
        Sign in to VakilDesk
      </h2>

      {errorMsg && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderRadius: 8,
          background: 'rgba(220,50,50,0.1)',
          border: '1px solid rgba(220,50,50,0.3)',
          color: 'var(--status-danger)',
          fontSize: '0.86rem',
          marginBottom: 20,
          lineHeight: 1.4,
        }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Google OAuth Button */}
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={googleLoading || loading}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: '11px 16px',
          borderRadius: 8,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface-elevated, #fff)',
          color: 'var(--text-primary)',
          fontSize: '0.92rem',
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          transition: 'all 0.15s ease',
          marginBottom: 20,
        }}
      >
        <GoogleIcon />
        <span>{googleLoading ? 'Connecting to Google…' : 'Continue with Google'}</span>
      </button>

      {/* Divider */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        margin: '0 0 20px',
        color: 'var(--text-muted)',
        fontSize: '0.78rem',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
        <span style={{ padding: '0 12px' }}>or sign in with email</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div style={{ marginBottom: 16 }}>
          <label className="input-label" htmlFor="login-email">Email address</label>
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text-secondary)', pointerEvents: 'none', display: 'flex',
            }}>
              <Mail size={18} />
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
              disabled={loading || googleLoading}
            />
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <label className="input-label" htmlFor="login-password">Password</label>
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text-secondary)', pointerEvents: 'none', display: 'flex',
            }}>
              <Lock size={18} />
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
              disabled={loading || googleLoading}
            />
          </div>
        </div>

        <button
          type="submit"
          className="action-btn action-btn-primary"
          style={{ width: '100%', justifyContent: 'center', padding: '12px 0', fontSize: '0.95rem' }}
          disabled={loading || googleLoading}
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
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
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
          <Lock size={24} color="#fff" />
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
          VakilDesk
        </h1>
        <p style={{ color: 'var(--text-secondary)', margin: '6px 0 0', fontSize: '0.9rem' }}>
          Advocate Practice Management
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

      <p style={{ marginTop: 24, color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: 'center', maxWidth: 360, lineHeight: 1.45 }}>
        Access is restricted to verified advocate and system accounts.
      </p>
    </div>
  );
}
