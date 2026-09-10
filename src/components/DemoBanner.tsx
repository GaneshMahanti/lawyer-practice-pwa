'use client';

import React, { useState } from 'react';
import { getWorkspaceState } from '@/lib/data/workspace';

export function DemoBanner() {
  const isDemo = getWorkspaceState().isDemo;
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isDemo) return null;

  const reset = async () => {
    setError(null);
    setResetting(true);
    try {
      const response = await fetch('/api/demo/reset', { method: 'POST' });
      if (!response.ok) throw new Error('Unable to reset the demo workspace.');
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.');
      setResetting(false);
    }
  };

  return (
    <div style={{ background: '#5b4b8a', color: '#fff', padding: '8px 12px', fontSize: '0.78rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span>Demo Mode — sample data only. Payments, WhatsApp, portal invites, and admin tools are blocked.</span>
        <button
          type="button"
          onClick={reset}
          disabled={resetting}
          style={{
            background: 'rgba(255,255,255,0.15)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.35)',
            borderRadius: 6,
            padding: '4px 10px',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {resetting ? 'Resetting…' : 'Reset sample data'}
        </button>
      </div>
      {error && <div style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
}
