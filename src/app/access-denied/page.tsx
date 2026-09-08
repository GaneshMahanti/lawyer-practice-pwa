export default function AccessDeniedPage() {
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
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--status-danger)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 20 }} aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="m4.9 4.9 14.2 14.2" />
      </svg>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px' }}>
        Access Denied
      </h1>
      <p style={{ color: 'var(--text-secondary)', maxWidth: 320, margin: '0 0 28px', fontSize: '0.92rem', lineHeight: 1.5 }}>
        You do not have permission to access this page. If you believe this is an error, contact your system administrator.
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
