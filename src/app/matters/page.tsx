'use client';

import React from 'react';
import { useLanguage } from '@/lib/i18n/context';

export default function MattersPage() {
  const { t } = useLanguage();

  return (
    <div>
      <div className="section-label">{t('cases')}</div>
      <div className="card">
        <div className="card-title">
          <span>Active Practice Matters</span>
        </div>
        <div className="empty-state">
          No active matters found. Ready for Phase 2 implementation.
        </div>
      </div>
    </div>
  );
}
