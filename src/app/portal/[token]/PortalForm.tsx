'use client';

import React, { useState } from 'react';
import { Lock, CheckCircle, ShieldCheck, CreditCard, ArrowRight } from 'lucide-react';
import type { PortalInviteStatus } from '@/lib/types/database';

interface Fee { fee_type: string; amount: number; razorpay_link_url: string | null; }

interface Props {
  inviteId: string;
  rawToken: string;
  advocateName: string;
  fees: Fee[];
  initialStatus?: PortalInviteStatus;
}

function feeLabel(type: string) {
  const labels: Record<string, string> = {
    consultation: 'Consultation Fee',
    legal_notice: 'Legal Notice Fee',
    case_fee: 'Case Retainer Fee',
  };
  return labels[type] || type.replace('_', ' ');
}

export default function PortalForm({ inviteId, rawToken, advocateName, fees, initialStatus = 'pending' }: Props) {
  const [fullName, setFullName] = useState('');
  const [phone1, setPhone1] = useState('');
  const [phone2, setPhone2] = useState('');
  const [aadhaarInput, setAadhaarInput] = useState('');
  const [currentAddress, setCurrentAddress] = useState('');
  const [permanentAddress, setPermanentAddress] = useState('');
  const [sameAsCurrent, setSameAsCurrent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(initialStatus === 'payment_pending' || initialStatus === 'submitted');
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
      if (!res.ok) {
        setError(data.error || 'Submission failed.');
        return;
      }
      setSuccess(true);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        background: 'var(--bg-app)',
        textAlign: 'center',
      }}>
        <div style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: 'rgba(34,197,94,0.12)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--status-success)',
          marginBottom: 16,
        }}>
          <CheckCircle size={32} />
        </div>
        <h1 style={{ color: 'var(--text-primary)', fontSize: '1.3rem', fontWeight: 700, margin: '0 0 8px' }}>
          Registration Submitted
        </h1>
        <p style={{ color: 'var(--text-secondary)', maxWidth: 360, lineHeight: 1.5, fontSize: '0.9rem', margin: '0 auto 20px' }}>
          Your KYC details have been verified and submitted to <strong>{advocateName}</strong>.
        </p>

        {fees.length > 0 && (
          <div style={{
            maxWidth: 420,
            width: '100%',
            background: 'var(--bg-card)',
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            padding: '20px 18px',
            textAlign: 'left',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              <CreditCard size={18} color="var(--accent-primary)" />
              <span>Prescribed Legal Fees</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {fees.map((f) => (
                <div key={f.fee_type} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: 8,
                }}>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {feeLabel(f.fee_type)}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', fontWeight: 700 }}>
                      ₹{f.amount.toLocaleString('en-IN')}
                    </div>
                  </div>
                  {f.razorpay_link_url ? (
                    <a
                      href={f.razorpay_link_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="action-btn action-btn-primary"
                      style={{ fontSize: '0.82rem', padding: '6px 14px', textDecoration: 'none' }}
                    >
                      Pay Now →
                    </a>
                  ) : (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Direct Payment
                    </span>
                  )}
                </div>
              ))}
            </div>

            {totalFee > 0 && (
              <div style={{
                borderTop: '1px solid var(--border-subtle)',
                marginTop: 14,
                paddingTop: 12,
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.95rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
              }}>
                <span>Total Amount:</span>
                <span style={{ color: 'var(--accent-primary)' }}>₹{totalFee.toLocaleString('en-IN')}</span>
              </div>
            )}
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
    <div style={{ minHeight: '100vh', background: 'var(--bg-app)', padding: '24px 16px 48px' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: 'linear-gradient(135deg, var(--accent-gold, #c8a03c), #9b722b)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px',
            color: '#fff',
          }}>
            <ShieldCheck size={26} />
          </div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>
            Client Onboarding Portal
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
            Legal Representation by <strong>{advocateName}</strong>
          </p>
        </div>

        {/* Card */}
        <div className="card">
          <div className="card-title" style={{ marginBottom: 16 }}><span>Client Details (KYC)</span></div>

          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(220,50,50,0.1)', border: '1px solid rgba(220,50,50,0.3)', color: 'var(--status-danger)', fontSize: '0.85rem', marginBottom: 16 }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            {field('fullName', 'Full Legal Name *', <input id="fullName" type="text" className="input-field" placeholder="As on official documents" value={fullName} onChange={e => setFullName(e.target.value)} required />)}
            {field('phone1', 'Primary Mobile Number *', <input id="phone1" type="tel" className="input-field" placeholder="10-digit mobile number" value={phone1} onChange={e => setPhone1(e.target.value)} required />)}
            {field('phone2', 'Secondary Phone Number (Optional)', <input id="phone2" type="tel" className="input-field" placeholder="Alternate phone number" value={phone2} onChange={e => setPhone2(e.target.value)} />)}

            {field('aadhaar', 'Aadhaar Number *', (
              <div>
                <input id="aadhaar" type="text" className="input-field" inputMode="numeric" maxLength={14}
                  placeholder="12-digit Aadhaar number"
                  value={aadhaarInput}
                  onChange={e => setAadhaarInput(e.target.value.replace(/[^\d]/g, '').slice(0, 12))}
                  required autoComplete="off" />
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  <Lock size={12} />
                  <span>Only the last 4 digits are stored for verification (UIDAI compliant).</span>
                </div>
              </div>
            ))}

            {field('currentAddress', 'Current Address *', <textarea id="currentAddress" className="input-field" rows={3} placeholder="House / Flat No., Street, Landmark, District, PIN" value={currentAddress} onChange={e => setCurrentAddress(e.target.value)} required />)}

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={sameAsCurrent} onChange={e => setSameAsCurrent(e.target.checked)} />
                Permanent address same as current
              </label>
            </div>

            {!sameAsCurrent && field('permanentAddress', 'Permanent Address *', <textarea id="permanentAddress" className="input-field" rows={3} placeholder="Permanent address details" value={permanentAddress} onChange={e => setPermanentAddress(e.target.value)} />)}

            {fees.length > 0 && (
              <div style={{ backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Attached Legal Fees</div>
                {fees.map((f) => (
                  <div key={f.fee_type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', marginTop: 4 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{feeLabel(f.fee_type)}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>₹{f.amount.toLocaleString('en-IN')}</span>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '0.9rem' }}>
                  <span>Total Due</span>
                  <span style={{ color: 'var(--accent-primary)' }}>₹{totalFee.toLocaleString('en-IN')}</span>
                </div>
              </div>
            )}

            <button
              type="submit"
              className="action-btn action-btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '12px 0', fontSize: '0.95rem' }}
              disabled={submitting}
            >
              {submitting ? 'Submitting Registration…' : 'Submit Registration Details →'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
