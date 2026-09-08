'use client';

import React from 'react';
import { useLanguage } from '@/lib/i18n/context';

export default function BillingPage() {
  const { t } = useLanguage();

  return (
    <div>
      <div className="section-label">{t('billing')}</div>
      <div className="card">
        <div className="card-title">
          <span>Invoices & Payments</span>
        </div>
        <div className="empty-state">
          Razorpay Payment Links and invoice tracking ready for Phase 3 implementation.
        </div>
      </div>
    </div>
  );
}
