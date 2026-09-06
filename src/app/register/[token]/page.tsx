'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { getClientByToken, submitClientKyc } from '@/lib/data/repository';
import type { Client, ClientFee } from '@/lib/types/database';

export default function ClientRegistrationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  // Next.js 16 params unwrap
  const unwrappedParams = React.use(params);
  const token = unwrappedParams.token;

  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<Client | null>(null);
  const [fees, setFees] = useState<ClientFee[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form Fields
  const [fullName, setFullName] = useState('');
  const [phone1, setPhone1] = useState('');
  const [phone2, setPhone2] = useState('');
  const [aadhaarInput, setAadhaarInput] = useState('');
  const [currentAddress, setCurrentAddress] = useState('');
  const [permanentAddress, setPermanentAddress] = useState('');
  const [sameAsCurrent, setSameAsCurrent] = useState(false);

  // Form submission state
  const [submitting, setSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setErrorMsg('Invalid or missing registration token.');
      setLoading(false);
      return;
    }

    const data = getClientByToken(token);
    if (!data) {
      setErrorMsg('This registration link is invalid, expired, or has already been completed. Please contact your advocate for a new link.');
      setLoading(false);
      return;
    }

    setClient(data.client);
    setFees(data.fees);
    if (data.client.name && data.client.name !== 'Prospective Client') {
      setFullName(data.client.name);
    }
    if (data.client.phone) {
      setPhone1(data.client.phone);
    }
    setLoading(false);
  }, [token]);

  // Sync permanent address if checkbox checked
  const handleSameAddressToggle = (checked: boolean) => {
    setSameAsCurrent(checked);
    if (checked) {
      setPermanentAddress(currentAddress);
    }
  };

  const handleCurrentAddressChange = (val: string) => {
    setCurrentAddress(val);
    if (sameAsCurrent) {
      setPermanentAddress(val);
    }
  };

  const validateForm = () => {
    const errs: Record<string, string> = {};

    if (!fullName.trim()) {
      errs.fullName = 'Full legal name is required.';
    }

    const rawPhone1 = phone1.replace(/\D/g, '');
    if (!rawPhone1 || rawPhone1.length < 10) {
      errs.phone1 = 'Please enter a valid 10-digit primary phone number.';
    }

    if (phone2) {
      const rawPhone2 = phone2.replace(/\D/g, '');
      if (rawPhone2.length < 10) {
        errs.phone2 = 'Secondary phone number must be at least 10 digits.';
      }
    }

    // Strict 12-digit Aadhaar validation
    const rawAadhaar = aadhaarInput.replace(/\s+/g, '');
    if (!rawAadhaar) {
      errs.aadhaar = 'Aadhaar number is mandatory for client KYC.';
    } else if (!/^\d{12}$/.test(rawAadhaar)) {
      errs.aadhaar = 'Aadhaar must be exactly 12 numeric digits (e.g. 1234 5678 9012).';
    }

    if (!currentAddress.trim()) {
      errs.currentAddress = 'Current address is required.';
    }

    if (!permanentAddress.trim()) {
      errs.permanentAddress = 'Permanent address is required.';
    }

    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);

    try {
      // UIDAI & Supreme Court Compliance:
      // The full 12-digit Aadhaar is masked to only the last 4 digits in the repository.
      // Full Aadhaar is NEVER stored in database, logs, or analytics.
      const result = submitClientKyc(token, {
        name: fullName.trim(),
        phone_1: phone1.trim(),
        phone_2: phone2.trim() || undefined,
        aadhaarNumber: aadhaarInput.replace(/\s+/g, ''),
        current_address: currentAddress.trim(),
        permanent_address: permanentAddress.trim(),
      });

      if (!result.success) {
        setErrorMsg(result.error || 'Failed to submit registration.');
        setSubmitting(false);
        return;
      }

      setIsSuccess(true);
      setSubmitting(false);
    } catch {
      setErrorMsg('An unexpected error occurred. Please try again or contact your advocate.');
      setSubmitting(false);
    }
  };

  // Format fee label
  const getFeeLabel = (type: string) => {
    switch (type) {
      case 'consultation':
        return 'Consultation Fee';
      case 'legal_notice':
        return 'Legal Notice Fee';
      case 'case_fee':
        return 'Case / Retainer Fee';
      default:
        return 'Legal Fee';
    }
  };

  const totalFeeAmount = fees.reduce((acc, f) => acc + f.amount, 0);

  if (loading) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
        <div style={{ color: 'var(--text-secondary)' }}>Verifying registration invite…</div>
      </div>
    );
  }

  if (errorMsg && !isSuccess) {
    return (
      <div style={{ padding: '32px 16px', maxWidth: 480, margin: '0 auto' }}>
        <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            Registration Link Invalid or Expired
          </div>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 20 }}>
            {errorMsg}
          </p>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            For client data security, onboarding links are single-use and expire automatically.
          </div>
        </div>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div style={{ padding: '32px 16px', maxWidth: 480, margin: '0 auto' }}>
        <div className="card" style={{ textAlign: 'center', padding: '36px 20px' }}>
          <div style={{ fontSize: '3rem', color: 'var(--status-success)', marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            Registration Submitted Successfully
          </div>
          <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 20 }}>
            Thank you, <strong>{fullName}</strong>. Your onboarding details and verification records have been securely transmitted to your Advocate.
          </p>
          <div style={{ backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 4 }}>
              Aadhaar Verification
            </div>
            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              XXXX-XXXX-{aadhaarInput.replace(/\s+/g, '').slice(-4)}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Stored strictly per UIDAI security guidelines.
            </div>
          </div>
          {totalFeeAmount > 0 && (
            <div style={{ marginTop: 12, padding: 14, border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Total Fee Scheduled</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--accent-primary)', marginTop: 2 }}>
                ₹{totalFeeAmount.toLocaleString('en-IN')}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px 40px' }}>
      {/* Brand Header */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <img
            src="/logo-light.png"
            alt="Advocate Logo"
            width={34}
            height={34}
            style={{ borderRadius: '50%' }}
          />
          <span style={{ fontWeight: 700, fontSize: '1.15rem', color: 'var(--text-primary)' }}>
            Advocate Client Onboarding
          </span>
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Mandatory KYC Verification & Representation Intake
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Section 1: Client KYC Information */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Client Details & KYC</div>

          {/* Full Name */}
          <label className="input-label">Full Name (as per Govt ID) *</label>
          <input
            type="text"
            className="input-field"
            placeholder="e.g. Rajesh Kumar"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          {validationErrors.fullName && (
            <div style={{ color: 'var(--status-danger)', fontSize: '0.78rem', marginTop: -6, marginBottom: 10 }}>
              {validationErrors.fullName}
            </div>
          )}

          {/* Aadhaar Number with Security Compliance Notice */}
          <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Aadhaar Number (12 digits) *</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', fontWeight: 500 }}>
              🔒 Masked on storage
            </span>
          </label>
          <input
            type="text"
            className="input-field"
            placeholder="1234 5678 9012"
            maxLength={14}
            value={aadhaarInput}
            onChange={(e) => {
              // Allow numbers and spaces for readable formatting
              const val = e.target.value.replace(/[^\d\s]/g, '');
              setAadhaarInput(val);
            }}
          />
          {validationErrors.aadhaar && (
            <div style={{ color: 'var(--status-danger)', fontSize: '0.78rem', marginTop: -6, marginBottom: 10 }}>
              {validationErrors.aadhaar}
            </div>
          )}
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: -6, marginBottom: 12, lineHeight: 1.4 }}>
            Per UIDAI and Supreme Court guidelines, only the last 4 digits (XXXX-XXXX-{aadhaarInput.replace(/\s+/g, '').slice(-4) || 'XXXX'}) are preserved. Full Aadhaar is never stored.
          </div>

          {/* Phone No. 1 */}
          <label className="input-label">Phone No. 1 (Primary) *</label>
          <input
            type="tel"
            className="input-field"
            placeholder="e.g. 9876543210"
            maxLength={14}
            value={phone1}
            onChange={(e) => setPhone1(e.target.value)}
          />
          {validationErrors.phone1 && (
            <div style={{ color: 'var(--status-danger)', fontSize: '0.78rem', marginTop: -6, marginBottom: 10 }}>
              {validationErrors.phone1}
            </div>
          )}

          {/* Secondary Phone No. */}
          <label className="input-label">Secondary Phone No. (Optional)</label>
          <input
            type="tel"
            className="input-field"
            placeholder="e.g. 9123456780"
            maxLength={14}
            value={phone2}
            onChange={(e) => setPhone2(e.target.value)}
          />
          {validationErrors.phone2 && (
            <div style={{ color: 'var(--status-danger)', fontSize: '0.78rem', marginTop: -6, marginBottom: 10 }}>
              {validationErrors.phone2}
            </div>
          )}

          {/* Current Address */}
          <label className="input-label">Current Address *</label>
          <textarea
            className="input-field"
            rows={2}
            placeholder="Door No, Street, Landmark, City, State, PIN"
            value={currentAddress}
            onChange={(e) => handleCurrentAddressChange(e.target.value)}
            style={{ resize: 'vertical' }}
          />
          {validationErrors.currentAddress && (
            <div style={{ color: 'var(--status-danger)', fontSize: '0.78rem', marginTop: -6, marginBottom: 10 }}>
              {validationErrors.currentAddress}
            </div>
          )}

          {/* Same Address Checkbox */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 12px' }}>
            <input
              type="checkbox"
              id="sameAddress"
              checked={sameAsCurrent}
              onChange={(e) => handleSameAddressToggle(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--accent-primary)' }}
            />
            <label htmlFor="sameAddress" style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              Permanent address is same as current address
            </label>
          </div>

          {/* Permanent Address */}
          <label className="input-label">Permanent Address *</label>
          <textarea
            className="input-field"
            rows={2}
            placeholder="Permanent legal residential address"
            value={permanentAddress}
            disabled={sameAsCurrent}
            onChange={(e) => setPermanentAddress(e.target.value)}
            style={{ resize: 'vertical', opacity: sameAsCurrent ? 0.7 : 1 }}
          />
          {validationErrors.permanentAddress && (
            <div style={{ color: 'var(--status-danger)', fontSize: '0.78rem', marginTop: -6, marginBottom: 10 }}>
              {validationErrors.permanentAddress}
            </div>
          )}
        </div>

        {/* Section 2: Read-Only Itemized Fee Breakdown (Only Non-Zero Fees!) */}
        {fees.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Fee Summary</div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
              The following legal representation fee structure has been prescribed by your advocate:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {fees.map((fee) => (
                <div
                  key={fee.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                    {getFeeLabel(fee.fee_type)}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                    ₹{fee.amount.toLocaleString('en-IN')}
                  </span>
                </div>
              ))}

              {/* Total */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: 8,
                }}
              >
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                  Total Applicable Fees
                </span>
                <span style={{ fontWeight: 800, fontSize: '1.2rem', color: 'var(--accent-primary)' }}>
                  ₹{totalFeeAmount.toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {/* Optional Razorpay Pay Now button */}
            <div style={{ marginTop: 16 }}>
              <a
                href={`https://rzp.io/l/demo-legal-payment?amount=${totalFeeAmount}`}
                target="_blank"
                rel="noopener noreferrer"
                className="action-btn action-btn-primary"
                style={{ width: '100%', justifyContent: 'center', textAlign: 'center', textDecoration: 'none' }}
              >
                💳 Pay Now via Razorpay (₹{totalFeeAmount.toLocaleString('en-IN')})
              </a>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
                Secure UPI, Net Banking, and Card payment through Razorpay.
              </div>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          className="action-btn action-btn-primary"
          style={{ width: '100%', justifyContent: 'center', padding: '14px 20px', fontSize: '1rem' }}
          disabled={submitting}
        >
          {submitting ? 'Submitting KYC Verification…' : 'Submit KYC & Complete Registration'}
        </button>

        <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 12 }}>
          🔒 By submitting, you confirm the accuracy of your KYC information under legal confidentiality.
        </div>
      </form>
    </div>
  );
}
