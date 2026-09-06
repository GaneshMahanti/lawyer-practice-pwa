'use client';

import React from 'react';
import { useLanguage } from '@/lib/i18n/context';

export default function ClientsPage() {
  const { t } = useLanguage();

  return (
    <div>
      <div className="section-label">{t('clients')}</div>
      <div className="card">
        <div className="card-title">
          <span>Client Directory</span>
        </div>
        <div className="empty-state">
          No clients added yet. Ready for Phase 2 implementation.
        </div>
      </div>
    </div>
  );
}
