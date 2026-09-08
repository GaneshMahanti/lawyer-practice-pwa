'use client';

import React, { useState } from 'react';

interface Fee { fee_type: string; amount: number; razorpay_link_url: string | null; }

interface Props {
  inviteId: string;
  rawToken: string;
  advocateName: string;
  fees: Fee[];
}

function feeLabel(type: string) {
  const labels: Record<string, string> = { consultation: 'Consultation Fee', legal_notice: 'Legal Notice Fee', case_fee: 'Case Fee' };
  return labels[type] || type;
}

function LockIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
}

export default function PortalForm({ inviteId, rawToken, advocateName, fees }: Props) {
  const [fullName, setFullName] = useState('');
  const [phone1, setPhone1] = useState('');
  const [phone2, setPhone2] = useState('');
  const [aadhaarInput, setAadhaarInput] = useState('');
  const [currentAddress, setCurrentAddress] = useState('');
  const [permanentAddress, setPermanentAddress] = useState('');
  const [sameAsCurrent, setSameAsCurrent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const totalFee = fees.reduce((s, f) => s + f.amount, 0);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = 'Full legal name is required.';
    if (!/^\d{10}$/.test(phone1.replace(/\D/g, ''))) errs.phone1 = 'Enter a valid 10-digit phone number.';
    if (!/^\d{12}$/.test(aadhaarInput.replace(/\s/g, ''))) errs.aadhaar = 'Aadhaar must be exactly 12 digits.';
    if (!currentAddress.trim()) errs.currentAddress = 'Current address is required.';
    const permAddr = sameAsCurrent ? currentAddress : permanentAddress;
    if (!permAddr.trim()) errs.permanentAddress = 'Permanent address is required.';
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    setValidationErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/portal/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: rawToken,
          inviteId,
          name: fullName.trim(),
          phone_1: phone1.replace(/\D/g, ''),
          phone_2: phone2.replace(/\D/g, '') || null,
          aadhaar_last4: aadhaarInput.replace(/\D/g, '').slice(-4),
          current_address: currentAddress.trim(),
          permanent_address: sameAsCurrent ? currentAddress.trim() : permanentAddress.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Submission failed.'); return; }
      setSuccess(true);
    } catch { setError('Network error. Please check your connection and try again.'); }
    finally { setSubmitting(false); }
  };

  if (success) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg-app)', textAlign: 'center' }}>
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--status-success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 20 }} aria-hidden="true">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <h1 style={{ color: 'var(--text-primary)', fontSize: '1.3rem', fontWeight: 700, margin: '0 0 10px' }}>Registration Submitted</h1>
        <p style={{ color: 'var(--text-secondary)', maxWidth: 340, lineHeight: 1.5, fontSize: '0.92rem' }}>
          Thank you. Your KYC information has been submitted to <strong>{advocateName}</strong>. They will contact you shortly.
        </p>
        {fees.length > 0 && (
          <div style={{ marginTop: 20, padding: '14px 20px', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-subtle)', maxWidth: 340, width: '100%' }}>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 10 }}>Fee Payment Links</div>
            {fees.map((f) => f.razorpay_link_url ? (
              <a key={f.fee_type} href={f.razorpay_link_url} target="_blank" rel="noopener noreferrer"
                style={{ display: 'block', padding: '10px 14px', borderRadius: 8, background: 'var(--accent-primary)', color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem', marginBottom: 8 }}>
                Pay {feeLabel(f.fee_type)} — ₹{f.amount.toLocaleString('en-IN')}
              </a>
            ) : null)}
          </div>
        )}
      </div>
    );
  }

  const field = (id: string, label: string, el: React.ReactNode) => (
    <div style={{ marginBottom: 14 }}>
      <label className="input-label" htmlFor={id}>{label}</label>
      {el}
      {validationErrors[id] && <div style={{ color: 'var(--status-danger)', fontSize: '0.78rem', marginTop: 3 }}>{validationErrors[id]}</div>}
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app)', padding: '24px 0 80px' }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 16px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24, paddingTop: 16 }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>Invited by</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{advocateName}</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 4 }}>Client Registration &amp; KYC</div>
        </div>

        {/* Fee Summary */}
        {fees.length > 0 && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title" style={{ marginBottom: 10 }}><span>Fee Summary</span></div>
            {fees.map((f) => (
              <div key={f.fee_type} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.88rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{feeLabel(f.fee_type)}</span>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>₹{f.amount.toLocaleString('en-IN')}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, fontSize: '0.95rem', fontWeight: 700 }}>
              <span style={{ color: 'var(--text-primary)' }}>Total</span>
              <span style={{ color: 'var(--accent-gold)' }}>₹{totalFee.toLocaleString('en-IN')}</span>
            </div>
          </div>
        )}

        {/* KYC Form */}
        <div className="card">
          <div className="card-title" style={{ marginBottom: 16 }}><span>Your Details (KYC)</span></div>

          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(220,50,50,0.1)', border: '1px solid rgba(220,50,50,0.3)', color: 'var(--status-danger)', fontSize: '0.85rem', marginBottom: 16 }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            {field('fullName', 'Full Legal Name *', <input id="fullName" type="text" className="input-field" placeholder="As on Aadhaar card" value={fullName} onChange={e => setFullName(e.target.value)} required />)}
            {field('phone1', 'Primary Phone Number *', <input id="phone1" type="tel" className="input-field" placeholder="10-digit mobile number" value={phone1} onChange={e => setPhone1(e.target.value)} required />)}
            {field('phone2', 'Secondary Phone Number (Optional)', <input id="phone2" type="tel" className="input-field" placeholder="Alternate number" value={phone2} onChange={e => setPhone2(e.target.value)} />)}

            {field('aadhaar', 'Aadhaar Number *', (
              <div>
                <input id="aadhaar" type="text" className="input-field" inputMode="numeric" maxLength={14}
                  placeholder="12-digit Aadhaar number"
                  value={aadhaarInput}
                  onChange={e => setAadhaarInput(e.target.value.replace(/[^\d]/g, '').slice(0, 12))}
                  required autoComplete="off" />
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  <LockIcon />
                  Only last 4 digits are stored. Full number is discarded immediately.
                </div>
              </div>
            ))}

            {field('currentAddress', 'Current Address *', <textarea id="currentAddress" className="input-field" rows={3} placeholder="House No., Street, Village/Town, District, State, PIN" value={currentAddress} onChange={e => setCurrentAddress(e.target.value)} required />)}

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={sameAsCurrent} onChange={e => setSameAsCurrent(e.target.checked)} />
                Permanent address same as current
              </label>
            </div>

            {!sameAsCurrent && field('permanentAddress', 'Permanent Address *', <textarea id="permanentAddress" className="input-field" rows={3} placeholder="House No., Street, Village/Town, District, State, PIN" value={permanentAddress} onChange={e => setPermanentAddress(e.target.value)} />)}

            <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--bg-app)', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.45, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <LockIcon />
                <strong style={{ color: 'var(--text-secondary)' }}>Legal Confidentiality</strong>
              </div>
              By submitting, you confirm the accuracy of your KYC information. Your data is stored securely under attorney-client privilege and used solely for legal representation purposes.
            </div>

            <button type="submit" className="action-btn action-btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '13px 0', fontSize: '0.95rem' }} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit KYC & Complete Registration'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
