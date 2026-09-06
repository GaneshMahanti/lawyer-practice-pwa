'use client';

import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/lib/i18n/context';
import { SupportedLanguage } from '@/lib/types/database';

export default function SettingsPage() {
  const { language, setLanguage, t } = useLanguage();
  const [barCouncilNo, setBarCouncilNo] = useState('');
  const [advocateName, setAdvocateName] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    try {
      const savedBar = localStorage.getItem('vakildesk_bar_no');
      const savedName = localStorage.getItem('vakildesk_advocate_name');
      if (savedBar) setBarCouncilNo(savedBar);
      if (savedName) setAdvocateName(savedName);
    } catch {
      // Storage access unavailable
    }
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus('saving');
    try {
      localStorage.setItem('vakildesk_bar_no', barCouncilNo);
      localStorage.setItem('vakildesk_advocate_name', advocateName);
      setTimeout(() => setSaveStatus('saved'), 400);
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('idle');
    }
  };

  return (
    <div>
      <div className="section-label">{t('settings')}</div>

      <div className="card">
        <div className="card-title">
          <span>{t('language')}</span>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', marginBottom: 12 }}>
          Choose your preferred interface language.
        </p>

        <div style={{ display: 'flex', gap: 8 }}>
          {(['en', 'hi', 'te'] as SupportedLanguage[]).map((lang) => (
            <button
              key={lang}
              type="button"
              className={`action-btn ${language === lang ? 'action-btn-primary' : ''}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => setLanguage(lang)}
            >
              {lang === 'en' ? 'English' : lang === 'hi' ? 'हिन्दी' : 'తెలుగు'}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>{t('lawyerProfile')}</span>
        </div>

        <form onSubmit={handleSave}>
          <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
            Advocate Name
          </label>
          <input
            type="text"
            className="input-field"
            placeholder="e.g. Adv. R. K. Sharma"
            value={advocateName}
            onChange={(e) => setAdvocateName(e.target.value)}
          />

          <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
            {t('barCouncilNumber')}
          </label>
          <input
            type="text"
            className="input-field"
            placeholder="e.g. D/1234/2015"
            value={barCouncilNo}
            onChange={(e) => setBarCouncilNo(e.target.value)}
          />

          <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
            {t('courtTimezone')}
          </label>
          <input
            type="text"
            className="input-field"
            value="Asia/Kolkata (IST, UTC+05:30)"
            disabled
            style={{ opacity: 0.7, cursor: 'not-allowed' }}
          />

          <button
            type="submit"
            className="action-btn action-btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
            disabled={saveStatus === 'saving'}
          >
            {saveStatus === 'saving'
              ? 'Saving…'
              : saveStatus === 'saved'
              ? 'Profile details saved'
              : 'Save profile details'}
          </button>
        </form>
      </div>

      <div className="disclaimer-box" role="note">
        <div className="disclaimer-title">{t('disclaimerTitle')}</div>
        <div>{t('disclaimerText')}</div>
      </div>
    </div>
  );
}
