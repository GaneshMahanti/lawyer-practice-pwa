'use client';

import React from 'react';
import { useLanguage } from '@/lib/i18n/context';

export default function DiaryPage() {
  const { t } = useLanguage();

  return (
    <div>
      <div className="section-label">{t('diary')}</div>
      <div className="card">
        <div className="card-title">
          <span>Voice Diary Entries</span>
        </div>
        <div className="empty-state">
          Voice recorder and speech-to-text pipeline ready for Phase 4 implementation.
        </div>
      </div>
    </div>
  );
}
