'use client';

import React, { useEffect, useState } from 'react';
import { hydrateWorkspace, getWorkspaceState } from '@/lib/data/workspace';

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hydrateWorkspace().finally(() => {
      if (!cancelled) setReady(true);
    });
    const onOnline = () => { void hydrateWorkspace(); };
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
    };
  }, []);

  if (!ready) {
    return (
      <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        Loading practice workspace…
      </div>
    );
  }

  return <>{children}</>;
}

export function useDemoMode() {
  return getWorkspaceState().isDemo;
}
