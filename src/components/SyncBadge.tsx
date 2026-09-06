'use client';

import React, { useState, useEffect } from 'react';
import { useLanguage } from '../lib/i18n/context';

export type SyncState = 'synced' | 'syncing' | 'offline' | 'sync_error';

export function SyncBadge() {
  const { t } = useLanguage();
  const [syncState, setSyncState] = useState<SyncState>('synced');

  useEffect(() => {
    const handleOnline = () => setSyncState('synced');
    const handleOffline = () => setSyncState('offline');

    if (typeof window !== 'undefined') {
      if (!navigator.onLine) setSyncState('offline');
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
    };
  }, []);

  const badgeConfig = {
    synced: { label: t('synced'), className: 'badge-synced' },
    syncing: { label: t('syncing'), className: 'badge-syncing' },
    offline: { label: t('offline'), className: 'badge-offline' },
    sync_error: { label: t('syncError'), className: 'badge-danger' },
  };

  const current = badgeConfig[syncState];

  return (
    <span className={`badge ${current.className}`} role="status" aria-live="polite">
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: 'currentColor',
          display: 'inline-block',
        }}
      />
      {current.label}
    </span>
  );
}
