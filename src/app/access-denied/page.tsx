'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function AccessDeniedContent() {
  const params = useSearchParams();
  const reason = params.get('reason');

  const isDeviceLimit = reason === 'device_limit';

  const title = isDeviceLimit ? 'Already Signed In' : 'Access Denied';
  const message = isDeviceLimit
    ? 'This account is already active on another device. To protect your one-time licence, only one device can be signed in at a time. Please sign out on your other device first, then try again.'
    : 'You do not have permission to access this page. If you believe this is an error, contact your system administrator.';

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: 'var(--bg-app)',
      textAlign: 'center',
    }}>
      {isDeviceLimit ? (
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--status-warning)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 20 }} aria-hidden="true">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
          <circle cx="12" cy="10" r="2" />
          <path d="M12 8v1M12 12v1" />
        </svg>
      ) : (
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--status-danger)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 20 }} aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="m4.9 4.9 14.2 14.2" />
        </svg>
      )}
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px' }}>
        {title}
      </h1>
      <p style={{ color: 'var(--text-secondary)', maxWidth: 340, margin: '0 0 28px', fontSize: '0.92rem', lineHeight: 1.6 }}>
        {message}
      </p>
      <a
        href="/login"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 22px',
          borderRadius: 8,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-primary)',
          textDecoration: 'none',
          fontSize: '0.9rem',
          fontWeight: 500,
        }}
      >
        Return to Login
      </a>
    </div>
  );
}

export default function AccessDeniedPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-app)',
      }}>
        <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>
      </div>
    }>
      <AccessDeniedContent />
    </Suspense>
  );
}
